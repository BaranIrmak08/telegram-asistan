// Telegram -> Cloudflare Workers AI (ayrıştırma) -> Notion asistanı. Cloudflare Workers üzerinde çalışır.
// Telegram -> Cloudflare Workers AI (parsing) -> Notion assistant. Runs on Cloudflare Workers.
// Kurulum / Setup: README.md
//
// Gerekli Secret'lar / Required secrets (Cloudflare -> Worker -> Settings -> Variables and Secrets):
//   TELEGRAM_TOKEN   BotFather'ın verdiği token / token from BotFather
//   WEBHOOK_SECRET   uydurduğun uzun rastgele metin (harf/rakam/_/-) / long random text you make up (letters, digits, _ and -)
//   NOTION_TOKEN     Notion integration secret'ı / Notion integration secret
// Gerekli binding / Required binding: Workers AI, adı/name "AI"
// İsteğe bağlı / Optional:
//   ALLOWED_CHAT_ID  bot yalnızca bu sohbete cevap verir / bot only answers this chat (bot tells you the id on first message)
//   NOTION_PAGE_ID   tabloların oluşturulacağı Notion sayfası / Notion page where tables are created (only if auto-detect fails)
//   AI_MODEL         varsayılan / default: @cf/meta/llama-3.1-8b-instruct-fp8
//   TIMEZONE         varsayılan / default: Europe/Istanbul
//   DB_HARCAMALAR, DB_GELIRLER, DB_GOREVLER, DB_NOTLAR, DB_ABONELIKLER, DB_KASA
//                    tablo id'sini elle vermek için / to set a table id by hand (normally found automatically by name)
//
// Kurulumdan sonra tarayıcıda https://<worker-adresin>/kurulum aç: tabloları oluşturur ve Telegram'a bağlar.
// After setup open https://<your-worker-address>/kurulum in a browser: it creates the tables and connects Telegram.

// Notion tabloları adlarıyla bulunur (ilk mesajda bir kez, sonra hafızada tutulur).
// Notion tables are found by their names (once, then cached).
const TABLES = {
  expense: { title: "Harcamalar", env: "DB_HARCAMALAR" },
  income: { title: "Gelirler", env: "DB_GELIRLER" },
  task: { title: "Görevler", env: "DB_GOREVLER" },
  note: { title: "Notlar", env: "DB_NOTLAR" },
  sub: { title: "Abonelikler", env: "DB_ABONELIKLER" },
  cash: { title: "Kasa", env: "DB_KASA" },
};
let DB = null; // { expense: "id", ... }
let TASK_STATUS_TYPE = "status"; // Görevler > Durum sütunu "status" ya da "select" olabilir
let TZ = "Europe/Istanbul";

const CATEGORIES = ["Yiyecek-İçecek", "Market", "Ulaşım", "Fatura", "Eğlence", "Alışveriş", "Sağlık", "Diğer"];
const INCOME_SOURCES = ["Harçlık", "Maaş", "Burs-Destek", "Hediye", "Ek Gelir", "Diğer"];
const TAGS = ["Fikir", "Kitap-Film", "Alışveriş Listesi", "Diğer"];

