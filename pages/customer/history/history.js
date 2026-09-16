const CUSTOMER_HISTORY_API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));

let historyBookings = [];
let historyFilter = 'all';
let historySortOrder = 'desc';
let selectedHistoryId = null;

function getCurrentCustomer() {
  try {
    const raw = localStorage.getItem('sn_customer_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function historyFetch(path) {
  const response = await fetch(`${CUSTOMER_HISTORY_API_BASE}${path}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Failed to load booking history.');
  return data;
}

function historyEsc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function historyMoney(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH')}`;
}

function historyDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' });
}

function historyDateTime(booking) {
  return `${historyDate(booking.scheduled_date)}${booking.scheduled_time ? ` at ${booking.scheduled_time}` : ''}`;
}

function historyStatus(value) {
  return String(value || 'pending').toLowerCase();
}

function historyStatusPill(status) {
  const normalized = historyStatus(status);
  const cls = normalized === 'completed' ? 'sn-pill--completed'
    : normalized === 'cancelled' ? 'sn-pill--cancelled'
      : 'sn-pill--active';
  return `<span class="sn-status-pill ${cls}">${historyEsc(normalized)}</span>`;
}

function historyAvatarClass(index) {
  return `sn-hi-avatar--${(index % 5) + 1}`;
}

function historyVisibleBookings() {
  const query = document.getElementById('history-search')?.value.trim().toLowerCase() || '';
  return historyBookings
    .filter((booking) => historyFilter === 'all' || historyStatus(booking.status) === historyFilter)
    .filter((booking) => {
      const haystack = `${booking.provider_name || ''} ${booking.service || ''} ${booking.address || ''} ${booking.status || ''}`.toLowerCase();
      return !query || haystack.includes(query);
    })
    .sort((a, b) => {
      const first = new Date(`${a.scheduled_date || ''} ${a.scheduled_time || ''}`).getTime() || 0;
      const second = new Date(`${b.scheduled_date || ''} ${b.scheduled_time || ''}`).getTime() || 0;
      return historySortOrder === 'asc' ? first - second : second - first;
    });
}

function renderHistoryItem(booking, index, active) {
  const avatarClass = historyAvatarClass(index);
  const reason = historyStatus(booking.status) === 'cancelled' ? '<div class="sn-hi-reason">Reason: Cancelled booking</div>' : '';
  return `
    <button class="sn-history-item ${active ? 'active' : ''}" type="button" data-id="${historyEsc(booking.id)}" data-status="${historyEsc(booking.status)}">
      <div class="sn-hi-avatar ${avatarClass}"></div>
      <div class="sn-hi-info">
        <div class="sn-hi-name">${historyEsc(booking.provider_name || 'Service Provider')}</div>
        <div class="sn-hi-meta">${historyEsc(booking.service || 'Service')} - ${historyEsc(historyDate(booking.scheduled_date))}</div>
        <div class="sn-hi-amount">Total Amount <strong>${historyMoney(booking.amount)}</strong></div>
        ${reason}
      </div>
      ${historyStatusPill(booking.status)}
    </button>
  `;
}

function showHistoryEmpty(title, subtitle) {
  const panel = document.getElementById('sn-detail-panel');
  const empty = document.getElementById('sn-detail-empty');
  if (panel) {
    panel.style.display = '';
    [...panel.children].forEach((child) => {
      if (child !== empty) child.hidden = true;
    });
  }
  if (empty) {
    empty.style.display = 'flex';
    empty.querySelector('.sn-empty-title').textContent = title;
    empty.querySelector('.sn-empty-sub').textContent = subtitle;
  }
}

function setHistoryEmpty(message) {
  const list = document.getElementById('sn-history-list');
  if (list) list.innerHTML = `<div class="sn-history-empty">${historyEsc(message)}</div>`;
  showHistoryEmpty('Select a booking', 'Completed and cancelled bookings will appear here once you have real activity.');
}

function showHistoryDetailPanel() {
  const panel = document.getElementById('sn-detail-panel');
  const empty = document.getElementById('sn-detail-empty');
  if (panel) {
    panel.style.display = '';
    [...panel.children].forEach((child) => {
      if (child !== empty) child.hidden = false;
    });
  }
  if (empty) empty.style.display = 'none';
}

function goToProviderPage(booking, page) {
  const id = encodeURIComponent(booking.provider_id || '');
  if (page === 'booking') window.location.href = `../bookings/bookings.html?provider_id=${id}`;
  else if (page === 'message') window.location.href = `../inbox/inbox.html?provider_id=${id}`;
  else window.location.href = `../provider-profile/provider-profile.html?id=${id}`;
}

function populateDetail(booking, index = 0) {
  if (!booking) {
    showHistoryEmpty('No booking selected', 'Choose a booking on the left to view details.');
    return;
  }

  showHistoryDetailPanel();
  const isCompleted = historyStatus(booking.status) === 'completed';
  const avatarClass = historyAvatarClass(index);
  document.getElementById('detail-avatar').className = `sn-detail-avatar ${avatarClass}`;
  document.getElementById('detail-provider-name').textContent = booking.provider_name || 'Service Provider';
  document.getElementById('detail-booking-id').textContent = `Booking ID: #SN-${String(booking.id).padStart(5, '0')}`;
  document.getElementById('detail-service-tag').textContent = booking.service || 'Service';
  document.getElementById('detail-date').textContent = historyDateTime(booking);
  document.getElementById('detail-service').textContent = booking.service || '-';
  document.getElementById('detail-address').textContent = booking.address || '-';
  document.getElementById('detail-amount').textContent = historyMoney(booking.amount);
  document.getElementById('detail-payment').textContent = booking.payment_method || 'cash';
  document.getElementById('detail-status-badge').innerHTML = historyStatusPill(booking.status);
  document.getElementById('detail-card-avatar').className = `sn-provider-info-avatar ${avatarClass}`;
  document.getElementById('detail-card-name').textContent = booking.provider_name || 'Service Provider';

  const verifiedBadge = document.getElementById('detail-verified');
  if (verifiedBadge) verifiedBadge.style.display = '';

  const banner = document.getElementById('sn-completion-banner');
  const bannerTitle = document.getElementById('banner-title');
  const bannerSub = document.getElementById('banner-sub');
  if (banner) {
    banner.style.display = '';
    banner.className = isCompleted ? 'sn-completion-banner' : 'sn-completion-banner sn-completion-banner--cancelled';
  }
  if (bannerTitle) bannerTitle.textContent = isCompleted ? 'This booking has been completed.' : 'This booking was cancelled.';
  if (bannerSub) bannerSub.textContent = isCompleted ? 'This service is now part of your booking history.' : 'Cancelled bookings remain visible for your records.';

  const completedRow = document.getElementById('detail-completed-row');
  const reasonRow = document.getElementById('detail-reason-row');
  if (completedRow) completedRow.style.display = isCompleted ? '' : 'none';
  if (reasonRow) reasonRow.classList.toggle('sn-dr--hidden', isCompleted);
  document.getElementById('detail-completed-at').textContent = historyDateTime(booking);
  document.getElementById('detail-reason').textContent = isCompleted ? '-' : 'Cancelled booking';

  const profileButton = document.querySelector('.sn-provider-info-card .sn-btn');
  const actionButtons = [...document.querySelectorAll('.sn-cust-actions .sn-btn')];
  if (profileButton) profileButton.onclick = () => goToProviderPage(booking, 'profile');
  if (actionButtons[0]) actionButtons[0].onclick = () => goToProviderPage(booking, 'profile');
  if (actionButtons[1]) actionButtons[1].onclick = () => goToProviderPage(booking, 'booking');
  if (actionButtons[2]) actionButtons[2].onclick = () => goToProviderPage(booking, 'message');
}

function renderHistoryList() {
  const list = document.getElementById('sn-history-list');
  if (!list) return;
  const visible = historyVisibleBookings();
  if (!visible.length) {
    setHistoryEmpty(historyBookings.length ? 'No bookings match your filter.' : 'No completed or cancelled bookings yet.');
    return;
  }

  const selectedExists = visible.some((booking) => String(booking.id) === String(selectedHistoryId));
  if (!selectedExists) selectedHistoryId = visible[0].id;
  list.innerHTML = visible.map((booking, index) => renderHistoryItem(booking, index, String(booking.id) === String(selectedHistoryId))).join('');

  const selected = visible.find((booking) => String(booking.id) === String(selectedHistoryId)) || visible[0];
  populateDetail(selected, visible.indexOf(selected));
}

function attachHistoryShell(customer) {
  const status = customer?.verification_status || 'pending';
  const userName = document.getElementById('sn-user-name');
  const userStatus = document.getElementById('sn-user-status');
  if (userName) userName.textContent = customer?.full_name || 'Customer';
  if (userStatus) userStatus.textContent = status === 'verified' ? 'Verified customer' : status === 'rejected' ? 'Verification declined' : 'Awaiting verification';

  const shell = document.getElementById('sn-shell');
  const overlay = document.getElementById('sn-overlay');
  const hamburger = document.getElementById('sn-hamburger');
  const hamburgerTop = document.getElementById('sn-hamburger-top');
  const logoutBtn = document.getElementById('sn-logout');

  function isMobile() { return window.matchMedia('(max-width: 940px)').matches; }
  function closeSidebar() { shell?.classList.remove('sidebar-open'); shell?.classList.add('sidebar-collapsed'); document.body.style.overflow = ''; }
  function openSidebar() { shell?.classList.remove('sidebar-collapsed'); shell?.classList.add('sidebar-open'); if (isMobile()) document.body.style.overflow = 'hidden'; }
  function toggleSidebar() {
    if (!shell) return;
    const open = shell.classList.contains('sidebar-open') || !shell.classList.contains('sidebar-collapsed');
    if (open) closeSidebar(); else openSidebar();
  }

  hamburger?.addEventListener('click', toggleSidebar);
  hamburgerTop?.addEventListener('click', toggleSidebar);
  overlay?.addEventListener('click', () => { if (isMobile()) closeSidebar(); });
  logoutBtn?.addEventListener('click', () => {
    logoutBtn.disabled = true;
    logoutBtn.querySelector('span:last-child').textContent = 'Logging out...';
    window.setTimeout(() => {
      localStorage.removeItem('sn_customer_user');
      window.location.href = '../../landing/index.html';
    }, 350);
  });
  if (isMobile()) closeSidebar(); else openSidebar();
}

document.addEventListener('DOMContentLoaded', async () => {
  const currentCustomer = getCurrentCustomer();
  if (!currentCustomer) {
    window.location.href = '../../auth/customerLogin.html';
    return;
  }

  const list = document.getElementById('sn-history-list');
  if (list) list.innerHTML = '<div class="sn-history-empty">Loading booking history...</div>';
  showHistoryEmpty('Loading history', 'Your completed and cancelled bookings will appear here.');

  try {
    const statusData = await historyFetch(`/api/auth/customer/status/${currentCustomer.id}`);
    if (statusData.user) {
      Object.assign(currentCustomer, statusData.user);
      localStorage.setItem('sn_customer_user', JSON.stringify(currentCustomer));
    }
  } catch {
    // Keep cached user data usable if the API is temporarily unreachable.
  }

  attachHistoryShell(currentCustomer);

  document.querySelectorAll('.sn-filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sn-filter-tab').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      historyFilter = tab.dataset.filter || 'all';
      renderHistoryList();
    });
  });
  document.getElementById('history-search')?.addEventListener('input', renderHistoryList);
  document.getElementById('sort-asc')?.addEventListener('click', () => {
    historySortOrder = 'asc';
    document.getElementById('sort-asc')?.classList.add('active');
    document.getElementById('sort-desc')?.classList.remove('active');
    renderHistoryList();
  });
  document.getElementById('sort-desc')?.addEventListener('click', () => {
    historySortOrder = 'desc';
    document.getElementById('sort-desc')?.classList.add('active');
    document.getElementById('sort-asc')?.classList.remove('active');
    renderHistoryList();
  });
  document.getElementById('sn-history-list')?.addEventListener('click', (event) => {
    const item = event.target.closest('.sn-history-item');
    if (!item) return;
    selectedHistoryId = item.dataset.id;
    renderHistoryList();
  });
  document.getElementById('sn-banner-close')?.addEventListener('click', () => {
    document.getElementById('sn-completion-banner').style.display = 'none';
  });

  try {
    const data = await historyFetch(`/api/customer/${currentCustomer.id}/dashboard`);
    historyBookings = (data.bookings || []).filter((booking) => ['completed', 'cancelled'].includes(historyStatus(booking.status)));
    renderHistoryList();
  } catch (error) {
    setHistoryEmpty(error.message || 'Unable to load booking history.');
  }
});
