/* ============================================================
   HS_THRIFT — CLIENT-SIDE APP JS
   Handles API fetching, Cart (sessionStorage), PKR formatting,
   Toast alerts, product card rendering, scroll animations.
============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initNavbarScroll();
  initCart();
  initQuickViewModal();
  initNewsletterForm();
  initScrollReveal();
  syncGlobalStoreSettings();
});

// ── Store Settings Sync ────────────────────────────────────────
async function syncGlobalStoreSettings() {
  try {
    const cachedRaw = localStorage.getItem('hst_store_settings');
    if (cachedRaw) {
      const parsed = JSON.parse(cachedRaw);
      if (parsed.free_shipping_threshold !== undefined) {
        applyFreeShippingUI(parseInt(parsed.free_shipping_threshold) || 3500);
      }
      window.dispatchEvent(new CustomEvent('hst-settings-loaded', { detail: parsed }));
    }
  } catch (e) {}

  try {
    const res = await fetch(`/api/get-products?settings=true&_=${Date.now()}`, { cache: 'no-store' });
    const data = await res.json();
    if (data && data.success && data.settings) {
      const threshold = data.settings.free_shipping_threshold !== undefined ? parseInt(data.settings.free_shipping_threshold) : 3500;
      localStorage.setItem('hst_store_settings', JSON.stringify(data.settings));
      applyFreeShippingUI(threshold);
      window.dispatchEvent(new CustomEvent('hst-settings-loaded', { detail: data.settings }));
    }
  } catch (e) {
    console.warn('Could not sync global store settings:', e);
  }
}

function applyFreeShippingUI(thresholdVal) {
  const formatted = formatPKR(thresholdVal);
  const topBarEl = document.getElementById('topBarFreeShippingText');
  if (topBarEl) {
    topBarEl.innerHTML = `<i class="bi bi-truck me-1"></i> Free shipping on orders above ${formatted}`;
  }
  const noteEl = document.getElementById('shippingThresholdNote');
  if (noteEl) {
    noteEl.textContent = `Free shipping on orders of ${formatted} or above!`;
  }
}

// ── Currency Formatter ─────────────────────────────────────────
function formatPKR(amount) {
  const number = Math.round(Number(amount) || 0);
  return 'Rs. ' + number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
const formatRupiah = formatPKR;

// ── Toast Notification ─────────────────────────────────────────
function showToast(message, type = 'success') {
  let toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    toastContainer.style.zIndex = '1090';
    document.body.appendChild(toastContainer);
  }

  const bgMap = {
    success: 'bg-success',
    warning: 'bg-warning text-dark',
    danger: 'bg-danger',
    info: 'bg-dark'
  };
  const iconMap = {
    success: 'bi-check-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    danger: 'bi-x-circle-fill',
    info: 'bi-info-circle-fill'
  };
  const bg = bgMap[type] || 'bg-dark';
  const icon = iconMap[type] || 'bi-check-circle-fill';

  const toastHtml = `
    <div class="toast align-items-center text-white ${bg} border-0 shadow-lg rounded-3" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body py-3 px-4 fw-semibold">
          <i class="bi ${icon} me-2"></i>${message}
        </div>
        <button type="button" class="btn-close btn-close-white me-3 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;

  toastContainer.insertAdjacentHTML('beforeend', toastHtml);
  const toastEl = toastContainer.lastElementChild;
  const bsToast = new bootstrap.Toast(toastEl, { delay: 4000 });
  bsToast.show();
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

// ── Navbar Scroll Shrink ───────────────────────────────────────
function initNavbarScroll() {
  const navbar = document.querySelector('.luxury-navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 40);
    });
  }
}

// ── Cart Logic ─────────────────────────────────────────────────
function getCart() {
  try {
    const raw = sessionStorage.getItem('hst_cart');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCart(cartItems) {
  try {
    sessionStorage.setItem('hst_cart', JSON.stringify(cartItems));
  } catch (e) {
    console.error('Failed to save cart:', e);
  }
  updateCartUI();
}

function addToCart(product, quantity = 1) {
  if (!product || !product.id) return;

  if (product.stock_status === false) {
    showToast('Sorry, this item is currently out of stock.', 'warning');
    return;
  }

  let cart = getCart();
  const index = cart.findIndex(item => item.id === product.id);
  const imgSrc = product.image_url || product.image || '';
  const effectivePrice = product.effective_price || product.price;

  if (index > -1) {
    cart[index].quantity += quantity;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      slug: product.slug,
      price: effectivePrice,
      image_url: imgSrc,
      condition_rating: product.condition_rating || '9.5/10',
      size: product.size || 'M',
      quantity: quantity
    });
  }

  saveCart(cart);
  showToast(`<b>${product.name}</b> added to cart!`, 'success');

  const cartOffcanvasEl = document.getElementById('cartDrawer');
  if (cartOffcanvasEl) {
    const bsOffcanvas = bootstrap.Offcanvas.getOrCreateInstance(cartOffcanvasEl);
    bsOffcanvas.show();
  }
}

function updateCartQuantity(productId, quantity) {
  let cart = getCart();
  const index = cart.findIndex(item => item.id === productId);
  if (index > -1) {
    if (quantity <= 0) {
      cart.splice(index, 1);
    } else {
      cart[index].quantity = quantity;
    }
    saveCart(cart);
  }
}

function removeFromCart(productId) {
  let cart = getCart();
  cart = cart.filter(item => item.id !== productId);
  saveCart(cart);
  showToast('Item removed from cart.', 'info');
}

function getCartSubtotal() {
  return getCart().reduce((sum, item) => sum + (item.price * item.quantity), 0);
}

function getCartItemCount() {
  return getCart().reduce((count, item) => count + item.quantity, 0);
}

function updateCartUI() {
  const count = getCartItemCount();
  const subtotal = getCartSubtotal();

  document.querySelectorAll('.js-cart-badge').forEach(b => {
    b.textContent = count;
    b.style.display = count > 0 ? 'flex' : 'none';
  });

  const drawerContainer = document.getElementById('cartDrawerItems');
  const drawerSubtotalEl = document.getElementById('cartDrawerSubtotal');

  if (drawerSubtotalEl) {
    drawerSubtotalEl.textContent = formatPKR(subtotal);
  }

  if (drawerContainer) {
    const cart = getCart();
    if (cart.length === 0) {
      drawerContainer.innerHTML = `
        <div class="text-center py-5">
          <i class="bi bi-bag-x display-1 opacity-25"></i>
          <h5 class="mt-3 fw-bold">Your cart is empty</h5>
          <p class="text-muted small">Browse our curated thrift drops and find your perfect piece.</p>
          <a href="/shop.html" class="btn btn-luxury btn-sm mt-2">Shop Now</a>
        </div>
      `;
    } else {
      let html = '';
      cart.forEach(item => {
        html += `
          <div class="cart-item-row" data-product-id="${item.id}">
            <img src="${item.image_url}" alt="${item.name}" class="cart-item-img rounded-2">
            <div class="flex-grow-1">
              <h6 class="fw-bold mb-1" style="font-size:0.95rem; line-height:1.35;">${item.name}</h6>
              <div class="d-flex gap-2 mb-2">
                ${item.condition_rating ? `<span class="badge bg-dark fs-8 fw-bold rounded-pill">${item.condition_rating}</span>` : ''}
                ${item.size ? `<span class="badge bg-light border text-dark fs-8 fw-bold rounded-pill">${item.size}</span>` : ''}
              </div>
              <div class="text-muted small mb-2 fw-semibold">${formatPKR(item.price)}</div>
              <div class="d-flex align-items-center justify-content-between">
                <div class="d-flex align-items-center gap-2">
                  <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-0 js-drawer-qty" data-id="${item.id}" data-action="-">−</button>
                  <span class="fw-bold">${item.quantity}</span>
                  <button type="button" class="btn btn-sm btn-outline-secondary px-2 py-0 js-drawer-qty" data-id="${item.id}" data-action="+">+</button>
                </div>
                <button type="button" class="btn btn-link text-danger p-0 small js-drawer-remove" data-id="${item.id}">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>
          </div>
        `;
      });
      drawerContainer.innerHTML = html;
    }
  }
}

function initCart() {
  updateCartUI();

  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.js-add-to-cart');
    if (addBtn) {
      e.preventDefault();
      const pid = parseInt(addBtn.dataset.productId);
      const qtyInput = document.getElementById('productQtyInput');
      const quantity = qtyInput ? parseInt(qtyInput.value) || 1 : 1;

      if (addBtn.dataset.productObj) {
        try {
          const product = JSON.parse(addBtn.dataset.productObj);
          addToCart(product, quantity);
        } catch (err) {
          fetchProductAndAdd(pid, quantity);
        }
      } else {
        fetchProductAndAdd(pid, quantity);
      }
    }

    const qtyBtn = e.target.closest('.js-drawer-qty');
    if (qtyBtn) {
      const pid = parseInt(qtyBtn.dataset.id);
      const action = qtyBtn.dataset.action;
      const cart = getCart();
      const item = cart.find(i => i.id === pid);
      if (item) {
        updateCartQuantity(pid, action === '+' ? item.quantity + 1 : item.quantity - 1);
      }
    }

    const removeBtn = e.target.closest('.js-drawer-remove');
    if (removeBtn) {
      removeFromCart(parseInt(removeBtn.dataset.id));
    }
  });
}

async function fetchProductAndAdd(productId, quantity) {
  try {
    const res = await fetch(`/api/get-product?id=${productId}`);
    const data = await res.json();
    if (data.success && data.product) {
      addToCart(data.product, quantity);
    } else {
      showToast('Failed to add product to cart.', 'danger');
    }
  } catch (err) {
    showToast('Connection error. Please try again.', 'danger');
  }
}

// ── Quick View Modal ───────────────────────────────────────────
function initQuickViewModal() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.js-quickview-btn');
    if (!btn) return;
    e.preventDefault();
    const productId = btn.dataset.productId;
    let p = null;

    if (btn.dataset.productObj) {
      try { p = JSON.parse(btn.dataset.productObj); } catch(err){}
    }

    if (!p) {
      try {
        const res = await fetch(`/api/get-product?id=${productId}`);
        const data = await res.json();
        if (data.success && data.product) p = data.product;
      } catch (err) {}
    }

    if (!p) return;

    const modalEl = document.getElementById('quickViewModal');
    if (!modalEl) return;

    const isDiscounted = (p.sale_price && p.sale_price > 0 && p.sale_price < p.price) || p.is_on_sale;
    const effectivePrice = isDiscounted ? p.sale_price : (p.effective_price || p.price);

    const qvImg = document.getElementById('qvImage');
    const qvTitle = document.getElementById('qvTitle');
    const qvPrice = document.getElementById('qvPrice');
    const qvOriginalPrice = document.getElementById('qvOriginalPrice');
    const qvDesc = document.getElementById('qvDescription');
    const qvCondition = document.getElementById('qvCondition');
    const qvSize = document.getElementById('qvSize');
    const qvMaterials = document.getElementById('qvMaterials');
    const qvDetailLink = document.getElementById('qvDetailLink');
    const addBtn = document.getElementById('qvAddToCartBtn');

    if (qvImg) qvImg.src = p.image_url || p.image || '';
    if (qvTitle) qvTitle.textContent = p.name;
    if (qvPrice) qvPrice.textContent = formatPKR(effectivePrice);
    if (qvOriginalPrice) {
      qvOriginalPrice.textContent = isDiscounted ? formatPKR(p.price) : '';
      qvOriginalPrice.style.display = isDiscounted ? 'inline' : 'none';
    }
    if (qvDesc) qvDesc.textContent = p.description || p.short_description || '';
    if (qvCondition) qvCondition.textContent = p.condition_rating || '9.5/10';
    if (qvSize) qvSize.textContent = p.size || 'M';
    if (qvMaterials) qvMaterials.textContent = p.materials || 'Curated Thrift';
    if (qvDetailLink) qvDetailLink.href = `/product.html?slug=${p.slug || ''}`;
    const qvWaBtn = document.getElementById('qvWhatsAppBtn');
    if (qvWaBtn) {
      const waText = encodeURIComponent(`Hi HS_Thrift! I want to order this piece:\n\n👕 Item: ${p.name}\n📏 Size: ${p.size || 'M'}\n⭐ Condition: ${p.condition_rating || '9.5/10'}\n💰 Price: ${formatPKR(effectivePrice)}\n\nPlease confirm availability!`);
      qvWaBtn.href = `https://wa.me/92319715071?text=${waText}`;
    }
    if (addBtn) {
      addBtn.dataset.productId = p.id;
      addBtn.dataset.productObj = JSON.stringify({ id: p.id, name: p.name, slug: p.slug, price: effectivePrice, effective_price: effectivePrice, image_url: p.image_url || p.image, stock_status: p.stock_status, condition_rating: p.condition_rating, size: p.size });
    }

    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
      const bsModal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      bsModal.show();
    }
  });
}

// ── Newsletter Form ────────────────────────────────────────────
function initNewsletterForm() {
  document.querySelectorAll('.js-newsletter-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const submitBtn = form.querySelector('[type="submit"]');
      if (!input || !input.value) return;
      const originalText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '…'; }
      try {
        const res = await fetch('/api/newsletter-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: input.value.trim() })
        });
        const data = await res.json();
        showToast(data.message || 'Thanks for subscribing! 🎉', data.success ? 'success' : 'warning');
        if (data.success) form.reset();
      } catch (err) {
        showToast('Subscription failed. Please try again.', 'danger');
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
      }
    });
  });
}

// ── Scroll Reveal ─────────────────────────────────────────────
function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.product-card, .feature-pillar-card, .review-card, .collection-card').forEach(el => {
    el.classList.add('reveal-on-scroll');
    observer.observe(el);
  });
}

// ── Product Card Renderer ─────────────────────────────────────
function renderProductCardHTML(p) {
  const isOutOfStock = !p.stock_status;
  const imgSrc = p.image_url || p.image || 'https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=600&auto=format&fit=crop';
  const salePriceNum = Number(p.sale_price) || 0;
  const priceNum = Number(p.price) || 0;
  const isDiscounted = (salePriceNum > 0 && salePriceNum < priceNum) || Boolean(p.is_on_sale);
  const effectivePrice = isDiscounted ? salePriceNum : (Number(p.effective_price) || priceNum);
  const cond = p.condition_rating || '9.5/10';
  const size = p.size || 'M';
  const isPristine = cond.startsWith('10');
  const discountPercent = isDiscounted ? Math.round((1 - effectivePrice / priceNum) * 100) : 0;

  const productObj = JSON.stringify({
    id: p.id, name: p.name, slug: p.slug, price: effectivePrice,
    effective_price: effectivePrice, image_url: imgSrc, stock_status: p.stock_status,
    condition_rating: cond, size: size
  }).replace(/'/g, "&apos;").replace(/"/g, "&quot;");

  return `
    <div class="product-card h-100">
      <div class="product-image-container">
        <a href="/product.html?slug=${p.slug}" class="d-block w-100 h-100 product-img-link" aria-label="View ${p.name}">
          <img src="${imgSrc}" alt="${p.name}" loading="lazy" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1551028719-00167b16eac5?q=80&w=600&auto=format&fit=crop';">
        </a>

        <!-- Top Badges -->
        <span class="badge-condition ${isPristine ? 'cond-pristine' : 'cond-mint'}">
          <i class="bi bi-patch-check-fill"></i> ${cond}
        </span>

        ${size ? `<span class="badge-size">${size}</span>` : ''}

        <!-- Hover Quick View Button over Image -->
        <button type="button" class="card-img-quickview js-quickview-btn" data-product-id="${p.id}" data-product-obj='${productObj}' aria-label="Quick View ${p.name}">
          <i class="bi bi-eye"></i> Quick View
        </button>

        ${isOutOfStock ? `
          <div class="product-sold-overlay">
            <span class="badge bg-secondary fs-7 fw-bold px-3 py-2 rounded-pill">Sold Out</span>
          </div>
        ` : ''}
      </div>

      <div class="product-info">
        <h3 class="product-title">
          <a href="/product.html?slug=${p.slug}" class="text-decoration-none text-reset">${p.name}</a>
        </h3>

        <div class="product-price-row">
          <span class="product-price">${isOutOfStock ? 'Sold Out' : formatPKR(effectivePrice)}</span>
          ${isDiscounted && !isOutOfStock ? `
            <span class="product-original-price">${formatPKR(priceNum)}</span>
            <span class="product-discount-pill">-${discountPercent}%</span>
          ` : ''}
        </div>

        <div class="product-action-bar">
          <button type="button" class="btn-card-action-icon js-quickview-btn" data-product-id="${p.id}" data-product-obj='${productObj}' title="Quick View" aria-label="Quick View">
            <i class="bi bi-eye"></i>
          </button>
          ${!isOutOfStock ? `
            <button type="button" class="btn-card-action-main js-add-to-cart" data-product-id="${p.id}" data-product-obj='${productObj}'>
              <i class="bi bi-bag-plus me-1"></i> Add
            </button>
          ` : `
            <button class="btn-card-action-main" disabled style="opacity:0.5; cursor:not-allowed;">Sold Out</button>
          `}
        </div>
      </div>
    </div>
  `;
}

// ── Category Card Renderer ────────────────────────────────────
function renderCategoryCardHTML(cat) {
  return `
    <a href="/shop.html?category=${cat.slug}" class="collection-card text-decoration-none d-block">
      <img src="${cat.image_url || ''}" alt="${cat.name}" loading="lazy">
      <div class="collection-card-content">
        <div class="collection-card-tag">Browse Collection</div>
        <div class="collection-card-title">${cat.name}</div>
        <div style="color: #E2E8F0; font-size:0.875rem; margin-top:4px;">${cat.description ? cat.description.substring(0, 55) + '...' : ''}</div>
      </div>
    </a>
  `;
}

// ── CSS Reveal Animations ─────────────────────────────────────
const _style = document.createElement('style');
_style.textContent = `
  .reveal-on-scroll {
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 0.5s ease, transform 0.5s ease;
  }
  .reveal-on-scroll.revealed {
    opacity: 1;
    transform: translateY(0);
  }
`;
document.head.appendChild(_style);