export default {
  async fetch(request, env, ctx) {
    TZ = env.TIMEZONE || "Europe/Istanbul";
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.replace(/\/+$/, "") === "/kurulum") {
      const report = await setup(env, url.origin);
      return new Response(report, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (request.method !== "POST") return new Response("ok");
    if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await request.json();
    const msg = update.message;
    if (msg && msg.text) ctx.waitUntil(handle(msg, env));
    return new Response("ok");
  },

  // Cron Trigger (günde bir kez): abonelik günü gelenleri Harcamalar'a ekler, ertesi gün çekilecekleri hatırlatır.
  async scheduled(event, env, ctx) {
    TZ = env.TIMEZONE || "Europe/Istanbul";
    ctx.waitUntil(loadDB(env).then(() => runSubscriptions(env)));
  },
};

async function handle(msg, env) {
  const chatId = msg.chat.id;
  // Bir şey takılırsa sessiz kalmak yerine haber ver.
  const watchdog = setTimeout(() => send(env, chatId, "⏳ Bu işlem çok uzun sürdü. Bir daha dener misin?").catch(() => {}), 22000);
  try {
    if (!env.ALLOWED_CHAT_ID) {
      await send(env, chatId, `Chat ID'n: ${chatId}\nBunu Cloudflare'de ALLOWED_CHAT_ID olarak gir.\n\nYour chat ID: ${chatId}\nAdd it in Cloudflare as ALLOWED_CHAT_ID.`);
      return;
    }
    if (String(chatId).trim() !== String(env.ALLOWED_CHAT_ID).trim()) {
      await send(env, chatId, `⛔ Yetkisiz sohbet (${chatId}). ALLOWED_CHAT_ID farklı.`);
      return;
    }
    await loadDB(env);

    const items = await parse(env, msg.text);
    const lines = [];
    for (const item of items) {
      try {
        lines.push(await save(env, item, msg.text));
      } catch (e) {
        lines.push(`⚠️ Kaydedilemedi (${item.description || item.title || "?"}): ${e.message}`);
      }
    }
    await send(env, chatId, lines.join("\n"));
  } catch (e) {
    console.error("handle hatası:", e.message);
    await send(env, chatId, `⚠️ Hata: ${e.message}`);
  } finally {
    clearTimeout(watchdog);
  }
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`zaman aşımı (${ms / 1000} sn)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function parse(env, text) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
  // Önümüzdeki 8 günün tarihi ve gün adı: "cumartesi", "yarın" gibi ifadeleri model hesaplamasın.
  const days = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(Date.now() + i * 86400000);
    const iso = d.toLocaleDateString("sv-SE", { timeZone: TZ });
    const name = d.toLocaleDateString("tr-TR", { weekday: "long", timeZone: TZ });
    return `${name} = ${iso}${i === 0 ? " (bugün)" : i === 1 ? " (yarın)" : ""}`;
  }).join("; ");
  const tomorrow = days.match(/(\d{4}-\d{2}-\d{2}) \(yarın\)/)[1];
  const prompt = `Bir kişisel asistansın. Kullanıcının Telegram mesajını sınıflandır ve SADECE JSON döndür.
Mesaj birden fazla şey içerebilir (örn. iki harcama ve bir randevu). Her şey için AYRI bir nesne yaz ve hepsini {"items":[...]} içine koy. Tek şey varsa da {"items":[{...}]} kullan.
Takvim: ${days}.
Bir gün adı (cumartesi, pazartesi...) veya "yarın" geçerse bu takvimden tarihi bul ve due alanına yaz.

ASLA soru sorma. Bilgi eksikse null yaz, tahmin etme.

Türler:
- "expense": SADECE para harcandığında ve mesajda bir TUTAR varsa. Alanlar: description (kısa), amount (sayı, TL), category (${CATEGORIES.join(", ")}), date (YYYY-MM-DD, belirtilmediyse bugün)
- "income": kullanıcıya para GELDİYSE (harçlık verdi, maaş yattı, para gönderdi, hediye para, burs) ve mesajda bir TUTAR varsa. Alanlar: description (kısa), amount (sayı, TL), source (${INCOME_SOURCES.join(", ")}), from (kimden: "Baba", "Anne" gibi, bilinmiyorsa null), date (YYYY-MM-DD, belirtilmediyse bugün)
- "task": yapılacak iş, randevu, buluşma, hatırlatma, plan. Alanlar: title (kısa), due (YYYY-MM-DD veya null), time (mesajda saat/zaman varsa metin, yoksa null), place (mesajda yer varsa metin, yoksa null)
- "note": bilgi, fikir, liste, öneri, okunacak/izlenecek şey. Alanlar: title (kısa), content, tags (${TAGS.join(", ")} içinden dizi)
- "cash_set": kullanıcı şu an elinde/cebinde/hesabında ne kadar parası olduğunu söylüyor (başlangıç bakiyesi). Alan: amount (sayı, TL). Sayıları düz sayıya çevir: 7 bin = 7000, 12.500 = 12500.
- "query": kullanıcı harcama, gelir veya parasını soruyor. Alanlar: kind ("expense" harcama, "income" gelir, "balance" bir dönemin gelir-gider farkı, "cash" şu an ne kadar parası var), period ("today", "week", "month" veya "last_month"), category (sadece harcama için: ${CATEGORIES.join(", ")} içinden veya null)
- "subscription": abonelik ekleme, güncelleme veya iptal. Alanlar: name (kısa ad), amount (sayı veya null), day (ayın kaçıncı günü çekildiği 1-31 veya null), category (listeden veya null), cancel (iptalse true, değilse false)
- "chat": sadece açık bir soru veya selamlama. Alan: reply (kısa Türkçe cevap)

Tutar yoksa "expense" veya "income" ASLA seçme.
Para kullanıcıya geldiyse "income", kullanıcı verdiyse veya harcadıysa "expense" seç.

Örnekler:
"kahve 120tl" -> {"items":[{"type":"expense","description":"Kahve","amount":120,"category":"Yiyecek-İçecek","date":"${today}"}]}
"yarın 5'te diş doktoru" -> {"items":[{"type":"task","title":"Diş doktoru","due":"${tomorrow}","time":"17:00","place":null}]}
"cumartesi çağanla buluşma" -> {"items":[{"type":"task","title":"Çağan'la buluşma","due":"<takvimdeki cumartesi tarihi>","time":null,"place":null}]}
"avm'de ayakkabı bak" -> {"items":[{"type":"task","title":"AVM'de ayakkabı bak","due":null,"time":null,"place":"AVM"}]}
"Dune kitabını oku" -> {"items":[{"type":"note","title":"Dune kitabını oku","content":"Dune kitabını oku","tags":["Kitap-Film"]}]}
"babam 500 lira harçlık verdi" -> {"items":[{"type":"income","description":"Harçlık","amount":500,"source":"Harçlık","from":"Baba","date":"${today}"}]}
"baba 500 TL harçlık" -> {"items":[{"type":"income","description":"Harçlık","amount":500,"source":"Harçlık","from":"Baba","date":"${today}"}]}
"maaş yattı 40000" -> {"items":[{"type":"income","description":"Maaş","amount":40000,"source":"Maaş","from":null,"date":"${today}"}]}
"babama 300 lira verdim" -> {"items":[{"type":"expense","description":"Babama verilen","amount":300,"category":"Diğer","date":"${today}"}]}
"bu ay ne kadar harcadım" -> {"items":[{"type":"query","kind":"expense","period":"month","category":null}]}
"bu hafta markete ne kadar gitti" -> {"items":[{"type":"query","kind":"expense","period":"week","category":"Market"}]}
"geçen ay toplam harcamam" -> {"items":[{"type":"query","kind":"expense","period":"last_month","category":null}]}
"bu ay ne kadar gelirim oldu" -> {"items":[{"type":"query","kind":"income","period":"month","category":null}]}
"bu ay gelir gider farkım ne" -> {"items":[{"type":"query","kind":"balance","period":"month","category":null}]}
"cebimde 7 bin lira var" -> {"items":[{"type":"cash_set","amount":7000}]}
"şu an 12.500 tl param var" -> {"items":[{"type":"cash_set","amount":12500}]}
"ne kadar param var" -> {"items":[{"type":"query","kind":"cash","period":"month","category":null}]}
"cebimde ne kadar var" -> {"items":[{"type":"query","kind":"cash","period":"month","category":null}]}
"netflix aboneliği 229 tl her ayın 5'i" -> {"items":[{"type":"subscription","name":"Netflix","amount":229,"day":5,"category":"Eğlence","cancel":false}]}
"claude aboneliği ayın 14'ü" -> {"items":[{"type":"subscription","name":"Claude","amount":null,"day":14,"category":null,"cancel":false}]}
"spotify aboneliğini iptal et" -> {"items":[{"type":"subscription","name":"Spotify","amount":null,"day":null,"category":null,"cancel":true}]}
"taksi 200 market 450 yarın dişçi" -> {"items":[{"type":"expense","description":"Taksi","amount":200,"category":"Ulaşım","date":"${today}"},{"type":"expense","description":"Market","amount":450,"category":"Market","date":"${today}"},{"type":"task","title":"Dişçi","due":"${tomorrow}","time":null,"place":null}]}

Mesaj: ${JSON.stringify(text)}`;

  // Cloudflare Workers AI (açık kaynak model, ücretsiz kota). Worker'a "AI" adıyla binding eklenmeli.
  // Model kaldırılırsa sıradakini dener.
  const models = [env.AI_MODEL, "@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"].filter(Boolean);
  let out;
  let lastError = "";
  for (const model of models) {
    try {
      out = await withTimeout(env.AI.run(model, {
        messages: [
          { role: "system", content: "Sadece geçerli JSON döndür. Başka hiçbir şey yazma." },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 900,
      }), 10000);
      break;
    } catch (e) {
      lastError = `${model}: ${e.message}`;
    }
  }
  if (!out) throw new Error(`AI modeli çalışmadı (${lastError})`);
  let r = out.response;
  if (typeof r !== "object" || r === null) {
    const m = String(r || "").match(/[\[{][\s\S]*[\]}]/);
    if (!m) throw new Error("Model JSON döndürmedi");
    r = JSON.parse(m[0]);
  }
  const items = Array.isArray(r) ? r : Array.isArray(r.items) ? r.items : [r];
  if (!items.length) throw new Error("Model hiçbir kayıt çıkarmadı");
  return items;
}

async function save(env, p, text) {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
  // Güvenlik ağı: tutarsız "harcama" ya da soru olmayan "chat" mesajı asla sorulmaz/harcamaya yazılmaz, not olarak saklanır.
  const isChatQuestion = p.type === "chat" && text.includes("?");
  const src = p.description || p.title || p.content || text;
  if ((p.type === "expense" || p.type === "income") && !(Number(p.amount) > 0)) p = { type: "note", title: src.slice(0, 80), content: src, tags: [] };
  else if (p.type === "cash_set" && (p.amount == null || !(Number(p.amount) >= 0))) p = { type: "note", title: src.slice(0, 80), content: src, tags: [] };
  else if (!["expense", "income", "task", "note", "query", "subscription", "cash_set"].includes(p.type) && !isChatQuestion) {
    p = { type: "note", title: src.slice(0, 80), content: src, tags: [] };
  }
  if (p.type === "cash_set") return setCash(env, Number(p.amount));
  if (p.type === "query") return answerQuery(env, p);
  if (p.type === "subscription") return upsertSubscription(env, p);
  const rt = (s) => ({ rich_text: [{ text: { content: String(s || "").slice(0, 2000) } }] });
  const ti = (s) => ({ title: [{ text: { content: String(s || "Adsız").slice(0, 200) } }] });

  let database_id, properties;
  if (p.type === "expense") {
    database_id = DB.expense;
    properties = {
      Açıklama: ti(p.description),
      Tutar: { number: Number(p.amount) },
      Kategori: { select: { name: CATEGORIES.includes(p.category) ? p.category : "Diğer" } },
      Tarih: { date: { start: p.date || today } },
    };
  } else if (p.type === "income") {
    database_id = DB.income;
    properties = {
      Açıklama: ti(p.description || p.source || "Gelir"),
      Tutar: { number: Number(p.amount) },
      Kaynak: { select: { name: INCOME_SOURCES.includes(p.source) ? p.source : "Diğer" } },
      Kimden: rt(p.from),
      Tarih: { date: { start: p.date || today } },
    };
  } else if (p.type === "note") {
    database_id = DB.note;
    properties = {
      Başlık: ti(p.title),
      İçerik: rt(p.content),
      Etiket: { multi_select: (p.tags || []).filter((t) => TAGS.includes(t)).map((name) => ({ name })) },
      Tarih: { date: { start: p.date || today } },
    };
  } else if (p.type === "task") {
    database_id = DB.task;
    properties = {
      Görev: ti(p.title),
      Durum: { [TASK_STATUS_TYPE]: { name: "Yapılacak" } },
      Not: rt(`Yer: ${p.place || "belirtilmedi"} · Saat: ${p.time || "belirtilmedi"}`),
    };
    if (p.due) properties["Son Tarih"] = { date: { start: p.due } };
  } else {
    return p.reply || "Anlayamadım, tekrar yazar mısın?";
  }

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parent: { database_id }, properties }),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 200)}`);
  // Onay metnini model değil kod üretir (küçük model bozuk Türkçe yazabiliyor).
  if (p.type === "expense") {
    const cat = CATEGORIES.includes(p.category) ? p.category : "Diğer";
    return `✅ ${Number(p.amount)} ₺ – ${p.description} kaydedildi (${cat})`;
  }
  if (p.type === "income") {
    const src = INCOME_SOURCES.includes(p.source) ? p.source : "Diğer";
    return `💰 ${fmt(p.amount)} ₺ gelir eklendi: ${p.description || src}${p.from ? ` (${p.from})` : ""} – ${src}`;
  }
  if (p.type === "task") return `✅ Görev eklendi: ${p.title}${p.due ? ` (son tarih: ${p.due})` : ""}`;
  return `✅ Not kaydedildi: ${p.title}`;
}

