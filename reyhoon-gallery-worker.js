// ============================================================
//  Reyhoon Gold Gallery — Cloudflare Worker
//  شامل: API گالری، پنل مدیریت اینلاین تلگرام، سیستم تیکت پشتیبانی
// ============================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PAGE_SIZE = 5;

const DEFAULT_SETTINGS = { fee18: 20, fee24: 4, feeUsed: 6 };

// ------------------------------------------------------------
//  Router
// ------------------------------------------------------------
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

    if (url.pathname === "/debug-send" && request.method === "GET") {
      return handleDebugSend(env);
    }

    // ---- سیستم تیکت پشتیبانی (برای ویجت چت روی سایت) ----
    if (url.pathname === "/api/ticket" && request.method === "POST") {
      return handleCreateTicket(request, env);
    }
    if (url.pathname === "/api/ticket/message" && request.method === "POST") {
      return handleTicketMessage(request, env);
    }
    if (url.pathname === "/api/ticket/poll" && request.method === "GET") {
      return handleTicketPoll(url, env);
    }

    return new Response("Reyhoon Gold Gallery API - OK", { status: 200 });
  },
};

// ============================================================
//  Gallery API
// ============================================================
async function handleGetGallery(env) {
  const items = await getItems(env);
  return new Response(JSON.stringify({ items }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function getItems(env) {
  const raw = await env.SHOP_DB.get("items");
  return raw ? JSON.parse(raw) : [];
}

async function saveItems(items, env) {
  await env.SHOP_DB.put("items", JSON.stringify(items));
}

async function getSettings(env) {
  const raw = await env.SHOP_DB.get("settings");
  return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
}

async function saveSettings(settings, env) {
  await env.SHOP_DB.put("settings", JSON.stringify(settings));
}

// ============================================================
//  Debug
// ============================================================
async function handleDebugSend(env) {
  const res = await tgApi("sendMessage", { chat_id: env.ADMIN_ID, text: "test from debug endpoint" }, env);
  const text = await res.text();
  return new Response(
    "status: " + res.status + "\nbody: " + text + "\nBOT_TOKEN set: " + (!!env.BOT_TOKEN) + "\nADMIN_ID: " + env.ADMIN_ID,
    { headers: { "Content-Type": "text/plain" } }
  );
}

// ============================================================
//  Telegram helpers
// ============================================================
async function tgApi(method, payload, env) {
  const res = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.log(method + " failed:", res.status, errText);
  }
  return res;
}

function sendMessage(chatId, text, env, keyboard) {
  const payload = { chat_id: chatId, text: text };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  return tgApi("sendMessage", payload, env);
}

function editMessage(chatId, messageId, text, env, keyboard) {
  const payload = { chat_id: chatId, message_id: messageId, text: text };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  return tgApi("editMessageText", payload, env);
}

function answerCallback(callbackQueryId, env, text) {
  const payload = { callback_query_id: callbackQueryId };
  if (text) payload.text = text;
  return tgApi("answerCallbackQuery", payload, env);
}

// ============================================================
//  Webhook entrypoint
// ============================================================
async function handleTelegramWebhook(request, env) {
  const update = await request.json();

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env);
    return new Response("ok");
  }

  const msg = update.message;
  if (!msg) return new Response("ok");

  const chatId = String(msg.chat.id);

  if (msg.text === "/whoami") {
    await sendMessage(chatId, "chat id: " + chatId, env);
    return new Response("ok");
  }

  if (chatId !== String(env.ADMIN_ID)) {
    return new Response("ok");
  }

  try {
    await handleAdminMessage(msg, chatId, env);
  } catch (err) {
    await sendMessage(chatId, "خطا: " + err.message, env);
  }

  return new Response("ok");
}

// ============================================================
//  Admin message handling (متن‌های ادمین + state دوطرفه)
// ============================================================
async function handleAdminMessage(msg, chatId, env) {
  const state = await env.SHOP_DB.get("state:" + chatId);
  if (state) {
    const consumed = await handlePendingState(state, msg, chatId, env);
    if (consumed) return;
  }

  if (msg.photo && msg.caption) {
    await handleNewItem(msg, env);
    return;
  }

  if (msg.text === "/start" || msg.text === "/panel") {
    await sendDashboard(chatId, env);
    return;
  }

  if (msg.text === "/help") {
    await sendMessage(chatId, HELP_TEXT, env, [[{ text: "🏠 پنل مدیریت", callback_data: "menu" }]]);
    return;
  }

  if (msg.text === "/list") {
    await sendItemListMessage(chatId, env, 0, "view");
    return;
  }

  if (msg.text && msg.text.startsWith("/delete")) {
    await handleDeleteCommand(msg.text, chatId, env);
    return;
  }

  await sendMessage(chatId, "برای شروع از /start استفاده کن.", env);
}

