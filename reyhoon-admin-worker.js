// ============================================================
//  ریحون گلد گالری — Worker اختصاصیِ پنل مدیریت (admin.html)
//  نسخه: 1.0
//
//  این وورکر جدا از reyhoon-gallery-worker.js اجراست ولی از همون
//  KV Namespace (SHOP_DB) استفاده می‌کنه، پس همه‌ی داده‌ها
//  (محصولات، سفارش‌ها، کاربران، تیکت‌ها، کدهای تخفیف، همکاران
//  ادمین تلگرام) بین این پنل وب و ربات تلگرام مشترکه.
//
//  قابلیت‌ها:
//   • ورود امن با رمز عبور + توکن نشست (بدون کوکی، فقط Bearer)
//   • محدودسازی تلاش ورود ناموفق (Rate limit / قفل موقت)
//   • داشبورد آماری کامل + نمودار فروش ۷ روز اخیر
//   • CRUD کامل محصولات، سفارش‌ها، کاربران، کدهای تخفیف، تیکت‌ها
//   • مدیریت کامل ربات تلگرام: همکاران ادمین، پیام همگانی، بک‌آپ فوری
//   • لاگ فعالیت‌های ادمین (Audit Log)
//   • خروجی بک‌آپ کامل + ارسال به تلگرام مالک
//
//  متغیرهای محیطی لازم (Cloudflare → Settings → Variables & Secrets):
//   ADMIN_PANEL_PASSWORD   رمز عبور ورود به پنل وب   (Secret)
//   BOT_TOKEN              توکن ربات تلگرام            (Secret)
//   ADMIN_ID               چت‌آیدی مالک ربات
//   SITE_URL               آدرس سایت (اختیاری)
//   ADMIN_SESSION_HOURS    مدت اعتبار نشست به ساعت (اختیاری، پیش‌فرض 12)
//   ADMIN_ALLOWED_ORIGIN   دامنه‌ی مجاز CORS (اختیاری، پیش‌فرض *)
//
//  KV Binding لازم: SHOP_DB → دقیقاً همون namespace ای که وورکر اصلی
//  فروشگاه (reyhoon-gallery-worker.js) استفاده می‌کنه.
// ============================================================

const DEFAULT_SETTINGS = { fee18: 20, fee24: 4, referralBuyerDiscountPercent: 5, referralBonusPoints: 50 };
const DEFAULT_SESSION_HOURS = 12;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;
const ACTIVITY_LOG_CAP = 300;

const ROLE_LABEL = {
  orders: "سفارش‌ها و تیکت‌ها",
  products: "محصولات + سفارش‌ها",
  full: "کامل (بجز بک‌آپ و مدیریت همکاران)",
  owner: "مالک",
};

const ORDER_STATUSES = ["pending", "in_progress", "completed", "rejected"];

// ------------------------------------------------------------
//  CORS
// ------------------------------------------------------------
function corsHeaders(request, env) {
  const allowed = env.ADMIN_ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(obj, status, request, env) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request, env) },
  });
}

// ------------------------------------------------------------
//  ابزارهای عمومی
// ------------------------------------------------------------
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function generateRandomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return arrayBufferToBase64(bytes.buffer).replace(/[^a-zA-Z0-9]/g, "");
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return {};
  }
}

// ============================================================
//  احراز هویت ادمین (نشست ساده مبتنی بر توکن تصادفی در KV)
// ============================================================
function sessionSeconds(env) {
  const hours = Number(env.ADMIN_SESSION_HOURS) > 0 ? Number(env.ADMIN_SESSION_HOURS) : DEFAULT_SESSION_HOURS;
  return Math.round(hours * 3600);
}

async function createAdminSession(env) {
  const token = generateRandomToken();
  await env.SHOP_DB.put("admin_session:" + token, String(Date.now()), { expirationTtl: sessionSeconds(env) });
  return token;
}

async function revokeAdminSession(token, env) {
  if (token) await env.SHOP_DB.delete("admin_session:" + token);
}

async function isAuthorized(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) return false;
  const val = await env.SHOP_DB.get("admin_session:" + token);
  return !!val;
}

// ---- محدودسازی تلاش ورود ناموفق ----
async function getLoginGuard(env, ip) {
  const raw = await env.SHOP_DB.get("loginguard:" + ip);
  return raw ? JSON.parse(raw) : { count: 0, lockUntil: 0 };
}
async function saveLoginGuard(env, ip, rec) {
  await env.SHOP_DB.put("loginguard:" + ip, JSON.stringify(rec), { expirationTtl: LOGIN_LOCK_MINUTES * 60 * 2 });
}
async function clearLoginGuard(env, ip) {
  await env.SHOP_DB.delete("loginguard:" + ip);
}

// ============================================================
//  لاگ فعالیت ادمین (Audit Log)
// ============================================================
async function logActivity(env, action, detail) {
  try {
    const raw = await env.SHOP_DB.get("admin_activity");
    let logs = raw ? JSON.parse(raw) : [];
    logs.unshift({ action, detail: detail || null, time: Date.now() });
    if (logs.length > ACTIVITY_LOG_CAP) logs = logs.slice(0, ACTIVITY_LOG_CAP);
    await env.SHOP_DB.put("admin_activity", JSON.stringify(logs));
  } catch (err) {
    // ثبت لاگ نباید کل عملیات رو خراب کنه
  }
}

// ============================================================
//  محصولات
// ============================================================
async function getItems(env) {
  const raw = await env.SHOP_DB.get("items");
  return raw ? JSON.parse(raw) : [];
}
async function saveItems(items, env) {
  await env.SHOP_DB.put("items", JSON.stringify(items));
}
async function getNextItemId(env) {
  const current = await env.SHOP_DB.get("next_id");
  const next = current ? parseInt(current, 10) + 1 : 1;
  await env.SHOP_DB.put("next_id", String(next));
  return next;
}

