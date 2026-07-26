// ============================================================
// ریحون گلد گالری — منطق مشترک صفحات (index.html و shop.html)
// هر صفحه با تنظیم window.PAGE_MODE = "featured" | "full" این فایل رو لود می‌کنه
// ============================================================
(function(){
  const PAGE_MODE = window.PAGE_MODE || "full"; // "featured" روی index، "full" روی shop

  // ============================================================
  // هدر مشترک — یک منبع واحد برای هدر که تو همه صفحات (index/shop) رندر می‌شه
  // ============================================================
  function buildNavLinks(){
    const onShop = PAGE_MODE === "full";
    const shopHref = "shop.html";
    const anchor = (hash) => onShop ? `index.html${hash}` : hash;
    return [
      { href: anchor("#shop"), label: "پرفروش‌ها" },
      { href: shopHref, label: "همه محصولات", active: onShop },
      { href: anchor("#calculator"), label: "محاسبه قیمت" },
      { href: anchor("#trust"), label: "چرا ما" },
      { href: anchor("#contact"), label: "تماس" },
      { href: "support.html", label: "پشتیبانی" },
    ];
  }

  function renderHeader(){
    const root = document.getElementById("siteHeaderRoot");
    if(!root) return;
    const links = buildNavLinks();
    const navHTML = links.map(l => `<a href="${l.href}"${l.active ? ' class="active"' : ''}>${l.label}</a>`).join("");
    const mobileNavHTML = links.map(l => `<a href="${l.href}" class="mobile-link${l.active ? ' active' : ''}">${l.label}</a>`).join("");

    root.innerHTML = `
      <header id="siteHeader">
        <div class="container">
          <div class="brand" style="display:flex;align-items:center;gap:12px;">
            <button class="menu-toggle icon-btn" id="menuToggle" aria-label="باز کردن منو">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <a href="index.html" class="brand">
              <div class="brand-mark">🏆</div>
              <span class="brand-name">ریحون گلد گالری</span>
            </a>
          </div>
          <nav class="main-nav">${navHTML}</nav>
          <div class="header-actions">
            <a href="favorites.html" class="icon-btn" id="favBtn" aria-label="علاقه‌مندی‌ها">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>
            </a>
            <a href="account.html" class="icon-btn account-btn" id="accountBtn" aria-label="حساب کاربری">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>
              <span class="account-label" id="accountLabel">ورود</span>
            </a>
            <button class="icon-btn cart-btn" id="cartBtn" aria-label="سبد خرید">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              <span class="cart-badge num" id="cartBadge" style="display:none;">0</span>
            </button>
          </div>
        </div>
      </header>
      <div class="mobile-menu" id="mobileMenu">
        <div class="mobile-menu-head">
          <button class="icon-btn" id="mobileMenuClose" aria-label="بستن منو">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <nav>${mobileNavHTML}</nav>
      </div>`;

    updateAccountLabel();
  }

  // متن دکمه‌ی حساب کاربری رو بر اساس وضعیت لاگین (از assets/auth.js) به‌روز می‌کنه
  function updateAccountLabel(){
    const label = document.getElementById("accountLabel");
    const btn = document.getElementById("accountBtn");
    if(!label) return;
    if(window.ReyhoonAuth && window.ReyhoonAuth.isLoggedIn()){
      const user = window.ReyhoonAuth.getUser();
      label.textContent = (user && user.name) ? user.name.split(" ")[0] : "حساب من";
      if(btn) btn.setAttribute("href", "profile.html");
    } else {
      label.textContent = "ورود";
      if(btn) btn.setAttribute("href", "account.html");
    }
  }

  renderHeader();

  // سایه‌ی هدر موقع اسکرول — یه لایه‌ی بصری اضافه برای هدر «قوی‌تر»
  (function initHeaderScrollShadow(){
    const header = document.getElementById("siteHeader");
    if(!header) return;
    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive:true });
  })();

  // ---------- Data ----------
  // محصولات فقط از گالری تلگرام (Cloudflare Worker) میان؛ دیتای نمایشی حذف شده.
  let PRODUCTS = [];
  let galleryLoaded = false;
  let galleryFailed = false;
  const galleryLoadedCallbacks = [];

  // آدرس Worker گالری تلگرام رو اینجا بذار
  const GALLERY_API_URL = "https://reyhoongoldgallery.tempmail41245.workers.dev";
  // سفارش‌ها هم الان توی همین وورکر گالری هندل می‌شه (وورکر جدای orders دیگه لازم نیست)
  const ORDERS_API_URL = GALLERY_API_URL;
  window.ORDERS_API_URL = ORDERS_API_URL;

  async function fetchGallery(){
    if(!GALLERY_API_URL) return;
    try{
      const res = await fetch(`${GALLERY_API_URL}/api/gallery`, { cache:"no-store" });
      if(!res.ok) throw new Error("bad status " + res.status);
      const data = await res.json();
      if(Array.isArray(data.items)){
        PRODUCTS = data.items;
        galleryLoaded = true;
        galleryFailed = false;
        if(typeof renderModelFilters === "function") renderModelFilters();
        renderProducts();
        galleryLoadedCallbacks.splice(0).forEach(cb => cb(PRODUCTS));
      }
    } catch(err){
      console.warn("اتصال به گالری تلگرام ناموفق بود:", err.message);
      galleryFailed = true;
      renderProducts();
    }
  }

  // ---------- Live price config ----------
  const BRSAPI_KEY = "BqE8gdGzKGK3cS2aS6zhsLGHtZGkYvuA";
  const BRSAPI_URL = `https://Api.BrsApi.ir/Market/Gold_Currency.php?key=${BRSAPI_KEY}`;
  const LIVE_REFRESH_MS = 60000;
  let usingLiveData = false;

  // ---------- Price history (تاریخچه‌ی گردشیِ قیمت) ----------
  // به‌جای موج تصادفی، هر قیمتی که از API می‌آد با زمانش توی localStorage ذخیره می‌شه
  // و هیچ‌وقت صفر نمی‌شه — یه بافر گردشی از آخرین MAX_POINTS قیمت واقعی همیشه نگه داشته می‌شه.
  const PRICE_HISTORY_KEY = "reyhoon-gallery-gold-history-v1";
  const MAX_POINTS = 100; // تعداد نقاطی که همیشه (به‌صورت گردشی) نگه داشته می‌شه
  const SPARK_WINDOW = 30; // تعداد نقاطی که روی خود نمودار (اسپارک‌لاین) نشون داده می‌شه

  function loadPricePoints(){
    try{
      const raw = localStorage.getItem(PRICE_HISTORY_KEY);
      if(!raw) return [];
      const saved = JSON.parse(raw);
      const points = Array.isArray(saved) ? saved : (saved && Array.isArray(saved.points) ? saved.points : []);
      return points.filter(p => p && typeof p.p === "number" && p.p > 0 && typeof p.t === "number");
    } catch(err){ return []; }
  }

  let pricePoints = loadPricePoints(); // آخرین قیمت‌های واقعی، گردشی و بدون ریست روزانه

  function savePricePoints(){
    try{
      localStorage.setItem(PRICE_HISTORY_KEY, JSON.stringify({ points: pricePoints }));
    } catch(err){ /* localStorage غیرفعال باشه هم سایت کار می‌کنه */ }
  }

  // طول نمودار رو ثابت نگه می‌داره (آخرین N نقطه) تا انیمیشن نرم بین آپدیت‌ها خراب نشه
  function sparkWindowFromPoints(points){
    const windowed = points.slice(-SPARK_WINDOW).map(p => p.p);
    if(windowed.length === 1) return [windowed[0], windowed[0]];
    return windowed;
  }

  // قیمت جدید رو (اگه واقعاً با قیمت قبلی فرق داشته باشه) به بافر گردشی اضافه و ذخیره می‌کنه
  function recordPricePoint(price){
    const now = Date.now();
    const last = pricePoints[pricePoints.length - 1];
    if(last && last.p === price){
      last.t = now; // قیمت تغییر نکرده، فقط زمان آخرین چک به‌روز می‌شه
    } else {
      pricePoints.push({ t: now, p: price });
      if(pricePoints.length > MAX_POINTS) pricePoints = pricePoints.slice(-MAX_POINTS); // گردشی: فقط قدیمی‌ترین حذف می‌شه
    }
    savePricePoints();
    history = sparkWindowFromPoints(pricePoints);
  }

  // کمترین و بیشترین قیمت واقعی توی همین بافر گردشی (برای نمایش بازه‌ی نوسان اخیر)
  function recentPriceRange(){
    if(!pricePoints.length) return null;
    let min = pricePoints[0].p, max = pricePoints[0].p;
    for(const pt of pricePoints){ if(pt.p < min) min = pt.p; if(pt.p > max) max = pt.p; }
    return { min, max };
  }

  function renderRecentRange(){
    const el = document.getElementById("dayRange");
    if(!el) return;
    const range = recentPriceRange();
    if(!range || !priceReady){ el.style.display = "none"; return; }
    el.style.display = "";
    el.innerHTML = `بازه نوسان اخیر: <span class="num">${toToman(range.min)}</span> تا <span class="num">${toToman(range.max)}</span> تومان`;
  }

  let pricePerGram = 38450000;
  let history = [];
  if(pricePoints.length){
    // اگه از قبل داده‌ی ذخیره‌شده داشتیم، همون لحظه (قبل از رسیدن جواب API) نشون بده
    history = sparkWindowFromPoints(pricePoints);
    pricePerGram = pricePoints[pricePoints.length - 1].p;
  }
  let cart = [];
  let appliedDiscount = null; // { code, type, value, label }
  let favoriteIds = new Set();
  let activeCategory = "همه";
  let activeKarat = "همه";
  let lightboxIndex = -1;
  let lightboxImgIndex = 0;
  let live24k = null;
  let liveEmami = null;
  let undoTimer = null;
  let lastRemoved = null; // { line, index }

  const toToman = n => Math.round(n).toLocaleString("fa-IR");
  let priceReady = pricePoints.length > 0; // داده‌ی واقعیِ ذخیره‌شده رو داریم، پس بلافاصله نشون بده
  const priceReadyCallbacks = [];
  const priceText = n => priceReady ? toToman(n) : "...";
  const price24kVal = () => usingLiveData && live24k ? live24k : pricePerGram*1.33;
  const priceEmamiVal = () => usingLiveData && liveEmami ? liveEmami : pricePerGram*8.13;

  async function fetchLivePrice(){
    if(!BRSAPI_KEY || BRSAPI_KEY === "YOUR_FREE_API_KEY"){
      usingLiveData = false;
      updateLiveIndicator();
      return;
    }
    try{
      const res = await fetch(BRSAPI_URL, { cache:"no-store" });
      if(!res.ok) throw new Error("bad status " + res.status);
      const data = await res.json();
      const goldList = data.gold || [];
      const item18k = goldList.find(g => g.symbol === "IR_GOLD_18K");
      const item24k = goldList.find(g => g.symbol === "IR_GOLD_24K");
      const itemEmami = goldList.find(g => g.symbol === "IR_COIN_EMAMI");
      if(item18k && item18k.price){
        const newPrice = Number(item18k.price);
        if(!isNaN(newPrice) && newPrice > 0){
          pricePerGram = newPrice;
          live24k = item24k ? Number(item24k.price) : null;
          liveEmami = itemEmami ? Number(itemEmami.price) : null;
          recordPricePoint(pricePerGram);
          usingLiveData = true;
          priceReady = true;
          updateLiveIndicator();
          refreshAllUI();
          priceReadyCallbacks.splice(0).forEach(cb => cb());
          return;
        }
      }
      throw new Error("قیمت طلای ۱۸ عیار (IR_GOLD_18K) در پاسخ پیدا نشد");
    } catch(err){
      console.warn("اتصال به قیمت زنده ناموفق بود، حالت نمایشی فعال شد:", err.message);
      usingLiveData = false;
      live24k = null;
      liveEmami = null;
      updateLiveIndicator();
    }
  }

  function updateLiveIndicator(){
    const dot = document.getElementById("liveDot");
    const label = document.getElementById("liveLabel");
    if(!dot || !label) return;
    dot.classList.toggle("stale", !usingLiveData);
    label.textContent = usingLiveData ? "قیمت زنده" : "در حال دریافت قیمت...";
  }

  // درصد تغییر رو دقیقاً بر اساس همون روندی که روی نمودار (اسپارک‌لاین) رسم می‌شه حساب می‌کنه:
  // شروعِ بازه‌ی نمایش‌داده‌شده روی نمودار در برابر قیمت فعلی. صعودی=سبز، نزولی=قرمز.
  function updatePriceChangeBadge(){
    const changeEl = document.getElementById("priceChange");
    const changeVal = document.getElementById("changeVal");
    if(!changeEl || !changeVal) return;
    const windowStart = (history && history.length) ? history[0] : null;
    if(!priceReady || !windowStart || windowStart <= 0){
      changeEl.style.display = "none";
      return;
    }
    const pct = ((pricePerGram - windowStart) / windowStart) * 100;
    const positive = pct >= 0;
    changeEl.style.display = "";
    changeEl.className = "price-change num " + (positive ? "up" : "down");
    const pctText = Math.abs(pct).toLocaleString("fa-IR", { minimumFractionDigits:1, maximumFractionDigits:1 });
    changeVal.textContent = (positive ? "+" : "−") + pctText + "٪";
  }

  function renderMainPrices(){
    const mp = document.getElementById("mainPrice");
    if(mp) mp.textContent = priceText(pricePerGram);
    const p24 = document.getElementById("price24");
    if(p24) p24.textContent = priceText(price24kVal());
    const pc = document.getElementById("priceCoin");
    if(pc) pc.textContent = priceText(priceEmamiVal());
    const phc = document.getElementById("priceHalfCoin");
    if(phc) phc.textContent = priceText(pricePerGram*4.06);
    const pqc = document.getElementById("priceQuarterCoin");
    if(pqc) pqc.textContent = priceText(pricePerGram*2.03);
  }

  function refreshAllUI(){
    renderMainPrices();
    renderSparkline();
    renderRecentRange();
    updatePriceChangeBadge();
    renderProducts();
    updateCalculator();
    renderCart();
  }

  // ---------- Product art ----------
  function productArtSVG(type){
    const stroke = "#C9A227";
    if(type === "necklace") return `<svg viewBox="0 0 120 120" width="100%" height="100%"><path d="M20 30 Q60 90 100 30" fill="none" stroke="${stroke}" stroke-width="1.4"/><circle cx="60" cy="78" r="6" fill="${stroke}"/></svg>`;
    if(type === "bracelet") return `<svg viewBox="0 0 120 120" width="100%" height="100%"><ellipse cx="60" cy="60" rx="42" ry="22" fill="none" stroke="${stroke}" stroke-width="1.4"/><circle cx="60" cy="82" r="5" fill="${stroke}"/></svg>`;
    if(type === "ring") return `<svg viewBox="0 0 120 120" width="100%" height="100%"><circle cx="60" cy="70" r="28" fill="none" stroke="${stroke}" stroke-width="1.4"/><polygon points="60,30 70,42 60,54 50,42" fill="${stroke}"/></svg>`;
    if(type === "bar") return `<svg viewBox="0 0 120 120" width="100%" height="100%"><polygon points="30,42 90,42 100,80 20,80" fill="none" stroke="${stroke}" stroke-width="1.4"/><line x1="38" y1="50" x2="82" y2="50" stroke="${stroke}" stroke-width="0.8" opacity="0.6"/><text x="60" y="66" text-anchor="middle" font-size="9" fill="${stroke}" font-family="sans-serif">Au 999.9</text></svg>`;
    return `<svg viewBox="0 0 120 120" width="100%" height="100%"><path d="M60 35 L60 60" fill="none" stroke="${stroke}" stroke-width="1.4"/><circle cx="60" cy="72" r="13" fill="none" stroke="${stroke}" stroke-width="1.4"/></svg>`;
  }

  function productImages(p){
    if(Array.isArray(p.images) && p.images.length) return p.images;
    if(p.image) return [p.image];
    return null;
  }

  function productVisual(p, imgIndex){
    const imgs = productImages(p);
    if(imgs && imgs.length){
      const idx = (typeof imgIndex === "number" && imgs[imgIndex]) ? imgIndex : 0;
      return `<img src="${imgs[idx]}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
    }
    return productArtSVG(p.art);
  }

  function karatBaseRate(karat){ return karat === 24 ? price24kVal() : pricePerGram; }
  function karatLabel(karat){
    if(karat === 24) return "۲۴ عیار";
    return "۱۸ عیار";
  }
  function productPrice(p){ return karatBaseRate(p.karat) * p.weight * (1 + p.makingFee/100); }


  // ---------- Sparkline ----------
  // به‌جای پرش یهویی به شکل جدید، خط از حالت قبلی به حالت جدید نرم animate می‌شه؛
  // اولین بار هم با یه انیمیشن «کشیده شدن» ظاهر می‌شه، نه یهویی.
  let sparklineAnimFrame = null;
  let sparklineCurrentPts = null; // آخرین نقاطی که واقعاً روی صفحه‌ست (برای شروع انیمیشن بعدی)

  function sparklinePoints(hist, w, h){
    const min = Math.min(...hist), max = Math.max(...hist);
    const range = (max - min) || 1;
    return hist.map((v,i) => ({
      x: (i/(hist.length-1)) * w,
      y: h - ((v-min)/range) * h
    }));
  }

  function ptsToStr(pts){
    return pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  }

  function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

  function renderSparkline(){
    const svg = document.getElementById("sparkline");
    if(!svg) return;
    if(!priceReady){
      svg.innerHTML = "";
      sparklineCurrentPts = null;
      if(sparklineAnimFrame){ cancelAnimationFrame(sparklineAnimFrame); sparklineAnimFrame = null; }
      return;
    }

    const w = 300, h = 36;
    const target = sparklinePoints(history, w, h);
    const positive = (history[history.length-1] >= history[history.length-2]);
    const color = positive ? "#7A8471" : "#8B2E2E";

    let line = svg.querySelector(".spark-line");

    // رسم اولین بار: خط با انیمیشن «کشیده شدن» از چپ به راست ظاهر می‌شه
    if(!line){
      svg.innerHTML = `<polyline class="spark-line" points="${ptsToStr(target)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      line = svg.querySelector(".spark-line");
      const len = (line.getTotalLength ? line.getTotalLength() : w) || w;
      line.style.strokeDasharray = String(len);
      line.style.strokeDashoffset = String(len);
      // فورس ری‌فلو تا transition درست اجرا بشه
      line.getBoundingClientRect();
      line.style.transition = "stroke-dashoffset 900ms ease-out";
      requestAnimationFrame(() => { line.style.strokeDashoffset = "0"; });
      sparklineCurrentPts = target;
      return;
    }

    line.setAttribute("stroke", color);

    // آپدیت‌های بعدی: از شکل فعلی نرم به شکل جدید می‌ره، نه یه پرش یهویی
    const from = (sparklineCurrentPts && sparklineCurrentPts.length === target.length) ? sparklineCurrentPts : target;
    if(sparklineAnimFrame) cancelAnimationFrame(sparklineAnimFrame);
    const duration = 700;
    const start = performance.now();

    function step(now){
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutCubic(t);
      const current = target.map((p,i) => ({ x: p.x, y: from[i].y + (p.y - from[i].y) * eased }));
      line.setAttribute("points", ptsToStr(current));
      if(t < 1){
        sparklineAnimFrame = requestAnimationFrame(step);
      } else {
        sparklineCurrentPts = target;
        sparklineAnimFrame = null;
      }
    }
    sparklineAnimFrame = requestAnimationFrame(step);
  }

  // ---------- Products ----------
  let activeModel = "همه";

  function matchesFilters(p){
    if(PAGE_MODE === "featured") return !!p.featured;
    const catOk = activeCategory === "همه" || p.category === activeCategory;
    const karatOk = activeKarat === "همه" || String(p.karat) === activeKarat;
    const modelOk = activeModel === "همه" || p.model === activeModel;
    return catOk && karatOk && modelOk;
  }

  function visibleProducts(){ return PRODUCTS.filter(matchesFilters); }

  function renderSkeleton(){
    const grid = document.getElementById("productGrid");
    if(!grid) return;
    const count = PAGE_MODE === "featured" ? 4 : 8;
    grid.innerHTML = Array.from({length:count}).map(() => `
      <div class="skel-card">
        <div class="skel-art"></div>
        <div class="skel-line w60"></div>
        <div class="skel-line w40"></div>
      </div>`).join("");
  }

  function renderProducts(){
    const grid = document.getElementById("productGrid");
    if(!grid) return;
    const list = visibleProducts();

    if(list.length === 0){
      let msg, sub = "";
      if(!galleryLoaded && !galleryFailed){
        msg = "در حال بارگذاری محصولات...";
      } else if(galleryFailed){
        msg = "در حال حاضر امکان بارگذاری محصولات نیست.";
        sub = "لطفاً چند لحظه دیگه دوباره سر بزن.";
      } else if(PAGE_MODE === "featured"){
        msg = "هنوز محصول ویژه‌ای برای صفحه اصلی انتخاب نشده.";
      } else {
        msg = "محصولی با این فیلترها پیدا نشد.";
        sub = "فیلترها رو تغییر بده یا بعداً دوباره سر بزن.";
      }
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <div class="t">${msg}</div>
        ${sub ? `<div>${sub}</div>` : ''}
      </div>`;
      return;
    }

    const source = PAGE_MODE === "featured" ? list : PRODUCTS;
    grid.innerHTML = source.map(p => {
      const hiddenClass = matchesFilters(p) ? "" : "hidden";
      const badgeText = p.featured && PAGE_MODE === "full" && !p.badge ? "پرفروش" : p.badge;
      const hasStockInfo = typeof p.stock === "number";
      const outOfStock = hasStockInfo && p.stock <= 0;
      const stockNote = hasStockInfo
        ? (outOfStock ? `<div class="stock-note out">ناموجود</div>` : (p.stock <= 3 ? `<div class="stock-note low">تنها ${p.stock} عدد در انبار</div>` : ""))
        : "";
      return `
        <div class="product-card ${hiddenClass}" data-id="${p.id}">
          <div class="product-art" data-open="${p.id}" style="cursor:zoom-in;">
            ${badgeText ? `<span class="product-badge ${p.featured ? 'featured' : ''}">${badgeText}</span>` : ""}
            ${outOfStock ? `<span class="product-badge" style="background:#8B2E2E;color:#fff;">ناموجود</span>` : ""}
            <button class="fav-btn${favoriteIds.has(String(p.id)) ? ' active' : ''}" data-fav="${p.id}" aria-label="افزودن به علاقه‌مندی‌ها" onclick="event.stopPropagation();">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="${favoriteIds.has(String(p.id)) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>
            </button>
            ${productVisual(p)}
          </div>
          <div class="product-info">
            <div class="product-name">${p.name}${p.model ? ` <span class="dot">· ${p.model}</span>` : ""}</div>
            <div class="product-meta">
              <span class="star">★</span>
              <span class="num">${p.rating}</span>
              <span class="dot">· ${p.weight} گرم</span>
              <span class="dot">· ${karatLabel(p.karat)}</span>
            </div>
            ${stockNote}
            <div class="product-price num">${priceText(productPrice(p))} تومان</div>
            <button class="add-btn" data-add="${p.id}" ${outOfStock ? "disabled" : ""}>${outOfStock ? "ناموجود" : "افزودن به سبد"}</button>
          </div>
        </div>`;
    }).join("");

    grid.querySelectorAll("[data-add]:not([disabled])").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.getAttribute("data-add"));
        const added = addToCart(id);
        if (!added) return;
        btn.textContent = "افزوده شد ✓";
        btn.classList.add("just-added");
        setTimeout(() => { btn.textContent = "افزودن به سبد"; btn.classList.remove("just-added"); }, 1200);
      });
    });

    grid.querySelectorAll("[data-open]").forEach(art => {
      art.addEventListener("click", () => {
        const id = parseInt(art.getAttribute("data-open"));
        openLightbox(id);
      });
    });

    grid.querySelectorAll("[data-fav]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.getAttribute("data-fav"));
        toggleFavorite(id);
      });
    });
  }

  // ---------- Favorites ----------
  function showFavToast(){
    let el = document.getElementById("favToast");
    if(!el){
      el = document.createElement("div");
      el.id = "favToast";
      el.className = "fav-toast";
      el.innerHTML = `برای افزودن به علاقه‌مندی‌ها باید <a href="account.html">وارد حساب</a> بشی.`;
      document.body.appendChild(el);
    }
    el.classList.add("show");
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove("show"), 3000);
  }

  function updateFavButtonsUI(id){
    const active = favoriteIds.has(String(id));
    document.querySelectorAll(`[data-fav="${id}"]`).forEach(btn => setFavBtnActive(btn, active));
    const favBtn = document.getElementById("lightboxFav");
    if(favBtn && lightboxIndex !== -1){
      const list = visibleProducts().length ? visibleProducts() : PRODUCTS;
      const p = list[lightboxIndex];
      if(p && p.id === id) setFavBtnActive(favBtn, active);
    }
  }

  async function toggleFavorite(id){
    if(!(window.ReyhoonAuth && window.ReyhoonAuth.isLoggedIn())){
      showFavToast();
      return;
    }
    const wasActive = favoriteIds.has(String(id));
    // به‌روزرسانی خوش‌بینانه رابط کاربری
    if(wasActive) favoriteIds.delete(String(id)); else favoriteIds.add(String(id));
    updateFavButtonsUI(id);
    try{
      const data = await window.ReyhoonAuth.apiFetch("/api/favorites/toggle", {
        method: "POST",
        body: JSON.stringify({ itemId: String(id) }),
      });
      favoriteIds = new Set((data.favorites || []).map(String));
      updateFavButtonsUI(id);
    } catch(err){
      // برگردوندن به حالت قبل در صورت خطا
      if(wasActive) favoriteIds.add(String(id)); else favoriteIds.delete(String(id));
      updateFavButtonsUI(id);
    }
  }

  async function syncFavorites(){
    if(!(window.ReyhoonAuth && window.ReyhoonAuth.isLoggedIn())) return;
    try{
      const data = await window.ReyhoonAuth.apiFetch("/api/favorites/mine", { method: "GET" });
      favoriteIds = new Set((data.itemIds || []).map(String));
      renderProducts();
      if(lightboxIndex !== -1) renderLightbox();
    } catch(err){ /* اگه توکن نامعتبر شده باشه، بی‌سروصدا رد می‌شیم */ }
  }

  function bumpCartBadge(){
    const badge = document.getElementById("cartBadge");
    if(!badge) return;
    badge.classList.add("bump");
    setTimeout(() => badge.classList.remove("bump"), 250);
  }

  function addToCart(id){
    if(!(window.ReyhoonAuth && window.ReyhoonAuth.isLoggedIn())){
      if(confirm("برای افزودن محصول به سبد خرید باید وارد حساب کاربری بشی.\nمیخوای الان بری صفحه ورود؟")){
        location.href = "account.html";
      }
      return false;
    }
    const product = PRODUCTS.find(p => p.id === id);
    if(!product) return false;
    const line = cart.find(l => l.product.id === id);
    const currentQty = line ? line.qty : 0;
    if(typeof product.stock === "number" && currentQty + 1 > product.stock){
      alert(product.stock <= 0 ? "این محصول در حال حاضر ناموجود است." : `فقط ${product.stock} عدد از این محصول موجود است.`);
      return false;
    }
    if(line){ line.qty += 1; } else { cart.push({ product, qty:1 }); }
    renderCart();
    bumpCartBadge();
    const overlay = document.getElementById("cartOverlay");
    if(overlay) overlay.classList.add("open");
    return true;
  }

  // ---------- Lightbox ----------
  const lightboxEl = document.getElementById("lightbox");

  function openLightbox(id){
    if(!lightboxEl) return;
    const list = visibleProducts().length ? visibleProducts() : PRODUCTS;
    lightboxIndex = list.findIndex(p => p.id === id);
    if(lightboxIndex === -1) return;
    lightboxImgIndex = 0;
    renderLightbox(list);
    lightboxEl.classList.add("open");
  }

  function renderLightbox(list){
    list = list || (visibleProducts().length ? visibleProducts() : PRODUCTS);
    const p = list[lightboxIndex];
    if(!p) return;
    renderLightboxImage(p);
    document.getElementById("lightboxName").textContent = p.name;
    document.getElementById("lightboxMeta").innerHTML =
      `<span class="star">★</span><span class="num">${p.rating}</span><span class="dot">· ${p.weight} گرم</span><span class="dot">· ${karatLabel(p.karat)}</span>`;
    document.getElementById("lightboxPrice").textContent = priceText(productPrice(p)) + " تومان";
    document.getElementById("lightboxAdd").onclick = () => addToCart(p.id);
    const favBtn = document.getElementById("lightboxFav");
    if(favBtn){
      favBtn.onclick = () => toggleFavorite(p.id);
      setFavBtnActive(favBtn, favoriteIds.has(String(p.id)));
    }
  }

  function setFavBtnActive(btn, active){
    btn.classList.toggle("active", active);
    const svg = btn.querySelector("svg");
    if(svg) svg.setAttribute("fill", active ? "currentColor" : "none");
  }

  // این تابع فقط تصویر + ردیف thumbnail رو رندر می‌کنه، بدون دست‌زدن به دکمه‌های
  // بستن/قبلی/بعدی که کنارشون هستن. جایگزینی کامل innerHTML به‌جای querySelector
  // تک‌المانی قبلی، باعث میشه هیچ تصویر اضافه‌ای از رندر قبلی باقی نمونه (رفع باگ).
  function renderLightboxImage(p){
    const wrap = document.getElementById("lightboxImgWrap");
    if(wrap) wrap.innerHTML = productVisual(p, lightboxImgIndex);
    renderLightboxThumbs(p);
  }

  function renderLightboxThumbs(p){
    const thumbsEl = document.getElementById("lightboxThumbs");
    if(!thumbsEl) return;
    const imgs = productImages(p);
    if(!imgs || imgs.length < 2){
      thumbsEl.innerHTML = "";
      thumbsEl.style.display = "none";
      return;
    }
    thumbsEl.style.display = "flex";
    thumbsEl.innerHTML = imgs.map((src, i) =>
      `<div class="lightbox-thumb ${i === lightboxImgIndex ? 'active' : ''}" data-thumb="${i}"><img src="${src}" alt=""></div>`
    ).join("");
    thumbsEl.querySelectorAll("[data-thumb]").forEach(el => {
      el.addEventListener("click", () => {
        lightboxImgIndex = parseInt(el.dataset.thumb, 10);
        renderLightboxImage(p);
      });
    });
  }

  function closeLightbox(){ lightboxEl && lightboxEl.classList.remove("open"); }

  if(lightboxEl){
    document.getElementById("lightboxClose").addEventListener("click", closeLightbox);
    document.getElementById("lightboxBg").addEventListener("click", closeLightbox);
    document.getElementById("lightboxPrev").addEventListener("click", () => {
      const list = visibleProducts().length ? visibleProducts() : PRODUCTS;
      lightboxIndex = (lightboxIndex - 1 + list.length) % list.length;
      lightboxImgIndex = 0;
      renderLightbox(list);
    });
    document.getElementById("lightboxNext").addEventListener("click", () => {
      const list = visibleProducts().length ? visibleProducts() : PRODUCTS;
      lightboxIndex = (lightboxIndex + 1) % list.length;
      lightboxImgIndex = 0;
      renderLightbox(list);
    });
    document.addEventListener("keydown", (e) => {
      if(!lightboxEl.classList.contains("open")) return;
      if(e.key === "Escape") closeLightbox();
      if(e.key === "ArrowLeft") document.getElementById("lightboxNext").click();
      if(e.key === "ArrowRight") document.getElementById("lightboxPrev").click();
    });
  }

  // ---------- Filters (فقط صفحه فروشگاه کامل) ----------
  const filtersEl = document.getElementById("filters");
  const modelFiltersEl = document.getElementById("modelFilters");

  function renderModelFilters(){
    if(!modelFiltersEl) return;
    activeModel = "همه";
    if(activeCategory === "همه"){
      modelFiltersEl.style.display = "none";
      modelFiltersEl.innerHTML = "";
      return;
    }
    const models = Array.from(new Set(
      PRODUCTS.filter(p => p.category === activeCategory && p.model).map(p => p.model)
    ));
    if(models.length === 0){
      modelFiltersEl.style.display = "none";
      modelFiltersEl.innerHTML = "";
      return;
    }
    modelFiltersEl.style.display = "";
    modelFiltersEl.innerHTML =
      `<button class="filter-btn active" data-model="همه">همه مدل‌ها</button>` +
      models.map(m => `<button class="filter-btn" data-model="${m}">${m}</button>`).join("");
  }

  if(filtersEl){
    filtersEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if(!btn) return;
      activeCategory = btn.getAttribute("data-cat");
      filtersEl.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderModelFilters();
      renderProducts();
    });
  }
  if(modelFiltersEl){
    modelFiltersEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if(!btn) return;
      activeModel = btn.getAttribute("data-model");
      modelFiltersEl.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderProducts();
    });
  }
  const karatFiltersEl = document.getElementById("karatFilters");
  if(karatFiltersEl){
    karatFiltersEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if(!btn) return;
      activeKarat = btn.getAttribute("data-karat");
      karatFiltersEl.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === btn));
      renderProducts();
    });
  }

  // ---------- Calculator (فقط صفحه‌ای که این عناصر رو داره) ----------
  let calcWeight = 5;
  let calcFee = 20;
  let calcKarat = 18;

  function updateCalculator(){
    const totalEl = document.getElementById("calcTotalVal");
    if(!totalEl) return;
    const rate = calcKarat === 24 ? price24kVal() : pricePerGram;
    const total = rate * calcWeight * (1 + calcFee/100);
    const base = rate * calcWeight;
    const fee = base * (calcFee/100);
    totalEl.textContent = priceText(total);
    document.getElementById("calcBase").textContent = priceText(base) + " تومان";
    document.getElementById("calcFee").textContent = priceText(fee) + " تومان";
  }

  const calcKaratBtns = document.getElementById("calcKaratBtns");
  if(calcKaratBtns){
    calcKaratBtns.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if(!btn) return;
      calcKarat = parseInt(btn.getAttribute("data-calc-karat"));
      calcKaratBtns.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === btn));
      updateCalculator();
    });
  }
  const weightRange = document.getElementById("weightRange");
  const feeRange = document.getElementById("feeRange");
  if(weightRange){
    weightRange.addEventListener("input", () => {
      calcWeight = parseFloat(weightRange.value);
      document.getElementById("weightVal").textContent = calcWeight;
      updateCalculator();
    });
    document.getElementById("weightMinus").addEventListener("click", () => {
      calcWeight = Math.max(0.5, calcWeight - 0.5);
      weightRange.value = calcWeight;
      document.getElementById("weightVal").textContent = calcWeight;
      updateCalculator();
    });
    document.getElementById("weightPlus").addEventListener("click", () => {
      calcWeight = Math.min(30, calcWeight + 0.5);
      weightRange.value = calcWeight;
      document.getElementById("weightVal").textContent = calcWeight;
      updateCalculator();
    });
  }
  if(feeRange){
    feeRange.addEventListener("input", () => {
      calcFee = parseInt(feeRange.value);
      document.getElementById("feeVal").textContent = calcFee + "٪";
      updateCalculator();
    });
  }

  // ---------- Cart ----------
  const CART_STORAGE_KEY = "reyhoon-gallery-cart"; // مشترک بین index و shop

  function saveCart(){
    try{
      const payload = cart.map(l => ({ id:l.product.id, qty:l.qty }));
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(payload));
    } catch(err){ /* localStorage غیرفعال باشه هم سایت کار می‌کنه */ }
  }

  function loadCart(){
    try{
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      if(!raw) return;
      const payload = JSON.parse(raw);
      cart = payload
        .map(item => ({ product: PRODUCTS.find(p => p.id === item.id), qty: item.qty }))
        .filter(l => l.product && l.qty > 0);
    } catch(err){ cart = []; }
  }

  function cartTotal(){ return cart.reduce((sum, l) => sum + productPrice(l.product) * l.qty, 0); }
  function cartTotalWeight(){ return cart.reduce((sum, l) => sum + l.product.weight * l.qty, 0); }
  function currentDiscountAmount(){
    if(!appliedDiscount) return 0;
    const subtotal = cartTotal();
    if(appliedDiscount.type === "percent") return Math.round(subtotal * appliedDiscount.value / 100);
    return Math.min(appliedDiscount.value, subtotal);
  }
  function cartFinalTotal(){ return Math.max(0, cartTotal() - currentDiscountAmount()); }

  function renderCart(){
    const badge = document.getElementById("cartBadge");
    if(badge){
      const totalQty = cart.reduce((sum, l) => sum + l.qty, 0);
      badge.style.display = totalQty ? "flex" : "none";
      badge.textContent = totalQty;
    }

    const list = document.getElementById("cartList");
    // این صفحه پنل سبد رو نداره (مثلاً account.html/support.html/orders.html) —
    // نشان تعداد رو بالا آپدیت کردیم، همین کافیه، ادامه نده. قبلاً اینجا کرش می‌کرد
    // و چون renderCart() تو توالی راه‌اندازی اولیه قبل از fetchLivePrice/fetchGallery
    // صدا زده می‌شه، اون کرش باعث می‌شد قیمت طلا و داده‌های سرور اصلاً لود نشن.
    if(!list) return;
    const empty = document.getElementById("cartEmpty");
    const footer = document.getElementById("cartFooter");
    const undoWrap = document.getElementById("undoWrap");

    if(cart.length === 0){
      list.innerHTML = "";
      empty.style.display = "flex";
      footer.style.display = "none";
      appliedDiscount = null;
      saveCart();
      return;
    }

    empty.style.display = "none";
    footer.style.display = "block";

    list.innerHTML = (undoWrap ? undoWrap.outerHTML : "") + cart.map((l, i) => {
      const base = karatBaseRate(l.product.karat) * l.product.weight;
      const fee = base * (l.product.makingFee/100);
      return `
      <div class="cart-item" data-idx="${i}">
        <div class="thumb">${productVisual(l.product)}</div>
        <div class="info">
          <div class="n">${l.product.name}</div>
          <div class="meta">${karatLabel(l.product.karat)} · ${l.product.weight} گرم</div>
          <div class="meta">طلا: ${toToman(base)} + اجرت: ${toToman(fee)}</div>
          <div class="p num">${toToman(productPrice(l.product))} تومان <span class="unit">/ عدد</span></div>
          <div class="qty-stepper">
            <button data-qty-minus="${i}" aria-label="کم کردن تعداد">−</button>
            <span class="q num">${l.qty}</span>
            <button data-qty-plus="${i}" aria-label="زیاد کردن تعداد">+</button>
          </div>
          <div class="line-total num">جمع: ${toToman(productPrice(l.product) * l.qty)} تومان</div>
        </div>
        <button class="remove" data-remove="${i}" aria-label="حذف">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    }).join("");

    list.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => removeFromCart(parseInt(btn.getAttribute("data-remove"))));
    });
    list.querySelectorAll("[data-qty-minus]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-qty-minus"));
        cart[idx].qty -= 1;
        if(cart[idx].qty <= 0) { removeFromCart(idx); return; }
        renderCart();
      });
    });
    list.querySelectorAll("[data-qty-plus]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-qty-plus"));
        const l = cart[idx];
        if(typeof l.product.stock === "number" && l.qty + 1 > l.product.stock){
          alert(`فقط ${l.product.stock} عدد از این محصول موجود است.`);
          return;
        }
        l.qty += 1;
        renderCart();
      });
    });

    document.getElementById("cartTotalVal").textContent = toToman(cartFinalTotal()) + " تومان";
    const weightNote = document.getElementById("cartWeightNote");
    if(weightNote) weightNote.textContent = "وزن کل: " + cartTotalWeight().toFixed(2) + " گرم";
    renderDiscountUI();
    saveCart();
  }

  // ---------- Discount code ----------
  function renderDiscountUI(){
    const row = document.getElementById("discountRow");
    const applied = document.getElementById("discountApplied");
    const line = document.getElementById("discountLine");
    const lineVal = document.getElementById("discountLineVal");
    if(!row || !applied) return;
    if(appliedDiscount){
      row.style.display = "none";
      applied.classList.add("show");
      document.getElementById("discountAppliedText").textContent = "کد «" + appliedDiscount.code + "» — " + appliedDiscount.label;
      if(line){ line.style.display = "flex"; lineVal.textContent = "- " + toToman(currentDiscountAmount()) + " تومان"; }
    } else {
      row.style.display = "flex";
      applied.classList.remove("show");
      if(line) line.style.display = "none";
    }
  }

  function showDiscountError(text){
    const el = document.getElementById("discountError");
    if(!el) return;
    el.textContent = text;
    el.classList.add("show");
  }
  function clearDiscountError(){
    const el = document.getElementById("discountError");
    if(el){ el.textContent = ""; el.classList.remove("show"); }
  }

  const applyDiscountBtn = document.getElementById("applyDiscountBtn");
  if(applyDiscountBtn){
    applyDiscountBtn.addEventListener("click", async () => {
      const input = document.getElementById("discountInput");
      const code = (input.value || "").trim();
      clearDiscountError();
      if(!code) return;
      if(!GALLERY_API_URL) return;
      applyDiscountBtn.disabled = true;
      applyDiscountBtn.textContent = "...";
      try{
        const res = await fetch(`${GALLERY_API_URL}/api/discount/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, subtotal: cartTotal() }),
        });
        const data = await res.json();
        if(data.valid){
          appliedDiscount = { code: data.code, type: data.type, value: data.value, label: data.label };
          input.value = "";
          renderCart();
        } else {
          showDiscountError(data.error || "کد تخفیف معتبر نیست.");
        }
      } catch(err){
        showDiscountError("مشکلی پیش اومد، دوباره تلاش کن.");
      } finally {
        applyDiscountBtn.disabled = false;
        applyDiscountBtn.textContent = "اعمال";
      }
    });
  }

  const removeDiscountBtn = document.getElementById("removeDiscountBtn");
  if(removeDiscountBtn){
    removeDiscountBtn.addEventListener("click", () => {
      appliedDiscount = null;
      renderCart();
    });
  }

  function removeFromCart(idx){
    lastRemoved = { line: cart[idx], index: idx };
    cart.splice(idx, 1);
    showUndoToast();
    renderCart();
  }

  function showUndoToast(){
    clearTimeout(undoTimer);
    const list = document.getElementById("cartList");
    if(!list) return;
    const existing = document.getElementById("undoToast");
    if(existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "undo-toast";
    toast.id = "undoToast";
    toast.innerHTML = `<span>${lastRemoved.line.product.name} حذف شد</span><button id="undoBtn">بازگردانی</button>`;
    list.prepend(toast);
    document.getElementById("undoBtn").addEventListener("click", () => {
      if(!lastRemoved) return;
      cart.splice(lastRemoved.index, 0, lastRemoved.line);
      lastRemoved = null;
      renderCart();
    });
    undoTimer = setTimeout(() => { document.getElementById("undoToast")?.remove(); lastRemoved = null; }, 5000);
  }

  function clearCart(){
    if(cart.length === 0) return;
    if(!confirm("سبد خرید خالی بشه؟")) return;
    cart = [];
    renderCart();
  }

  const clearCartBtn = document.getElementById("clearCartBtn");
  if(clearCartBtn) clearCartBtn.addEventListener("click", clearCart);

  // ---------- Checkout ----------
  const SHOP_TELEGRAM_USERNAME = "ReyhoonGoldGallery";

  const checkoutModal = document.getElementById("checkoutModal");
  const stepForm = document.getElementById("checkoutStepForm");
  const stepSuccess = document.getElementById("checkoutStepSuccess");

  function fillShippingFields(user){
    const phoneInput = document.getElementById("ckPhone");
    if(phoneInput && !phoneInput.value && user && user.phone) phoneInput.value = user.phone;
    const shipping = user && user.shipping;
    if(shipping){
      const nameInput = document.getElementById("ckName");
      const emailInput = document.getElementById("ckEmail");
      const postalInput = document.getElementById("ckPostalCode");
      const addressInput = document.getElementById("ckAddress");
      if(nameInput && !nameInput.value && shipping.name) nameInput.value = shipping.name;
      if(emailInput && !emailInput.value && shipping.email) emailInput.value = shipping.email;
      if(postalInput && !postalInput.value && shipping.postalCode) postalInput.value = shipping.postalCode;
      if(addressInput && !addressInput.value && shipping.address) addressInput.value = shipping.address;
    }
  }

  async function openCheckout(){
    if(cart.length === 0 || !checkoutModal) return;
    document.getElementById("checkoutTotal").textContent = toToman(cartFinalTotal()) + " تومان";
    if(window.ReyhoonAuth && window.ReyhoonAuth.isLoggedIn()){
      // اول با چیزی که تو کش لوکاله فرم رو پر کن (سریع)، بعد از سرور تازه‌ش کن (برای سشن‌های قدیمی)
      fillShippingFields(window.ReyhoonAuth.getUser());
      window.ReyhoonAuth.refreshUser().then(fillShippingFields);
    }
    stepForm.style.display = "block";
    stepSuccess.style.display = "none";
    checkoutModal.classList.add("open");
  }
  function closeCheckout(){ checkoutModal && checkoutModal.classList.remove("open"); }

  const checkoutBtn = document.getElementById("checkoutBtn");
  if(checkoutBtn) checkoutBtn.addEventListener("click", openCheckout);
  const checkoutClose = document.getElementById("checkoutClose");
  if(checkoutClose) checkoutClose.addEventListener("click", closeCheckout);
  const checkoutBg = document.getElementById("checkoutBg");
  if(checkoutBg) checkoutBg.addEventListener("click", closeCheckout);
  const checkoutDone = document.getElementById("checkoutDone");
  if(checkoutDone) checkoutDone.addEventListener("click", () => {
    cart = [];
    renderCart();
    closeCheckout();
    document.getElementById("cartOverlay")?.classList.remove("open");
  });

  function validateField(fieldId, isValid){
    document.getElementById(fieldId).classList.toggle("invalid", !isValid);
    return isValid;
  }

  const checkoutSubmit = document.getElementById("checkoutSubmit");
  if(checkoutSubmit){
    checkoutSubmit.addEventListener("click", async () => {
      const name = document.getElementById("ckName").value.trim();
      const phone = document.getElementById("ckPhone").value.trim();
      const email = document.getElementById("ckEmail").value.trim();
      const postalCode = document.getElementById("ckPostalCode").value.trim();
      const address = document.getElementById("ckAddress").value.trim();

      const nameOk = validateField("fieldName", name.length >= 2);
      const phoneOk = validateField("fieldPhone", /^0?9\d{9}$/.test(phone.replace(/\s/g, "")));
      const emailOk = validateField("fieldEmail", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      const postalOk = validateField("fieldPostalCode", /^\d{10}$/.test(postalCode.replace(/\s/g, "")));
      const addressOk = validateField("fieldAddress", address.length >= 5);
      if(!nameOk || !phoneOk || !emailOk || !postalOk || !addressOk) return;

      const orderItems = cart.map(l => ({
        id: l.product.id,
        name: l.product.name,
        karat: l.product.karat,
        weight: l.product.weight,
        qty: l.qty,
        unitPrice: productPrice(l.product),
      }));

      const lines = cart.map(l => `- ${l.product.name} (${karatLabel(l.product.karat)}، ${l.product.weight} گرم) × ${l.qty} — ${toToman(productPrice(l.product)*l.qty)} تومان`).join("\n");
      const discountText = appliedDiscount ? `\nکد تخفیف: ${appliedDiscount.code} (-${toToman(currentDiscountAmount())} تومان)` : "";
      const message =
`سفارش جدید از ریحون گلد گالری
نام: ${name}
تماس: ${phone}
ایمیل: ${email}
کدپستی: ${postalCode}
آدرس: ${address}

اقلام:
${lines}
${discountText}
جمع کل: ${toToman(cartFinalTotal())} تومان`;

      const tgLink = `https://t.me/${SHOP_TELEGRAM_USERNAME}?text=${encodeURIComponent(message)}`;
      document.getElementById("checkoutTelegramLink").href = tgLink;

      checkoutSubmit.disabled = true;
      checkoutSubmit.textContent = "در حال ثبت سفارش...";

      let ticketNumber = null;
      if(ORDERS_API_URL){
        try{
          const headers = { "Content-Type": "application/json" };
          if(window.ReyhoonAuth && window.ReyhoonAuth.getToken()){
            headers["Authorization"] = "Bearer " + window.ReyhoonAuth.getToken();
          }
          const res = await fetch(`${ORDERS_API_URL}/api/order`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              name, phone, email, postalCode, address, items: orderItems,
              subtotal: cartTotal(),
              discountCode: appliedDiscount ? appliedDiscount.code : undefined,
              total: cartFinalTotal(),
            }),
          });
          if(res.ok){
            const data = await res.json();
            if(data.ok && data.ticketNumber) ticketNumber = data.ticketNumber;
          }
        } catch(err){
          console.warn("ارسال خودکار تیکت ناموفق بود:", err.message);
        }
      }

      checkoutSubmit.disabled = false;
      checkoutSubmit.textContent = "ثبت سفارش و ارسال به تلگرام";

      const ticketDisplay = document.getElementById("ticketNumberDisplay");
      const tgLinkEl = document.getElementById("checkoutTelegramLink");
      const successDesc = document.getElementById("checkoutSuccessDesc");

      if(ticketNumber){
        ticketDisplay.style.display = "block";
        ticketDisplay.textContent = "شماره پیگیری تیکت: #" + ticketNumber;
        tgLinkEl.style.display = "none";
        successDesc.textContent = "تیکت سفارش شما مستقیم برای ما ارسال شد. برای پیگیری همین شماره تیکت رو نگه دارید.";
      } else {
        ticketDisplay.style.display = "none";
        tgLinkEl.style.display = "block";
        successDesc.textContent = "برای تکمیل سفارش، روی دکمه زیر بزنید تا خلاصه سفارش به تلگرام ما ارسال بشه.";
      }

      stepForm.style.display = "none";
      stepSuccess.style.display = "block";
    });
  }

  // ---------- Cart drawer open/close ----------
  const cartOverlay = document.getElementById("cartOverlay");
  const cartBtn = document.getElementById("cartBtn");
  if(cartBtn) cartBtn.addEventListener("click", () => cartOverlay.classList.add("open"));
  const cartClose = document.getElementById("cartClose");
  if(cartClose) cartClose.addEventListener("click", () => cartOverlay.classList.remove("open"));
  const cartOverlayBg = document.getElementById("cartOverlayBg");
  if(cartOverlayBg) cartOverlayBg.addEventListener("click", () => cartOverlay.classList.remove("open"));

  // ---------- Mobile menu ----------
  const mobileMenu = document.getElementById("mobileMenu");
  const menuToggle = document.getElementById("menuToggle");
  if(menuToggle) menuToggle.addEventListener("click", () => mobileMenu.classList.add("open"));
  const mobileMenuClose = document.getElementById("mobileMenuClose");
  if(mobileMenuClose) mobileMenuClose.addEventListener("click", () => mobileMenu.classList.remove("open"));
  if(mobileMenu) mobileMenu.querySelectorAll(".mobile-link").forEach(link => {
    link.addEventListener("click", () => mobileMenu.classList.remove("open"));
  });

  // ---------- Init ----------
  renderSkeleton();
  loadCart();
  updatePriceChangeBadge();
  renderMainPrices();
  renderSparkline();
  renderRecentRange();
  renderProducts();
  updateCalculator();
  renderCart();
  updateLiveIndicator();
  fetchLivePrice();
  fetchGallery();
  syncFavorites();
  setInterval(fetchLivePrice, LIVE_REFRESH_MS);
  setInterval(fetchGallery, 30000);

  // ---------- API مشترک برای صفحات دیگه (مثل favorites.html) ----------
  window.ReyhoonShop = {
    getProducts: () => PRODUCTS,
    productPrice,
    productVisual,
    priceText,
    addToCart,
    openLightbox,
    toggleFavorite,
    isFavorite: (id) => favoriteIds.has(String(id)),
    syncFavorites,
    onGalleryLoaded: (cb) => { galleryLoadedCallbacks.push(cb); if(galleryLoaded) cb(PRODUCTS); },
    isPriceReady: () => priceReady,
    onPriceReady: (cb) => { if(priceReady) cb(); else priceReadyCallbacks.push(cb); },
  };
})();
