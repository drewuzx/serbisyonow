const ADMIN_API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));
const adminLiveSignatures = new Map();

document.addEventListener('DOMContentLoaded', () => {
 const nav = document.querySelector('.admin-module-nav');
 if (nav && !nav.querySelector('[href*="/revenue/"]')) {
  const link = document.createElement('a');
  link.href = '../revenue/revenue.html';
  link.textContent = 'Revenue & Promotions';
  nav.appendChild(link);
 }
 if (nav && !nav.querySelector('[href*="/activity/"]')) {
  const link = document.createElement('a');
  link.href = '../activity/activity.html';
  link.textContent = 'Admin Activity';
  if (window.location.pathname.includes('/activity/')) link.className = 'active';
  nav.appendChild(link);
 }
});

function adminCanRefresh() {
  return window.snLiveRefresh?.isIdle() && !document.querySelector('.admin-modal:not([hidden]), .admin-confirm-modal:not([hidden]), .admin-provider-detail[open], .sn-modal:not([hidden]), .admin-actions button:disabled, [data-feedback-status]:disabled, [data-feedback-status]:focus');
}

function adminDataChanged(key, data, { background = false } = {}) {
  if (background && !adminCanRefresh()) return false;
  const signature = JSON.stringify(data);
  const changed = signature !== adminLiveSignatures.get(key);
  adminLiveSignatures.set(key, signature);
  return !background || changed;
}

function adminLive(key, refresh) {
  document.addEventListener('DOMContentLoaded', () => {
    window.snStartLiveRefresh(`admin-${key}`, () => {
      if (!adminCanRefresh()) return;
      return refresh({ background: true });
    });
  });
}

async function adminGet(path) {
  const response = await fetch(`${ADMIN_API_BASE}${path}`, { headers: adminAuthHeaders(), credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.message || 'Failed to load admin data.'); error.status = response.status; throw error; }
  return data;
}

async function adminSend(path, { method = 'POST', body } = {}) {
  const response = await fetch(`${ADMIN_API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() },
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.message || 'Admin request failed.'); error.status = response.status; throw error; }
  return data;
}

function adminAuthHeaders() {
  try {
    const token = JSON.parse(localStorage.getItem('sn_admin_user') || 'null')?.auth_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch { return {}; }
}

async function adminViewPrivateFile(url) {
  const tab = window.open('about:blank', '_blank');
  try {
    const response = await fetch(url, { credentials: 'same-origin', headers: adminAuthHeaders(), cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to open this private document. Please sign in again.');
    const objectUrl = URL.createObjectURL(await response.blob());
    if (tab) tab.location.href = objectUrl;
    else {
      const link = document.createElement('a'); link.href = objectUrl; link.download = 'verification-document'; link.click();
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch (error) {
    tab?.close();
    window.SN?.toast?.error(error.message);
    if (!window.SN?.toast) alert(error.message);
  }
}

function adminFormatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-PH', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric', hour12: true,
    minute: '2-digit',
  });
}

function adminEscape(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function adminCategoryLabel(value = '') {
  const label = String(value || '').trim();
  const aliases = {
    'home repair': 'Repair Services',
    'home repairs': 'Repair Services',
    'home installation': 'Installation Services',
    'home installations': 'Installation Services',
  };
  return aliases[label.toLowerCase()] || label;
}

function adminVerificationStatus(status = 'pending') {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'rejected') return { className: 'rejected', label: 'Declined' };
  if (normalized === 'verified') return { className: 'verified', label: 'Verified' };
  if (normalized === 'pending') return { className: 'pending', label: 'Pending' };
  return { className: 'pending', label: normalized };
}

function adminNormalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function adminSearchRank(query, values = []) {
  const normalizedQuery = adminNormalizeSearch(query);
  if (!normalizedQuery) return 0;
  const fields = values.map(adminNormalizeSearch).filter(Boolean);
  const combined = fields.join(' ');
  const tokens = normalizedQuery.split(' ');
  const allTokensMatch = tokens.every(token => combined.includes(token));
  const digits = String(query || '').replace(/\D/g, '');
  const digitsMatch = digits.length >= 3 && values.some(value => String(value || '').replace(/\D/g, '').includes(digits));
  if (!allTokensMatch && !digitsMatch) return -1;

  let rank = allTokensMatch ? tokens.length : 0;
  if (fields.some(field => field === normalizedQuery)) rank += 100;
  if (fields.some(field => field.startsWith(normalizedQuery))) rank += 60;
  if (fields.some(field => field.includes(normalizedQuery))) rank += 30;
  if (fields[0]?.startsWith(normalizedQuery)) rank += 20;
  if (digitsMatch) rank += 40;
  return rank;
}