// ---------------- دسته‌بندی‌های محصولات ----------------
async function getCategories(env) {
  const raw = await env.SHOP_DB.get("categories");
  if (raw) return JSON.parse(raw);
  // اولین‌بار: از دسته‌بندی‌های محصولات فعلی بساز (سازگاری با داده‌ی قدیمی)
  const items = await getItems(env);
  const seeded = [...new Set(items.map((it) => it.category).filter(Boolean))];
  await saveCategories(seeded, env);
  return seeded;
}
async function saveCategories(list, env) {
  await env.SHOP_DB.put("categories", JSON.stringify(list));
}
async function ensureCategory(category, env) {
  if (!category) return;
  const cats = await getCategories(env);
  if (!cats.includes(category)) {
    cats.push(category);
    await saveCategories(cats, env);
  }
}

const LOW_STOCK_THRESHOLD = 3;

// ============================================================
//  تنظیمات فروشگاه
// ============================================================
async function getSettings(env) {
  const raw = await env.SHOP_DB.get("settings");
  return raw ? Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw)) : Object.assign({}, DEFAULT_SETTINGS);
}
async function saveSettings(settings, env) {
  await env.SHOP_DB.put("settings", JSON.stringify(settings));
}

// ============================================================
//  سفارش‌ها
// ============================================================
async function listAllOrders(env) {
  const list = await env.SHOP_DB.list({ prefix: "order:" });
  const orders = [];
  for (const key of list.keys) {
    const raw = await env.SHOP_DB.get(key.name);
    if (raw) orders.push(JSON.parse(raw));
  }
  orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return orders;
}
async function getOrder(ticketNumber, env) {
  const raw = await env.SHOP_DB.get("order:" + ticketNumber);
  return raw ? JSON.parse(raw) : null;
}
async function saveOrder(order, env) {
  await env.SHOP_DB.put("order:" + order.ticketNumber, JSON.stringify(order));
}
async function removeOrderFromUserIndex(phone, ticketNumber, env) {
  const raw = await env.SHOP_DB.get("orders_by_phone:" + phone);
  if (!raw) return;
  const list = JSON.parse(raw).filter((tn) => tn !== ticketNumber);
  await env.SHOP_DB.put("orders_by_phone:" + phone, JSON.stringify(list));
}

// ============================================================
//  کاربران
// ============================================================
async function listRegisteredUsers(env) {
  const list = await env.SHOP_DB.list({ prefix: "user:" });
  const users = [];
  for (const key of list.keys) {
    const raw = await env.SHOP_DB.get(key.name);
    if (raw) users.push(JSON.parse(raw));
  }
  users.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return users;
}
function publicUser(user) {
  return {
    phone: user.phone,
    name: user.name || null,
    shipping: user.shipping || null,
    createdAt: user.createdAt || null,
    points: user.points || 0,
    walletBalance: user.walletBalance || 0,
    referralCode: user.referralCode || null,
  };
}

// ============================================================
//  گردش حساب (کیف پول)، امتیاز وفاداری و کد معرفی (رفرال)
// ============================================================
const LEDGER_CAP = 200;

async function getLedger(phone, env) {
  const raw = await env.SHOP_DB.get("ledger:" + phone);
  return raw ? JSON.parse(raw) : [];
}

async function addLedgerEntry(phone, entry, env) {
  const list = await getLedger(phone, env);
  list.unshift({
    id: crypto.randomUUID().slice(0, 8),
    ts: Date.now(),
    type: entry.type,
    amount: Number(entry.amount) || 0,
    unit: entry.unit || "toman",
    note: entry.note || "",
    ref: entry.ref || null,
  });
  if (list.length > LEDGER_CAP) list.length = LEDGER_CAP;
  await env.SHOP_DB.put("ledger:" + phone, JSON.stringify(list));
}

async function getUserRaw(phone, env) {
  const raw = await env.SHOP_DB.get("user:" + phone);
  return raw ? JSON.parse(raw) : null;
}

async function saveUserRaw(user, env) {
  await env.SHOP_DB.put("user:" + user.phone, JSON.stringify(user));
}

async function adjustWallet(phone, amount, note, env) {
  const user = await getUserRaw(phone, env);
  if (!user) throw new Error("کاربر پیدا نشد");
  user.walletBalance = (user.walletBalance || 0) + Number(amount);
  await saveUserRaw(user, env);
  await addLedgerEntry(phone, { type: amount >= 0 ? "credit" : "debit", amount: Math.abs(amount), unit: "toman", note }, env);
  return user.walletBalance;
}

async function adjustPoints(phone, points, note, env) {
  const user = await getUserRaw(phone, env);
  if (!user) throw new Error("کاربر پیدا نشد");
  user.points = (user.points || 0) + Number(points);
  await saveUserRaw(user, env);
  await addLedgerEntry(phone, { type: points >= 0 ? "credit" : "debit", amount: Math.abs(points), unit: "point", note }, env);
  return user.points;
}

function generateReferralCode(phone) {
  const tail = String(phone).slice(-4);
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return "RG-" + tail + rand;
}

async function ensureReferralCode(user, env) {
  if (user.referralCode) return user.referralCode;
  let code = null;
  for (let i = 0; i < 5; i++) {
    const candidate = generateReferralCode(user.phone);
    const exists = await env.SHOP_DB.get("referral_code:" + candidate);
    if (!exists) { code = candidate; break; }
  }
  if (!code) code = generateReferralCode(user.phone) + Date.now().toString().slice(-3);
  user.referralCode = code;
  await saveUserRaw(user, env);
  await env.SHOP_DB.put("referral_code:" + code, user.phone);
  return code;
}

async function getUserOrderHistory(phone, env) {
  const raw = await env.SHOP_DB.get("orders_by_phone:" + phone);
  const ticketNumbers = raw ? JSON.parse(raw) : [];
  const orders = [];
  for (const tn of ticketNumbers) {
    const orderRaw = await env.SHOP_DB.get("order:" + tn);
    if (orderRaw) orders.push(JSON.parse(orderRaw));
  }
  orders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return orders;
}
async function getFavUsers(env) {
  const raw = await env.SHOP_DB.get("fav_users");
  return raw ? JSON.parse(raw) : [];
}
async function saveFavUsers(list, env) {
  await env.SHOP_DB.put("fav_users", JSON.stringify(list));
}
async function deleteUserAccount(phone, env) {
  await env.SHOP_DB.delete("user:" + phone);
  await env.SHOP_DB.delete("favorites:" + phone);
  await env.SHOP_DB.delete("session:" + phone); // بی‌اثر اگه کلید نباشه
  const favUsers = await getFavUsers(env);
  if (favUsers.includes(phone)) {
    await saveFavUsers(favUsers.filter((p) => p !== phone), env);
  }
}