async function handlePendingState(state, msg, chatId, env) {
  // مرحله عکس: تنها استثنایی که پیام متنی نیست
  if (state === "new_photo") {
    if (!msg.photo) {
      await sendMessage(chatId, "لطفاً یه عکس بفرست، یا /start رو بزن برای انصراف.", env);
      return true;
    }
    await goToPreview(msg, chatId, env);
    return true;
  }

  // این مرحله‌ها فقط با دکمه پیش می‌رن، نه با تایپ کردن
  if (["new_category", "new_karat", "new_fee_choice", "new_badge", "new_featured", "new_confirm"].includes(state)) {
    await sendMessage(chatId, "لطفاً از دکمه‌های بالا استفاده کن، یا /start رو بزن.", env);
    return true;
  }

  if (!msg.text) return false;

  if (state === "new_name") {
    await saveDraft(chatId, { name: msg.text }, env);
    await env.SHOP_DB.put("state:" + chatId, "new_category");
    await sendMessage(chatId, "مرحله ۲ از ۶ — دسته محصول رو انتخاب کن:", env, categoryKeyboard());
    return true;
  }

  if (state === "new_weight") {
    const val = parseFloat(msg.text);
    if (isNaN(val)) {
      await sendMessage(chatId, "عدد نامعتبره. وزن رو به گرم بفرست (مثلاً 4.2):", env, cancelKeyboard());
      return true;
    }
    const draft = await saveDraft(chatId, { weight: val }, env);
    // اگه از مسیر "مشابه آخرین" اومده باشیم، بقیه فیلدها از قبل ست شدن → مستقیم برو مرحله عکس
    if (draft.karat !== undefined && draft.fee !== undefined) {
      await env.SHOP_DB.put("state:" + chatId, "new_photo");
      await sendMessage(chatId, "آخرین مرحله — حالا عکس محصول رو بفرست 📷", env, cancelKeyboard());
      return true;
    }
    await env.SHOP_DB.put("state:" + chatId, "new_fee_choice");
    await sendMessage(chatId, "مرحله ۴ از ۶ — برای اجرت چیکار کنیم؟", env, [
      [{ text: "استفاده از اجرت پیش‌فرض", callback_data: "newfee:default" }],
      [{ text: "وارد کردن دستی", callback_data: "newfee:manual" }],
      [{ text: "انصراف", callback_data: "newitem_cancel" }],
    ]);
    return true;
  }

  if (state === "new_fee_manual") {
    const val = parseFloat(msg.text);
    if (isNaN(val)) {
      await sendMessage(chatId, "عدد نامعتبره. درصد اجرت رو بفرست:", env, cancelKeyboard());
      return true;
    }
    await saveDraft(chatId, { fee: val }, env);
    await env.SHOP_DB.put("state:" + chatId, "new_badge");
    await sendMessage(chatId, "مرحله ۵ از ۶ — برچسب محصول رو انتخاب کن:", env, badgeKeyboard());
    return true;
  }

  if (state.startsWith("await_fee_")) {
    await env.SHOP_DB.delete("state:" + chatId);
    const key = state.replace("await_fee_", "");
    const val = parseFloat(msg.text);
    if (isNaN(val)) {
      await sendMessage(chatId, "عدد نامعتبره. دوباره از منوی تنظیمات تلاش کن.", env, [[{ text: "⚙️ تنظیمات اجرت", callback_data: "settings" }]]);
      return true;
    }
    const settings = await getSettings(env);
    if (key === "18") settings.fee18 = val;
    else if (key === "24") settings.fee24 = val;
    else settings.feeUsed = val;
    await saveSettings(settings, env);
    await sendMessage(chatId, "اجرت پیش‌فرض به‌روزرسانی شد ✅", env, [[{ text: "⚙️ تنظیمات اجرت", callback_data: "settings" }, { text: "🏠 منو", callback_data: "menu" }]]);
    return true;
  }

  if (state.startsWith("await_reply_")) {
    await env.SHOP_DB.delete("state:" + chatId);
    const ticketId = state.replace("await_reply_", "");
    await addTicketMessage(ticketId, "admin", msg.text, env);
    await sendMessage(chatId, "پاسخ برای تیکت #" + ticketId + " ارسال شد ✅", env, [[{ text: "🎫 تیکت‌های باز", callback_data: "tickets:0" }, { text: "🏠 منو", callback_data: "menu" }]]);
    return true;
  }

  return false;
}