async function send(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// ---------- Yardımcılar ----------

const todayIST = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
const fmt = (n) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 });

async function notion(env, method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function notionQuery(env, database_id, filter) {
  const results = [];
  let cursor;
  do {
    const data = await notion(env, "POST", `/databases/${database_id}/query`, { filter, start_cursor: cursor, page_size: 100 });
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
}

// ---------- Harcama sorgulama ----------

async function answerQuery(env, p) {
  if (p.kind === "cash") return answerCash(env);
  const today = todayIST();
  const period = ["today", "week", "month", "last_month"].includes(p.period) ? p.period : "month";
  let start;
  let end = today;
  let label;
  if (period === "today") {
    start = today;
    label = "Bugün";
  } else if (period === "week") {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Pazar
    start = addDays(today, -((dow + 6) % 7)); // haftanın başı: Pazartesi
    label = "Bu hafta";
  } else if (period === "month") {
    start = `${today.slice(0, 8)}01`;
    label = "Bu ay";
  } else {
    const y = Number(today.slice(0, 4));
    const m = Number(today.slice(5, 7));
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const mm = String(pm).padStart(2, "0");
    start = `${py}-${mm}-01`;
    end = `${py}-${mm}-${lastDayOfMonth(py, pm)}`;
    label = "Geçen ay";
  }
  if (p.kind === "income" || p.kind === "balance") {
    const dateFilters = [
      { property: "Tarih", date: { on_or_after: start } },
      { property: "Tarih", date: { on_or_before: end } },
    ];
    return answerIncomeOrBalance(env, p.kind, dateFilters, label);
  }
  const category = CATEGORIES.includes(p.category) ? p.category : null;
  const filters = [
    { property: "Tarih", date: { on_or_after: start } },
    { property: "Tarih", date: { on_or_before: end } },
  ];
  if (category) filters.push({ property: "Kategori", select: { equals: category } });
  const rows = await notionQuery(env, DB.expense, { and: filters });

  const title = `${label}${category ? ` · ${category}` : ""}`;
  if (!rows.length) return `📊 ${title}: kayıtlı harcama yok.`;

  let total = 0;
  let biggest = null;
  const byCat = {};
  for (const r of rows) {
    const amt = r.properties["Tutar"]?.number || 0;
    const cat = r.properties["Kategori"]?.select?.name || "Diğer";
    const name = r.properties["Açıklama"]?.title?.[0]?.plain_text || "?";
    total += amt;
    byCat[cat] = (byCat[cat] || 0) + amt;
    if (!biggest || amt > biggest.amt) biggest = { name, amt };
  }
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  const lines = [`📊 ${title}: ${fmt(total)} ₺ (${rows.length} harcama)`];
  if (!category) {
    for (const [cat, amt] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
      lines.push(`• ${cat}: ${fmt(amt)} ₺ (%${Math.round((amt / total) * 100)})`);
    }
  }
  if (days > 1) lines.push(`Günlük ortalama: ${fmt(total / days)} ₺`);
  lines.push(`En büyük: ${biggest.name} – ${fmt(biggest.amt)} ₺`);
  return lines.join("\n");
}

// ---------- Abonelikler ----------

async function upsertSubscription(env, p) {
  const name = String(p.name || "").trim();
  if (!name) return "⚠️ Abonelik adını anlayamadım.";
  const d = Number(p.day);
  const day = Number.isInteger(d) && d >= 1 && d <= 31 ? d : null;
  const amount = Number(p.amount) > 0 ? Number(p.amount) : null;
  const cancel = p.cancel === true || p.cancel === "true";

  const found = await notionQuery(env, DB.sub, { property: "Ad", title: { contains: name } });
  const props = { Aktif: { checkbox: !cancel } };
  if (amount) props["Tutar"] = { number: amount };
  if (day) props["Ödeme Günü"] = { number: day };
  if (CATEGORIES.includes(p.category)) props["Kategori"] = { select: { name: p.category } };

  let title = name;
  let finalAmount = amount;
  let finalDay = day;
  if (found.length) {
    const ex = found[0].properties;
    title = ex["Ad"]?.title?.[0]?.plain_text || name;
    finalAmount = amount ?? ex["Tutar"]?.number ?? null;
    finalDay = day ?? ex["Ödeme Günü"]?.number ?? null;
    await notion(env, "PATCH", `/pages/${found[0].id}`, { properties: props });
  } else {
    if (cancel) return `⚠️ "${name}" adında bir abonelik bulamadım.`;
    props["Ad"] = { title: [{ text: { content: name.slice(0, 200) } }] };
    if (!props["Kategori"]) props["Kategori"] = { select: { name: "Diğer" } };
    await notion(env, "POST", "/pages", { parent: { database_id: DB.sub }, properties: props });
  }

  if (cancel) return `✅ Abonelik iptal edildi: ${title}`;
  const amountText = finalAmount ? `${fmt(finalAmount)} ₺` : "tutar belirtilmedi";
  const dayText = finalDay ? `her ayın ${finalDay}'i` : "ödeme günü bilinmiyor (öğrenince \"" + name.toLowerCase() + " aboneliği ayın 14'ü\" gibi yaz)";
  return `✅ Abonelik ${found.length ? "güncellendi" : "eklendi"}: ${title} – ${amountText}, ${dayText}`;
}

async function runSubscriptions(env) {
  const today = todayIST();
  const tomorrow = addDays(today, 1);
  const ym = today.slice(0, 7);
  // 31'inde çekilen abonelik kısa aylarda ayın son günü çekilmiş sayılır.
  const effDay = (iso, day) => Math.min(day, lastDayOfMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7))));

  const subs = await notionQuery(env, DB.sub, { property: "Aktif", checkbox: { equals: true } });
  const msgs = [];
  for (const s of subs) {
    const pr = s.properties;
    const name = pr["Ad"]?.title?.[0]?.plain_text;
    const amount = pr["Tutar"]?.number;
    const day = pr["Ödeme Günü"]?.number;
    const last = pr["Son Eklenen Ay"]?.rich_text?.[0]?.plain_text;
    if (!name || !amount || !day) continue;
    try {
      if (Number(today.slice(8)) === effDay(today, day) && last !== ym) {
        await notion(env, "POST", "/pages", {
          parent: { database_id: DB.expense },
          properties: {
            Açıklama: { title: [{ text: { content: `${name} (abonelik)` } }] },
            Tutar: { number: amount },
            Kategori: { select: { name: pr["Kategori"]?.select?.name || "Diğer" } },
            Tarih: { date: { start: today } },
          },
        });
        await notion(env, "PATCH", `/pages/${s.id}`, {
          properties: { "Son Eklenen Ay": { rich_text: [{ text: { content: ym } }] } },
        });
        msgs.push(`🔁 ${name}: ${fmt(amount)} ₺ bugün çekiliyor, Harcamalar'a eklendi.`);
      } else if (Number(tomorrow.slice(8)) === effDay(tomorrow, day)) {
        msgs.push(`⏰ Yarın ${name} aboneliği (${fmt(amount)} ₺) çekilecek.`);
      }
    } catch (e) {
      msgs.push(`⚠️ ${name} aboneliği işlenemedi: ${e.message}`);
    }
  }
  if (msgs.length && env.ALLOWED_CHAT_ID) await send(env, env.ALLOWED_CHAT_ID, msgs.join("\n"));
}

