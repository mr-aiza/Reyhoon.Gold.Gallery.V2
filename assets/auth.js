// ============================================================
// ریحون گلد گالری — سیستم احراز هویت مشترک (شماره تماس + رمز عبور)
// این فایل باید قبل از app.js لود بشه. یک شیء window.ReyhoonAuth
// می‌سازه که همه‌ی صفحات (لاگین، پیگیری سفارش، علاقه‌مندی‌ها و...) ازش استفاده می‌کنن.
// ============================================================
(function () {
  const API_URL = "https://reyhoongoldgallery.tempmail41245.workers.dev";
  const TOKEN_KEY = "reyhoon_auth_token";
  const USER_KEY = "reyhoon_auth_user";

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveSession(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) { /* localStorage غیرفعال باشه هم کرش نکنه */ }
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) { /* ignore */ }
  }

  function isLoggedIn() {
    return !!(getToken() && getUser());
  }

  async function apiFetch(path, options) {
    options = options || {};
    const headers = Object.assign({}, options.headers || {});
    const token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    const res = await fetch(API_URL + path, Object.assign({}, options, { headers }));
    let data = null;
    try { data = await res.json(); } catch (e) { /* بدنه خالی یا غیر JSON */ }

    if (!res.ok) {
      const err = new Error((data && data.error) || "خطایی رخ داد. دوباره تلاش کن.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function register(phone, password, name) {
    const data = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ phone, password, name }),
    });
    saveSession(data.token, { phone: data.phone, name: data.name });
    return data;
  }

  async function login(phone, password) {
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    });
    saveSession(data.token, { phone: data.phone, name: data.name });
    return data;
  }

  async function logout() {
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch (e) { /* حتی اگه شکست بخوره، لوکال رو پاک کن */ }
    clearSession();
  }

  window.ReyhoonAuth = { getToken, getUser, isLoggedIn, saveSession, clearSession, apiFetch, register, login, logout };
})();