// ------------------------------------------------------------
//  Draft محصول در حال افزودن (پیش‌نویس مرحله‌ای)
// ------------------------------------------------------------
async function getDraft(chatId, env) {
  const raw = await env.SHOP_DB.get("draft:" + chatId);
  return raw ? JSON.parse(raw) : {};
}

async function saveDraft(chatId, patch, env) {
  const draft = await getDraft(chatId, env);
  Object.assign(draft, patch);
  await env.SHOP_DB.put("draft:" + chatId, JSON.stringify(draft));
  return draft;
}

async function clearDraft(chatId, env) {
  await env.SHOP_DB.delete("draft:" + chatId);
}

async function getLastDraft(chatId, env) {
  const raw = await env.SHOP_DB.get("lastdraft:" + chatId);
  return raw ? JSON.parse(raw) : null;
}

async function saveLastDraft(chatId, draft, env) {
  // فقط ویژگی‌های قابل تکرار رو نگه می‌داریم، نه نام/وزن/عکس
  const reusable = { category: draft.category, karat: draft.karat, fee: draft.fee, badge: draft.badge, featured: draft.featured };
  await env.SHOP_DB.put("lastdraft:" + chatId, JSON.stringify(reusable));
}

function categoryKeyboard() {
  return [
    [{ text: "گردنبند", callback_data: "newcat:گردنبند" }, { text: "دستبند", callback_data: "newcat:دستبند" }],
    [{ text: "انگشتر", callback_data: "newcat:انگشتر" }, { text: "گوشواره", callback_data: "newcat:گوشواره" }],
    [{ text: "شمش", callback_data: "newcat:شمش" }],
    [{ text: "انصراف", callback_data: "newitem_cancel" }],
  ];
}

function karatKeyboard() {
  return [
    [{ text: "18 عیار", callback_data: "newkarat:18" }, { text: "24 عیار", callback_data: "newkarat:24" }],
    [{ text: "کارکرده", callback_data: "newkarat:used" }],
    [{ text: "انصراف", callback_data: "newitem_cancel" }],
  ];
}

function badgeKeyboard() {
  return [
    [{ text: "پرفروش", callback_data: "newbadge:پرفروش" }, { text: "جدید", callback_data: "newbadge:جدید" }],
    [{ text: "هیچکدام", callback_data: "newbadge:none" }],
    [{ text: "انصراف", callback_data: "newitem_cancel" }],
  ];
}

function featuredKeyboard() {
  return [
    [{ text: "✅ بله، تو صفحه اصلی هم باشه", callback_data: "newfeatured:yes" }],
    [{ text: "خیر، فقط تو فروشگاه کامل", callback_data: "newfeatured:no" }],
    [{ text: "انصراف", callback_data: "newitem_cancel" }],
  ];
}

function cancelKeyboard() {
  return [[{ text: "انصراف", callback_data: "newitem_cancel" }]];
}

function draftSummaryText(draft) {
  const karatTxt = draft.karat === "used" ? "کارکرده" : draft.karat + " عیار";
  const feeTxt = draft.fee != null ? draft.fee + "٪ (دستی)" : "پیش‌فرض";
  return (
    "پیش‌نمایش محصول:\n\n" +
    "نام: " + draft.name + "\n" +
    "دسته: " + draft.category + "\n" +
    "عیار: " + karatTxt + "\n" +
    "وزن: " + draft.weight + " گرم\n" +
    "اجرت: " + feeTxt + "\n" +
    "برچسب: " + (draft.badge || "—") + "\n" +
    "نمایش در صفحه اصلی: " + (draft.featured ? "بله ✅" : "خیر") + "\n\n" +
    "همه چیز درسته؟"
  );
}

async function goToPreview(msg, chatId, env) {
  const photo = msg.photo[msg.photo.length - 1];
  await saveDraft(chatId, { photoFileId: photo.file_id }, env);
  const draft = await getDraft(chatId, env);
  await env.SHOP_DB.put("state:" + chatId, "new_confirm");
  await sendMessage(chatId, draftSummaryText(draft), env, [
    [{ text: "✅ تایید و ثبت محصول", callback_data: "newitem_confirm" }],
    [{ text: "انصراف", callback_data: "newitem_cancel" }],
  ]);
}

