'use strict';

const AUTH_API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));
let allUsers = [];
let declineResolver = null;
let selectedSearchUser = null;
let activeSuggestionIndex = -1;

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
      hour: 'numeric', hour12: true,
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
      ? `<button type="button" class="admin-file-link" data-private-file="${AUTH_API_BASE}/uploads/${uploadFolder}/${encodeURIComponent(user.id_front_file)}"><span>Identity upload</span><strong>Front ID</strong></button>`
      : 'No file';
    const backLink = user.id_back_file
      ? `<button type="button" class="admin-file-link" data-private-file="${AUTH_API_BASE}/uploads/${uploadFolder}/${encodeURIComponent(user.id_back_file)}"><span>Identity upload</span><strong>Back ID</strong></button>`
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
      <td data-label="ID">${user.id}</td>
      <td data-label="User type"><span class="role-badge ${role}">${roleLabel}</span></td>
      <td data-label="Full name">${user.full_name}</td>
      <td data-label="Email">${user.email}</td>
      <td data-label="Contact">${user.contact || '-'}</td>
      <td data-label="Account detail">${getAccountDetail(user)}</td>
      <td data-label="Uploaded IDs">${frontLink}<br>${backLink}</td>
      <td data-label="Created">${formatDate(user.created_at)}</td>
      <td data-label="Action">${actionContent}</td>
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
    if (selectedSearchUser && `${rowRole}:${user.id}` !== selectedSearchUser) return false;
    if (!query) return true;
    return adminSearchRank(query, [user.id, user.full_name, user.email, user.contact, getAccountDetail(user),
      rowRole, rowRole === 'provider' ? 'providers' : 'customers', rowStatus === 'rejected' ? 'declined' : rowStatus]) >= 0;
  });

  renderRows(filtered);
}

function renderSearchSuggestions() {
  const input = document.getElementById('search-input');
  const list = document.getElementById('search-suggestions');
  if (!input || !list) return;
  const query = input.value.trim().toLowerCase();
  const shouldShow = query.length > 0 && !selectedSearchUser;
  list.replaceChildren();
  activeSuggestionIndex = -1;
  if (!shouldShow) {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    return;
  }

  const status = document.getElementById('status-filter')?.value || 'pending';
  const role = document.getElementById('role-filter')?.value || 'all';
  const matches = allUsers.map((user) => {
    const rowStatus = getStatus(user);
    const rowRole = getRole(user);
    if (status !== 'all' && rowStatus !== status) return null;
    if (role !== 'all' && rowRole !== role) return null;
    const rank = adminSearchRank(query, [user.id, user.full_name, user.email, user.contact, getAccountDetail(user),
      getRoleLabel(user), rowStatus === 'rejected' ? 'declined' : rowStatus]);
    return rank < 0 ? null : { user, rank };
  }).filter(Boolean).sort((a, b) => b.rank - a.rank || String(a.user.full_name || '').localeCompare(String(b.user.full_name || '')))
    .slice(0, 6).map(result => result.user);

  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'user-search-empty';
    empty.textContent = 'No matching accounts';
    list.appendChild(empty);
  } else {
    matches.forEach((user, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'user-search-option';
      option.role = 'option';
      option.id = `user-search-option-${index}`;
      option.dataset.userKey = `${getRole(user)}:${user.id}`;
      option.setAttribute('aria-selected', 'false');
      const primary = document.createElement('span');
      primary.className = 'user-search-primary';
      primary.textContent = user.full_name || 'Unnamed account';
      const secondary = document.createElement('span');
      secondary.className = 'user-search-secondary';
      secondary.textContent = `ID ${user.id} | ${getRoleLabel(user)} | ${user.email || user.contact || 'No contact details'}`;
      option.append(primary, secondary);
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => {
        input.value = user.full_name || user.email || '';
        selectedSearchUser = option.dataset.userKey;
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        applyFilters();
      });
      list.appendChild(option);
    });
  }
  list.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function moveSearchSuggestion(direction) {
  const list = document.getElementById('search-suggestions');
  const options = [...(list?.querySelectorAll('.user-search-option') || [])];
  if (!options.length) return false;
  activeSuggestionIndex = (activeSuggestionIndex + direction + options.length) % options.length;
  options.forEach((option, index) => {
    option.setAttribute('aria-selected', String(index === activeSuggestionIndex));
    if (index === activeSuggestionIndex) document.getElementById('search-input')?.setAttribute('aria-activedescendant', option.id);
    if (index === activeSuggestionIndex) option.scrollIntoView({ block: 'nearest' });
  });
  return true;
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

async function loadUsers({ background = false } = {}) {
  const data = await adminGet('/api/admin/users?status=all');
  const users = Array.isArray(data.users) ? data.users : [];
  if (background && !window.snLiveRefresh?.isIdle()) return;
  if (background && document.querySelector('.sn-modal:not([hidden]), #pending-table-body button:disabled')) return;
  if (background && JSON.stringify(users) === JSON.stringify(allUsers)) return;
  allUsers = users;
  updateMetrics(allUsers);
  applyFilters();
}

async function verifyUser(userId, role, button) {
  button.disabled = true;
  button.textContent = 'Verifying...';
  try {
    await adminSend(`/api/admin/${getAdminPath(role)}/${userId}/verify`, { method: 'PATCH' });
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
    await adminSend(`/api/admin/${getAdminPath(role)}/${userId}/reject`, { method: 'PATCH' });
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

  window.snStartLiveRefresh('admin-users', () => {
    if (document.querySelector('.sn-modal:not([hidden]), #pending-table-body button:disabled')) return;
    return loadUsers({ background: true });
  });

  searchInput?.addEventListener('input', () => {
    selectedSearchUser = null;
    applyFilters();
    renderSearchSuggestions();
  });
  searchInput?.addEventListener('focus', renderSearchSuggestions);
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && moveSearchSuggestion(1)) event.preventDefault();
    else if (event.key === 'ArrowUp' && moveSearchSuggestion(-1)) event.preventDefault();
    else if (event.key === 'Enter') {
      const active = document.querySelector('#search-suggestions .user-search-option[aria-selected="true"]');
      if (active) { event.preventDefault(); active.click(); }
      else document.getElementById('search-suggestions').hidden = true;
    } else if (event.key === 'Escape') {
      document.getElementById('search-suggestions').hidden = true;
      searchInput.setAttribute('aria-expanded', 'false');
      searchInput.removeAttribute('aria-activedescendant');
    }
  });
  statusFilter?.addEventListener('change', () => { applyFilters(); renderSearchSuggestions(); });
  roleFilter?.addEventListener('change', () => { applyFilters(); renderSearchSuggestions(); });
  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.user-search')) return;
    const list = document.getElementById('search-suggestions');
    if (list) list.hidden = true;
    searchInput?.setAttribute('aria-expanded', 'false');
  });

  tableBody?.addEventListener('click', (event) => {
    const fileButton = event.target.closest('[data-private-file]');
    if (fileButton) {
      adminViewPrivateFile(fileButton.dataset.privateFile);
      return;
    }
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
