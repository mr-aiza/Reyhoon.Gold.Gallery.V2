// ============================================================
// ریحون گلد گالری — منطق مشترک صفحات (index.html و shop.html)
// هر صفحه با تنظیم window.PAGE_MODE = "featured" | "full" این فایل رو لود می‌کنه
// ============================================================
(function(){
  const PAGE_MODE = window.PAGE_MODE || "full"; // "featured" روی index، "full" روی shop

  // ---------- Data ----------
  const DEFAULT_PRODUCTS = [
    { id:1, name:"گردنبند زنجیر ظریف", category:"گردنبند", karat:18, weight:4.2, makingFee:18, art:"necklace", rating:4.8, badge:"پرفروش", featured:true },
    { id:2, name:"دستبند زنجیری کلاسیک", category:"دستبند", karat:18, weight:6.8, makingFee:15, art:"bracelet", rating:4.6, badge:null, featured:false },
    { id:3, name:"انگشتر سولیتر", category:"انگشتر", karat:18, weight:2.1, makingFee:28, art:"ring", rating:4.9, badge:"جدید", featured:true },
    { id:4, name:"گوشواره مدالیونی", category:"گوشواره", karat:18, weight:1.8, makingFee:22, art:"earring", rating:4.7, badge:null, featured:false },
    { id:5, name:"گردنبند طرح برگ", category:"گردنبند", karat:18, weight:5.5, makingFee:20, art:"necklace", rating:4.5, badge:null, featured:false },
    { id:6, name:"دستبند پاندولی", category:"دستبند", karat:18, weight:3.4, makingFee:25, art:"bracelet", rating:4.8, badge:"پرفروش", featured:true },
    { id:7, name:"شمش طلای ۲۴ عیار ۵ گرمی", category:"شمش", karat:24, weight:5, makingFee:3, art:"bar", rating:4.9, badge:"سرمایه‌گذاری", featured:true },
    { id:8, name:"شمش طلای ۲۴ عیار ۱۰ گرمی", category:"شمش", karat:24, weight:10, makingFee:2, art:"bar", rating:4.9, badge:null, featured:false },
    { id:9, name:"گردنبند ساده ۲۴ عیار", category:"گردنبند", karat:24, weight:6, makingFee:6, art:"necklace", rating:4.6, badge:null, featured:false },
    { id:10, name:"النگوی ۲۴ عیار", category:"دستبند", karat:24, weight:8, makingFee:5, art:"bracelet", rating:4.7, badge:"جدید", featured:false },
    { id:11, name:"دستبند کارکرده طرح ظریف", category:"دستبند", karat:"used", weight:5.5, makingFee:6, art:"bracelet", rating:4.3, badge:"کارکرده", featured:false },
    { id:12, name:"گردنبند کارکرده سنتی", category:"گردنبند", karat:"used", weight:7.2, makingFee:5, art:"necklace", rating:4.2, badge:"کارکرده", featured:false },
    { id:13, name:"انگشتر کارکرده", category:"انگشتر", karat:"used", weight:3.1, makingFee:8, art:"ring", rating:4.1, badge:"کارکرده", featured:false },
    { id:14, name:"گوشواره کارکرده", category:"گوشواره", karat:"used", weight:2.5, makingFee:5, art:"earring", rating:4.0, badge:"کارکرده", featured:false },
  ];

  let PRODUCTS = DEFAULT_PRODUCTS.slice();
  let galleryLoaded = false;

  // آدرس Worker گالری تلگرام رو اینجا بذار
  const GALLERY_API_URL = "https://reyhoongoldgallery.tempmail41245.workers.dev";

  async function fetchGallery(){
    if(!GALLERY_API_URL) return;
    try{
      const res = await fetch(`${GALLERY_API_URL}/api/gallery`, { cache:"no-store" });
      if(!res.ok) throw new Error("bad status " + res.status);
      const data = await res.json();
      if(Array.isArray(data.items) && data.items.length > 0){
        PRODUCTS = data.items;
        galleryLoaded = true;
        renderProducts();
      } else if(Array.isArray(data.items)){
        galleryLoaded = true;
        renderProducts();
      }
    } catch(err){
      console.warn("اتصال به گالری تلگرام ناموفق بود، محصولات نمایشی نشون داده می‌شه:", err.message);
    }
  }

  // ---------- Live price config ----------
  const BRSAPI_KEY = "BqE8gdGzKGK3cS2aS6zhsLGHtZGkYvuA";
  const BRSAPI_URL = `https://Api.BrsApi.ir/Market/Gold_Currency.php?key=${BRSAPI_KEY}`;
  const LIVE_REFRESH_MS = 60000;
  let usingLiveData = false;

  let pricePerGram = 38450000;
  let history = Array.from({length:24}, (_,i) => 38450000 + Math.sin(i/3)*80000 + i*4000);
  let cart = [];
  let activeCategory = "همه";
  let activeKarat = "همه";
  let lightboxIndex = -1;
  let live24k = null;
  let liveEmami = null;
  let undoTimer = null;
  let lastRemoved = null; // { line, index }

  const toToman = n => Math.round(n).toLocaleString("fa-IR");
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
          history.shift();
          history.push(pricePerGram);
          usingLiveData = true;
          updateLiveIndicator();
          refreshAllUI();
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
    label.textContent = usingLiveData ? "قیمت زنده" : "حالت نمایشی";
  }

  function refreshAllUI(){
    const mp = document.getElementById("mainPrice");
    if(mp) mp.textContent = toToman(pricePerGram);
    const p24 = document.getElementById("price24");
    if(p24) p24.textContent = toToman(price24kVal());
    const pc = document.getElementById("priceCoin");
    if(pc) pc.textContent = toToman(priceEmamiVal());
    renderSparkline();
    renderTicker();
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

  function productVisual(p){
    if(p.image) return `<img src="${p.image}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
    return productArtSVG(p.art);
  }

  function karatBaseRate(karat){ return karat === 24 ? price24kVal() : pricePerGram; }
  function karatLabel(karat){
    if(karat === 24) return "۲۴ عیار";
    if(karat === "used") return "کارکرده";
    return "۱۸ عیار";
  }
  function productPrice(p){ return karatBaseRate(p.karat) * p.weight * (1 + p.makingFee/100); }

  // ---------- Ticker ----------
  function renderTicker(){
    const track = document.getElementById("tickerTrack");
    if(!track) return;
    const items = [
      { label:"طلای ۱۸ عیار (هر گرم)", val:pricePerGram },
      { label:"طلای ۲۴ عیار (هر گرم)", val:price24kVal() },
      { label:"سکه امامی", val:priceEmamiVal() },
      { label:"نیم سکه", val:pricePerGram*4.06 },
      { label:"ربع سکه", val:pricePerGram*2.03 },
    ];
    let groupHTML = items.map(it => `<span class="ticker-item"><span>${it.label}</span><span class="val num">${toToman(it.val)}</span><span class="unit">تومان</span></span>`).join("");
    track.innerHTML = `<div class="ticker-group">${groupHTML}</div><div class="ticker-group">${groupHTML}</div>`;
  }

  // ---------- Sparkline ----------
  function renderSparkline(){
    const svg = document.getElementById("sparkline");
    if(!svg) return;
    const w = 300, h = 36;
    const min = Math.min(...history), max = Math.max(...history);
    const range = (max - min) || 1;
    const points = history.map((v,i) => {
      const x = (i/(history.length-1)) * w;
      const y = h - ((v-min)/range) * h;
      return `${x},${y}`;
    }).join(" ");
    const positive = (history[history.length-1] >= history[history.length-2]);
    const color = positive ? "#7A8471" : "#8B2E2E";
    svg.innerHTML = `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  // ---------- Simulated price update (demo fallback) ----------
  function updatePrice(){
    if(usingLiveData) return;
    const delta = (Math.random() - 0.48) * 35000;
    pricePerGram = Math.max(37000000, pricePerGram + delta);
    history.shift();
    history.push(pricePerGram);

    const mp = document.getElementById("mainPrice");
    if(mp) mp.textContent = toToman(pricePerGram);
    const p24 = document.getElementById("price24");
    if(p24) p24.textContent = toToman(pricePerGram*1.33);
    const pc = document.getElementById("priceCoin");
    if(pc) pc.textContent = toToman(pricePerGram*8.13);

    const changeEl = document.getElementById("priceChange");
    if(changeEl){
      const changeVal = document.getElementById("changeVal");
      const positive = delta >= 0;
      changeEl.className = "price-change num " + (positive ? "up" : "down");
      changeVal.textContent = (positive ? "+" : "") + toToman(delta);
    }

    renderSparkline();
    renderTicker();
    renderProducts();
    updateCalculator();
    renderCart();
  }

  // ---------- Products ----------
  function matchesFilters(p){
    if(PAGE_MODE === "featured") return !!p.featured;
    const catOk = activeCategory === "همه" || p.category === activeCategory;
    const karatOk = activeKarat === "همه" || String(p.karat) === activeKarat;
    return catOk && karatOk;
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
      const msg = PAGE_MODE === "featured"
        ? "هنوز محصول ویژه‌ای برای صفحه اصلی انتخاب نشده."
        : "محصولی با این فیلترها پیدا نشد.";
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">
        <div class="t">${msg}</div>
        ${PAGE_MODE === "full" ? '<div>فیلترها رو تغییر بده یا بعداً دوباره سر بزن.</div>' : ''}
      </div>`;
      return;
    }

    const source = PAGE_MODE === "featured" ? list : PRODUCTS;
    grid.innerHTML = source.map(p => {
      const hiddenClass = matchesFilters(p) ? "" : "hidden";
      const badgeText = p.featured && PAGE_MODE === "full" && !p.badge ? "پرفروش" : p.badge;
      return `
        <div class="product-card ${hiddenClass}" data-id="${p.id}">
          <div class="product-art" data-open="${p.id}" style="cursor:zoom-in;">
            ${badgeText ? `<span class="product-badge ${p.featured ? 'featured' : ''}">${badgeText}</span>` : ""}
            ${productVisual(p)}
          </div>
          <div class="product-info">
            <div class="product-name">${p.name}</div>
            <div class="product-meta">
              <span class="star">★</span>
              <span class="num">${p.rating}</span>
              <span class="dot">· ${p.weight} گرم</span>
              <span class="dot">· ${karatLabel(p.karat)}</span>
            </div>
            <div class="product-price num">${toToman(productPrice(p))} تومان</div>
            <button class="add-btn" data-add="${p.id}">افزودن به سبد</button>
          </div>
        </div>`;
    }).join("");

    grid.querySelectorAll("[data-add]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.getAttribute("data-add"));
        addToCart(id);
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
  }

  function bumpCartBadge(){
    const badge = document.getElementById("cartBadge");
    if(!badge) return;
    badge.classList.add("bump");
    setTimeout(() => badge.classList.remove("bump"), 250);
  }

  function addToCart(id){
    const product = PRODUCTS.find(p => p.id === id);
    if(!product) return;
    const line = cart.find(l => l.product.id === id);
    if(line){ line.qty += 1; } else { cart.push({ product, qty:1 }); }
    renderCart();
    bumpCartBadge();
    const overlay = document.getElementById("cartOverlay");
    if(overlay) overlay.classList.add("open");
  }

  // ---------- Lightbox ----------
  const lightboxEl = document.getElementById("lightbox");

  function openLightbox(id){
    if(!lightboxEl) return;
    const list = visibleProducts().length ? visibleProducts() : PRODUCTS;
    lightboxIndex = list.findIndex(p => p.id === id);
    if(lightboxIndex === -1) return;
    renderLightbox(list);
    lightboxEl.classList.add("open");
  }

  function renderLightbox(list){
    list = list || (visibleProducts().length ? visibleProducts() : PRODUCTS);
    const p = list[lightboxIndex];
    if(!p) return;
    const artEl = document.getElementById("lightboxArt");
    artEl.querySelector("svg, img")?.remove();
    artEl.insertAdjacentHTML("beforeend", productVisual(p));
    document.getElementById("lightboxName").textContent = p.name;
    document.getElementById("lightboxMeta").innerHTML =
      `<span class="star">★</span><span class="num">${p.rating}</span><span class="dot">· ${p.weight} گرم</span><span class="dot">· ${karatLabel(p.karat)}</span>`;
    document.getElementById("lightboxPrice").textContent = toToman(productPrice(p)) + " تومان";
    document.getElementById("lightboxAdd").onclick = () => addToCart(p.id);
  }

  function closeLightbox(){ lightboxEl && lightboxEl.classList.remove("open"); }

  if(lightboxEl){
    document.getElementById("lightboxClose").addEventListener("click", closeLightbox);
    document.getElementById("lightboxBg").addEventListener("click", closeLightbox);
    document.getElementById("lightboxPrev").addEventListener("click", () => {
      const list = visibleProducts().length ? visibleProducts() : PRODUCTS;
      lightboxIndex = (lightboxIndex - 1 + list.length) % list.length;
      renderLightbox(list);
    });
    document.getElementById("lightboxNext").addEventListener("click", () => {
      const list = visibleProducts().length ? visibleProducts() : PRODUCTS;
      lightboxIndex = (lightboxIndex + 1) % list.length;
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
  if(filtersEl){
    filtersEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if(!btn) return;
      activeCategory = btn.getAttribute("data-cat");
      filtersEl.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === btn));
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
    totalEl.textContent = toToman(total);
    document.getElementById("calcBase").textContent = toToman(base) + " تومان";
    document.getElementById("calcFee").textContent = toToman(fee) + " تومان";
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

  function renderCart(){
    const badge = document.getElementById("cartBadge");
    if(!badge) return; // این صفحه سبد نداره
    const totalQty = cart.reduce((sum, l) => sum + l.qty, 0);
    badge.style.display = totalQty ? "flex" : "none";
    badge.textContent = totalQty;

    const list = document.getElementById("cartList");
    const empty = document.getElementById("cartEmpty");
    const footer = document.getElementById("cartFooter");
    const undoWrap = document.getElementById("undoWrap");

    if(cart.length === 0){
      list.innerHTML = "";
      empty.style.display = "flex";
      footer.style.display = "none";
      saveCart();
      return;
    }

    empty.style.display = "none";
    footer.style.display = "block";

    list.innerHTML = (undoWrap ? undoWrap.outerHTML : "") + cart.map((l, i) => `
      <div class="cart-item" data-idx="${i}">
        <div class="thumb">${productVisual(l.product)}</div>
        <div class="info">
          <div class="n">${l.product.name}</div>
          <div class="p num">${toToman(productPrice(l.product))} تومان</div>
          <div class="qty-stepper">
            <button data-qty-minus="${i}" aria-label="کم کردن تعداد">−</button>
            <span class="q num">${l.qty}</span>
            <button data-qty-plus="${i}" aria-label="زیاد کردن تعداد">+</button>
          </div>
        </div>
        <button class="remove" data-remove="${i}" aria-label="حذف">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`).join("");

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
      btn.addEventListener("click", () => { cart[parseInt(btn.getAttribute("data-qty-plus"))].qty += 1; renderCart(); });
    });

    document.getElementById("cartTotalVal").textContent = toToman(cartTotal()) + " تومان";
    const weightNote = document.getElementById("cartWeightNote");
    if(weightNote) weightNote.textContent = "وزن کل: " + cartTotalWeight().toFixed(2) + " گرم";
    saveCart();
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

  function openCheckout(){
    if(cart.length === 0 || !checkoutModal) return;
    document.getElementById("checkoutTotal").textContent = toToman(cartTotal()) + " تومان";
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
    checkoutSubmit.addEventListener("click", () => {
      const name = document.getElementById("ckName").value.trim();
      const phone = document.getElementById("ckPhone").value.trim();
      const address = document.getElementById("ckAddress").value.trim();

      const nameOk = validateField("fieldName", name.length >= 2);
      const phoneOk = validateField("fieldPhone", /^0?9\d{9}$/.test(phone.replace(/\s/g, "")));
      const addressOk = validateField("fieldAddress", address.length >= 5);
      if(!nameOk || !phoneOk || !addressOk) return;

      const lines = cart.map(l => `- ${l.product.name} × ${l.qty} — ${toToman(productPrice(l.product)*l.qty)} تومان`).join("\n");
      const message =
`سفارش جدید از ریحون گلد گالری
نام: ${name}
تماس: ${phone}
آدرس: ${address}

اقلام:
${lines}

جمع کل: ${toToman(cartTotal())} تومان`;

      const tgLink = `https://t.me/${SHOP_TELEGRAM_USERNAME}?text=${encodeURIComponent(message)}`;
      document.getElementById("checkoutTelegramLink").href = tgLink;

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
  renderTicker();
  renderSparkline();
  renderProducts();
  updateCalculator();
  renderCart();
  updateLiveIndicator();
  fetchLivePrice();
  fetchGallery();
  setInterval(updatePrice, 3000);
  setInterval(fetchLivePrice, LIVE_REFRESH_MS);
  setInterval(fetchGallery, 30000);
})();