async function finalizeNewItem(chatId, env) {
  const draft = await getDraft(chatId, env);
  const imageDataUrl = await downloadPhotoAsDataUrl(draft.photoFileId, env);

  const items = await getItems(env);
  const settings = await getSettings(env);
  const nextId = await getNextId(env);

  const karatVal = draft.karat === "used" ? "used" : parseInt(draft.karat);
  const defaultFee = karatVal === 24 ? settings.fee24 : karatVal === "used" ? settings.feeUsed : settings.fee18;

  const item = {
    id: nextId,
    name: draft.name,
    category: draft.category,
    karat: karatVal,
    weight: draft.weight,
    makingFee: draft.fee != null ? draft.fee : defaultFee,
    badge: draft.badge || null,
    featured: !!draft.featured,
    rating: 4.7,
    image: imageDataUrl,
    createdAt: Date.now(),
  };

  items.unshift(item);
  await saveItems(items, env);
  await saveLastDraft(chatId, draft, env);
  await clearDraft(chatId, env);
  await env.SHOP_DB.delete("state:" + chatId);

  await sendMessage(chatId, "محصول اضافه شد ✅\n\n" + formatItemLine(item), env, [
    [{ text: "➕ مشابه همین (سریع)", callback_data: "newitem_like" }],
    [{ text: "➕ محصول کاملاً جدید", callback_data: "newitem" }, { text: "🏠 منو", callback_data: "menu" }],
  ]);
}

