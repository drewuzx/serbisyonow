'use strict';

const AUTH_API_BASE = (window.SN_API_BASE || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3000' : `http://${window.location.hostname}:3000`));
let allUsers = [];
let declineResolver = null;

function getStatus(user) {
  if (user.verification_status) return user.verification_status;
  return user.is_verified ? 'verified' : 'pending';
}

function getRole(user) {
  return user.role === 'provider' ? 'provider' : 'customer';
}

function getRoleLabel(user) {
  return getRole(user) === 'provider' ? 'Provider' : 'Customer';
}

function getAdminPath(role) {
  return role === 'provider' ? 'providers' : 'customers';
}

function getAccountDetail(user) {
  if (getRole(user) === 'provider') {
    return `${user.category || 'Provider'}${user.service ? ` - ${user.service}` : ''}`;
  }
  return user.id_type || 'Customer ID';
}

function formatDate(value) {
  try {
    return new Date(value).toLocaleString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value || '-';
  }
}

function updateMetrics(users) {
  const pending = users.filter((user) => getStatus(user) === 'pending').length;
  const verified = users.filter((user) => getStatus(user) === 'verified').length;
  const total = users.length;
  const now = new Date();
  const today = users.filter((user) => {
    const date = new Date(user.created_at);
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  }).length;

  const pendingEl = document.getElementById('metric-pending');
  const verifiedEl = document.getElementById('metric-verified');
  const totalEl = document.getElementById('metric-total');
  const todayEl = document.getElementById('metric-today');

  if (pendingEl) pendingEl.textContent = String(pending);
  if (verifiedEl) verifiedEl.textContent = String(verified);
  if (totalEl) totalEl.textContent = String(total);
  if (todayEl) todayEl.textContent = String(today);
}

function renderRows(users) {
  const body = document.getElementById('pending-table-body');
  const emptyState = document.getElementById('empty-state');
  const tableWrap = document.getElementById('table-wrap');
  const pendingCount = document.getElementById('pending-count');
  if (!body || !emptyState || !tableWrap || !pendingCount) return;

  pendingCount.textContent = `${users.length} shown`;
  body.innerHTML = '';

  if (!users.length) {
    tableWrap.hidden = true;
    emptyState.hidden = false;
    return;
  }

  tableWrap.hidden = false;
  emptyState.hidden = true;

  users.forEach((user) => {
    const role = getRole(user);
    const roleLabel = getRoleLabel(user);
    const uploadFolder = 'customer-ids';
    const frontLink = user.id_front_file
      ? `<a href="${AUTH_API_BASE}/uploads/${uploadFolder}/${user.id_front_file}" target="_blank" rel="noopener noreferrer">Front ID</a>`
      : 'No file';
    const backLink = user.id_back_file
      ? `<a href="${AUTH_API_BASE}/uploads/${uploadFolder}/${user.id_back_file}" target="_blank" rel="noopener noreferrer">Back ID</a>`
      : 'No file';

    const status = getStatus(user);
    let actionContent;
    if (status === 'verified') {
      actionContent = '<span class="status-badge verified">Verified</span>';
    } else if (status === 'rejected') {
      actionContent = `
        <div class="action-group">
          <span class="status-badge rejected">Declined</span>
          <button class="verify-btn" data-id="${user.id}" data-role="${role}" type="button">Verify</button>
        </div>`;
    } else {
      actionContent = `
        <div class="action-group">
          <button class="verify-btn" data-id="${user.id}" data-role="${role}" type="button">Verify</button>
          <button class="decline-btn" data-id="${user.id}" data-role="${role}" type="button">Decline</button>
        </div>`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${user.id}</td>
      <td><span class="role-badge ${role}">${roleLabel}</span></td>
      <td>${user.full_name}</td>
      <td>${user.email}</td>
      <td>${user.contact || '-'}</td>
      <td>${getAccountDetail(user)}</td>
      <td>${frontLink}<br>${backLink}</td>
      <td>${formatDate(user.created_at)}</td>
      <td>${actionContent}</td>
    `;
    body.appendChild(tr);
  });
}

function applyFilters() {
  const searchInput = document.getElementById('search-input');
  const statusFilter = document.getElementById('status-filter');
  const roleFilter = document.getElementById('role-filter');
  const query = String(searchInput?.value || '').trim().toLowerCase();
  const status = String(statusFilter?.value || 'pending');
  const role = String(roleFilter?.value || 'all');

  const filtered = allUsers.filter((user) => {
    const rowStatus = getStatus(user);
    const rowRole = getRole(user);
    if (status === 'pending' && rowStatus !== 'pending') return false;
    if (status === 'verified' && rowStatus !== 'verified') return false;
    if (status === 'rejected' && rowStatus !== 'rejected') return false;
    if (role !== 'all' && rowRole !== role) return false;
    if (!query) return true;
    const haystack = `${rowRole} ${user.full_name || ''} ${user.email || ''} ${user.contact || ''} ${getAccountDetail(user)}`.toLowerCase();
    return haystack.includes(query);
  });

  renderRows(filtered);
}

function closeDeclineModal(result) {
  const modal = document.getElementById('decline-modal');
  if (modal) modal.hidden = true;
  if (declineResolver) {
    const resolve = declineResolver;
    declineResolver = null;
    resolve(result);
  }
}

function confirmDeclineModal() {
  const modal = document.getElementById('decline-modal');
  if (!modal) return Promise.resolve(true);
  modal.hidden = false;
  return new Promise((resolve) => {
    declineResolver = resolve;
  });
}

async function loadUsers() {
  const response = await fetch(`${AUTH_API_BASE}/api/admin/users?status=all`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Failed to load users.');
  }
  allUsers = Array.isArray(data.users) ? data.users : [];
  updateMetrics(allUsers);
  applyFilters();
}

async function verifyUser(userId, role, button) {
  button.disabled = true;
  button.textContent = 'Verifying...';
  try {
    const response = await fetch(`${AUTH_API_BASE}/api/admin/${getAdminPath(role)}/${userId}/verify`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || `Failed to verify ${role}.`);
    }
    SN.toast.success(`${role === 'provider' ? 'Provider' : 'Customer'} verified.`);
    await loadUsers();
  } catch (error) {
    SN.toast.error(error.message || 'Failed to verify user.');
    button.disabled = false;
    button.textContent = 'Verify';
  }
}

async function rejectUser(userId, role, button) {
  const shouldReject = await confirmDeclineModal();
  if (!shouldReject) return;
  button.disabled = true;
  button.textContent = 'Declining...';
  try {
    const response = await fetch(`${AUTH_API_BASE}/api/admin/${getAdminPath(role)}/${userId}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || `Failed to decline ${role}.`);
    }
    SN.toast.success(`${role === 'provider' ? 'Provider' : 'Customer'} registration declined.`);
    await loadUsers();
  } catch (error) {
    SN.toast.error(error.message || 'Failed to decline user.');
    button.disabled = false;
    button.textContent = 'Decline';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('pending-table-body');
  const refreshBtn = document.getElementById('refresh-btn');
  const searchInput = document.getElementById('search-input');
  const statusFilter = document.getElementById('status-filter');
  const roleFilter = document.getElementById('role-filter');
  const modal = document.getElementById('decline-modal');
  const cancelBtn = document.getElementById('decline-cancel-btn');
  const closeBtn = document.getElementById('decline-close-btn');
  const confirmBtn = document.getElementById('decline-confirm-btn');
  const AUTO_REFRESH_MS = 10000;

  cancelBtn?.addEventListener('click', () => closeDeclineModal(false));
  closeBtn?.addEventListener('click', () => closeDeclineModal(false));
  confirmBtn?.addEventListener('click', () => closeDeclineModal(true));
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) closeDeclineModal(false);
  });

  loadUsers().catch((error) => {
    SN.toast.error(error.message || 'Failed to load users.');
  });

  refreshBtn?.addEventListener('click', () => {
    loadUsers()
      .then(() => SN.toast.success('List refreshed.'))
      .catch((error) => SN.toast.error(error.message || 'Failed to refresh.'));
  });

  setInterval(() => {
    if (document.hidden) return;
    loadUsers().catch(() => {
      // silent auto-refresh failure; user can still manually refresh
    });
  }, AUTO_REFRESH_MS);

  searchInput?.addEventListener('input', applyFilters);
  statusFilter?.addEventListener('change', applyFilters);
  roleFilter?.addEventListener('change', applyFilters);

  tableBody?.addEventListener('click', (event) => {
    const btn = event.target.closest('.verify-btn');
    if (btn) {
      verifyUser(btn.dataset.id, btn.dataset.role, btn);
      return;
    }
    const declineBtn = event.target.closest('.decline-btn');
    if (declineBtn) {
      rejectUser(declineBtn.dataset.id, declineBtn.dataset.role, declineBtn);
    }
  });
});
