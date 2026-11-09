# 🤖 Telegram Asistan

**[🇹🇷 Türkçe](#-türkçe) · [🇬🇧 English](#-english)**

Telegram'a "kahve 120tl" yaz, harcaman Notion'a kaydedilsin.
Write "kahve 120tl" on Telegram and the expense lands in Notion.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/BaranIrmak08/telegram-asistan)

---

## 🇹🇷 Türkçe

### Bu ne işe yarar?

Kendi Telegram botuna günlük dilde mesaj atarsın. Bot ne demek istediğini anlar ve Notion'daki tablolarına kaydeder:

| Telegram'a yazdığın | Bot ne yapar |
|---|---|
| `kahve 120tl` | **Harcamalar** tablosuna 120 ₺, kategori "Yiyecek-İçecek" |
| `babam 500 lira harçlık verdi` | **Gelirler** tablosuna 500 ₺, kimden "Baba" |
| `yarın 5'te diş doktoru` | **Görevler** tablosuna yarının tarihiyle |
| `Dune kitabını oku` | **Notlar** tablosuna "Kitap-Film" etiketiyle |
| `taksi 200 market 450 yarın dişçi` | Tek mesajdan üç kayıt |
| `cebimde 7 bin lira var` | **Kasa**'ya başlangıç bakiyesi |
| `ne kadar param var` | Başlangıç + gelirler − giderler = şu an elindeki para |
| `bu ay ne kadar harcadım` | Toplam, kategorilere göre dağılım, günlük ortalama |
| `bu ay gelir gider farkım ne` | Gelir, gider, kalan |
| `netflix aboneliği 229 tl her ayın 5'i` | **Abonelikler** tablosuna ekler. Her ayın 5'inde harcamalara kendisi yazar, bir gün önce hatırlatır |
| `spotify aboneliğini iptal et` | Aboneliği pasif yapar |

Bilgisayarın kapalıyken de çalışır, çünkü bot Cloudflare'in sunucularında durur.

> ℹ️ Bot **Türkçe** mesajları anlar. Para birimi ₺ (Türk lirası) olarak kaydedilir.

### Ücret var mı?

**Hayır.** Her şey ücretsiz katmanlarda çalışır:

- **Telegram botu:** ücretsiz
- **Notion:** ücretsiz plan yeterli
- **Cloudflare Workers:** ücretsiz plan, günde 100.000 istek
- **Cloudflare Workers AI:** ücretsiz günlük kota. Mesajı anlayan yapay zekâ budur (açık kaynak Llama modeli). Kişisel kullanımda kota bitmez.

Kredi kartı gerekmez.

### Nasıl çalışır?

```
Sen (Telegram) ──► Cloudflare Worker ──► Workers AI: "bu bir harcama, 120 ₺, Yiyecek-İçecek"
                          │
                          ├──► Notion: tabloya satır ekler
                          └──► Telegram: "✅ 120 ₺ – Kahve kaydedildi"
```

Bütün kod tek bir dosyada: [`worker.js`](worker.js).

---

### Kurulum (yaklaşık 15 dakika)

Üç ücretsiz hesap gerekiyor: **Telegram**, **Notion**, **Cloudflare**. Adımları sırayla yap. Bir adımda aldığın bir değeri (token, secret) sonraki adımda kullanacaksın. Bunları geçici olarak bir not defterine yapıştırabilirsin.

> 🔒 **Güvenlik:** Token ve secret'lar şifre gibidir. Kimseyle paylaşma, GitHub'a yükleme, ekran görüntüsünde gösterme.

#### 1. adım: Telegram botunu oluştur

1. Telegram'da **@BotFather**'ı ara ve aç. Mavi tikli, resmi hesap olan.
2. `/newbot` yaz ve gönder.
3. Botuna bir **ad** ver, örneğin `Kasam`.
4. Botuna bir **kullanıcı adı** ver. Sonu `bot` ile bitmeli, örneğin `baran_kasa_bot`.
5. BotFather sana şuna benzeyen bir **token** verir: `123456789:AAH...`
   👉 Bunu kopyala ve sakla. Bu senin **`TELEGRAM_TOKEN`** değerin.