// ============================================================
//  Callback query (دکمه‌های اینلاین)
// ============================================================
async function handleCallbackQuery(cq, env) {
  const chatId = String(cq.message.chat.id);
  const messageId = cq.message.message_id;
  const data = cq.data || "";

  if (chatId !== String(env.ADMIN_ID)) {
    await answerCallback(cq.id, env);
    return;
  }

  await answerCallback(cq.id, env);

  if (data === "menu") {
    await editMessage(chatId, messageId, DASHBOARD_TEXT, env, dashboardKeyboard());
    return;
  }

  if (data === "noop") return;

  if (data.startsWith("list:")) {
    const page = parseInt(data.split(":")[1]) || 0;
    await editItemListMessage(chatId, messageId, env, page, "view");
    return;
  }

  if (data.startsWith("delmenu:")) {
    const page = parseInt(data.split(":")[1]) || 0;
    await editItemListMessage(chatId, messageId, env, page, "delete");
    return;
  }

  if (data.startsWith("del:")) {
    const id = parseInt(data.split(":")[1]);
    const items = await getItems(env);
    const before = items.length;
    const filtered = items.filter((it) => it.id !== id);
    await saveItems(filtered, env);
    const text = filtered.length < before ? "محصول #" + id + " حذف شد ✅" : "محصول #" + id + " پیدا نشد";
    await editMessage(chatId, messageId, text, env, [[{ text: "🗑 حذف محصول دیگر", callback_data: "delmenu:0" }, { text: "🏠 منو", callback_data: "menu" }]]);
    return;
  }

  if (data === "newitem") {
    await clearDraft(chatId, env);
    await env.SHOP_DB.put("state:" + chatId, "new_name");
    await editMessage(chatId, messageId, "بیا محصول جدید اضافه کنیم 🛍\n\nمرحله ۱ از ۶ — نام محصول رو بفرست:", env, cancelKeyboard());
    return;
  }

  // مسیر سریع: مشخصات محصول قبلی (دسته/عیار/اجرت/برچسب/ویژه) رو کپی می‌کنیم
  // و فقط نام، وزن و عکس جدید می‌پرسیم
  if (data === "newitem_like") {
    const last = await getLastDraft(chatId, env);
    if (!last) {
      await editMessage(chatId, messageId, "هنوز محصول قبلی‌ای برای کپی کردن نیست. بیا از اول شروع کنیم:", env, [[{ text: "➕ افزودن محصول", callback_data: "newitem" }]]);
      return;
    }
    await clearDraft(chatId, env);
    await saveDraft(chatId, last, env);
    await env.SHOP_DB.put("state:" + chatId, "new_name");
    await editMessage(chatId, messageId, "مشخصات قبلی کپی شد (دسته/عیار/اجرت/برچسب).\n\nفقط نام محصول جدید رو بفرست:", env, cancelKeyboard());
    return;
  }

  if (data === "newitem_cancel") {
    await clearDraft(chatId, env);
    await env.SHOP_DB.delete("state:" + chatId);
    await editMessage(chatId, messageId, "افزودن محصول لغو شد.", env, [[{ text: "🏠 منو", callback_data: "menu" }]]);
    return;
  }

  if (data === "newitem_confirm") {
    await finalizeNewItem(chatId, env);
    return;
  }

  if (data.startsWith("newcat:")) {
    const val = data.slice("newcat:".length);
    await saveDraft(chatId, { category: val }, env);
    await env.SHOP_DB.put("state:" + chatId, "new_karat");
    await editMessage(chatId, messageId, "مرحله ۳ از ۶ — عیار رو انتخاب کن:", env, karatKeyboard());
    return;
  }

  if (data.startsWith("newkarat:")) {
    const val = data.slice("newkarat:".length);
    await saveDraft(chatId, { karat: val }, env);
    await env.SHOP_DB.put("state:" + chatId, "new_weight");
    await editMessage(chatId, messageId, "مرحله ۳ از ۶ — وزن رو به گرم بفرست (مثلاً 4.2):", env, cancelKeyboard());
    return;
  }

  if (data === "newfee:default") {
    await saveDraft(chatId, { fee: null }, env);
    await env.SHOP_DB.put("state:" + chatId, "new_badge");
    await editMessage(chatId, messageId, "مرحله ۵ از ۶ — برچسب محصول رو انتخاب کن:", env, badgeKeyboard());
    return;
  }

  if (data === "newfee:manual") {
    await env.SHOP_DB.put("state:" + chatId, "new_fee_manual");
    await editMessage(chatId, messageId, "درصد اجرت رو بفرست (مثلاً 18):", env, cancelKeyboard());
    return;
  }

  if (data.startsWith("newbadge:")) {
    const val = data.slice("newbadge:".length);
    const patch = { badge: val === "none" ? null : val };
    // انتخاب هوشمند پیش‌فرض: اگه برچسب «پرفروش» بود پیشنهاد می‌دیم نمایش در اصلی هم فعال باشه
    await saveDraft(chatId, patch, env);
    await env.SHOP_DB.put("state:" + chatId, "new_featured");
    await editMessage(chatId, messageId, "مرحله ۶ از ۶ — این محصول تو صفحه اصلی (بخش پرفروش‌ها) هم نمایش داده بشه؟", env, featuredKeyboard());
    return;
  }

  if (data.startsWith("newfeatured:")) {
    const val = data.slice("newfeatured:".length) === "yes";
    await saveDraft(chatId, { featured: val }, env);
    await env.SHOP_DB.put("state:" + chatId, "new_photo");
    await editMessage(chatId, messageId, "آخرین مرحله — حالا عکس محصول رو بفرست 📷", env, cancelKeyboard());
    return;
  }

  if (data === "addhelp") {
    await editMessage(chatId, messageId, HELP_TEXT, env, [[{ text: "« بازگشت", callback_data: "menu" }]]);
    return;
  }

  if (data === "stats") {
    await editMessage(chatId, messageId, await buildStatsText(env), env, [[{ text: "« بازگشت", callback_data: "menu" }]]);
    return;
  }

  if (data === "settings") {
    const settings = await getSettings(env);
    const text =
      "نرخ اجرت پیش‌فرض:\n" +
      "طلای ۱۸ عیار: " + settings.fee18 + "%\n" +
      "طلای ۲۴ عیار: " + settings.fee24 + "%\n" +
      "کارکرده: " + settings.feeUsed + "%\n\n" +
      "برای تغییر هرکدوم روی دکمه بزن.";
    await editMessage(chatId, messageId, text, env, [
      [{ text: "ویرایش اجرت ۱۸ عیار", callback_data: "setfee:18" }],
      [{ text: "ویرایش اجرت ۲۴ عیار", callback_data: "setfee:24" }],
      [{ text: "ویرایش اجرت کارکرده", callback_data: "setfee:used" }],
      [{ text: "« بازگشت", callback_data: "menu" }],
    ]);
    return;
  }

  if (data.startsWith("setfee:")) {
    const key = data.split(":")[1];
    await env.SHOP_DB.put("state:" + chatId, "await_fee_" + key);
    await editMessage(chatId, messageId, "درصد اجرت جدید رو به‌صورت عدد بفرست (مثلاً 18):", env, [[{ text: "انصراف", callback_data: "settings" }]]);
    return;
  }

  if (data.startsWith("tickets:")) {
    const page = parseInt(data.split(":")[1]) || 0;
    await editTicketListMessage(chatId, messageId, env, page);
    return;
  }

  if (data.startsWith("viewtick:")) {
    const id = data.split(":")[1];
    await editTicketDetailMessage(chatId, messageId, env, id);
    return;
  }

  if (data.startsWith("reply:")) {
    const id = data.split(":")[1];
    await env.SHOP_DB.put("state:" + chatId, "await_reply_" + id);
    await editMessage(chatId, messageId, "پاسخت رو برای تیکت #" + id + " بنویس و بفرست:", env, [[{ text: "انصراف", callback_data: "viewtick:" + id }]]);
    return;
  }

  if (data.startsWith("closetick:")) {
    const id = data.split(":")[1];
    await closeTicket(id, env);
    await editTicketListMessage(chatId, messageId, env, 0);
    return;
  }
}

// ============================================================
//  Dashboard
// ============================================================
const DASHBOARD_TEXT = "پنل مدیریت گالری طلا 🏆\nیکی از گزینه‌ها رو انتخاب کن:";

