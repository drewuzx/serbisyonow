const ADMIN_API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));

async function adminGet(path) {
  const response = await fetch(`${ADMIN_API_BASE}${path}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Failed to load admin data.');
  return data;
}

async function adminSend(path, { method = 'POST', body } = {}) {
  const response = await fetch(`${ADMIN_API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Admin request failed.');
  return data;
}

function adminFormatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-PH', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
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

function adminVerificationStatus(status = 'pending') {
  const normalized = String(status || 'pending').toLowerCase();
  if (normalized === 'rejected') return { className: 'rejected', label: 'Declined' };
  if (normalized === 'verified') return { className: 'verified', label: 'Verified' };
  if (normalized === 'pending') return { className: 'pending', label: 'Pending' };
  return { className: 'pending', label: normalized };
}