#### 2. adım: Notion'u hazırla

**2a. Notion bağlantısı (integration) oluştur**

1. Tarayıcıda **https://www.notion.so/profile/integrations** adresine git ve Notion hesabınla giriş yap.
2. **New integration** (Yeni bağlantı) düğmesine bas.
3. Ad olarak `Telegram Asistan` yaz. Workspace olarak kendi çalışma alanını seç. Tür **Internal** kalsın.
4. **Save** (Kaydet) de.
5. Açılan sayfada **Internal Integration Secret** yazan yerde **Show** (Göster) ve **Copy** (Kopyala) düğmelerine bas. Değer `ntn_` ile başlar.
   👉 Bu senin **`NOTION_TOKEN`** değerin.
6. Aynı sayfada **Capabilities** (Yetenekler) bölümünde **Read content**, **Update content** ve **Insert content** seçili olsun.

**2b. Bir sayfa oluştur ve bağlantıyı ekle**

1. Notion'da yeni, boş bir sayfa oluştur. Adı örneğin `Telegram Asistanım` olsun.
2. Sayfanın sağ üstündeki **•••** (üç nokta) menüsünü aç.
3. **Connections** (Bağlantılar) → **Connect to** seçeneğine gir, az önce oluşturduğun `Telegram Asistan` bağlantısını seç ve onayla.

Tabloları elle oluşturmana **gerek yok**. 4. adımda bot onları bu sayfanın altına kendisi kurar.