function dashboardKeyboard() {
  return [
    [{ text: "📋 لیست محصولات", callback_data: "list:0" }, { text: "🗑 حذف محصول", callback_data: "delmenu:0" }],
    [{ text: "📊 آمار فروشگاه", callback_data: "stats" }, { text: "⚙️ تنظیمات اجرت", callback_data: "settings" }],
    [{ text: "➕ افزودن محصول جدید", callback_data: "newitem" }, { text: "🎫 تیکت‌های باز", callback_data: "tickets:0" }],
    [{ text: "📖 روش سریع (عکس+کپشن)", callback_data: "addhelp" }],
  ];
}

function sendDashboard(chatId, env) {
  return sendMessage(chatId, DASHBOARD_TEXT, env, dashboardKeyboard());
}

const HELP_TEXT =
  "روش سریع افزودن محصول (پیشنهادی: از /start استفاده کن که مرحله‌به‌مرحله پیش بره)\n\n" +
  "اگه عجله داری، یه عکس با کپشن به این فرمت بفرست:\n\n" +
  "نام: گردنبند طرح ظریف\n" +
  "دسته: گردنبند\n" +
  "عیار: 18\n" +
  "وزن: 4.2\n" +
  "اجرت: 18\n" +
  "برچسب: پرفروش\n" +
  "نمایش: بله\n\n" +
  "دسته: گردنبند/دستبند/انگشتر/گوشواره/شمش\n" +
  "عیار: 18 یا 24 یا used (کارکرده)\n" +
  "اجرت اختیاریه — اگه ندی از تنظیمات پیش‌فرض استفاده میشه.\n" +
  "برچسب و «نمایش» (نمایش در صفحه اصلی) هم اختیاری‌ان — پیش‌فرض «خیر».\n\n" +
  "برای افزودن سریع محصول مشابه قبلی، از دکمه «➕ مشابه همین» بعد از ثبت هر محصول استفاده کن — دیگه لازم نیست دسته/عیار/اجرت رو دوباره بزنی.\n\n" +
  "دستورهای دیگه:\n" +
  "/start - پنل مدیریت\n" +
  "/list - لیست محصولات\n" +
  "/delete <id> - حذف محصول";

// ============================================================
//  افزودن محصول (روش سریع: عکس + کپشن)
// ============================================================
async function handleNewItem(msg, env) {
  const fields = parseCaption(msg.caption);
  if (!fields.name || !fields.category || !fields.karat || !fields.weight) {
    await sendMessage(msg.chat.id, "کپشن ناقصه. حداقل نام، دسته، عیار و وزن لازمه.\n\n" + HELP_TEXT, env);
    return;
  }

  const photo = msg.photo[msg.photo.length - 1];
  const imageDataUrl = await downloadPhotoAsDataUrl(photo.file_id, env);

  const items = await getItems(env);
  const settings = await getSettings(env);
  const nextId = await getNextId(env);

  const karatVal = fields.karat === "used" ? "used" : parseInt(fields.karat);
  const defaultFee = karatVal === 24 ? settings.fee24 : karatVal === "used" ? settings.feeUsed : settings.fee18;
  const featuredVal = fields.featured ? /^(بله|yes|true|1)$/i.test(fields.featured.trim()) : false;

  const item = {
    id: nextId,
    name: fields.name,
    category: fields.category,
    karat: karatVal,
    weight: parseFloat(fields.weight),
    makingFee: fields.fee ? parseFloat(fields.fee) : defaultFee,
    badge: fields.badge || null,
    featured: featuredVal,
    rating: 4.7,
    image: imageDataUrl,
    createdAt: Date.now(),
  };

  items.unshift(item);
  await saveItems(items, env);

  await sendMessage(msg.chat.id, "موفق: " + item.name + " id=" + item.id, env, [[{ text: "🏠 منو", callback_data: "menu" }]]);
}