// ============================================================
//  کدهای تخفیف
// ============================================================
async function getDiscountCodes(env) {
  const raw = await env.SHOP_DB.get("discount_codes");
  return raw ? JSON.parse(raw) : [];
}
async function saveDiscountCodesIndex(list, env) {
  await env.SHOP_DB.put("discount_codes", JSON.stringify(list));
}
async function getDiscount(code, env) {
  const raw = await env.SHOP_DB.get("discount:" + String(code).toUpperCase());
  return raw ? JSON.parse(raw) : null;
}
async function saveDiscount(discount, env) {
  await env.SHOP_DB.put("discount:" + discount.code, JSON.stringify(discount));
  const index = await getDiscountCodes(env);
  if (!index.includes(discount.code)) {
    index.push(discount.code);
    await saveDiscountCodesIndex(index, env);
  }
}
async function deleteDiscount(code, env) {
  code = String(code).toUpperCase();
  await env.SHOP_DB.delete("discount:" + code);
  const index = await getDiscountCodes(env);
  await saveDiscountCodesIndex(index.filter((c) => c !== code), env);
}
async function listDiscounts(env) {
  const codes = await getDiscountCodes(env);
  const discounts = [];
  for (const code of codes) {
    const d = await getDiscount(code, env);
    if (d) discounts.push(d);
  }
  discounts.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return discounts;
}

// ============================================================
//  تیکت‌های پشتیبانی
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
async function listAllTickets(env) {
  const list = await env.SHOP_DB.list({ prefix: "ticket:" });
  const tickets = [];
  for (const key of list.keys) {
    const raw = await env.SHOP_DB.get(key.name);
    if (raw) tickets.push(JSON.parse(raw));
  }
  tickets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return tickets;
}

// ============================================================
//  همکاران ادمین تلگرام (Co-Admins)
// ============================================================
function roleLevel(role) {
  return { orders: 1, products: 2, full: 3, owner: 4 }[role] || 0;
}
async function getCoAdmins(env) {
  const raw = await env.SHOP_DB.get("co_admins");
  return raw ? JSON.parse(raw) : [];
}
async function saveCoAdmins(list, env) {
  await env.SHOP_DB.put("co_admins", JSON.stringify(list));
}

// ============================================================
//  ارتباط با API تلگرام
// ============================================================
async function tgApi(method, payload, env) {
  const res = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.log(method + " failed:", res.status, errText);
  }
  return res;
}
function sendMessage(chatId, text, env, keyboard) {
  const payload = { chat_id: chatId, text: text };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  return tgApi("sendMessage", payload, env);
}
async function sendDocument(chatId, content, filename, caption, env) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("document", new Blob([content], { type: "application/json" }), filename);
  const res = await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendDocument", {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.log("sendDocument failed:", res.status, errText);
  }
  return res;
}
async function broadcastToAdmins(env, text) {
  const recipients = [String(env.ADMIN_ID)];
  const coAdmins = await getCoAdmins(env);
  for (const a of coAdmins) recipients.push(String(a.chatId));
  let sent = 0;
  for (const chatId of recipients) {
    try {
      await sendMessage(chatId, text, env);
      sent++;
    } catch (err) {
      // اگه یکی از همکارها ربات رو بلاک کرده باشه، بقیه رو متوقف نکن
    }
  }
  return sent;
}

// ============================================================
//  بک‌آپ کامل
// ============================================================
async function buildBackupPayload(env) {
  const items = await getItems(env);
  const settings = await getSettings(env);
  const orders = await listAllOrders(env);
  const users = await listRegisteredUsers(env);
  const discounts = await listDiscounts(env);
  const tickets = await listAllTickets(env);
  const coAdmins = await getCoAdmins(env);
  return {
    generatedAt: new Date().toISOString(),
    items,
    settings,
    orders,
    users,
    discounts,
    tickets,
    coAdmins,
  };
}

// ============================================================
//  آمار داشبورد
// ============================================================
function weekdayLabel(date) {
  try {
    return date.toLocaleDateString("fa-IR", { weekday: "short" });
  } catch (e) {
    return date.toISOString().slice(5, 10);
  }
}

async function buildStats(env) {
  const [items, orders, users, coAdmins, tickets] = await Promise.all([
    getItems(env),
    listAllOrders(env),
    listRegisteredUsers(env),
    getCoAdmins(env),
    listAllTickets(env),
  ]);

  const counts = {
    pendingOrders: orders.filter((o) => o.status === "pending").length,
    inProgressOrders: orders.filter((o) => o.status === "in_progress").length,
    openTickets: tickets.filter((t) => t.status === "open").length,
    totalProducts: items.length,
    outOfStock: items.filter((it) => !(it.stock > 0)).length,
    totalUsers: users.length,
    coAdminsCount: coAdmins.length,
    rejectedOrders: orders.filter((o) => o.status === "rejected").length,
    completedOrders: orders.filter((o) => o.status === "completed").length,
    totalOrders: orders.length,
  };

  const revenue = orders
    .filter((o) => o.status === "completed")
    .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

  counts.lowStock = items.filter((it) => it.stock > 0 && it.stock <= LOW_STOCK_THRESHOLD).length;
  const lowStockItems = items
    .filter((it) => it.stock > 0 && it.stock <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 8)
    .map((it) => ({ id: it.id, name: it.name, stock: it.stock }));

  const recentOrders = orders.slice(0, 8);

  // فروش ۷ روز اخیر (بر اساس سفارش‌های ثبت‌شده، رد‌شده‌ها حساب نمی‌شن)
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }
  const salesByDay = days.map((day) => {
    const dayStart = day.getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const total = orders
      .filter((o) => o.status !== "rejected" && o.createdAt >= dayStart && o.createdAt < dayEnd)
      .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    return { label: weekdayLabel(day), total };
  });

  return { counts, revenue, recentOrders, salesByDay, lowStockItems };
}