> ⚠️ Bağlantıyı yalnızca **bu tek sayfaya** ekle. Bağlantı birden fazla sayfa görürse bot tabloları hangisine kuracağını bilemez. Bu durumda ne yapacağın [Sorun giderme](#sorun-giderme) bölümünde.

#### 3. adım: Botu Cloudflare'e kur

Önce **https://dash.cloudflare.com/sign-up** adresinden ücretsiz bir Cloudflare hesabı aç.

Sonra iki yoldan birini seç:

<details open>
<summary><b>Yol A: Tek tıkla kurulum (önerilen)</b></summary>

1. Bu sayfanın en üstündeki **Deploy to Cloudflare** düğmesine bas.
2. Cloudflare hesabınla giriş yap. Gerekirse GitHub hesabını da bağla. Cloudflare bu projenin bir kopyasını senin GitHub hesabına oluşturur.
3. Kurulum ekranı senden üç değer ister:
   - **`TELEGRAM_TOKEN`**: 1. adımda aldığın token
   - **`NOTION_TOKEN`**: 2. adımda aldığın `ntn_...` değeri
   - **`WEBHOOK_SECRET`**: kendin uydurduğun uzun, rastgele bir metin. **Yalnızca** harf, rakam, `_` ve `-` kullan. Örneğin `kedi_masa_7391_yesil_bulut`. Bunu hatırlaman gerekmez.
4. **Create and deploy** (Oluştur ve yayınla) düğmesine bas ve bitmesini bekle.
5. Ekranda Worker'ının adresi görünür, şuna benzer: `https://telegram-asistan.KULLANICIADIN.workers.dev`. Bu adresi kopyala.

Yapay zekâ bağlantısı (`AI`) ve günlük zamanlayıcı bu yolda otomatik kurulur. **4. adıma geç.**
</details>

<details>
<summary><b>Yol B: Elle kurulum (düğme çalışmazsa)</b></summary>

1. **https://dash.cloudflare.com** adresine gir. Sol menüden **Compute (Workers)** → **Workers & Pages** bölümünü aç. Menünün adı biraz farklı olabilir; "Workers" yazanı seç.
2. **Create** → **Start with Hello World!** (ya da "Create Worker") seçeneğine tıkla.
3. Ad olarak `telegram-asistan` yaz ve **Deploy** de.
4. **Edit code** (Kodu düzenle) düğmesine bas.
5. Soldaki `worker.js` dosyasının içindekilerin **hepsini sil**. Bu projedeki [`worker.js`](worker.js) dosyasını açıp tamamını kopyala ve yapıştır.
6. Sağ üstteki **Deploy** düğmesine bas. Sonra geri çık.
7. **Settings** (Ayarlar) → **Variables and Secrets** → **Add**. Aşağıdaki üç değeri **Type: Secret** seçerek tek tek ekle:

   | Variable name | Value |
   |---|---|
   | `TELEGRAM_TOKEN` | 1. adımdaki token |
   | `NOTION_TOKEN` | 2. adımdaki `ntn_...` |
   | `WEBHOOK_SECRET` | uydurduğun rastgele metin (yalnızca harf, rakam, `_`, `-`) |

   Her eklemeden sonra **Deploy** ya da **Save** de.
8. **Settings** → **Bindings** → **Add binding** → **Workers AI**. **Variable name** kutusuna tam olarak `AI` yaz (büyük harfle) ve kaydet.
9. **Settings** → **Trigger Events** (ya da "Triggers") → **Add** → **Cron Triggers**. Değer olarak `0 6 * * *` yaz ve kaydet. Bu ayar abonelikleri her sabah Türkiye saatiyle 09:00'da işler.
10. Worker'ının adresini kopyala. Sayfanın üstünde görünür, şuna benzer: `https://telegram-asistan.KULLANICIADIN.workers.dev`.
</details>

#### 4. adım: Kurulum sayfasını aç

Tarayıcıda Worker adresinin sonuna `/kurulum` ekleyip aç:

```
https://telegram-asistan.KULLANICIADIN.workers.dev/kurulum
```

Bu sayfa:
- ayarlarının doğru olup olmadığını kontrol eder,
- Notion sayfanın altına 6 tabloyu oluşturur (Harcamalar, Gelirler, Görevler, Notlar, Abonelikler, Kasa),
- botunu Telegram'a bağlar.

Her satırda ✅ görmelisin. ❌ olan bir satır varsa yanında ne yapman gerektiği yazar. Düzelttikten sonra sayfayı yenile. Bu sayfayı istediğin kadar açabilirsin: var olan tablolara dokunmaz, aynı tabloyu iki kez oluşturmaz.

#### 5. adım: Botu yalnızca kendine aç

1. Telegram'da botunu bul (1. adımdaki kullanıcı adı) ve **Başlat**'a bas ya da `merhaba` yaz.
2. Bot şöyle cevap verir: `Chat ID'n: 123456789`.
3. Cloudflare'de **Settings** → **Variables and Secrets** → **Add** ile yeni bir değer ekle:
   - Variable name: `ALLOWED_CHAT_ID`
   - Value: botun söylediği sayı
   Sonra kaydet.

Bundan sonra bot **yalnızca senin** mesajlarına cevap verir. Başkaları botunu bulsa bile hiçbir şey kaydedemez.

#### 6. adım: Dene! 🎉

Botuna `kahve 120tl` yaz. Birkaç saniye içinde `✅ 120 ₺ – Kahve kaydedildi (Yiyecek-İçecek)` cevabını almalısın. Notion'daki **Harcamalar** tablosunda da yeni satırı görmelisin.

---

### Kullanım ipuçları

- **Kasa:** Önce bir kez `cebimde 6000 lira var` yaz. Sonra `ne kadar param var` diye sorduğunda bot, bu andan sonra kaydettiğin gelirleri ve giderleri hesaba katar. Notion'da bir satırı silersen ya da düzeltirsen bakiye de kendiliğinden düzelir.
- **Sorgular:** `bugün`, `bu hafta` (Pazartesiden itibaren), `bu ay` ve `geçen ay` dönemlerini anlar. Örnek: `bu hafta markete ne kadar gitti`.
- **Yanlış kayıt:** Notion'da ilgili satırı silmen ya da düzeltmen yeterli.
- **Tutar yazmazsan** bot harcama kaydetmez, mesajını not olarak saklar.

### İsteğe bağlı ayarlar

Cloudflare → Settings → Variables and Secrets bölümünden eklenir:

| Ad | Ne işe yarar |
|---|---|
| `TIMEZONE` | Saat dilimi. Varsayılan `Europe/Istanbul`. |
| `AI_MODEL` | Kullanılacak yapay zekâ modeli. Varsayılan `@cf/meta/llama-3.1-8b-instruct-fp8`. Bir gün Cloudflare bu modeli kaldırırsa [model listesinden](https://developers.cloudflare.com/workers-ai/models/) yeni bir "instruct" modelin adını buraya yaz. Kodu değiştirmen gerekmez. |
| `NOTION_PAGE_ID` | Tabloların kurulacağı Notion sayfasının id'si. Yalnızca bağlantın birden fazla sayfa görüyorsa gerekir. |
| `DB_HARCAMALAR`, `DB_GELIRLER`, `DB_GOREVLER`, `DB_NOTLAR`, `DB_ABONELIKLER`, `DB_KASA` | Tablo id'sini elle vermek için. Normalde gerekmez, bot tabloları adlarından bulur. |

> ⚠️ Notion'da tabloların ve sütunların **adlarını değiştirme**. Bot onları adlarıyla bulur. Kategori seçeneklerine yeni seçenek eklemek sorun çıkarmaz, ama bot yalnızca hazır listedeki kategorileri kullanır.

### Sorun giderme

| Belirti | Çözüm |
|---|---|
| Bot hiç cevap vermiyor | `/kurulum` sayfasını aç; ❌ olan satırları düzelt. Botun kullanıcı adını doğru yazdığından emin ol. |
| `⛔ Yetkisiz sohbet` | `ALLOWED_CHAT_ID` değeri yanlış. Değeri sil, bota yeniden yaz, gelen sayıyı tekrar gir. |
| `Notion tablosu bulunamadı` | `/kurulum` sayfasını aç. Notion sayfanda **••• → Connections** altında bağlantının ekli olduğunu kontrol et. |
| `/kurulum`'da "sayfa görüyor, hangisini kullanacağımı bilemiyorum" | Bağlantıyı fazladan eklediğin sayfalardan kaldır, **ya da** `NOTION_PAGE_ID` ekle. Sayfa id'si, sayfanın adresindeki son 32 karakterdir: `notion.so/Telegram-Asistanim-`**`1a2b3c4d5e6f7a8b...`** |
| `AI modeli çalışmadı` | Cloudflare'de `AI` binding'inin ekli olduğunu kontrol et. Sorun sürerse `AI_MODEL` ile yeni bir model adı gir. |
| `⏳ Bu işlem çok uzun sürdü` | Yapay zekâ o an yavaştı. Mesajı tekrar gönder. |
| Telegram'da `Unauthorized` | `TELEGRAM_TOKEN` yanlış kopyalanmış. BotFather'da `/mybots` → botun → **API Token** ile kontrol et. |

Cloudflare'de Worker sayfasındaki **Logs** sekmesi, hataların ayrıntısını gösterir.

### Gizlilik

- Mesajların yalnızca şu yerlere gider: **senin** Cloudflare hesabın, **senin** Notion çalışma alanın ve Telegram. Bu projenin sahibi dahil hiç kimse verilerini göremez.
- Mesajı anlayan yapay zekâ Cloudflare'in kendi sunucularında çalışır. Mesajlar başka bir yapay zekâ şirketine gönderilmez.

### Geliştiriciler için

```bash
npm test          # Sahte Telegram/Notion/AI ile testler (internet gerekmez)
npx wrangler dev  # Yerel çalıştırma (.dev.vars.example dosyasını .dev.vars olarak kopyala)
npx wrangler deploy
```

Yeni bir mesaj türü öğretmek için `worker.js` içindeki `parse` fonksiyonundaki prompt'a örnek ekle. Küçük model örneklerden öğrenir.

---

## 🇬🇧 English

### What does it do?

You message your own Telegram bot in everyday language. The bot understands what you mean and saves it to your Notion tables:

| You write on Telegram | The bot |
|---|---|
| `kahve 120tl` ("coffee 120 lira") | adds 120 ₺ to **Harcamalar** (Expenses), category "Yiyecek-İçecek" (Food & Drink) |
| `babam 500 lira harçlık verdi` ("dad gave me 500 lira allowance") | adds 500 ₺ to **Gelirler** (Income), from "Baba" (Dad) |
| `yarın 5'te diş doktoru` ("dentist tomorrow at 5") | adds a task with tomorrow's date to **Görevler** (Tasks) |
| `Dune kitabını oku` ("read Dune") | adds a note tagged "Kitap-Film" (Books & Films) to **Notlar** (Notes) |
| `taksi 200 market 450 yarın dişçi` | three records from one message |
| `cebimde 7 bin lira var` ("I have 7k lira on me") | saves a starting balance in **Kasa** (Cash) |
| `ne kadar param var` ("how much money do I have") | starting balance + income − expenses = money you have now |
| `bu ay ne kadar harcadım` ("how much did I spend this month") | total, breakdown by category, daily average |
| `netflix aboneliği 229 tl her ayın 5'i` ("Netflix subscription 229 lira on the 5th") | adds it to **Abonelikler** (Subscriptions). On the 5th of each month the bot adds it to expenses and reminds you the day before |

It works while your computer is off, because the bot runs on Cloudflare's servers.

> ℹ️ **Language:** the bot understands **Turkish** messages, and the Notion tables use Turkish names. Amounts are stored in Turkish lira (₺). To use another language, translate the prompt and examples in the `parse` function of `worker.js`.

### Does it cost anything?

**No.** Everything runs on free tiers:

- **Telegram bot:** free
- **Notion:** the free plan is enough
- **Cloudflare Workers:** free plan, 100,000 requests per day
- **Cloudflare Workers AI:** free daily allowance. This is the AI that reads your messages (an open-source Llama model). Personal use stays within it.

No credit card needed.

### How it works

```
You (Telegram) ──► Cloudflare Worker ──► Workers AI: "this is an expense, 120 ₺, Food & Drink"
                          │
                          ├──► Notion: adds a row to the table
                          └──► Telegram: "✅ 120 ₺ – Kahve kaydedildi"
```

All of the code is in one file: [`worker.js`](worker.js).

---

### Setup (about 15 minutes)

You need three free accounts: **Telegram**, **Notion** and **Cloudflare**. Do the steps in order. You will reuse values (tokens, secrets) from earlier steps, so paste them into a notepad for now.

> 🔒 **Security:** tokens and secrets work like passwords. Don't share them, don't upload them to GitHub, and don't show them in screenshots.

#### Step 1: Create the Telegram bot

1. In Telegram, search for **@BotFather** (the official one with a blue check) and open it.
2. Send `/newbot`.
3. Choose a **name** for your bot, e.g. `My Wallet`.
4. Choose a **username**. It must end in `bot`, e.g. `my_wallet_bot`.
5. BotFather gives you a **token** that looks like `123456789:AAH...`
   👉 Copy and keep it. This is your **`TELEGRAM_TOKEN`**.

#### Step 2: Prepare Notion

**2a. Create a Notion integration**

1. Go to **https://www.notion.so/profile/integrations** and sign in.
2. Click **New integration**.
3. Name it `Telegram Asistan`, pick your workspace and leave the type as **Internal**.
4. Click **Save**.
5. Next to **Internal Integration Secret**, click **Show** and then **Copy**. The value starts with `ntn_`.
   👉 This is your **`NOTION_TOKEN`**.
6. On the same page, under **Capabilities**, make sure **Read content**, **Update content** and **Insert content** are ticked.

**2b. Create a page and connect the integration**

1. Create a new, empty page in Notion, e.g. `Telegram Assistant`.
2. Open the **•••** menu at the top right of the page.
3. Go to **Connections** → **Connect to**, pick the `Telegram Asistan` integration and confirm.

You **don't** need to create any tables by hand. The bot creates them under this page in step 4.

> ⚠️ Connect the integration to **this one page only**. If the integration can see several pages, the bot can't tell which one to use. See [Troubleshooting](#troubleshooting) if that happens.

#### Step 3: Deploy the bot to Cloudflare

First create a free Cloudflare account at **https://dash.cloudflare.com/sign-up**.

Then choose one of the two options below:

<details open>
<summary><b>Option A: One-click deploy (recommended)</b></summary>

1. Click the **Deploy to Cloudflare** button at the top of this page.
2. Sign in to Cloudflare, and connect GitHub if it asks. Cloudflare makes a copy of this project in your GitHub account.
3. The setup screen asks for three values:
   - **`TELEGRAM_TOKEN`**: the token from step 1
   - **`NOTION_TOKEN`**: the `ntn_...` value from step 2
   - **`WEBHOOK_SECRET`**: a long random text you make up. Use **only** letters, digits, `_` and `-`, e.g. `cat_table_7391_green_cloud`. You don't need to remember it.
4. Click **Create and deploy** and wait for it to finish.
5. You'll see your Worker's address, like `https://telegram-asistan.YOURNAME.workers.dev`. Copy it.

The AI binding (`AI`) and the daily timer are set up automatically with this option. **Go to step 4.**
</details>

<details>
<summary><b>Option B: Manual setup (if the button doesn't work)</b></summary>

1. Go to **https://dash.cloudflare.com** and open **Compute (Workers)** → **Workers & Pages** in the left menu. The menu name may differ slightly; pick the one that says "Workers".
2. Click **Create** → **Start with Hello World!** (or "Create Worker").
3. Name it `telegram-asistan` and click **Deploy**.
4. Click **Edit code**.
5. **Delete everything** in the `worker.js` file on the left. Open [`worker.js`](worker.js) from this project, copy all of it and paste it in.
6. Click **Deploy** at the top right, then go back.
7. Go to **Settings** → **Variables and Secrets** → **Add**. Add these three values one by one, each with **Type: Secret**:

   | Variable name | Value |
   |---|---|
   | `TELEGRAM_TOKEN` | the token from step 1 |
   | `NOTION_TOKEN` | the `ntn_...` value from step 2 |
   | `WEBHOOK_SECRET` | your made-up random text (letters, digits, `_`, `-` only) |

   Click **Deploy** or **Save** after each one.
8. Go to **Settings** → **Bindings** → **Add binding** → **Workers AI**. Type exactly `AI` (capital letters) as the **Variable name** and save.
9. Go to **Settings** → **Trigger Events** (or "Triggers") → **Add** → **Cron Triggers**. Enter `0 6 * * *` and save. This processes subscriptions every day at 06:00 UTC.
10. Copy your Worker's address from the top of the page. It looks like `https://telegram-asistan.YOURNAME.workers.dev`.
</details>

#### Step 4: Open the setup page

In your browser, add `/kurulum` ("setup" in Turkish) to the end of your Worker's address:

```
https://telegram-asistan.YOURNAME.workers.dev/kurulum
```

This page:
- checks that your settings are correct,
- creates the 6 tables under your Notion page,
- connects your bot to Telegram.

Every line should show ✅. If a line shows ❌, it tells you what to fix. Fix it and reload the page. You can open this page as often as you like: it never touches existing tables and never creates the same table twice.

#### Step 5: Lock the bot to yourself

1. Find your bot in Telegram (the username from step 1), tap **Start** or send `hello`.
2. The bot replies with `Your chat ID: 123456789`.
3. In Cloudflare, go to **Settings** → **Variables and Secrets** → **Add**:
   - Variable name: `ALLOWED_CHAT_ID`
   - Value: the number the bot sent you
   Then save.

From now on the bot answers **only you**. Even if someone else finds your bot, they can't save anything.

#### Step 6: Try it! 🎉

Send `kahve 120tl` to your bot. Within a few seconds you should get `✅ 120 ₺ – Kahve kaydedildi (Yiyecek-İçecek)`, and a new row should appear in the **Harcamalar** table in Notion.

---

### Tips

- **Cash balance:** first send `cebimde 6000 lira var` ("I have 6000 lira") once. After that, `ne kadar param var` counts the income and expenses you saved from then on. If you delete or fix a row in Notion, the balance fixes itself.
- **Queries:** understands today (`bugün`), this week (`bu hafta`, starting Monday), this month (`bu ay`) and last month (`geçen ay`).
- **Wrong record:** just delete or edit the row in Notion.
- **No amount, no expense:** if a message has no amount, it is saved as a note.

### Optional settings

Add these in Cloudflare → Settings → Variables and Secrets:

| Name | What it does |
|---|---|
| `TIMEZONE` | Time zone. Default `Europe/Istanbul`. |
| `AI_MODEL` | The AI model. Default `@cf/meta/llama-3.1-8b-instruct-fp8`. If Cloudflare ever retires it, put the name of a newer "instruct" model from the [model list](https://developers.cloudflare.com/workers-ai/models/) here. No code change needed. |
| `NOTION_PAGE_ID` | The id of the Notion page for the tables. Only needed if your integration sees more than one page. |
| `DB_HARCAMALAR`, `DB_GELIRLER`, `DB_GOREVLER`, `DB_NOTLAR`, `DB_ABONELIKLER`, `DB_KASA` | Set table ids by hand. Normally not needed; the bot finds tables by name. |

> ⚠️ **Don't rename** the tables or their columns in Notion. The bot finds them by name.

### Troubleshooting

| Symptom | Fix |
|---|---|
| The bot never replies | Open `/kurulum` and fix any ❌ lines. Check you're messaging the right bot. |
| `⛔ Yetkisiz sohbet` (unauthorized chat) | `ALLOWED_CHAT_ID` is wrong. Delete it, message the bot again and enter the new number. |
| `Notion table not found` | Open `/kurulum`. Check that the integration is added under **••• → Connections** on your Notion page. |
| `/kurulum` says the integration sees several pages | Remove the integration from the extra pages, **or** add `NOTION_PAGE_ID`. The page id is the last 32 characters of the page's address: `notion.so/My-Page-`**`1a2b3c4d5e6f7a8b...`** |
| `AI modeli çalışmadı` (AI model failed) | Check the `AI` binding exists in Cloudflare. If it keeps failing, set a newer model name in `AI_MODEL`. |
| `⏳ Bu işlem çok uzun sürdü` (took too long) | The AI was slow at that moment. Send the message again. |
| `Unauthorized` from Telegram | `TELEGRAM_TOKEN` was copied wrong. Check it in BotFather: `/mybots` → your bot → **API Token**. |

The **Logs** tab on your Worker's page in Cloudflare shows error details.

### Privacy

- Your messages only go to **your** Cloudflare account, **your** Notion workspace and Telegram. Nobody else, including the author of this project, can see your data.
- The AI that reads your messages runs on Cloudflare's own servers. Messages are not sent to any other AI company.

### For developers

```bash
npm test          # Tests with fake Telegram/Notion/AI (no internet needed)
npx wrangler dev  # Run locally (copy .dev.vars.example to .dev.vars)
npx wrangler deploy
```

To teach the bot a new kind of message, add an example to the prompt in the `parse` function of `worker.js`. The small model learns from examples.

---

Lisans / License: [MIT](LICENSE)
