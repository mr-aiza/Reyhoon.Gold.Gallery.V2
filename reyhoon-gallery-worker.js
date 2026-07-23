/**
 * ===================================================================
 * ریحون گلد گالری — Worker اتصال گالری به تلگرام
 * ===================================================================
 *
 * این Worker دقیقاً همون الگوی bytelab-telegram خودته: یه ربات تلگرام
 * که ازش عکس + مشخصات جنس رو می‌گیری، و یه API عمومی که سایت ازش
 * محصولات رو می‌خونه.
 *
 * ---------------------------------------------------------------
 * مراحل راه‌اندازی:
 * ---------------------------------------------------------------
 * 1) یه ربات تلگرام جدید بساز (اگه نداری): توی تلگرام برو پیش @BotFather
 *    دستور /newbot رو بزن، اسم بده، توکن رو کپی کن.
 *
 * 2) آیدی عددی خودت (ادمین) رو بگیر: به @userinfobot پیام بده،
 *    عدد "Id" که برات می‌فرسته رو نگه دار.
 *
 * 3) یه KV namespace بساز:
 *      wrangler kv namespace create SHOP_DB
 *    خروجیش رو توی wrangler.toml بذار (نمونه‌ش رو جدا فرستادم).
 *
 * 4) این دو تا secret رو ست کن:
 *      wrangler secret put BOT_TOKEN
 *      wrangler secret put ADMIN_ID
 *
 * 5) دیپلوی کن:
 *      wrangler deploy
 *
 * 6) وبهوک ربات رو به آدرس Worker وصل کن (این آدرس رو با آدرس واقعی
 *    Workerت بعد از دیپلوی عوض کن):
 *      https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://reyhoon-gallery.YOUR-SUBDOMAIN.workers.dev/telegram-webhook
 *
 * ---------------------------------------------------------------
 * نحوه‌ی افزودن محصول جدید از تلگرام:
 * ---------------------------------------------------------------
 * یه عکس با کپشن به این فرمت (هر خط جدا) برای ربات بفرست:
 *
 *   نام: گردنبند طرح ظریف
 *   دسته: گردنبند
 *   عیار: 18
 *   وزن: 4.2
 *   اجرت: 18
 *   برچسب: پرفروش
 *
 * - دسته یکی از: گردنبند / دستبند / انگشتر / گوشواره / شمش
 * - عیار یکی از: 18 / 24 / used  (used یعنی کارکرده)
 * - برچسب اختیاریه (می‌تونی خط آخر رو کلاً حذف کنی)
 *
 * دستورهای دیگه:
 *   /list            → لیست همه محصولات با آیدی‌شون
 *   /delete 7        → حذف محصول با آیدی ۷
 *   /help            → راهنما
 * ===================================================================
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/gallery" && request.method === "GET") {
      return handleGetGallery(env);
    }

    if (url.pathname === "/telegram-webhook" && request.method === "POST") {
      return handleTelegramWebhook(request, env);
    }

    return new Response("Reyhoon Gold Gallery API — OK", { status: 200 });
  },
};

// ---------- Public API ----------
async function handleGetGallery(env) {
  const raw = await env.SHOP_DB.get("items");
  const items = raw ? JSON.parse(raw) : [];
  return new Response(JSON.stringify({ items }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ---------- Telegram webhook ----------
async function handleTelegramWebhook(request, env) {
  const update = await request.json();
  const msg = update.message;
  if (!msg) return new Response("ok");

  const chatId = String(msg.chat.id);
  if (chatId !== String(env.ADMIN_ID)) {
    // فقط ادمین اجازه‌ی مدیریت گالری رو داره
    return new Response("ok");
  }

  try {
    if (msg.photo && msg.caption) {
      await handleNewItem(msg, env);
    } else if (msg.text === "/list") {
      await handleList(chatId, env);
    } else if (msg.text && msg.text.startsWith("/delete")) {
      await handleDelete(msg.text, chatId, env);
    } else if (msg.text === "/help" || msg.text === "/start") {
      await sendMessage(chatId, HELP_TEXT, env);
    }
  } catch (err) {
    await sendMessage(chatId, "❌ خطا: " + err.message, env);
  }

  return new Response("ok");
}

const HELP_TEXT =
`برای افزودن محصول جدید، یه عکس با کپشن به این فرمت بفرست:

نام: گردنبند طرح ظریف
دسته: گردنبند
عیار: 18
وزن: 4.2
اجرت: 18
برچسب: پرفروش

دسته: گردنبند/دستبند/انگشتر/گوشواره/شمش
عیار: 18 یا 24 یا used (کارکرده)
برچسب اختیاریه.

دستورهای دیگه:
/list — لیست محصولات
/delete <id> — حذف محصول`;

async function handleNewItem(msg, env) {
  const fields = parseCaption(msg.caption);
  if (!fields.name || !fields.category || !fields.karat || !fields.weight) {
    await sendMessage(msg.chat.id,
      "⚠️ کپشن ناقصه. حداقل «نام»، «دسته»، «عیار» و «وزن» لازمه.\n\n" + HELP_TEXT, env);
    return;
  }

  // بزرگ‌ترین سایز عکس رو انتخاب می‌کنیم
  const photo = msg.photo[msg.photo.length - 1];
  const imageDataUrl = await downloadPhotoAsDataUrl(photo.file_id, env);

  const raw = await env.SHOP_DB.get("items");
  const items = raw ? JSON.parse(raw) : [];
  const nextId = await getNextId(env);

  const karatVal = fields.karat === "used" ? "used" : parseInt(fields.karat);

  const item = {
    id: nextId,
    name: fields.name,
    category: fields.category,
    karat: karatVal,
    weight: parseFloat(fields.weight),
    makingFee: fields.fee ? parseFloat(fields.fee) : (karatVal === 24 ? 4 : karatVal === "used" ? 6 : 20),
    badge: fields.badge || null,
    rating: 4.7,
    image: imageDataUrl,
    createdAt: Date.now(),
  };

  items.unshift(item);
  await env.SHOP_DB.put("items", JSON.stringify(items));

  await sendMessage(msg.chat.id,
    `✅ محصول «${item.name}» با آیدی ${item.id} اضافه شد.`, env);
}

function parseCaption(caption) {
  const fields = {};
  const map = { "نام": "name", "دسته": "category", "عیار": "karat", "وزن": "weight", "اجرت": "fee", "برچسب": "badge" };
  caption.split("\n").forEach(line => {
    const idx = line.indexOf(":");
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    const mapped = map[key];
    if (mapped) fields[mapped] = val;
  });
  return fields;
}

async function getNextId(env) {
  const current = await env.SHOP_DB.get("next_id");
  const next = current ? parseInt(current) + 1 : 1;
  await env.SHOP_DB.put("next_id", String(next));
  return next;
}

async function downloadPhotoAsDataUrl(fileId, env) {
  const fileInfoRes = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const fileInfo = await fileInfoRes.json();
  const filePath = fileInfo.result.file_path;
  const fileRes = await fetch(
    `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`
  );
  const buffer = await fileRes.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const contentType = fileRes.headers.get("content-type") || "image/jpeg";
  return `data:${contentType};base64,${base64}`;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function handleList(chatId, env) {
  const raw = await env.SHOP_DB.get("items");
  const items = raw ? JSON.parse(raw) : [];
  if (items.length === 0) {
    await sendMessage(chatId, "گالری خالیه.", env);
    return;
  }
  const lines = items.map(it =>
    `#${it.id} — ${it.name} (${it.category}، ${it.karat === "used" ? "کارکرده" : it.karat + " عیار"}، ${it.weight} گرم)`
  );
  await sendMessage(chatId, lines.join("\n"), env);
}

async function handleDelete(text, chatId, env) {
  const parts = text.trim().split(/\s+/);
  const id = parseInt(parts[1]);
  if (!id) {
    await sendMessage(chatId, "فرمت درست: /delete 7", env);
    return;
  }
  const raw = await env.SHOP_DB.get("items");
  let items = raw ? JSON.parse(raw) : [];
  const before = items.length;
  items = items.filter(it => it.id !== id);
  await env.SHOP_DB.put("items", JSON.stringify(items));
  await sendMessage(chatId,
    items.length < before ? `🗑️ محصول #${id} حذف شد.` : `محصولی با آیدی ${id} پیدا نشد.`, env);
}

async function sendMessage(chatId, text, env) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