// ------------------------------------------------------------
//  Router
// ------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    try {
      if (path === "/" ) {
        return new Response("Reyhoon Gold Gallery — Admin API OK", { status: 200 });
      }

      if (!path.startsWith("/api/admin")) {
        return jsonResponse({ error: "مسیر نامعتبر است." }, 404, request, env);
      }

      const sub = path.slice("/api/admin".length) || "/";

      // ---------------- ورود (بدون نیاز به توکن) ----------------
      if (sub === "/login" && request.method === "POST") {
        return handleLogin(request, env);
      }

      // ---------------- از این به بعد نیاز به توکن معتبر ----------------
      if (!(await isAuthorized(request, env))) {
        return jsonResponse({ error: "وارد نشدی یا نشست منقضی شده." }, 401, request, env);
      }

      if (sub === "/logout" && request.method === "POST") {
        const authHeader = request.headers.get("Authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
        await revokeAdminSession(token, env);
        return jsonResponse({ ok: true }, 200, request, env);
      }

      if (sub === "/me" && request.method === "GET") {
        return jsonResponse({ ok: true }, 200, request, env);
      }

      // ---------------- داشبورد ----------------
      if (sub === "/stats" && request.method === "GET") {
        const stats = await buildStats(env);
        return jsonResponse(stats, 200, request, env);
      }

      // ---------------- لاگ فعالیت ----------------
      if (sub === "/activity" && request.method === "GET") {
        const raw = await env.SHOP_DB.get("admin_activity");
        const logs = raw ? JSON.parse(raw) : [];
        return jsonResponse({ logs }, 200, request, env);
      }

      // ---------------- محصولات ----------------
      if (sub === "/products" && request.method === "GET") {
        const items = await getItems(env);
        return jsonResponse({ items }, 200, request, env);
      }
      if (sub === "/products" && request.method === "POST") {
        return handleCreateProduct(request, env);
      }
      if (sub === "/products/update" && request.method === "POST") {
        return handleUpdateProduct(request, env);
      }
      if (sub === "/products/delete" && request.method === "POST") {
        return handleDeleteProduct(request, env);
      }
      if (sub === "/categories" && request.method === "GET") {
        const categories = await getCategories(env);
        return jsonResponse({ categories }, 200, request, env);
      }
      if (sub === "/categories" && request.method === "POST") {
        return handleAddCategory(request, env);
      }

      // ---------------- سفارش‌ها ----------------
      if (sub === "/orders" && request.method === "GET") {
        const status = url.searchParams.get("status");
        let orders = await listAllOrders(env);
        if (status && ORDER_STATUSES.includes(status)) {
          orders = orders.filter((o) => o.status === status);
        }
        return jsonResponse({ orders }, 200, request, env);
      }
      if (sub === "/orders/status" && request.method === "POST") {
        return handleOrderStatus(request, env);
      }
      if (sub === "/orders/tracking" && request.method === "POST") {
        return handleOrderTracking(request, env);
      }
      if (sub === "/orders/delete" && request.method === "POST") {
        return handleOrderDelete(request, env);
      }

      // ---------------- کاربران ----------------
      if (sub === "/users" && request.method === "GET") {
        const users = await listRegisteredUsers(env);
        return jsonResponse({ users: users.map(publicUser) }, 200, request, env);
      }
      if (sub === "/users/delete" && request.method === "POST") {
        return handleUserDelete(request, env);
      }
      if (sub === "/users/history" && request.method === "GET") {
        return handleUserHistory(request, env);
      }
      if (sub === "/users/referral" && request.method === "POST") {
        return handleUserGenerateReferral(request, env);
      }

      // ---------------- گردش حساب (کیف پول و امتیاز) ----------------
      if (sub === "/ledger" && request.method === "GET") {
        return handleGetLedger(request, env);
      }
      if (sub === "/ledger/add" && request.method === "POST") {
        return handleAddLedger(request, env);
      }

      // ---------------- کدهای تخفیف ----------------
      if (sub === "/discounts" && request.method === "GET") {
        const discounts = await listDiscounts(env);
        return jsonResponse({ discounts }, 200, request, env);
      }
      if (sub === "/discounts" && request.method === "POST") {
        return handleCreateDiscount(request, env);
      }
      if (sub === "/discounts/delete" && request.method === "POST") {
        return handleDeleteDiscount(request, env);
      }

      // ---------------- تیکت‌ها ----------------
      if (sub === "/tickets" && request.method === "GET") {
        const tickets = await listAllTickets(env);
        return jsonResponse({ tickets }, 200, request, env);
      }
      if (sub === "/tickets/reply" && request.method === "POST") {
        return handleTicketReply(request, env);
      }
      if (sub === "/tickets/close" && request.method === "POST") {
        return handleTicketClose(request, env);
      }

      // ---------------- تلگرام ----------------
      if (sub === "/telegram/admins" && request.method === "GET") {
        const coAdmins = await getCoAdmins(env);
        return jsonResponse({ owner: env.ADMIN_ID, coAdmins }, 200, request, env);
      }
      if (sub === "/telegram/admins" && request.method === "POST") {
        return handleAddCoAdmin(request, env);
      }
      if (sub === "/telegram/admins/delete" && request.method === "POST") {
        return handleDeleteCoAdmin(request, env);
      }
      if (sub === "/telegram/broadcast" && request.method === "POST") {
        return handleBroadcast(request, env);
      }
      if (sub === "/telegram/backup" && request.method === "POST") {
        return handleBackup(request, env);
      }
      if (sub === "/backup/restore" && request.method === "POST") {
        return handleRestoreBackup(request, env);
      }

      // ---------------- تنظیمات ----------------
      if (sub === "/settings" && request.method === "GET") {
        const settings = await getSettings(env);
        return jsonResponse({ settings }, 200, request, env);
      }
      if (sub === "/settings" && request.method === "POST") {
        return handleSaveSettings(request, env);
      }

      return jsonResponse({ error: "مسیر یا متد پشتیبانی نمی‌شود." }, 404, request, env);
    } catch (err) {
      console.log("Unhandled admin API error:", err && err.stack ? err.stack : err);
      return jsonResponse({ error: "خطای داخلی سرور. لطفاً دوباره تلاش کن." }, 500, request, env);
    }
  },
};