// ---------- Gelir ve bakiye sorgulama ----------

async function answerIncomeOrBalance(env, kind, dateFilters, label) {
  const amountOf = (r) => r.properties["Tutar"]?.number || 0;
  const incomeRows = await notionQuery(env, DB.income, { and: dateFilters });
  const income = incomeRows.reduce((t, r) => t + amountOf(r), 0);

  if (kind === "income") {
    if (!incomeRows.length) return `💰 ${label}: kayıtlı gelir yok.`;
    const bySource = {};
    for (const r of incomeRows) {
      const s = r.properties["Kaynak"]?.select?.name || "Diğer";
      bySource[s] = (bySource[s] || 0) + amountOf(r);
    }
    const lines = [`💰 ${label} gelir: ${fmt(income)} ₺ (${incomeRows.length} kayıt)`];
    for (const [s, amt] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) lines.push(`• ${s}: ${fmt(amt)} ₺`);
    return lines.join("\n");
  }

  const expenseRows = await notionQuery(env, DB.expense, { and: dateFilters });
  const expense = expenseRows.reduce((t, r) => t + amountOf(r), 0);
  const net = income - expense;
  return [
    `⚖️ ${label}`,
    `💰 Gelir: ${fmt(income)} ₺`,
    `💸 Gider: ${fmt(expense)} ₺`,
    `${net >= 0 ? "✅" : "⚠️"} Kalan: ${fmt(net)} ₺`,
  ].join("\n");
}

