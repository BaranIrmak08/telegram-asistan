// Sahte Telegram / Notion / Workers AI ile worker.js testi. Gerçek servislere bağlanmaz.
import { pathToFileURL } from "node:url";
const workerPath = process.argv[2];
let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`);
  if (!cond) failures++;
};

function makeWorld({ dbs, pages }) {
  const w = { dbs, pages, created: [], createdDbs: [], sent: [], webhook: null, rows: {} };
  globalThis.fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    const j = (o, status = 200) => ({ ok: status < 300, status, json: async () => o, text: async () => JSON.stringify(o) });
    if (url.includes("api.telegram.org")) {
      if (url.endsWith("/sendMessage")) w.sent.push(body.text);
      if (url.endsWith("/setWebhook")) w.webhook = body;
      return j({ ok: true });
    }
    const path = url.replace("https://api.notion.com/v1", "");
    if (path === "/search") {
      return j({ results: body.filter.value === "database" ? w.dbs : w.pages, has_more: false });
    }
    if (path === "/databases" && opts.method === "POST") {
      const d = { object: "database", id: "new-" + body.title[0].text.content, title: [{ plain_text: body.title[0].text.content }], parent: { type: "page_id", page_id: body.parent.page_id }, properties: Object.fromEntries(Object.entries(body.properties).map(([k, v]) => [k, { type: Object.keys(v)[0] }])) };
      w.createdDbs.push({ body, d });
      w.dbs.push(d);
      return j(d);
    }
    let m;
    if ((m = path.match(/^\/databases\/([^/]+)$/))) return j(w.dbs.find((d) => d.id === m[1]));
    if ((m = path.match(/^\/databases\/([^/]+)\/query$/))) return j({ results: w.rows[m[1]] || [], has_more: false });
    if (path === "/pages" && opts.method === "POST") {
      w.created.push(body);
      return j({ id: "p" + w.created.length });
    }
    if (path.startsWith("/pages/")) return j({});
    throw new Error("beklenmeyen istek " + url);
  };
  return w;
}

const db = (id, title, parent, durumType) => ({ object: "database", id, title: [{ plain_text: title }], parent: { type: "page_id", page_id: parent }, properties: durumType ? { Durum: { type: durumType } } : {} });

const aiFor = (map) => ({ run: async (_model, input) => {
  const text = JSON.parse(input.messages[1].content.match(/Mesaj: (".*")$/s)[1]);
  return { response: map[text] };
} });

const baseEnv = { TELEGRAM_TOKEN: "t", WEBHOOK_SECRET: "gizli_123", NOTION_TOKEN: "n", ALLOWED_CHAT_ID: "42" };
const tg = (text) => new Request("https://bot.example.workers.dev/", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "gizli_123", "Content-Type": "application/json" }, body: JSON.stringify({ message: { chat: { id: 42 }, text } }) });
async function deliver(mod, env, text) {
  const waits = [];
  const res = await mod.default.fetch(tg(text), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}
let n = 0;
const fresh = async () => (await import(pathToFileURL(workerPath).href + "?v=" + ++n));

// ---- 1) Mevcut kullanıcı (senin kurulumun): tablolar adla bulunur, Durum = status ----
{
  const mod = await fresh();
  const P = "sayfa-1";
  const w = makeWorld({ dbs: [
    db("harcama-id", "Harcamalar", P), db("gelir-id", "Gelirler", P), db("gorev-id", "Görevler", P, "status"),
    db("not-id", "Notlar", P), db("abonelik-id", "Abonelikler", P), db("kasa-id", "Kasa", P),
    db("baska", "Harcamalar", "baska-sayfa"), // aynı adlı başka tablo: seçilmemeli
  ], pages: [] });
  const env = { ...baseEnv, AI: aiFor({
    "kahve 120tl": { items: [{ type: "expense", description: "Kahve", amount: 120, category: "Yiyecek-İçecek", date: "2026-11-09" }] },
    "yarın dişçi": { items: [{ type: "task", title: "Dişçi", due: "2026-11-10", time: null, place: null }] },
    "babam 500 verdi": { items: [{ type: "income", description: "Harçlık", amount: 500, source: "Harçlık", from: "Baba" }] },
  }) };
  await deliver(mod, env, "kahve 120tl");
  check("1a harcama doğru tabloya (Harcamalar, kendi sayfandaki)", w.created[0]?.parent.database_id === "harcama-id", JSON.stringify(w.created[0]?.parent));
  check("1b onay mesajı", w.sent.at(-1) === "✅ 120 ₺ – Kahve kaydedildi (Yiyecek-İçecek)", w.sent.at(-1));
  await deliver(mod, env, "yarın dişçi");
  check("1c görev Görevler'e, Durum status tipinde", w.created[1]?.parent.database_id === "gorev-id" && w.created[1]?.properties.Durum.status?.name === "Yapılacak", JSON.stringify(w.created[1]));
  await deliver(mod, env, "babam 500 verdi");
  check("1d gelir Gelirler'e", w.created[2]?.parent.database_id === "gelir-id");
  const res = await mod.default.fetch(new Request("https://x/", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "yanlis" }, body: "{}" }), env, { waitUntil() {} });
  check("1e yanlış gizli anahtar reddedilir (403)", res.status === 403);
  const g = await mod.default.fetch(new Request("https://x/"), env, { waitUntil() {} });
  check("1f normal GET hâlâ 'ok'", (await g.text()) === "ok");
}

// ---- 2) Yeni kullanıcı: tablo yok, tek sayfa paylaşılmış -> /kurulum oluşturur ----
{
  const mod = await fresh();
  const w = makeWorld({ dbs: [], pages: [{ id: "sayfa1", parent: { type: "workspace" } }, { id: "satir", parent: { type: "database_id" } }] });
  const env = { ...baseEnv, ALLOWED_CHAT_ID: undefined, AI: aiFor({
    "yarın dişçi": { items: [{ type: "task", title: "Dişçi", due: "2026-11-10" }] },
  }) };
  const r = await mod.default.fetch(new Request("https://bot.example.workers.dev/kurulum"), env, { waitUntil() {} });
  const text = await r.text();
  console.log("----- /kurulum çıktısı -----\n" + text + "\n----------------------------");
  check("2a 6 tablo oluşturuldu", w.createdDbs.length === 6, w.createdDbs.length);
  check("2b tablolar paylaşılan sayfanın altında", w.createdDbs.every((c) => c.body.parent.page_id === "sayfa1"));
  check("2c webhook doğru adres + gizli anahtar", w.webhook?.url === "https://bot.example.workers.dev" && w.webhook?.secret_token === "gizli_123", JSON.stringify(w.webhook));
  check("2d chat id adımı gösteriliyor", text.includes("ALLOWED_CHAT_ID"));
  // ilk mesaj: chat id söylenir
  await deliver(mod, env, "merhaba");
  check("2e ilk mesajda Chat ID söylenir", w.sent.at(-1)?.includes("Chat ID'n: 42"), w.sent.at(-1));
  // chat id girildikten sonra görev select tipinde yazılır
  const env2 = { ...env, ALLOWED_CHAT_ID: "42" };
  const mod2 = await fresh();
  await deliver(mod2, env2, "yarın dişçi");
  check("2f yeni kurulumda görev Durum select tipinde", w.created[0]?.properties.Durum.select?.name === "Yapılacak", JSON.stringify(w.created[0]));
  // ikinci kez /kurulum: yeni tablo oluşturmaz
  const before = w.createdDbs.length;
  await (await mod2.default.fetch(new Request("https://bot.example.workers.dev/kurulum"), env2, { waitUntil() {} })).text();
  check("2g /kurulum tekrar açılınca tablo çoğaltmaz", w.createdDbs.length === before);
}

// ---- 3) Eksik ayarlar: anlaşılır hata ----
{
  const mod = await fresh();
  makeWorld({ dbs: [], pages: [{ id: "a", parent: { type: "workspace" } }, { id: "b", parent: { type: "workspace" } }] });
  const r = await mod.default.fetch(new Request("https://bot.example.workers.dev/kurulum"), { NOTION_TOKEN: "n" }, { waitUntil() {} });
  const text = await r.text();
  check("3a eksik TELEGRAM_TOKEN ve AI gösterilir", text.includes("❌ TELEGRAM_TOKEN") && text.includes("Workers AI binding yok"));
  check("3b iki sayfa varsa NOTION_PAGE_ID istenir", text.includes("NOTION_PAGE_ID"), text);
}

// ---- 4) Elle tablo id'si (DB_ değişkenleri) arama yapmadan çalışır ----
{
  const mod = await fresh();
  const w = makeWorld({ dbs: [db("elle-gorev", "X", "p", "status")], pages: [] });
  const env = { ...baseEnv, DB_HARCAMALAR: "elle-h", DB_GELIRLER: "g", DB_GOREVLER: "elle-gorev", DB_NOTLAR: "n", DB_ABONELIKLER: "a", DB_KASA: "k",
    AI: aiFor({ "kahve 120tl": { items: [{ type: "expense", description: "Kahve", amount: 120, category: "Yiyecek-İçecek" }] } }) };
  await deliver(mod, env, "kahve 120tl");
  check("4a DB_HARCAMALAR kullanılır", w.created[0]?.parent.database_id === "elle-h");
}

// ---- 5) Abonelik cron'u ----
{
  const mod = await fresh();
  const P = "p";
  const w = makeWorld({ dbs: [db("h", "Harcamalar", P), db("g", "Gelirler", P), db("t", "Görevler", P, "status"), db("n", "Notlar", P), db("s", "Abonelikler", P), db("k", "Kasa", P)], pages: [] });
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" });
  w.rows.s = [{ id: "sub1", properties: { Ad: { title: [{ plain_text: "Netflix" }] }, Tutar: { number: 229 }, "Ödeme Günü": { number: Number(today.slice(8)) }, Kategori: { select: { name: "Eğlence" } }, "Son Eklenen Ay": { rich_text: [] } } }];
  const waits = [];
  await mod.default.scheduled({}, baseEnv, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  check("5a bugünkü abonelik Harcamalar'a eklendi", w.created[0]?.parent.database_id === "h" && w.created[0]?.properties.Tutar.number === 229);
  check("5b bildirim gönderildi", w.sent.at(-1)?.includes("Netflix"), w.sent.at(-1));
}

console.log(failures ? `\n${failures} test BAŞARISIZ` : "\nTüm testler geçti");
process.exit(failures ? 1 : 0);