// ============================================================
//  هندلرها
// ============================================================

async function handleLogin(request, env) {
  const ip = clientIp(request);
  const guard = await getLoginGuard(env, ip);
  if (guard.lockUntil && Date.now() < guard.lockUntil) {
    const waitMin = Math.ceil((guard.lockUntil - Date.now()) / 60000);
    return jsonResponse(
      { error: "به‌خاطر تلاش‌های ناموفق زیاد، حساب موقتاً قفل شده. حدود " + waitMin + " دقیقه دیگه دوباره امتحان کن." },
      429,
      request,
      env
    );
  }

  const body = await readJson(request);
  const password = String(body.password || "");

  if (!env.ADMIN_PANEL_PASSWORD) {
    return jsonResponse({ error: "رمز عبور پنل مدیریت روی سرور تنظیم نشده (ADMIN_PANEL_PASSWORD)." }, 500, request, env);
  }

  if (!password || password !== env.ADMIN_PANEL_PASSWORD) {
    guard.count = (guard.count || 0) + 1;
    if (guard.count >= LOGIN_MAX_ATTEMPTS) {
      guard.lockUntil = Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000;
      guard.count = 0;
    }
    await saveLoginGuard(env, ip, guard);
    return jsonResponse({ error: "رمز عبور اشتباهه." }, 401, request, env);
  }

  await clearLoginGuard(env, ip);
  const token = await createAdminSession(env);
  await logActivity(env, "ورود به پنل مدیریت", "IP: " + ip);
  return jsonResponse({ token }, 200, request, env);
}

async function handleCreateProduct(request, env) {
  const body = await readJson(request);
  const name = String(body.name || "").trim();
  const category = String(body.category || "").trim();
  const weight = parseFloat(body.weight);

  if (!name || !category || !weight) {
    return jsonResponse({ error: "نام، دسته‌بندی و وزن الزامیه." }, 400, request, env);
  }

  const settings = await getSettings(env);
  const karat = parseInt(body.karat, 10) === 24 ? 24 : 18;
  const defaultFee = karat === 24 ? settings.fee24 : settings.fee18;
  const makingFee = body.makingFee !== undefined && body.makingFee !== null && String(body.makingFee).trim() !== ""
    ? parseFloat(body.makingFee)
    : defaultFee;

  const id = await getNextItemId(env);
  const images = Array.isArray(body.images) ? body.images.filter(Boolean).slice(0, 8) : (body.image ? [body.image] : []);

  const item = {
    id,
    name,
    category,
    model: String(body.model || "").trim() || null,
    karat,
    weight,
    stock: body.stock !== undefined ? parseInt(body.stock, 10) || 0 : 0,
    makingFee,
    badge: String(body.badge || "").trim() || null,
    featured: !!body.featured,
    rating: 4.7,
    images,
    image: images[0] || null,
    createdAt: Date.now(),
  };

  const items = await getItems(env);
  items.unshift(item);
  await saveItems(items, env);
  await ensureCategory(category, env);
  await logActivity(env, "افزودن محصول", name + " (id=" + id + ")");

  return jsonResponse({ ok: true, item }, 200, request, env);
}

async function handleUpdateProduct(request, env) {
  const body = await readJson(request);
  const id = parseInt(body.id, 10);
  if (!id) return jsonResponse({ error: "شناسه محصول نامعتبره." }, 400, request, env);

  const items = await getItems(env);
  const item = items.find((it) => it.id === id);
  if (!item) return jsonResponse({ error: "محصول پیدا نشد." }, 404, request, env);

  const settings = await getSettings(env);

  if (body.name !== undefined) item.name = String(body.name).trim() || item.name;
  if (body.category !== undefined) item.category = String(body.category).trim() || item.category;
  if (body.model !== undefined) item.model = String(body.model).trim() || null;
  if (body.karat !== undefined) item.karat = parseInt(body.karat, 10) === 24 ? 24 : 18;
  if (body.weight !== undefined && body.weight !== "") item.weight = parseFloat(body.weight);
  if (body.stock !== undefined && body.stock !== "") item.stock = parseInt(body.stock, 10) || 0;
  if (body.makingFee !== undefined) {
    const trimmed = String(body.makingFee).trim();
    item.makingFee = trimmed === "" ? (item.karat === 24 ? settings.fee24 : settings.fee18) : parseFloat(trimmed);
  }
  if (body.badge !== undefined) item.badge = String(body.badge).trim() || null;
  if (body.featured !== undefined) item.featured = !!body.featured;
  if (Array.isArray(body.images)) {
    item.images = body.images.filter(Boolean).slice(0, 8);
    item.image = item.images[0] || null;
  } else if (body.image) {
    item.image = body.image;
    item.images = [body.image];
  }

  await saveItems(items, env);
  if (item.category) await ensureCategory(item.category, env);
  await logActivity(env, "ویرایش محصول", item.name + " (id=" + id + ")");

  return jsonResponse({ ok: true, item }, 200, request, env);
}

async function handleAddCategory(request, env) {
  const body = await readJson(request);
  const name = String(body.name || "").trim();
  if (!name) return jsonResponse({ error: "نام دسته‌بندی خالیه." }, 400, request, env);

  const cats = await getCategories(env);
  if (!cats.includes(name)) {
    cats.push(name);
    await saveCategories(cats, env);
    await logActivity(env, "افزودن دسته‌بندی", name);
  }
  return jsonResponse({ ok: true, categories: cats }, 200, request, env);
}