// ---------- Kasa: elimdeki para ----------
// Bakiye saklanmaz, her seferinde hesaplanır: son başlangıç bakiyesi + o andan sonra
// KAYDEDİLEN gelirler - giderler. Notion'da bir satırı silip düzeltirsen bakiye de düzelir.

async function setCash(env, amount) {
  await notion(env, "POST", "/pages", {
    parent: { database_id: DB.cash },
    properties: {
      Açıklama: { title: [{ text: { content: "Başlangıç bakiyesi" } }] },
      Tutar: { number: amount },
    },
  });
  return `👛 Başlangıç bakiyesi ayarlandı: ${fmt(amount)} ₺\nBundan sonra yazdığın gelir ve giderler otomatik hesaplanacak. "ne kadar param var" diye sorabilirsin.`;
}

async function answerCash(env) {
  const base = await notion(env, "POST", `/databases/${DB.cash}/query`, {
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: 1,
  });
  if (!base.results.length) {
    return `👛 Önce şu an ne kadar paran olduğunu söyle. Örneğin: "cebimde 7000 TL var"`;
  }
  const b = base.results[0];
  const startAmount = b.properties["Tutar"]?.number || 0;
  const since = { timestamp: "created_time", created_time: { on_or_after: b.created_time } };
  const [incomeRows, expenseRows] = await Promise.all([
    notionQuery(env, DB.income, since),
    notionQuery(env, DB.expense, since),
  ]);
  const sum = (rows) => rows.reduce((t, r) => t + (r.properties["Tutar"]?.number || 0), 0);
  const income = sum(incomeRows);
  const expense = sum(expenseRows);
  const now = startAmount + income - expense;
  const when = new Date(b.created_time).toLocaleString("tr-TR", {
    timeZone: TZ,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  return [
    `👛 Şu an elinde: ${fmt(now)} ₺`,
    `Başlangıç (${when}): ${fmt(startAmount)} ₺`,
    `+ Gelir: ${fmt(income)} ₺ (${incomeRows.length} kayıt)`,
    `− Gider: ${fmt(expense)} ₺ (${expenseRows.length} kayıt)`,
  ].join("\n");
}

// ---------- Notion tablolarını bulma / Finding the Notion tables ----------

const dbTitle = (d) => (d.title || []).map((t) => t.plain_text).join("").trim();

// Bağlantının (integration) görebildiği bütün tabloları getirir.
async function listDatabases(env) {
  const all = [];
  let cursor;
  do {
    const data = await notion(env, "POST", "/search", {
      filter: { property: "object", value: "database" },
      start_cursor: cursor,
      page_size: 100,
    });
    all.push(...data.results.filter((d) => !d.archived && !d.in_trash));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return all;
}

// Adı aynı birden fazla tablo varsa, diğer tablolarla aynı sayfada olanı seçer.
// If several tables share a name, picks the one on the same page as the others.
function pickTables(dbs) {
  const parentOf = (d) => d.parent?.page_id || (d.parent?.workspace ? "workspace" : d.parent?.block_id) || "?";
  const byKey = {};
  for (const [key, t] of Object.entries(TABLES)) byKey[key] = dbs.filter((d) => dbTitle(d) === t.title);
  const votes = {};
  for (const list of Object.values(byKey)) {
    for (const p of new Set(list.map(parentOf))) votes[p] = (votes[p] || 0) + 1;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
  const found = {};
  for (const [key, list] of Object.entries(byKey)) {
    if (!list.length) continue;
    found[key] = list.find((d) => parentOf(d) === best) || list[0];
  }
  return found;
}

async function loadDB(env, force = false) {
  if (DB && !force) return DB;
  const ids = {};
  const fromSearch = [];
  for (const [key, t] of Object.entries(TABLES)) {
    if (env[t.env]) ids[key] = String(env[t.env]).trim();
    else fromSearch.push(key);
  }
  let objects = {};
  if (fromSearch.length) {
    objects = pickTables(await listDatabases(env));
    for (const key of fromSearch) if (objects[key]) ids[key] = objects[key].id;
  }
  const missing = Object.keys(TABLES).filter((k) => !ids[k]);
  if (missing.length) {
    throw new Error(
      `Notion tablosu bulunamadı / Notion table not found: ${missing.map((k) => TABLES[k].title).join(", ")}. ` +
        `Tarayıcıda /kurulum adresini aç / Open /kurulum in your browser.`
    );
  }
  const taskDb = objects.task && objects.task.id === ids.task ? objects.task : await notion(env, "GET", `/databases/${ids.task}`);
  TASK_STATUS_TYPE = taskDb.properties?.["Durum"]?.type === "select" ? "select" : "status";
  DB = ids;
  return DB;
}

// ---------- Kurulum sayfası / Setup page (GET /kurulum) ----------
// Tekrar tekrar açılabilir: var olan tablolara dokunmaz, yalnızca eksikleri oluşturur ve Telegram webhook'unu kurar.
// Safe to open again: never touches existing tables, only creates missing ones and sets the Telegram webhook.

const sel = (names) => ({ select: { options: names.map((name) => ({ name })) } });
const TABLE_SCHEMAS = {
  expense: {
    Açıklama: { title: {} },
    Tutar: { number: { format: "lira" } },
    Kategori: sel(CATEGORIES),
    Tarih: { date: {} },
    Not: { rich_text: {} },
  },
  income: {
    Açıklama: { title: {} },
    Tutar: { number: { format: "lira" } },
    Kaynak: sel(INCOME_SOURCES),
    Kimden: { rich_text: {} },
    Tarih: { date: {} },
  },
  task: {
    Görev: { title: {} },
    // Notion API "status" sütunu oluşturamıyor; "select" kullanılır, kod ikisiyle de çalışır.
    Durum: sel(["Yapılacak", "Devam ediyor", "Bitti"]),
    "Son Tarih": { date: {} },
    Not: { rich_text: {} },
  },
  note: {
    Başlık: { title: {} },
    İçerik: { rich_text: {} },
    Etiket: { multi_select: { options: TAGS.map((name) => ({ name })) } },
    Tarih: { date: {} },
  },
  sub: {
    Ad: { title: {} },
    Tutar: { number: { format: "lira" } },
    "Ödeme Günü": { number: {} },
    Kategori: sel(CATEGORIES),
    Aktif: { checkbox: {} },
    "Son Eklenen Ay": { rich_text: {} },
  },
  cash: {
    Açıklama: { title: {} },
    Tutar: { number: { format: "lira" } },
  },
};

async function findParentPage(env) {
  if (env.NOTION_PAGE_ID) return String(env.NOTION_PAGE_ID).trim();
  const data = await notion(env, "POST", "/search", { filter: { property: "object", value: "page" }, page_size: 100 });
  // Tablo satırları da "page" olarak gelir; yalnızca normal sayfaları al.
  const pages = data.results.filter((p) => !p.archived && !p.in_trash && p.parent?.type !== "database_id");
  if (pages.length === 1) return pages[0].id;
  if (!pages.length) {
    throw new Error(
      "Bağlantının görebildiği bir Notion sayfası yok. Sayfanda ••• > Connections > bağlantını ekle.\n" +
        "   The integration can't see any Notion page. On your page: ••• > Connections > add your integration."
    );
  }
  throw new Error(
    `Bağlantı ${pages.length} sayfa görüyor, hangisini kullanacağımı bilemiyorum. Cloudflare'e NOTION_PAGE_ID ekle.\n` +
      `   The integration sees ${pages.length} pages, so I can't pick one. Add NOTION_PAGE_ID in Cloudflare.`
  );
}

async function setup(env, origin) {
  const out = ["Telegram Asistan · Kurulum kontrolü / Setup check", ""];
  const ok = (s) => out.push(`✅ ${s}`);
  let fine = true;
  const bad = (s) => {
    out.push(`❌ ${s}`);
    fine = false;
  };

  // 1) Değişkenler / Variables
  for (const name of ["TELEGRAM_TOKEN", "WEBHOOK_SECRET", "NOTION_TOKEN"]) {
    if (env[name]) ok(name);
    else bad(`${name} eksik / missing (Settings > Variables and Secrets)`);
  }
  if (env.WEBHOOK_SECRET && !/^[A-Za-z0-9_-]{1,256}$/.test(env.WEBHOOK_SECRET)) {
    bad("WEBHOOK_SECRET yalnızca harf, rakam, _ ve - içerebilir / may only contain letters, digits, _ and -");
  }
  if (env.AI && typeof env.AI.run === "function") ok("Workers AI binding (AI)");
  else bad('Workers AI binding yok / missing: Settings > Bindings > Add > Workers AI, adı/name "AI"');

  // 2) Notion tabloları / Notion tables
  if (env.NOTION_TOKEN) {
    try {
      const found = pickTables(await listDatabases(env));
      const missing = Object.keys(TABLES).filter((k) => !found[k] && !env[TABLES[k].env]);
      const present = Object.keys(TABLES).filter((k) => !missing.includes(k));
      if (present.length) ok(`Notion tabloları bulundu / tables found: ${present.map((k) => TABLES[k].title).join(", ")}`);
      if (missing.length) {
        const parent = await findParentPage(env);
        for (const key of missing) {
          await notion(env, "POST", "/databases", {
            parent: { type: "page_id", page_id: parent },
            title: [{ type: "text", text: { content: TABLES[key].title } }],
            properties: TABLE_SCHEMAS[key],
          });
        }
        ok(`Notion tabloları oluşturuldu / tables created: ${missing.map((k) => TABLES[k].title).join(", ")}`);
      }
      await loadDB(env, true);
      ok("Notion bağlantısı çalışıyor / Notion connection works");
    } catch (e) {
      bad(`Notion: ${e.message}`);
    }
  }

  // 3) Telegram webhook
  if (env.TELEGRAM_TOKEN && env.WEBHOOK_SECRET) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: origin, secret_token: env.WEBHOOK_SECRET, allowed_updates: ["message"] }),
      });
      const data = await res.json();
      if (data.ok) ok(`Telegram webhook → ${origin}`);
      else bad(`Telegram: ${data.description || res.status} (TELEGRAM_TOKEN doğru mu? / is TELEGRAM_TOKEN correct?)`);
    } catch (e) {
      bad(`Telegram: ${e.message}`);
    }
  }

  // 4) Sohbet izni / Chat permission
  if (env.ALLOWED_CHAT_ID) ok("ALLOWED_CHAT_ID");
  else {
    out.push(
      "➡️  Botuna Telegram'dan bir mesaj at; sana Chat ID'ni söyleyecek. Onu ALLOWED_CHAT_ID olarak ekle.",
      "    Send your bot any message on Telegram; it will reply with your Chat ID. Add it as ALLOWED_CHAT_ID."
    );
  }

  out.push("");
  if (!fine) out.push("Yukarıdaki ❌ satırlarını düzeltip bu sayfayı yenile. / Fix the ❌ lines above and reload this page.");
  else if (!env.ALLOWED_CHAT_ID) out.push("Neredeyse bitti, yukarıdaki son adımı yap. / Almost done, do the last step above.");
  else out.push('🎉 Her şey hazır. Telegram\'da "kahve 120tl" yazmayı dene. / All set. Try sending "kahve 120tl" on Telegram.');
  return out.join("\n");
}
