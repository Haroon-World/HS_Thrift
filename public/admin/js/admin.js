/**
 * admin.js — Shared JS for the HS_Thrift Admin Panel
 * Handles: JWT auth guard, API calls, store settings, order state, utilities
 */

'use strict';

// ── Constants ────────────────────────────────────────────────
const TOKEN_KEY = 'hh_admin_token';
const EMAIL_KEY = 'hh_admin_email';
const STORE_SETTINGS_KEY = 'hh_store_settings';
const ADMIN_ORDERS_KEY = 'hh_admin_orders';

const STATUS_LABELS = {
  PENDING:    { label: 'Pending',       cls: 'warning' },
  CONFIRMED:  { label: 'Confirmed',     cls: 'info' },
  PROCESSING: { label: 'Processing',    cls: 'primary' },
  READY:      { label: 'Ready to Ship', cls: 'secondary' },
  SHIPPED:    { label: 'Shipped',       cls: 'info' },
  COMPLETED:  { label: 'Completed',     cls: 'success' },
  CANCELLED:  { label: 'Cancelled',     cls: 'danger' },
};

const PAYMENT_LABELS = {
  UNPAID:   { label: 'Unpaid',   cls: 'warning' },
  PAID:     { label: 'Paid',     cls: 'success' },
  FAILED:   { label: 'Failed',   cls: 'danger' },
  REFUNDED: { label: 'Refunded', cls: 'secondary' },
};

const PAYMENT_METHOD_LABELS = {
  COD:    { label: 'Cash on Delivery', cls: 'dark' },
  ONLINE: { label: 'Online Payment',   cls: 'primary' }
};

function formatPaymentMethod(method) {
  const m = (method || 'COD').toUpperCase();
  if (m === 'ONLINE') return '<span class="badge bg-primary text-white"><i class="bi bi-bank me-1"></i> Online Payment</span>';
  return '<span class="badge bg-dark text-white"><i class="bi bi-truck me-1"></i> Cash on Delivery</span>';
}

// ── Default Store Settings (Pakistan Shipping Rates & Promo) ────
const DEFAULT_STORE_SETTINGS = {
  standard_shipping_fee: 250,
  free_shipping_threshold: 10000,
  online_payment_instructions: "Please complete the payment using your preferred bank/Easypaisa/JazzCash account and send your payment screenshot to our official WhatsApp number along with your Order ID.",
  promo_popup_enabled: false,
  promo_popup_title: "",
  promo_popup_desc: ""
};

function getStoreSettings() {
  try {
    const raw = localStorage.getItem(STORE_SETTINGS_KEY);
    return raw ? { ...DEFAULT_STORE_SETTINGS, ...JSON.parse(raw) } : DEFAULT_STORE_SETTINGS;
  } catch (e) {
    return DEFAULT_STORE_SETTINGS;
  }
}

function saveStoreSettings(settings, suppressToast = false) {
  try {
    const current = getStoreSettings();
    const merged = { ...current, ...settings };
    localStorage.setItem(STORE_SETTINGS_KEY, JSON.stringify(merged));
    if (!suppressToast) showAdminToast('Store settings updated successfully!', 'success');
  } catch (e) {
    if (!suppressToast) showAdminToast('Failed to save store settings.', 'danger');
  }
}

// ── Auth ─────────────────────────────────────────────────────
function getToken() { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY); }
function getEmail() { return sessionStorage.getItem(EMAIL_KEY) || localStorage.getItem(EMAIL_KEY); }

function saveAuth(token, email, remember = false) {
  const store = remember ? localStorage : sessionStorage;
  store.setItem(TOKEN_KEY, token);
  store.setItem(EMAIL_KEY, email);
}

function clearAuth() {
  [sessionStorage, localStorage].forEach(s => {
    s.removeItem(TOKEN_KEY);
    s.removeItem(EMAIL_KEY);
  });
}

function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = '/admin/login.html';
    return null;
  }
  const emailEl = document.getElementById('adminEmailDisplay');
  if (emailEl) emailEl.textContent = getEmail() || 'Admin';
  return token;
}

// ── Orders Storage (Offline Preview Fallback) ────────────────
const INITIAL_ADMIN_ORDERS = [
  { id: 1, order_id: 'A1001', customer_name: 'Usman Ali', customer_phone: '+923001234567', customer_address: '123 Gulberg III, Lahore', subtotal: 4800, shipping_fee: 250, total_amount: 5050, payment_method: 'COD', order_status: 'CONFIRMED', payment_status: 'PAID', created_at: new Date().toISOString() },
  { id: 2, order_id: 'A1002', customer_name: 'Sara Khan', customer_phone: '+923219876543', customer_address: 'Block 4 Clifton, Karachi', subtotal: 3200, shipping_fee: 250, total_amount: 3450, payment_method: 'ONLINE', order_status: 'SHIPPED', payment_status: 'PAID', created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 3, order_id: 'A1003', customer_name: 'Ahmad Raza', customer_phone: '+923335557788', customer_address: 'F-7 Markaz, Islamabad', subtotal: 10500, shipping_fee: 0, total_amount: 10500, payment_method: 'ONLINE', order_status: 'COMPLETED', payment_status: 'PAID', created_at: new Date(Date.now() - 172800000).toISOString() },
  { id: 4, order_id: 'A1004', customer_name: 'Fatima Zahra', customer_phone: '+923451122334', customer_address: 'Model Town, Lahore', subtotal: 2500, shipping_fee: 250, total_amount: 2750, payment_method: 'COD', order_status: 'PENDING', payment_status: 'UNPAID', created_at: new Date(Date.now() - 3600000).toISOString() }
];