async function handleDeleteProduct(request, env) {
  const body = await readJson(request);
  const id = parseInt(body.id, 10);
  if (!id) return jsonResponse({ error: "شناسه محصول نامعتبره." }, 400, request, env);

  const items = await getItems(env);
  const target = items.find((it) => it.id === id);
  const filtered = items.filter((it) => it.id !== id);
  await saveItems(filtered, env);
  await logActivity(env, "حذف محصول", (target ? target.name : "") + " (id=" + id + ")");

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleOrderStatus(request, env) {
  const body = await readJson(request);
  const ticketNumber = parseInt(body.ticketNumber, 10);
  const status = String(body.status || "");
  if (!ticketNumber || !ORDER_STATUSES.includes(status)) {
    return jsonResponse({ error: "ورودی نامعتبره." }, 400, request, env);
  }
  const order = await getOrder(ticketNumber, env);
  if (!order) return jsonResponse({ error: "سفارش پیدا نشد." }, 404, request, env);

  const prevStatus = order.status;
  order.status = status;
  order.updatedAt = Date.now();
  await saveOrder(order, env);
  await logActivity(env, "تغییر وضعیت سفارش #" + ticketNumber, prevStatus + " → " + status);

  if (status === "completed" || status === "rejected") {
    const label = status === "completed" ? "✅ تکمیل شد" : "❌ رد شد";
    broadcastToAdmins(env, "سفارش #" + ticketNumber + " از پنل وب " + label + ".").catch(() => {});
  }

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleOrderTracking(request, env) {
  const body = await readJson(request);
  const ticketNumber = parseInt(body.ticketNumber, 10);
  const trackingCode = String(body.trackingCode || "").trim();
  if (!ticketNumber) return jsonResponse({ error: "شماره تیکت نامعتبره." }, 400, request, env);

  const order = await getOrder(ticketNumber, env);
  if (!order) return jsonResponse({ error: "سفارش پیدا نشد." }, 404, request, env);

  order.trackingCode = trackingCode || null;
  order.trackingSetAt = Date.now();
  await saveOrder(order, env);
  await logActivity(env, "ثبت کد رهگیری سفارش #" + ticketNumber, trackingCode);

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleOrderDelete(request, env) {
  const body = await readJson(request);
  const ticketNumber = parseInt(body.ticketNumber, 10);
  if (!ticketNumber) return jsonResponse({ error: "شماره تیکت نامعتبره." }, 400, request, env);

  const order = await getOrder(ticketNumber, env);
  if (order && order.accountPhone) {
    await removeOrderFromUserIndex(order.accountPhone, ticketNumber, env).catch(() => {});
  }
  await env.SHOP_DB.delete("order:" + ticketNumber);
  await logActivity(env, "حذف سفارش #" + ticketNumber, null);

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleUserDelete(request, env) {
  const body = await readJson(request);
  const phone = String(body.phone || "").trim();
  if (!phone) return jsonResponse({ error: "شماره تماس نامعتبره." }, 400, request, env);

  await deleteUserAccount(phone, env);
  await logActivity(env, "حذف کاربر", phone);

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleUserHistory(request, env) {
  const url = new URL(request.url);
  const phone = String(url.searchParams.get("phone") || "").trim();
  if (!phone) return jsonResponse({ error: "شماره تماس نامعتبره." }, 400, request, env);

  const user = await getUserRaw(phone, env);
  if (!user) return jsonResponse({ error: "کاربر پیدا نشد." }, 404, request, env);

  const orders = await getUserOrderHistory(phone, env);
  const ledger = await getLedger(phone, env);

  return jsonResponse({ user: publicUser(user), orders, ledger }, 200, request, env);
}

async function handleUserGenerateReferral(request, env) {
  const body = await readJson(request);
  const phone = String(body.phone || "").trim();
  if (!phone) return jsonResponse({ error: "شماره تماس نامعتبره." }, 400, request, env);

  const user = await getUserRaw(phone, env);
  if (!user) return jsonResponse({ error: "کاربر پیدا نشد." }, 404, request, env);

  const code = await ensureReferralCode(user, env);
  await logActivity(env, "ساخت کد معرفی برای کاربر", phone + " → " + code);

  return jsonResponse({ ok: true, referralCode: code }, 200, request, env);
}

async function handleGetLedger(request, env) {
  const url = new URL(request.url);
  const phone = String(url.searchParams.get("phone") || "").trim();
  if (!phone) return jsonResponse({ error: "شماره تماس نامعتبره." }, 400, request, env);

  const user = await getUserRaw(phone, env);
  const ledger = await getLedger(phone, env);

  return jsonResponse({
    ledger,
    points: user ? (user.points || 0) : 0,
    walletBalance: user ? (user.walletBalance || 0) : 0,
  }, 200, request, env);
}

async function handleAddLedger(request, env) {
  const body = await readJson(request);
  const phone = String(body.phone || "").trim();
  const unit = body.unit === "point" ? "point" : "toman";
  const amount = Number(body.amount);
  const note = String(body.note || "").trim();

  if (!phone) return jsonResponse({ error: "شماره تماس نامعتبره." }, 400, request, env);
  if (!amount || isNaN(amount) || amount === 0) return jsonResponse({ error: "مقدار تراکنش باید عدد غیرصفر باشه." }, 400, request, env);

  try {
    if (unit === "point") {
      await adjustPoints(phone, amount, note || "تراکنش دستی ادمین", env);
    } else {
      await adjustWallet(phone, amount, note || "تراکنش دستی ادمین", env);
    }
  } catch (err) {
    return jsonResponse({ error: "کاربر پیدا نشد." }, 404, request, env);
  }

  await logActivity(env, "ثبت تراکنش گردش حساب", phone + " (" + (amount > 0 ? "+" : "") + amount + " " + (unit === "point" ? "امتیاز" : "تومان") + ")");

  const user = await getUserRaw(phone, env);
  const ledger = await getLedger(phone, env);
  return jsonResponse({ ok: true, ledger, points: user.points || 0, walletBalance: user.walletBalance || 0 }, 200, request, env);
}

async function handleCreateDiscount(request, env) {
  const body = await readJson(request);
  const code = String(body.code || "").trim().toUpperCase();
  const kind = ["tiered", "points"].includes(body.kind) ? body.kind : "simple";
  const type = body.type === "fixed" ? "fixed" : "percent";

  if (!code) return jsonResponse({ error: "کد الزامیه." }, 400, request, env);

  const existing = await getDiscount(code, env);
  const discount = {
    code,
    active: true,
    usageCount: existing ? existing.usageCount || 0 : 0,
    createdAt: existing ? existing.createdAt : Date.now(),
    kind,
  };

  if (kind === "tiered") {
    // پلکانی/پلنی: آرایه‌ای از پله‌ها بر اساس حداقل مبلغ سفارش
    const tiers = Array.isArray(body.tiers) ? body.tiers : [];
    const cleanTiers = tiers
      .map((t) => ({
        minTotal: Number(t.minTotal) || 0,
        type: t.type === "fixed" ? "fixed" : "percent",
        value: Number(t.value) || 0,
      }))
      .filter((t) => t.value > 0);
    if (!cleanTiers.length) {
      return jsonResponse({ error: "برای کد پلکانی حداقل یک پله معتبر لازمه." }, 400, request, env);
    }
    discount.tiers = cleanTiers;
    discount.type = "percent"; // برچسب پیش‌فرض، خودِ محاسبه از tiers استفاده می‌کنه
    discount.value = 0;
  } else if (kind === "points") {
    // امتیازی: با کسر امتیاز از موجودی کاربرِ لاگین‌شده فعال می‌شه
    const pointsCost = parseInt(body.pointsCost, 10);
    const value = parseFloat(body.value);
    if (!pointsCost || pointsCost <= 0) {
      return jsonResponse({ error: "هزینه‌ی امتیازی این کد باید عدد مثبت باشه." }, 400, request, env);
    }
    if (!value || value <= 0) {
      return jsonResponse({ error: "مقدار تخفیف این کد باید عدد مثبت باشه." }, 400, request, env);
    }
    if (type === "percent" && value > 100) {
      return jsonResponse({ error: "درصد تخفیف نمی‌تونه بیشتر از ۱۰۰ باشه." }, 400, request, env);
    }
    discount.pointsCost = pointsCost;
    discount.type = type;
    discount.value = value;
  } else {
    const value = parseFloat(body.value);
    if (!value || value <= 0) {
      return jsonResponse({ error: "کد و مقدار معتبر الزامیه." }, 400, request, env);
    }
    if (type === "percent" && value > 100) {
      return jsonResponse({ error: "درصد تخفیف نمی‌تونه بیشتر از ۱۰۰ باشه." }, 400, request, env);
    }
    discount.type = type;
    discount.value = value;
  }

  await saveDiscount(discount, env);
  await logActivity(env, "ثبت/ویرایش کد تخفیف", code);

  return jsonResponse({ ok: true, discount }, 200, request, env);
}

async function handleDeleteDiscount(request, env) {
  const body = await readJson(request);
  const code = String(body.code || "").trim().toUpperCase();
  if (!code) return jsonResponse({ error: "کد نامعتبره." }, 400, request, env);

  await deleteDiscount(code, env);
  await logActivity(env, "حذف کد تخفیف", code);

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleTicketReply(request, env) {
  const body = await readJson(request);
  const id = String(body.id || "");
  const message = String(body.message || "").trim().slice(0, 2000);
  if (!id || !message) return jsonResponse({ error: "پیام یا شناسه تیکت خالیه." }, 400, request, env);

  const ticket = await addTicketMessage(id, "admin", message, env);
  if (!ticket) return jsonResponse({ error: "تیکت پیدا نشد." }, 404, request, env);
  await logActivity(env, "پاسخ به تیکت #" + id, message.slice(0, 60));

  return jsonResponse({ ok: true, ticket }, 200, request, env);
}

async function handleTicketClose(request, env) {
  const body = await readJson(request);
  const id = String(body.id || "");
  if (!id) return jsonResponse({ error: "شناسه تیکت نامعتبره." }, 400, request, env);

  const ticket = await getTicket(id, env);
  if (!ticket) return jsonResponse({ error: "تیکت پیدا نشد." }, 404, request, env);
  ticket.status = "closed";
  ticket.updatedAt = Date.now();
  await saveTicket(ticket, env);
  await logActivity(env, "بستن تیکت #" + id, null);

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleAddCoAdmin(request, env) {
  const body = await readJson(request);
  const chatId = String(body.chatId || "").trim();
  const role = String(body.role || "");
  const validRoles = ["orders", "products", "full"];

  if (!/^\d+$/.test(chatId)) return jsonResponse({ error: "Chat ID باید فقط عدد باشه." }, 400, request, env);
  if (!validRoles.includes(role)) return jsonResponse({ error: "سطح دسترسی نامعتبره." }, 400, request, env);
  if (chatId === String(env.ADMIN_ID)) return jsonResponse({ error: "این آیدی مالک ربات (خودتو) هست." }, 400, request, env);

  const list = await getCoAdmins(env);
  const existing = list.find((a) => String(a.chatId) === chatId);
  if (existing) existing.role = role;
  else list.push({ chatId, role, addedAt: Date.now() });
  await saveCoAdmins(list, env);
  await logActivity(env, "افزودن/ویرایش همکار تلگرام", chatId + " → " + ROLE_LABEL[role]);

  try {
    await sendMessage(
      chatId,
      "سلام! دسترسی مدیریت به فروشگاه ریحون گلد گالری برات فعال شد.\nسطح دسترسی: " + ROLE_LABEL[role] + "\n\nبرای شروع /start رو بزن.",
      env
    );
  } catch (err) {
    // اگه همکار هنوز به ربات پیام نداده، ارسال خطا می‌ده؛ مشکلی نیست
  }

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleDeleteCoAdmin(request, env) {
  const body = await readJson(request);
  const chatId = String(body.chatId || "").trim();
  if (!chatId) return jsonResponse({ error: "Chat ID نامعتبره." }, 400, request, env);

  const list = await getCoAdmins(env);
  const filtered = list.filter((a) => String(a.chatId) !== chatId);
  await saveCoAdmins(filtered, env);
  await logActivity(env, "حذف همکار تلگرام", chatId);

  try {
    await sendMessage(chatId, "دسترسی مدیریتی شما به فروشگاه ریحون گلد گالری لغو شد.", env);
  } catch (err) {
    // بی‌اهمیت
  }

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleBroadcast(request, env) {
  const body = await readJson(request);
  const message = String(body.message || "").trim().slice(0, 4000);
  if (!message) return jsonResponse({ error: "متن پیام خالیه." }, 400, request, env);

  const sent = await broadcastToAdmins(env, "📢 پیام از پنل مدیریت:\n\n" + message);
  await logActivity(env, "پیام همگانی تلگرام", message.slice(0, 80) + " (به " + sent + " نفر)");

  return jsonResponse({ ok: true, sent }, 200, request, env);
}

async function handleBackup(request, env) {
  const payload = await buildBackupPayload(env);
  const json = JSON.stringify(payload, null, 2);
  const dateKey = payload.generatedAt.slice(0, 10);

  await env.SHOP_DB.put("backup:" + dateKey, json);
  await env.SHOP_DB.put("backup:latest", json);

  const filename = "reyhoon-backup-" + dateKey + ".json";
  const caption =
    "💾 بک‌آپ کامل سایت (دستی — از پنل وب)\n" +
    payload.items.length + " محصول، " + payload.orders.length + " سفارش، " +
    payload.users.length + " کاربر، " + payload.tickets.length + " تیکت";

  try {
    await sendDocument(env.ADMIN_ID, json, filename, caption, env);
  } catch (err) {
    // حتی اگه ارسال به تلگرام خطا بده، نسخه‌ی KV ذخیره شده
  }

  await logActivity(env, "ساخت بک‌آپ فوری", filename);
  return jsonResponse({ ok: true, filename, generatedAt: payload.generatedAt }, 200, request, env);
}

// ---------------- بازگردانی (Restore) از فایل بک‌آپ JSON ----------------
async function deleteAllByPrefix(env, prefix) {
  let cursor;
  do {
    const res = await env.SHOP_DB.list({ prefix, cursor });
    for (const key of res.keys) await env.SHOP_DB.delete(key.name);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
}

async function handleRestoreBackup(request, env) {
  const payload = await readJson(request);
  if (!payload || !Array.isArray(payload.items) || !Array.isArray(payload.orders) || !Array.isArray(payload.users)) {
    return jsonResponse({ error: "ساختار فایل بک‌آپ نامعتبره (items/orders/users پیدا نشد)." }, 400, request, env);
  }

  // محصولات، تنظیمات، همکاران تلگرام — کلید تکی، فقط بازنویسی می‌شن
  await saveItems(payload.items, env);
  if (payload.settings) await saveSettings(payload.settings, env);
  if (Array.isArray(payload.coAdmins)) await saveCoAdmins(payload.coAdmins, env);

  // سفارش‌ها — کامل حذف و جایگزین + بازسازی ایندکس بر اساس موبایل
  await deleteAllByPrefix(env, "order:");
  await deleteAllByPrefix(env, "orders_by_phone:");
  const byPhone = {};
  for (const o of payload.orders) {
    if (!o.ticketNumber) continue;
    await env.SHOP_DB.put("order:" + o.ticketNumber, JSON.stringify(o));
    if (o.phone) (byPhone[o.phone] = byPhone[o.phone] || []).push(o.ticketNumber);
  }
  for (const phone in byPhone) {
    await env.SHOP_DB.put("orders_by_phone:" + phone, JSON.stringify(byPhone[phone]));
  }

  // کاربران — کامل حذف و جایگزین
  await deleteAllByPrefix(env, "user:");
  for (const u of payload.users) {
    if (u.phone) await env.SHOP_DB.put("user:" + u.phone, JSON.stringify(u));
  }

  // کدهای تخفیف
  if (Array.isArray(payload.discounts)) {
    await deleteAllByPrefix(env, "discount:");
    const codes = [];
    for (const d of payload.discounts) {
      if (!d.code) continue;
      await env.SHOP_DB.put("discount:" + d.code, JSON.stringify(d));
      codes.push(d.code);
    }
    await saveDiscountCodesIndex(codes, env);
  }

  // تیکت‌های پشتیبانی
  if (Array.isArray(payload.tickets)) {
    await deleteAllByPrefix(env, "ticket:");
    for (const t of payload.tickets) {
      if (t.id) await env.SHOP_DB.put("ticket:" + t.id, JSON.stringify(t));
    }
  }

  await logActivity(
    env,
    "بازگردانی بک‌آپ",
    payload.items.length + " محصول، " + payload.orders.length + " سفارش، " + payload.users.length + " کاربر"
  );

  return jsonResponse({ ok: true }, 200, request, env);
}

async function handleSaveSettings(request, env) {
  const body = await readJson(request);
  const fee18 = parseFloat(body.fee18);
  const fee24 = parseFloat(body.fee24);
  if (isNaN(fee18) || isNaN(fee24) || fee18 < 0 || fee24 < 0) {
    return jsonResponse({ error: "مقادیر اجرت باید عدد معتبر و مثبت باشن." }, 400, request, env);
  }
  let referralBuyerDiscountPercent = parseFloat(body.referralBuyerDiscountPercent);
  let referralBonusPoints = parseFloat(body.referralBonusPoints);
  if (isNaN(referralBuyerDiscountPercent) || referralBuyerDiscountPercent < 0) referralBuyerDiscountPercent = DEFAULT_SETTINGS.referralBuyerDiscountPercent;
  if (isNaN(referralBonusPoints) || referralBonusPoints < 0) referralBonusPoints = DEFAULT_SETTINGS.referralBonusPoints;

  const settings = { fee18, fee24, referralBuyerDiscountPercent, referralBonusPoints };
  await saveSettings(settings, env);
  await logActivity(env, "به‌روزرسانی تنظیمات فروشگاه", "fee18=" + fee18 + " fee24=" + fee24);

  return jsonResponse({ ok: true, settings }, 200, request, env);
}
