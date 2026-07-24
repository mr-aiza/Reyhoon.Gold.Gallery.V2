const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/order" && request.method === "POST") {
      return handleNewOrder(request, env);
    }

    if (url.pathname === "/telegram-webhook" && request.method === "POST") {
      return handleTelegramWebhook(request, env);
    }

    return new Response("Reyhoon Orders API - OK", { status: 200 });
  },
};

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function handleNewOrder(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonResponse({ ok: false, error: "invalid json" }, 400);
  }

  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const address = String(body.address || "").trim();
  const items = Array.isArray(body.items) ? body.items : [];
  const total = Number(body.total) || 0;

  if (!name || !phone || !address || items.length === 0) {
    return jsonResponse({ ok: false, error: "missing fields" }, 400);
  }

  const ticketNumber = await getNextTicket(env);

  const order = {
    ticketNumber: ticketNumber,
    name: name,
    phone: phone,
    address: address,
    items: items,
    total: total,
    status: "pending",
    createdAt: Date.now(),
  };

  await env.ORDERS_DB.put("order:" + ticketNumber, JSON.stringify(order));

  const itemLines = items.map(function (it) {
    const karatText = it.karat === "used" ? "کارکرده" : it.karat + " عیار";
    return "- " + it.name + " (" + karatText + "، " + it.weight + " گرم) x" + it.qty + " = " + toToman(it.unitPrice * it.qty) + " تومان";
  }).join("\n");

  const message =
    "تیکت سفارش جدید #" + ticketNumber + "\n\n" +
    "نام: " + name + "\n" +
    "تماس: " + phone + "\n" +
    "آدرس: " + address + "\n\n" +
    "اقلام:\n" + itemLines + "\n\n" +
    "جمع کل: " + toToman(total) + " تومان";

  try {
    await sendMessage(env.ADMIN_ID, message, env);
  } catch (err) {
    // حتی اگه ارسال به تلگرام خطا بده، تیکت ذخیره شده و شماره‌ش برمی‌گرده
  }

  return jsonResponse({ ok: true, ticketNumber: ticketNumber });
}

function toToman(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function getNextTicket(env) {
  const current = await env.ORDERS_DB.get("next_ticket");
  const next = current ? parseInt(current) + 1 : 1001;
  await env.ORDERS_DB.put("next_ticket", String(next));
  return next;
}

async function handleTelegramWebhook(request, env) {
  const update = await request.json();
  const msg = update.message;
  if (!msg) return new Response("ok");

  const chatId = String(msg.chat.id);
  if (chatId !== String(env.ADMIN_ID)) return new Response("ok");

  const text = msg.text || "";

  if (text.startsWith("/order")) {
    const parts = text.trim().split(/\s+/);
    const ticket = parseInt(parts[1]);
    if (!ticket) {
      await sendMessage(chatId, "format dorost: /order 1001", env);
      return new Response("ok");
    }
    const raw = await env.ORDERS_DB.get("order:" + ticket);
    if (!raw) {
      await sendMessage(chatId, "tiketi ba in shomare peida nashod.", env);
      return new Response("ok");
    }
    const order = JSON.parse(raw);
    await sendMessage(chatId,
      "تیکت #" + order.ticketNumber + " - وضعیت: " + order.status + "\n" +
      order.name + " - " + order.phone + "\n" + order.address, env);
  } else if (text === "/help" || text === "/start") {
    await sendMessage(chatId, "برای مشاهده جزئیات یه تیکت: /order <شماره تیکت>", env);
  }

  return new Response("ok");
}

async function sendMessage(chatId, text, env) {
  await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text }),
  });
}