function getStoredAdminOrders() {
  try {
    const raw = localStorage.getItem(ADMIN_ORDERS_KEY);
    return raw ? JSON.parse(raw) : INITIAL_ADMIN_ORDERS;
  } catch (e) {
    return INITIAL_ADMIN_ORDERS;
  }
}

function saveStoredAdminOrders(orders) {
  try {
    localStorage.setItem(ADMIN_ORDERS_KEY, JSON.stringify(orders));
  } catch (e) {
    console.error('Failed to save admin orders', e);
  }
}

// ── API Helper (Neon DB Primary Source of Truth) ──────────────
async function adminFetch(path, options = {}) {
  const token = getToken();
  try {
    const res = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        ...(options.headers || {})
      }
    });

    if (res.status === 401) {
      clearAuth();
      window.location.href = '/admin/login.html?expired=1';
      return null;
    }

    const data = await res.json().catch(() => ({ success: false, error: 'Invalid JSON response from server.' }));
    const isOk = res.ok && data && data.success !== false;

    return {
      ok: isOk,
      status: res.status,
      data: data || { success: false, error: 'Empty server response.' }
    };
  } catch (err) {
    console.error(`[Admin API Error] ${path}:`, err);
    return {
      ok: false,
      status: 0,
      data: {
        success: false,
        error: `Network Connection Error: ${err.message || 'Failed to communicate with server.'}`
      }
    };
  }
}

// ── Unmissable Error Alert ──────────────────────────────────
function showAdminErrorAlert(title, message) {
  let modal = document.getElementById('adminErrorAlertModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'adminErrorAlertModal';
    modal.className = 'admin-modal-overlay show';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
      <div class="admin-modal" style="max-width:480px;border-top:5px solid #dc3545;background:#fff;padding:1.5rem;border-radius:12px;">
        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;">
          <i class="bi bi-exclamation-octagon-fill text-danger" style="font-size:2.2rem;"></i>
          <h4 id="adminErrorAlertTitle" style="margin:0;font-weight:700;color:#991b1b;font-size:1.1rem;">SAVE FAILED — NOT SAVED TO DATABASE</h4>
        </div>
        <p id="adminErrorAlertMessage" style="font-size:.9rem;color:#374151;margin-bottom:1.5rem;line-height:1.5;"></p>
        <div style="text-align:right;">
          <button type="button" class="btn-admin-primary" style="background:#dc3545;border:none;padding:.5rem 1.25rem;font-weight:600;" onclick="document.getElementById('adminErrorAlertModal').classList.remove('show')">Acknowledge &amp; Retry</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } else {
    document.getElementById('adminErrorAlertTitle').textContent = title || 'SAVE FAILED — NOT SAVED TO DATABASE';
    document.getElementById('adminErrorAlertMessage').textContent = message || 'The server did not save your changes. Please retry.';
    modal.classList.add('show');
  }
}

// ── Format Helpers ───────────────────────────────────────────
function formatPKR(amount) {
  const number = Math.round(Number(amount) || 0);
  return 'Rs. ' + number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
const formatRp = formatPKR;

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusBadge(code, map) {
  const s = map[code] || { label: code || '—', cls: 'secondary' };
  return `<span class="badge bg-${s.cls} text-${s.cls === 'warning' ? 'dark' : 'white'}">${s.label}</span>`;
}

// ── Toast ────────────────────────────────────────────────────
function showAdminToast(msg, type = 'success') {
  let container = document.getElementById('adminToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'adminToastContainer';
    container.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:.5rem;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const color = type === 'success' ? '#155724' : type === 'danger' ? '#721c24' : '#856404';
  const bg    = type === 'success' ? '#d4edda' : type === 'danger' ? '#f8d7da' : '#fff3cd';
  toast.style.cssText = `padding:.75rem 1.25rem;border-radius:8px;font-size:.9rem;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.12);background:${bg};color:${color};max-width:360px;`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── Collapsible Sidebar Toggle Handler ───────────────────────
function toggleAdminSidebar() {
  document.body.classList.toggle('sidebar-collapsed');
  const nowCollapsed = document.body.classList.contains('sidebar-collapsed');
  try { localStorage.setItem('hh_admin_sidebar_collapsed', nowCollapsed ? 'true' : 'false'); } catch (e) {}
}
window.toggleAdminSidebar = toggleAdminSidebar;

function initSidebarToggle() {
  const isCollapsed = localStorage.getItem('hh_admin_sidebar_collapsed') === 'true';
  if (isCollapsed) {
    document.body.classList.add('sidebar-collapsed');
  }

  document.querySelectorAll('.sidebar-toggle-btn, .js-sidebar-toggle').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleAdminSidebar();
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initLogout();
  initSidebarToggle();
});