function parseCaption(caption) {
  const fields = {};
  const map = { "نام": "name", "دسته": "category", "عیار": "karat", "وزن": "weight", "اجرت": "fee", "برچسب": "badge", "نمایش": "featured" };
  caption.split("\n").forEach(function (line) {
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
  const fileInfoRes = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/getFile?file_id=" + fileId);
  const fileInfo = await fileInfoRes.json();
  const filePath = fileInfo.result.file_path;
  const fileRes = await fetch("https://api.telegram.org/file/bot" + env.BOT_TOKEN + "/" + filePath);
  const buffer = await fileRes.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  const contentType = fileRes.headers.get("content-type") || "image/jpeg";
  return "data:" + contentType + ";base64," + base64;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ============================================================
//  لیست / حذف محصولات
// ============================================================
function formatItemLine(it) {
  return "#" + it.id + " - " + it.name + " (" + it.category + ", " + (it.karat === "used" ? "کارکرده" : it.karat + " عیار") + ", " + it.weight + " گرم)" + (it.featured ? " ⭐" : "");
}

function buildItemListView(items, page, mode) {
  const start = page * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  let text;
  const keyboard = [];

  if (items.length === 0) {
    text = "هنوز محصولی ثبت نشده.";
  } else {
    text = (mode === "delete" ? "برای حذف روی محصول بزن:" : "لیست محصولات (صفحه " + (page + 1) + " از " + totalPages + "):") + "\n\n" + pageItems.map(formatItemLine).join("\n");
    if (mode === "delete") {
      pageItems.forEach((it) => keyboard.push([{ text: "🗑 حذف #" + it.id + " - " + it.name, callback_data: "del:" + it.id }]));
    }
  }

  const navRow = [];
  if (page > 0) navRow.push({ text: "« قبلی", callback_data: (mode === "delete" ? "delmenu:" : "list:") + (page - 1) });
  if (start + PAGE_SIZE < items.length) navRow.push({ text: "بعدی »", callback_data: (mode === "delete" ? "delmenu:" : "list:") + (page + 1) });
  if (navRow.length) keyboard.push(navRow);

  keyboard.push([{ text: "🏠 منو", callback_data: "menu" }]);

  return { text, keyboard };
}

async function sendItemListMessage(chatId, env, page, mode) {
  const items = await getItems(env);
  const { text, keyboard } = buildItemListView(items, page, mode);
  return sendMessage(chatId, text, env, keyboard);
}

async function editItemListMessage(chatId, messageId, env, page, mode) {
  const items = await getItems(env);
  const { text, keyboard } = buildItemListView(items, page, mode);
  return editMessage(chatId, messageId, text, env, keyboard);
}

async function handleDeleteCommand(text, chatId, env) {
  const parts = text.trim().split(/\s+/);
  const id = parseInt(parts[1]);
  if (!id) {
    await sendMessage(chatId, "فرمت درست: /delete 7", env);
    return;
  }
  const items = await getItems(env);
  const before = items.length;
  const filtered = items.filter((it) => it.id !== id);
  await saveItems(filtered, env);
  await sendMessage(chatId, filtered.length < before ? "حذف شد: " + id : "پیدا نشد: " + id, env);
}

// ============================================================
//  آمار
// ============================================================
async function buildStatsText(env) {
  const items = await getItems(env);
  if (items.length === 0) return "هنوز محصولی ثبت نشده.";

  const byCategory = {};
  let totalWeight = 0;
  let featuredCount = 0;
  items.forEach((it) => {
    byCategory[it.category] = (byCategory[it.category] || 0) + 1;
    totalWeight += it.weight || 0;
    if (it.featured) featuredCount += 1;
  });

  let text = "📊 آمار فروشگاه\n\n";
  text += "تعداد کل محصولات: " + items.length + "\n";
  text += "تعداد ویژه (صفحه اصلی): " + featuredCount + "\n";
  text += "مجموع وزن: " + totalWeight.toFixed(2) + " گرم\n\n";
  text += "بر اساس دسته:\n";
  Object.keys(byCategory).forEach((cat) => {
    text += "- " + cat + ": " + byCategory[cat] + "\n";
  });

  return text;
}

// ============================================================
//  سیستم تیکت پشتیبانی (ویجت چت سایت <-> تلگرام ادمین)
// ============================================================
async function getTicket(id, env) {
  const raw = await env.SHOP_DB.get("ticket:" + id);
  return raw ? JSON.parse(raw) : null;
}

async function saveTicket(ticket, env) {
  await env.SHOP_DB.put("ticket:" + ticket.id, JSON.stringify(ticket));
}

async function addTicketMessage(id, from, text, env) {
  const ticket = await getTicket(id, env);
  if (!ticket) return null;
  ticket.messages.push({ from, text, time: Date.now() });
  ticket.updatedAt = Date.now();
  await saveTicket(ticket, env);
  return ticket;
}

async function closeTicket(id, env) {
  const ticket = await getTicket(id, env);
  if (!ticket) return;
  ticket.status = "closed";
  await saveTicket(ticket, env);
}

async function notifyAdminNewTicketMessage(ticket, env) {
  const lastMsg = ticket.messages[ticket.messages.length - 1];
  const text = "🎫 تیکت #" + ticket.id + " از " + (ticket.name || "کاربر سایت") + "\n\n" + lastMsg.text;
  await sendMessage(env.ADMIN_ID, text, env, [[{ text: "پاسخ", callback_data: "reply:" + ticket.id }, { text: "بستن تیکت", callback_data: "closetick:" + ticket.id }]]);
}

async function handleCreateTicket(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = (body.name || "کاربر سایت").toString().slice(0, 100);
  const message = (body.message || "").toString().slice(0, 2000);
  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  const currentRaw = await env.SHOP_DB.get("ticket_next_id");
  const id = currentRaw ? String(parseInt(currentRaw) + 1) : "1";
  await env.SHOP_DB.put("ticket_next_id", id);

  const ticket = {
    id,
    name,
    status: "open",
    messages: [{ from: "customer", text: message, time: Date.now() }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveTicket(ticket, env);
  await notifyAdminNewTicketMessage(ticket, env);

  return new Response(JSON.stringify({ ticketId: id }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

async function handleTicketMessage(request, env) {
  const body = await request.json().catch(() => ({}));
  const ticketId = (body.ticketId || "").toString();
  const message = (body.message || "").toString().slice(0, 2000);
  if (!ticketId || !message) {
    return new Response(JSON.stringify({ error: "ticketId and message are required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  const ticket = await addTicketMessage(ticketId, "customer", message, env);
  if (!ticket) {
    return new Response(JSON.stringify({ error: "ticket not found" }), { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }
  await notifyAdminNewTicketMessage(ticket, env);

  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

async function handleTicketPoll(url, env) {
  const ticketId = url.searchParams.get("ticketId");
  if (!ticketId) {
    return new Response(JSON.stringify({ error: "ticketId is required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }
  const ticket = await getTicket(ticketId, env);
  if (!ticket) {
    return new Response(JSON.stringify({ error: "ticket not found" }), { status: 404, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }
  return new Response(JSON.stringify({ status: ticket.status, messages: ticket.messages }), { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

// ---- لیست تیکت‌ها برای ادمین ----
async function listOpenTickets(env) {
  const list = await env.SHOP_DB.list({ prefix: "ticket:" });
  const tickets = [];
  for (const key of list.keys) {
    const raw = await env.SHOP_DB.get(key.name);
    if (!raw) continue;
    const ticket = JSON.parse(raw);
    if (ticket.status === "open") tickets.push(ticket);
  }
  tickets.sort((a, b) => b.updatedAt - a.updatedAt);
  return tickets;
}

async function editTicketListMessage(chatId, messageId, env, page) {
  const tickets = await listOpenTickets(env);
  const start = page * PAGE_SIZE;
  const pageTickets = tickets.slice(start, start + PAGE_SIZE);

  let text;
  const keyboard = [];

  if (tickets.length === 0) {
    text = "هیچ تیکت بازی وجود نداره.";
  } else {
    text = "🎫 تیکت‌های باز (" + tickets.length + " مورد):";
    pageTickets.forEach((t) => {
      const lastMsg = t.messages[t.messages.length - 1];
      keyboard.push([{ text: "#" + t.id + " - " + t.name + ": " + lastMsg.text.slice(0, 20), callback_data: "viewtick:" + t.id }]);
    });
  }

  const navRow = [];
  if (page > 0) navRow.push({ text: "« قبلی", callback_data: "tickets:" + (page - 1) });
  if (start + PAGE_SIZE < tickets.length) navRow.push({ text: "بعدی »", callback_data: "tickets:" + (page + 1) });
  if (navRow.length) keyboard.push(navRow);

  keyboard.push([{ text: "🏠 منو", callback_data: "menu" }]);

  return editMessage(chatId, messageId, text, env, keyboard);
}

async function editTicketDetailMessage(chatId, messageId, env, ticketId) {
  const ticket = await getTicket(ticketId, env);
  if (!ticket) {
    await editMessage(chatId, messageId, "تیکت پیدا نشد.", env, [[{ text: "🏠 منو", callback_data: "menu" }]]);
    return;
  }

  let text = "🎫 تیکت #" + ticket.id + " - " + ticket.name + " (" + (ticket.status === "open" ? "باز" : "بسته") + ")\n\n";
  ticket.messages.slice(-10).forEach((m) => {
    text += (m.from === "admin" ? "من: " : ticket.name + ": ") + m.text + "\n";
  });

  const keyboard = [];
  if (ticket.status === "open") {
    keyboard.push([{ text: "✍️ پاسخ", callback_data: "reply:" + ticket.id }, { text: "بستن تیکت", callback_data: "closetick:" + ticket.id }]);
  }
  keyboard.push([{ text: "« بازگشت به لیست تیکت‌ها", callback_data: "tickets:0" }, { text: "🏠 منو", callback_data: "menu" }]);

  await editMessage(chatId, messageId, text, env, keyboard);
}
