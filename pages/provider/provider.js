(function snLoadFloatingChat() {
  if (document.querySelector('script[src*="floating-chat.js"]')) return;
  const script = document.createElement('script');
  script.src = '/shared/js/floating-chat.js';
  script.defer = true;
  document.head.appendChild(script);
})();

function getProviderUser() {
  try {
    return JSON.parse(localStorage.getItem('sn_provider_user') || 'null');
  } catch {
    return null;
  }
}

const PROVIDER_API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));
let providerLocationWatchId = null;
let providerBookingMap = null;
let providerBookingMapLayer = null;
let providerRouteLayer = null;
let providerRouteLine = null;
let providerNavMarker = null;
let selectedProviderBookingId = null;
let providerNavBooking = null;
let providerDirectionsRequestId = 0;
let providerRequestsGpsRefreshStarted = false;
let providerDashboardRefreshActive = false;
let providerNotificationRefreshActive = false;
let lastProviderGpsPayload = { at: 0, lat: null, lng: null };
let lastProviderRouteKey = '';

async function providerGet(path) {
  const response = await fetch(`${PROVIDER_API_BASE}${path}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Failed to load provider data.');
  return data;
}

async function providerSend(path, method, body) {
  const response = await fetch(`${PROVIDER_API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
}

async function providerSendForm(path, method, body) {
  const response = await fetch(`${PROVIDER_API_BASE}${path}`, {
    method,
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Request failed.');
  return data;
}

async function getAvailableServiceCategories() {
  try {
    const data = await providerGet('/api/categories');
    return Array.isArray(data.categories) ? data.categories.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH')}`;
}

function providerCategoryLabel(value) {
  const label = String(value || '').trim();
  const aliases = {
    'home repair': 'Repair Services',
    'home repairs': 'Repair Services',
    'home installation': 'Installation Services',
    'home installations': 'Installation Services',
  };
  return aliases[label.toLowerCase()] || label;
}

let activeProviderReassessmentQuestions = [];

function providerAssessmentBanks() {
  return {
    fallback: window.SN_PROVIDER_ASSESSMENT_FALLBACK || [],
    banks: window.SN_PROVIDER_ASSESSMENT_BANKS || {},
  };
}

function providerAssessmentCanonicalCategory(value) {
  const normalized = providerCategoryLabel(value);
  const aliases = {
    Repairs: 'Repair Services',
    Cleaning: 'Cleaning',
    'Cleaning Services': 'Cleaning',
    'Personal Care': 'Personal Care',
    'Appliance Repair': 'Appliance Maintenance',
    'Appliance Maintenance': 'Appliance Maintenance',
    Installation: 'Installation Services',
    'Installation Services': 'Installation Services',
    'Outdoor Maintenance': 'Outdoor and Property Maintenance',
    'Outdoor and Property Maintenance': 'Outdoor and Property Maintenance',
  };
  return aliases[normalized] || normalized;
}

function normalizeProviderAssessmentText(value) {
  return String(value || '').trim().toLowerCase();
}

function providerAssessmentCategoryFromService(value) {
  const target = normalizeProviderAssessmentText(value);
  const servicesByCategory = window.SN_PROVIDER_SERVICES_BY_CATEGORY || {};
  if (!target) return '';

  for (const [category, services] of Object.entries(servicesByCategory)) {
    const categoryText = normalizeProviderAssessmentText(category);
    if (categoryText === target) return category;

    const match = (Array.isArray(services) ? services : []).some((service) => {
      const serviceText = normalizeProviderAssessmentText(service);
      return serviceText === target || serviceText.includes(target) || target.includes(serviceText);
    });
    if (match) return category;
  }
  return '';
}

function resolveProviderAssessmentCategory(provider = {}, assessment = {}) {
  const { banks } = providerAssessmentBanks();
  const candidates = [
    provider.category,
    assessment?.category,
    provider.service,
  ].map(providerAssessmentCanonicalCategory).filter(Boolean);

  for (const candidate of candidates) {
    if (banks[candidate]) return candidate;
  }

  for (const value of [provider.category, assessment?.category, provider.service]) {
    const category = providerAssessmentCategoryFromService(value);
    if (category && banks[category]) return category;
  }

  return candidates[0] || 'General';
}

function providerAssessmentBank(category) {
  const { fallback, banks } = providerAssessmentBanks();
  const normalized = providerAssessmentCanonicalCategory(category);
  return banks[normalized] || fallback;
}

function shuffleProviderAssessment(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function shortDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' });
}

function shortDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-PH', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function providerPageHref(page) {
  return `../${page}/${page}.html`;
}

function providerNotificationItems(data) {
  const messages = (data.messages || []).filter((message) => message.sender_role === 'customer').slice(0, 5).map((message) => ({
    id: `message-${message.id}`,
    kind: 'Message',
    title: message.customer_name || 'Customer',
    body: message.message || 'New customer message.',
    time: message.created_at,
    href: `../dashboard/dashboard.html#messages=${message.customer_id}`,
  }));
  const bookings = (data.bookings || []).slice(0, 5).map((booking) => ({
    id: `booking-${booking.id}-${booking.status}`,
    kind: 'Booking',
    title: booking.customer_name || 'Booking request',
    body: `${booking.service || 'Service'} is ${booking.status || 'pending'}.`,
    time: booking.created_at,
    href: providerPageHref('requests'),
  }));
  return [...messages, ...bookings]
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
    .slice(0, 8);
}

function providerUnreadMessages(data) {
  return (data.messages || []).filter((message) => message.sender_role === 'customer' && !message.is_read).length;
}

function providerPendingBookings(data) {
  return (data.bookings || []).filter((booking) => String(booking.status || '').toLowerCase() === 'pending').length;
}

function storedNoticeList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function providerSeenNoticeKey(providerId) {
  return `sn_provider_seen_notifications_${providerId}`;
}

function providerUnseenNotices(providerId, items) {
  const seen = new Set(storedNoticeList(providerSeenNoticeKey(providerId)).map(String));
  return items.filter((item) => !seen.has(String(item.id)));
}

function markProviderNoticesSeen(providerId, items) {
  const key = providerSeenNoticeKey(providerId);
  const seen = new Set(storedNoticeList(key).map(String));
  items.forEach((item) => seen.add(String(item.id)));
  localStorage.setItem(key, JSON.stringify([...seen].slice(-150)));
}

function setProviderCountBadge(target, count, label = 'new notifications') {
  if (!target) return;
  target.classList.add('sn-has-count-badge');
  target.querySelector('.sn-dot')?.setAttribute('hidden', '');
  let badge = target.querySelector('.sn-badge-count');
  if (count <= 0) {
    badge?.remove();
    target.removeAttribute('data-count');
    target.removeAttribute('aria-label');
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'sn-badge-count';
    target.appendChild(badge);
  }
  badge.textContent = count > 99 ? '99+' : String(count);
  target.dataset.count = String(count);
  target.setAttribute('aria-label', `${count} ${label}`);
}

function updateProviderNotificationBadges(data, notificationCountOverride = null) {
  const unreadMessages = providerUnreadMessages(data);
  const pendingBookings = providerPendingBookings(data);
  const notificationCount = notificationCountOverride ?? (unreadMessages + pendingBookings);
  const messageButton = document.querySelector('.sn-topbar-right [title*="Message"], .sn-topbar-right [title*="message"]');
  const notificationButton = document.getElementById('sn-notification-button')
    || document.querySelector('.sn-topbar-right [title*="Notification"], .sn-topbar-right [title*="notification"]');
  setProviderCountBadge(messageButton, unreadMessages, 'unread messages');
  setProviderCountBadge(notificationButton, notificationCount, 'new notifications');
  setProviderCountBadge(document.querySelector('.sn-nav-item[href*="inbox"]'), unreadMessages, 'unread messages');
  setProviderCountBadge(document.querySelector('.sn-nav-item[href*="requests"]'), pendingBookings, 'pending bookings');
  return { unreadMessages, pendingBookings, notificationCount };
}

function showProviderToast(item) {
  let host = document.getElementById('sn-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'sn-toast-host';
    host.className = 'sn-toast-host';
    document.body.appendChild(host);
  }
  const toast = document.createElement('button');
  toast.className = 'sn-live-toast';
  toast.type = 'button';
  toast.innerHTML = `<strong>${esc(item.kind)}: ${esc(item.title)}</strong><span>${esc(item.body)}</span>`;
  toast.addEventListener('click', () => { window.location.href = item.href; });
  host.appendChild(toast);
  window.setTimeout(() => toast.remove(), 5200);
}

function renderProviderNotificationPanel(items, unseenIds = new Set()) {
  const panel = document.getElementById('sn-notification-panel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="sn-notification-head">
      <strong>Notifications</strong>
      <span>${unseenIds.size ? `${unseenIds.size} new` : `${items.length} update${items.length === 1 ? '' : 's'}`}</span>
    </div>
    <div class="sn-notification-list">
      ${items.map((item) => `
        <a class="sn-notification-item ${unseenIds.has(String(item.id)) ? 'is-unseen' : ''}" href="${item.href}">
          <span class="sn-notification-kind">${esc(item.kind)}</span>
          <strong>${esc(item.title)}</strong>
          <small>${esc(item.body)}</small>
        </a>
      `).join('') || '<p class="sn-notification-empty">No notifications yet.</p>'}
    </div>
  `;
}

function attachProviderTopbarRealtime(provider) {
  const topbar = document.querySelector('.sn-topbar');
  const right = topbar?.querySelector('.sn-topbar-right');
  if (!topbar || !right || document.getElementById('sn-notification-panel')) return;

  const messageButton = right.querySelector('[title*="Message"], [title*="message"]');
  const notificationButton = right.querySelector('[title*="Notification"], [title*="notification"]');
  messageButton?.classList.add('sn-topbar-message-btn');
  notificationButton?.classList.add('sn-topbar-notification-btn');
  messageButton?.addEventListener('click', (event) => {
    event.preventDefault();
    if (window.snFloatingChat) window.snFloatingChat.toggleList();
    else window.location.href = '../dashboard/dashboard.html#messages';
  });
  if (messageButton) messageButton.setAttribute('aria-label', 'Open messages');
  if (notificationButton) {
    notificationButton.id = 'sn-notification-button';
    notificationButton.type = 'button';
    notificationButton.setAttribute('aria-label', 'Open notifications');
    notificationButton.setAttribute('aria-expanded', 'false');
  }

  const panel = document.createElement('section');
  panel.id = 'sn-notification-panel';
  panel.className = 'sn-notification-panel';
  panel.hidden = true;
  topbar.after(panel);

  notificationButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const isOpen = panel.hidden;
    panel.hidden = !isOpen;
    notificationButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      const latestData = handleProviderNotifications.latestData || {};
      markProviderNoticesSeen(provider.id, providerNotificationItems(latestData));
      handleProviderNotifications(latestData, false);
    }
  });
  document.addEventListener('click', (event) => {
    if (panel.hidden || event.target.closest('#sn-notification-panel') || event.target.closest('#sn-notification-button')) return;
    panel.hidden = true;
    notificationButton?.setAttribute('aria-expanded', 'false');
  });

  startProviderNotificationRealtime(provider);
}

function handleProviderNotifications(data, notify = false) {
  const provider = getProviderUser();
  if (!provider?.id) return;
  const notificationButton = document.getElementById('sn-notification-button');
  const dot = notificationButton?.querySelector('.sn-dot');
  handleProviderNotifications.latestData = data || {};
  const items = providerNotificationItems(data);
  const unseenItems = providerUnseenNotices(provider.id, items);
  const unseenIds = new Set(unseenItems.map((item) => String(item.id)));
  renderProviderNotificationPanel(items, unseenIds);
  const counts = updateProviderNotificationBadges(data, unseenItems.length);
  if (dot) dot.hidden = counts.notificationCount <= 0;

  const key = `sn_provider_latest_notice_${provider.id}`;
  const latestKey = localStorage.getItem(key) || '';
  const newest = unseenItems[0];
  if (newest?.id && newest.id !== latestKey) {
    if (notify) showProviderToast(newest);
    localStorage.setItem(key, newest.id);
  }
}

function startProviderNotificationRealtime(provider) {
  if (providerNotificationRefreshActive || !provider?.id) return;
  providerNotificationRefreshActive = true;
  window.snProviderNotificationTimer = window.setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const data = await providerGet(`/api/provider/${provider.id}/dashboard`);
      handleProviderNotifications(data, true);
    } catch (error) {
      console.warn(error.message || error);
    }
  }, 5000);
  window.addEventListener('beforeunload', () => window.clearInterval(window.snProviderNotificationTimer));
}

function openProviderModal({ title, message = '', label = '', value = '', placeholder = '', multiline = false, confirmText = 'Save', cancelText = 'Cancel', danger = false, options = [] }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'sn-modal-backdrop';
    const inputMarkup = label ? `
      <label class="sn-modal-field">
        <span>${esc(label)}</span>
        ${multiline
          ? `<textarea class="sn-modal-input" rows="4" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
          : options.length
            ? `<select class="sn-modal-input">
                ${options.map((option) => `<option value="${esc(option)}" ${String(option) === String(value) ? 'selected' : ''}>${esc(option)}</option>`).join('')}
              </select>`
            : `<input class="sn-modal-input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" />`}
      </label>
    ` : '';

    backdrop.innerHTML = `
      <section class="sn-modal" role="dialog" aria-modal="true" aria-labelledby="sn-modal-title">
        <div class="sn-provider-modal-icon ${danger ? 'is-danger' : 'is-info'}">${danger ? '!' : 'i'}</div>
        <div class="sn-modal-head">
          <h2 id="sn-modal-title">${esc(title)}</h2>
          <button class="sn-modal-close" type="button" aria-label="Close">×</button>
        </div>
        ${message ? `<p class="sn-modal-message">${esc(message)}</p>` : ''}
        ${inputMarkup}
        <div class="sn-modal-actions">
          <button class="btn btn-outline" type="button" data-modal-cancel>${esc(cancelText)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-modal-confirm>${esc(confirmText)}</button>
        </div>
      </section>
    `;

    const field = backdrop.querySelector('.sn-modal-input');
    const close = (result) => {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      resolve(result);
    };
    const submitModal = () => {
      if (!field) return close(true);
      const nextValue = field.tagName === 'SELECT' ? field.value : field.value.trim();
      close(nextValue || (typeof value === 'string' ? value : ''));
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') close(null);
      if (!multiline && event.key === 'Enter' && field) submitModal();
      if (multiline && event.key === 'Enter' && event.ctrlKey && field) submitModal();
    };

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(null);
    });
    backdrop.querySelector('.sn-modal-close')?.addEventListener('click', () => close(null));
    backdrop.querySelector('[data-modal-cancel]')?.addEventListener('click', () => close(null));
    backdrop.querySelector('[data-modal-confirm]')?.addEventListener('click', submitModal);
    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => field?.focus());
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const provider = getProviderUser();
  if (!provider?.id) {
    window.location.href = '../../auth/providerLogin.html';
    return;
  }
  const userName = document.getElementById('sn-user-name');
  const userStatus = document.getElementById('sn-user-status');
  const shell = document.querySelector('.sn-shell');
  const overlay = document.getElementById('sn-overlay');

  function escapeAttr(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const providerNav = [
    { key: 'dashboard', label: 'Dashboard', href: '../dashboard/dashboard.html', icon: '&#127968;' },
    { key: 'services', label: 'Service', href: '../services/services.html', icon: '&#128736;' },
    { key: 'requests', label: 'Bookings', href: '../requests/requests.html', icon: '&#128197;' },
    { key: 'schedule', label: 'Schedules', href: '../schedule/schedule.html', icon: '&#128198;' },
    { key: 'reviews', label: 'Reviews', href: '../reviews/reviews.html', icon: '&#11088;' },
    { key: 'history', label: 'History', href: '../history/history.html', icon: '&#128344;' },
    { key: 'assessment', label: 'Skill Status', href: '../assessment/assessment.html', icon: '&#9989;' },
    { key: 'profile', label: 'Profile', href: '../profile/profile.html', icon: '&#128100;' },
  ];

  const nav = document.querySelector('.sn-nav');
  if (nav) {
    const path = window.location.pathname;
    nav.innerHTML = providerNav.map(item => {
      const isActive = path.includes(`/provider/${item.key}/`);
      return `<a class="sn-nav-item ${isActive ? 'active' : ''}" href="${item.href}"><span class="sn-ico">${item.icon}</span><span>${item.label}</span></a>`;
    }).join('') + `
      <div class="sn-nav-sep" role="separator"></div>
      <button class="sn-nav-item sn-nav-item--danger" id="sn-logout" type="button"><span class="sn-ico">&#128682;</span><span>Logout</span></button>
    `;
  }

  const topbar = document.querySelector('.sn-topbar');
  if (topbar) {
    const isDashboard = window.location.pathname.includes('/provider/dashboard/');
    const existingSearch = topbar.querySelector('.sn-topbar-search input');
    const placeholder = escapeAttr(existingSearch?.getAttribute('placeholder') || 'Search bookings, customers...');

    topbar.classList.toggle('no-search', isDashboard);
    topbar.innerHTML = `
      <button class="sn-hamburger sn-hamburger--top" id="sn-hamburger-top" type="button" aria-label="Open menu">
        <span></span><span></span><span></span>
      </button>
      ${isDashboard ? '' : `
      <div class="sn-topbar-search">
        <span class="sn-topbar-search-ico">&#128269;</span>
        <input id="sn-global-search" type="search" placeholder="${placeholder}" />
        <button class="sn-topbar-pill" type="button" title="Filters">&#9881;</button>
      </div>`}
      <div class="sn-topbar-right">
        <button class="sn-icon-btn" type="button" title="Messages">&#128172;</button>
        <button class="sn-icon-btn" type="button" title="Notifications">&#128276;<span class="sn-dot"></span></button>
        <div class="sn-avatar" aria-hidden="true"></div>
      </div>
    `;
  }

  if (userName) userName.textContent = provider?.full_name || 'Service Provider';
  if (userStatus) {
    const status = provider?.verification_status || (provider?.is_verified ? 'verified' : 'pending');
    userStatus.textContent = status === 'verified' ? 'Verified provider' : 'Awaiting provider verification';
  }

  function isMobile() {
    return window.matchMedia('(max-width: 940px)').matches;
  }

  function closeSidebar() {
    shell?.classList.remove('sidebar-open');
    shell?.classList.add('sidebar-collapsed');
    document.body.style.overflow = '';
  }

  function openSidebar() {
    shell?.classList.remove('sidebar-collapsed');
    shell?.classList.add('sidebar-open');
    if (isMobile()) document.body.style.overflow = 'hidden';
  }

  function toggleSidebar() {
    const open = shell?.classList.contains('sidebar-open') || !shell?.classList.contains('sidebar-collapsed');
    open ? closeSidebar() : openSidebar();
  }

  document.getElementById('sn-hamburger')?.addEventListener('click', toggleSidebar);
  document.getElementById('sn-hamburger-top')?.addEventListener('click', toggleSidebar);
  overlay?.addEventListener('click', closeSidebar);
  window.addEventListener('resize', () => {
    if (isMobile()) closeSidebar();
  });

  document.getElementById('sn-logout')?.addEventListener('click', () => {
    localStorage.removeItem('sn_provider_user');
    window.location.href = '../../auth/providerLogin.html';
  });

  if (isMobile()) closeSidebar();

  attachProviderTopbarRealtime(provider);
  loadProviderDatabase();
  startProviderBackgroundLiveGps();
  if (window.location.pathname.includes('/provider/dashboard/')) {
    startProviderDashboardRealtime();
  }
});

async function loadProviderDatabase() {
  const provider = getProviderUser();
  if (!provider?.id) return;

  try {
    const data = await providerGet(`/api/provider/${provider.id}/dashboard`);
    const path = window.location.pathname;
    handleProviderNotifications(data, false);

    renderProviderMetrics(data);
    renderProviderEarnings(data);
    if (path.includes('/dashboard/')) renderProviderDashboardAnalytics(data);
    if (path.includes('/services/')) renderServices(data.services || []);
    if (path.includes('/requests/')) {
      renderRequests(data.bookings || [], data.provider || provider);
      refreshProviderGpsForRequests();
    }
    if (path.includes('/schedule/')) renderSchedule(data.availability || [], data.bookings || []);
    if (path.includes('/inbox/')) renderInbox(data.messages || []);
    if (path.includes('/assessment/')) renderAssessment(data.assessment, data.metrics);
    if (path.includes('/reviews/')) renderReviews(data.reviews || [], data.metrics);
    if (path.includes('/history/')) renderHistory(data.history_bookings || data.bookings || []);
    if (path.includes('/profile/')) renderProfile(data.provider || provider, data.metrics, data.assessment);
  } catch (error) {
    console.warn(error.message || error);
  }
}

function sumCompletedEarningsSince(bookings, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return (bookings || []).reduce((acc, booking) => {
    if (String(booking.status || '').toLowerCase() !== 'completed') return acc;
    const stamp = new Date(booking.updated_at || booking.scheduled_date || booking.created_at).getTime();
    if (!Number.isFinite(stamp) || stamp < cutoff) return acc;
    return {
      amount: acc.amount + Number(booking.amount || 0),
      jobs: acc.jobs + 1,
    };
  }, { amount: 0, jobs: 0 });
}

function liveClockLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function bookingDayStamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  date.setHours(0, 0, 0, 0);
  return date.toDateString();
}

function lastSevenLiveDays() {
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    days.push({
      key: date.toDateString(),
      label: date.toLocaleDateString('en-PH', { weekday: 'short' }),
      date,
    });
  }
  return days;
}

function bookingResponseRate(bookings, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const pool = (bookings || []).filter((booking) => {
    const stamp = new Date(booking.created_at || booking.scheduled_date).getTime();
    return Number.isFinite(stamp) && stamp >= cutoff;
  });
  const source = pool.length ? pool : (bookings || []);
  if (!source.length) return 0;
  const acted = source.filter((booking) => String(booking.status || '').toLowerCase() !== 'pending').length;
  return Math.round((acted / source.length) * 100);
}

function averageProviderReplyLabel(messages) {
  const firstCustomer = new Map();
  const firstReply = new Map();
  const sorted = [...(messages || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (const row of sorted) {
    const id = String(row.customer_id || '');
    if (!id) continue;
    const stamp = new Date(row.created_at).getTime();
    if (!Number.isFinite(stamp)) continue;
    if (row.sender_role === 'customer' && !firstCustomer.has(id)) firstCustomer.set(id, stamp);
    if (row.sender_role === 'provider' && firstCustomer.has(id) && !firstReply.has(id) && stamp >= firstCustomer.get(id)) {
      firstReply.set(id, stamp);
    }
  }
  const diffs = [];
  for (const [id, start] of firstCustomer) {
    if (!firstReply.has(id)) continue;
    diffs.push((firstReply.get(id) - start) / 60000);
  }
  if (!diffs.length) return '—';
  const avg = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  if (avg < 1) return '< 1 min';
  if (avg < 60) return `${Math.round(avg)} mins`;
  const hours = avg / 60;
  if (hours < 24) return `${hours.toFixed(1)} hrs`;
  return `${Math.round(hours / 24)} days`;
}

function computeLiveProviderMetrics(data) {
  const bookings = data.history_bookings || data.bookings || [];
  const reviews = data.reviews || [];
  const messages = data.messages || [];
  const completed = bookings.filter((booking) => String(booking.status || '').toLowerCase() === 'completed');
  const pending = bookings.filter((booking) => String(booking.status || '').toLowerCase() === 'pending');
  const rating = reviews.length
    ? Number((reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length).toFixed(1))
    : null;
  const server = data.metrics || {};
  return {
    rating: rating ?? (server.rating ?? null),
    review_count: reviews.length || server.review_count || 0,
    completed_jobs: completed.length,
    response_rate: bookingResponseRate(bookings),
    pending_requests: pending.length,
    total_earnings: completed.reduce((sum, booking) => sum + Number(booking.amount || 0), 0),
    avg_response_time: averageProviderReplyLabel(messages),
    badge_status: server.badge_status || data.provider?.assessment_badge || 'Pending',
  };
}

function renderProviderEarnings(data) {
  const section = document.querySelector('.sn-earnings-section');
  const grid = section?.querySelector('.sn-earnings-grid');
  if (!grid) return;

  const bookings = data.history_bookings || data.bookings || [];
  const periods = [
    { days: 30, label: 'Last 30 days' },
    { days: 14, label: 'Last 2 weeks' },
    { days: 7, label: 'Last 7 days' },
  ];

  const live = section.querySelector('.sn-earnings-live');
  if (live) live.textContent = `Live ${liveClockLabel()}`;

  grid.innerHTML = periods.map((period) => {
    const computed = sumCompletedEarningsSince(bookings, period.days);
    const jobLabel = `${computed.jobs} completed job${computed.jobs === 1 ? '' : 's'}`;
    return `
      <article class="sn-earnings-card">
        <div class="sn-earnings-card-label">${period.label}</div>
        <div class="sn-earnings-card-value">${money(computed.amount)}</div>
        <div class="sn-earnings-card-meta">${jobLabel}</div>
      </article>
    `;
  }).join('');
}

function renderProviderMetrics(data) {
  const grid = document.querySelector('.stats-grid');
  if (!grid) return;
  const m = computeLiveProviderMetrics(data);
  const ratingLabel = m.review_count ? `${m.rating}` : '—';
  grid.innerHTML = [
    ['&#9733;', ratingLabel, m.review_count ? `Overall Rating (${m.review_count})` : 'Overall Rating', 'var(--orange-pale)'],
    ['&#10003;', m.completed_jobs, 'Completed Jobs', 'var(--success-bg)'],
    ['&#9679;', `${m.response_rate}%`, 'Response Rate', 'var(--info-bg)'],
    ['&#9635;', m.pending_requests, 'Pending Requests', 'var(--blue-pale)'],
    ['&#8369;', money(m.total_earnings), 'Total Earnings', 'var(--blue-pale)'],
    ['&#9719;', m.avg_response_time, 'Avg. Response Time', 'var(--blue-pale)'],
    ['&#9670;', m.badge_status, 'Badge Status', 'var(--orange-pale)'],
  ].map(([icon, value, label, bg]) => `
    <article class="stat-card">
      <div class="stat-icon" style="background:${bg}">${icon}</div>
      <div class="stat-info"><div class="value">${value}</div><div class="label">${label}</div></div>
    </article>
  `).join('');
}

function startProviderDashboardRealtime() {
  if (providerDashboardRefreshActive) return;
  providerDashboardRefreshActive = true;
  const refresh = () => {
    if (document.visibilityState === 'visible') loadProviderDatabase();
  };
  window.snProviderDashboardRefreshTimer = window.setInterval(refresh, 3000);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('beforeunload', () => window.clearInterval(window.snProviderDashboardRefreshTimer));
}

function renderProviderDashboardAnalytics(data) {
  const bookings = data.history_bookings || data.bookings || [];
  renderProviderRealtimeChart(bookings, data.reviews || []);
  renderProviderDashboardLists(data.bookings || [], bookings, data.availability || []);
}

function renderProviderRealtimeChart(bookings, reviews) {
  const chart = document.querySelector('.sn-provider-chart');
  if (!chart) return;

  const days = lastSevenLiveDays();
  const completedByDay = Object.fromEntries(days.map((day) => [day.key, 0]));
  const requestByDay = Object.fromEntries(days.map((day) => [day.key, 0]));
  const earningsByDay = Object.fromEntries(days.map((day) => [day.key, 0]));

  (bookings || []).forEach((booking) => {
    const requestKey = bookingDayStamp(booking.created_at || booking.scheduled_date);
    if (requestByDay[requestKey] !== undefined) requestByDay[requestKey] += 1;
    if (String(booking.status || '').toLowerCase() === 'completed') {
      const completedKey = bookingDayStamp(booking.updated_at || booking.scheduled_date || booking.created_at);
      if (completedByDay[completedKey] !== undefined) {
        completedByDay[completedKey] += 1;
        earningsByDay[completedKey] += Number(booking.amount || 0);
      }
    }
  });

  const maxCount = Math.max(
    1,
    ...days.map((day) => requestByDay[day.key]),
    ...days.map((day) => completedByDay[day.key]),
  );
  const reviewCount = (reviews || []).length;
  const weekEarnings = days.reduce((sum, day) => sum + earningsByDay[day.key], 0);
  const weekJobs = days.reduce((sum, day) => sum + completedByDay[day.key], 0);

  chart.innerHTML = `
    <div class="sn-provider-chart-head">
      <div>
        <h3>Live activity · last 7 days</h3>
        <p>Built from your actual bookings, completed jobs, and reviews. Updates every 3 seconds.</p>
      </div>
      <span class="sn-live-pill">Live ${liveClockLabel()}</span>
    </div>
    <div class="sn-provider-chart-bars">
      ${days.map((day) => {
        const completed = completedByDay[day.key];
        const requests = requestByDay[day.key];
        const jobHeight = completed ? Math.max(10, Math.round((completed / maxCount) * 150)) : 0;
        const requestHeight = requests ? Math.max(10, Math.round((requests / maxCount) * 150)) : 0;
        return `
          <div class="sn-provider-chart-day" data-day="${day.label}" title="${day.label}: ${completed} completed, ${requests} requests, ${money(earningsByDay[day.key])}">
            <div class="sn-bar jobs ${completed ? 'is-filled' : ''}" style="height:${jobHeight}px"></div>
            <div class="sn-bar rating ${requests ? 'is-filled' : ''}" style="height:${requestHeight}px"></div>
          </div>
        `;
      }).join('')}
    </div>
    <div class="sn-provider-chart-legend">
      <span><i class="jobs"></i>Completed jobs</span>
      <span><i class="rating"></i>Incoming requests</span>
      <strong>${weekJobs} jobs · ${money(weekEarnings)} · ${reviewCount} review${reviewCount === 1 ? '' : 's'}</strong>
    </div>
  `;
}

function renderProviderDashboardLists(activeBookings, allBookings, availability) {
  const panels = document.querySelectorAll('.sn-provider-bottom-grid .sn-panel');
  const requestsPanel = panels[0];
  const schedulePanel = panels[1];
  if (requestsPanel) {
    const recent = activeBookings.slice(0, 5);
    requestsPanel.innerHTML = `
      <h3>Recent Requests</h3>
      <table class="sn-provider-table">
        <thead><tr><th>Time</th><th>Customer Name</th><th>Service</th><th>Status</th></tr></thead>
        <tbody>
          ${recent.map((booking) => `
            <tr>
              <td>${esc(booking.scheduled_time || '-')}</td>
              <td>${esc(booking.customer_name || 'Customer')}</td>
              <td>${esc(booking.service || 'Service')}</td>
              <td>${statusPill(booking.status)}</td>
            </tr>
          `).join('') || '<tr><td colspan="4">No active booking requests.</td></tr>'}
        </tbody>
      </table>
    `;
  }

  if (schedulePanel) {
    const upcoming = allBookings
      .filter((booking) => ['pending', 'upcoming', 'ongoing'].includes(String(booking.status).toLowerCase()))
      .slice(0, 3);
    const openSlots = availability.filter((slot) => slot.is_available).slice(0, 3);
    schedulePanel.innerHTML = `
      <h3>Upcoming Schedule</h3>
      <div class="sn-panel-list">
        ${upcoming.map((booking) => `
          <div class="sn-module-card"><div><strong>${shortDate(booking.scheduled_date)} ${esc(booking.scheduled_time)}</strong><span>${esc(booking.service)} - ${esc(booking.customer_name || 'Customer')}</span></div>${statusPill(booking.status)}</div>
        `).join('') || '<p>No upcoming bookings.</p>'}
      </div>
      <h3 class="sn-mini-heading">Open Availability</h3>
      <div class="sn-panel-list">
        ${openSlots.map((slot) => `
          <div class="sn-module-card"><div><strong>${shortDate(slot.available_date)}</strong><span>${esc(slot.start_time)} - ${esc(slot.end_time)}</span></div><span class="sn-status-pill active">Open</span></div>
        `).join('') || '<p>No open availability slots.</p>'}
      </div>
    `;
  }
}

function statusPill(status) {
  const normalized = String(status || 'pending').toLowerCase();
  const cls = normalized === 'completed' ? 'active' : normalized === 'cancelled' ? 'declined' : normalized === 'upcoming' || normalized === 'ongoing' ? 'info' : 'pending';
  return `<span class="sn-status-pill ${cls}">${normalized}</span>`;
}

function renderServices(services) {
  const host = document.querySelector('.sn-section, .sn-panel');
  if (!host) return;
  host.innerHTML = `
    <div class="sn-section-head"><h2>Services</h2><button class="btn btn-primary" type="button" data-action="add-service">+ Add Services</button></div>
    ${services.map(service => `
      <article class="sn-provider-service-card" data-service-id="${service.id}">
        <div class="sn-actions-row"><button class="btn btn-outline" type="button" data-action="edit-service">Edit Service</button><button class="btn btn-danger" type="button" data-action="remove-service">Remove Service</button></div>
        <h3>${esc(service.title)} ${service.is_active ? '<span class="sn-status-pill accepted">Active</span>' : '<span class="sn-status-pill pending">Off</span>'}</h3>
        <p>${esc(service.description || service.category)}</p>
        <strong style="display:block;text-align:right;color:#005cab">Price: ${money(service.starting_price)} - ${money(service.max_price)}</strong>
        <div class="sn-provider-payment-row">
          <span>Payment Options</span>
          <label><input type="checkbox" data-service-field="accepts_cash" ${service.accepts_cash ? 'checked' : ''}> Cash</label>
          <label><input type="checkbox" data-service-field="accepts_gcash" ${service.accepts_gcash ? 'checked' : ''}> GCash / QR</label>
          <label><input type="checkbox" data-service-field="accepts_other" ${service.accepts_other ? 'checked' : ''}> Other</label>
          <span style="margin-left:auto">On / Off Service:</span><label class="sn-provider-switch"><input type="checkbox" data-service-field="is_active" ${service.is_active ? 'checked' : ''}><span class="sn-provider-toggle"></span></label>
        </div>
      </article>
    `).join('') || '<article class="sn-provider-service-card"><p>No services listed yet.</p></article>'}
  `;

  host.querySelector('[data-action="add-service"]')?.addEventListener('click', () => saveService());
  host.querySelectorAll('[data-action="edit-service"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.closest('[data-service-id]')?.dataset.serviceId;
      const service = services.find((item) => String(item.id) === String(id));
      saveService(service);
    });
  });
  host.querySelectorAll('[data-action="remove-service"]').forEach((button) => {
    button.addEventListener('click', () => removeService(button.closest('[data-service-id]')?.dataset.serviceId));
  });
  host.querySelectorAll('[data-service-field]').forEach((input) => {
    input.addEventListener('change', () => updateServiceField(
      input.closest('[data-service-id]')?.dataset.serviceId,
      input.dataset.serviceField,
      input.checked,
      input,
    ));
  });
}

async function updateServiceField(serviceId, field, value, input) {
  const provider = getProviderUser();
  if (!provider?.id || !serviceId || !field) return;
  input.disabled = true;
  try {
    await providerSend(`/api/provider/${provider.id}/services/${serviceId}`, 'PATCH', { [field]: value });
    loadProviderDatabase();
  } catch (error) {
    input.checked = !value;
    await openProviderModal({
      title: 'Service not updated',
      message: error.message || 'Unable to update this service option.',
      confirmText: 'OK',
    });
  } finally {
    input.disabled = false;
  }
}

async function saveService(service) {
  const provider = getProviderUser();
  if (!provider?.id) return;
  const modalTitle = service?.id ? 'Edit service' : 'Add service';
  const categoryOptions = await getAvailableServiceCategories();
  const defaultCategory = service?.category || provider.category || categoryOptions[0] || 'Repair Services';

  const title = await openProviderModal({
    title: modalTitle,
    label: 'Service name',
    value: service?.title || provider.service || '',
    placeholder: 'Enter service name',
    confirmText: 'Next',
  });
  if (!title) return;
  const categoryChoices = [...new Set([...(categoryOptions.length ? categoryOptions : [defaultCategory]), 'Others'])];
  const selectedCategory = await openProviderModal({
    title: modalTitle,
    label: 'Category',
    value: defaultCategory,
    placeholder: 'Select service category',
    confirmText: 'Next',
    options: categoryChoices,
  });
  if (!selectedCategory) return;
  const category = selectedCategory === 'Others'
    ? await openProviderModal({
        title: modalTitle,
        label: 'New category name',
        placeholder: 'Enter service category',
        confirmText: 'Next',
      })
    : selectedCategory;
  if (!category) return;
  const description = await openProviderModal({
    title: modalTitle,
    label: 'Description',
    value: service?.description || '',
    placeholder: 'Describe the service',
    multiline: true,
    confirmText: 'Next',
  });
  const startingPriceInput = await openProviderModal({
    title: modalTitle,
    label: 'Starting price',
    value: service?.starting_price || 500,
    placeholder: 'Enter starting price',
    confirmText: 'Next',
  });
  if (!startingPriceInput) return;
  const starting_price = Number(startingPriceInput || 0);
  const maxPriceInput = await openProviderModal({
    title: modalTitle,
    label: 'Maximum price',
    value: service?.max_price || starting_price || 500,
    placeholder: 'Enter maximum price',
    confirmText: 'Save',
  });
  if (!maxPriceInput) return;
  const max_price = Number(maxPriceInput || 0);
  const body = {
    title,
    category,
    description,
    starting_price,
    max_price,
    accepts_cash: true,
    accepts_gcash: true,
    accepts_other: false,
    is_active: true,
  };
  const path = service?.id
    ? `/api/provider/${provider.id}/services/${service.id}`
    : `/api/provider/${provider.id}/services`;
  await providerSend(path, service?.id ? 'PATCH' : 'POST', body);
  loadProviderDatabase();
}

async function removeService(serviceId) {
  const provider = getProviderUser();
  if (!provider?.id || !serviceId) return;
  const confirmed = await openProviderModal({
    title: 'Remove service',
    message: 'This service will no longer appear in your service listings.',
    confirmText: 'Remove',
    danger: true,
  });
  if (!confirmed) return;
  await providerSend(`/api/provider/${provider.id}/services/${serviceId}`, 'DELETE');
  loadProviderDatabase();
}

function renderRequests(bookings, provider) {
  const panel = document.querySelector('.sn-panel');
  if (!panel) return;
  const visibleBookings = bookings.filter((booking) => !booking.provider_closed);
  const selectedBooking = visibleBookings.find((booking) => String(booking.id) === String(selectedProviderBookingId))
    || visibleBookings.find((booking) => booking.customer_latitude && booking.customer_longitude)
    || visibleBookings[0];
  selectedProviderBookingId = selectedBooking?.id || null;
  panel.innerHTML = `
    <h2>Booking Requests</h2>
    <div class="sn-booking-map-layout">
      <div class="sn-booking-request-list">
        ${visibleBookings.map((booking) => `
          <article class="sn-booking-request-card ${selectedBooking?.id === booking.id ? 'active' : ''}" data-booking-card="${booking.id}" data-lat="${booking.customer_latitude || ''}" data-lng="${booking.customer_longitude || ''}">
            <div>
              <strong>${esc(booking.service)}</strong>
              <span>${esc(booking.customer_name || 'Customer')} - ${shortDate(booking.scheduled_date)} - ${esc(booking.scheduled_time)}</span>
              <small>${esc(booking.address || 'Customer address unavailable')}</small>
            </div>
            <div class="sn-booking-request-side" data-booking-id="${booking.id}">
              ${statusPill(booking.status)}
              ${booking.status === 'pending' ? '<div class="sn-actions-row"><button class="btn btn-success btn-sm" data-status="upcoming">Accept</button><button class="btn btn-danger btn-sm" data-status="cancelled">Decline</button></div>' : ''}
              ${booking.status === 'upcoming' || booking.status === 'ongoing' ? '<button class="btn btn-success btn-sm" data-status="completed">Mark done</button>' : ''}
              ${booking.status === 'completed' ? '<button class="btn btn-outline btn-sm" data-close-booking>Close</button>' : ''}
              ${booking.status === 'cancelled' ? '<button class="btn btn-outline btn-sm" disabled>Cancelled</button>' : ''}
            </div>
          </article>
        `).join('') || '<p>No booking requests to show.</p>'}
      </div>
      <aside class="sn-booking-customer-map-panel">
        <div class="sn-booking-customer-map-head">
          <div>
            <h3>Customer Location</h3>
            <p id="sn-booking-map-caption">Select a booking to view the customer pickup/service point.</p>
          </div>
          <div class="sn-booking-map-tools">
            <span id="sn-booking-map-status">In-app map</span>
            <button class="sn-booking-map-expand" id="sn-booking-map-expand" type="button" aria-label="Expand map"></button>
          </div>
        </div>
        <div id="sn-booking-customer-map" class="sn-booking-customer-map"></div>
        <div class="sn-booking-nav-guide">
          <p class="sn-booking-nav-eta" id="sn-booking-nav-eta">Road directions appear once both GPS pins are available.</p>
          <div class="sn-booking-nav-actions">
            <button class="btn btn-primary btn-sm" id="sn-booking-add-direction" type="button">Add Direction</button>
            <a class="btn btn-outline btn-sm" id="sn-booking-open-gmaps" target="_blank" rel="noopener">Google Maps</a>
            <a class="btn btn-outline btn-sm" id="sn-booking-open-waze" target="_blank" rel="noopener">Waze</a>
          </div>
          <ol class="sn-booking-nav-steps" id="sn-booking-nav-steps"></ol>
        </div>
      </aside>
    </div>
  `;
  panel.querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', () => updateBookingStatus(button.closest('[data-booking-id]')?.dataset.bookingId, button.dataset.status));
  });
  panel.querySelectorAll('[data-close-booking]').forEach((button) => {
    button.addEventListener('click', () => closeCompletedBooking(button.closest('[data-booking-id]')?.dataset.bookingId, button.closest('[data-booking-card]')));
  });
  panel.querySelectorAll('[data-booking-card]').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      const booking = visibleBookings.find((item) => String(item.id) === String(card.dataset.bookingCard));
      panel.querySelectorAll('[data-booking-card]').forEach((item) => item.classList.toggle('active', item === card));
      selectedProviderBookingId = booking?.id || null;
      renderBookingCustomerMap(booking, provider, { loadDirections: true });
    });
  });
  document.getElementById('sn-booking-map-expand')?.addEventListener('click', toggleBookingMapFullscreen);
  document.getElementById('sn-booking-add-direction')?.addEventListener('click', () => {
    const booking = visibleBookings.find((item) => String(item.id) === String(selectedProviderBookingId)) || selectedBooking;
    renderBookingCustomerMap(booking, provider, { loadDirections: true, force: true });
  });
  document.addEventListener('keydown', closeBookingMapFullscreenOnEscape);
  renderBookingCustomerMap(selectedBooking, provider, { loadDirections: true });
}

function providerDistanceKm(start, end) {
  const toRad = (value) => Number(value) * Math.PI / 180;
  const lat1 = toRad(start.lat);
  const lat2 = toRad(end.lat);
  const deltaLat = toRad(end.lat - start.lat);
  const deltaLng = toRad(end.lng - start.lng);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toggleBookingMapFullscreen() {
  const panel = document.querySelector('.sn-booking-customer-map-panel');
  const button = document.getElementById('sn-booking-map-expand');
  if (!panel) return;
  const isFullscreen = panel.classList.toggle('is-fullscreen');
  document.body.classList.toggle('sn-map-fullscreen-open', isFullscreen);
  if (button) {
    button.classList.toggle('is-close', isFullscreen);
    button.setAttribute('aria-label', isFullscreen ? 'Close full screen map' : 'Expand map');
  }
  setTimeout(() => providerBookingMap?.invalidateSize(), 120);
}

function closeBookingMapFullscreenOnEscape(event) {
  if (event.key !== 'Escape') return;
  const panel = document.querySelector('.sn-booking-customer-map-panel.is-fullscreen');
  if (!panel) return;
  panel.classList.remove('is-fullscreen');
  document.body.classList.remove('sn-map-fullscreen-open');
  const button = document.getElementById('sn-booking-map-expand');
  if (button) {
    button.classList.remove('is-close');
    button.setAttribute('aria-label', 'Expand map');
  }
  setTimeout(() => providerBookingMap?.invalidateSize(), 120);
}

function refreshProviderGpsForRequests() {
  const provider = getProviderUser();
  if (providerRequestsGpsRefreshStarted || !provider?.id || !navigator.geolocation) return;
  providerRequestsGpsRefreshStarted = true;

  navigator.geolocation.getCurrentPosition(async (position) => {
    try {
      await saveProviderCoordinates(position.coords, null);
      loadProviderDatabase();
    } catch (error) {
      console.warn(error.message || error);
    }
  }, (error) => {
    console.warn(error.code === error.PERMISSION_DENIED ? 'Provider GPS permission denied.' : 'Provider GPS unavailable.');
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
}

function formatProviderRouteDistance(meters) {
  const value = Number(meters);
  if (!Number.isFinite(value)) return '';
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
}

function formatProviderRouteDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '';
  const minutes = Math.max(1, Math.round(value / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function setProviderDirectionsLinks(from, to) {
  const googleLink = document.getElementById('sn-booking-open-gmaps');
  const wazeLink = document.getElementById('sn-booking-open-waze');
  const hasPins = [from?.lat, from?.lng, to?.lat, to?.lng].every((value) => Number.isFinite(Number(value)));
  if (googleLink) {
    if (hasPins) {
      googleLink.href = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
      googleLink.removeAttribute('aria-disabled');
    } else {
      googleLink.removeAttribute('href');
      googleLink.setAttribute('aria-disabled', 'true');
    }
  }
  if (wazeLink) {
    if (hasPins) {
      wazeLink.href = `https://waze.com/ul?ll=${to.lat},${to.lng}&navigate=yes`;
      wazeLink.removeAttribute('aria-disabled');
    } else {
      wazeLink.removeAttribute('href');
      wazeLink.setAttribute('aria-disabled', 'true');
    }
  }
}

function clearProviderDirectionsUi(message = 'Road directions appear once both GPS pins are available.') {
  const eta = document.getElementById('sn-booking-nav-eta');
  const steps = document.getElementById('sn-booking-nav-steps');
  const addButton = document.getElementById('sn-booking-add-direction');
  if (eta) eta.textContent = message;
  if (steps) steps.innerHTML = '';
  if (addButton) addButton.disabled = false;
  if (providerRouteLayer) providerRouteLayer.clearLayers();
  providerRouteLine = null;
  providerNavMarker = null;
  lastProviderRouteKey = '';
}

function renderProviderDirections(directions, routeKey) {
  if (routeKey !== lastProviderRouteKey || !directions) return;
  const eta = document.getElementById('sn-booking-nav-eta');
  const steps = document.getElementById('sn-booking-nav-steps');
  const distanceText = formatProviderRouteDistance(directions.distance_m);
  const durationText = formatProviderRouteDuration(directions.duration_s);
  if (eta) eta.textContent = `${durationText || 'ETA unavailable'} driving - ${distanceText || 'distance unavailable'}`;
  if (steps) {
    const stepItems = (directions.steps || [])
      .filter((step) => Number(step.distance_m || 0) > 5 || step.instruction)
      .slice(0, 8);
    steps.innerHTML = stepItems.map((step) => `
      <li>
        <span>${esc(step.instruction || 'Continue')}</span>
        <small>${esc(formatProviderRouteDistance(step.distance_m))}</small>
      </li>
    `).join('') || '<li><span>Follow the highlighted route to the customer pin.</span></li>';
  }

  const coordinates = directions.geometry?.coordinates;
  if (!providerBookingMap || !providerBookingMapLayer || !providerRouteLayer || !Array.isArray(coordinates) || coordinates.length < 2) return;
  const latLngs = coordinates
    .map((point) => [Number(point[1]), Number(point[0])])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (latLngs.length < 2) return;
  providerRouteLayer.clearLayers();
  const routeHalo = window.L.polyline(latLngs, {
    color: '#dbeafe',
    weight: 15,
    opacity: 0.95,
    lineCap: 'round',
    lineJoin: 'round',
  });
  const routeShadow = window.L.polyline(latLngs, {
    color: '#1d4ed8',
    weight: 11,
    opacity: 0.28,
    lineCap: 'round',
    lineJoin: 'round',
  });
  const routeMain = window.L.polyline(latLngs, {
    color: '#2563eb',
    weight: 10,
    opacity: 0.94,
    lineCap: 'round',
    lineJoin: 'round',
  });
  providerRouteLine = window.L.layerGroup([routeHalo, routeShadow, routeMain]).addTo(providerRouteLayer);
  const bounds = window.L.featureGroup([providerBookingMapLayer, routeMain]).getBounds();
  if (bounds.isValid()) providerBookingMap.fitBounds(bounds.pad(0.22), { maxZoom: 16 });
}

async function fetchProviderDirectionsFromOsrm(from, to) {
  const coordinates = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`);
  const data = await response.json().catch(() => ({}));
  const route = data.routes?.[0];
  if (!response.ok || data.code !== 'Ok' || !route?.geometry?.coordinates?.length) {
    throw new Error(data.message || 'Unable to build road route.');
  }
  const steps = (route.legs || []).flatMap((leg) => (leg.steps || []).map((step) => ({
    instruction: step.name ? `Continue on ${step.name}` : 'Continue on the highlighted route',
    distance_m: Number(step.distance || 0),
    duration_s: Number(step.duration || 0),
  })));
  return {
    distance_m: Number(route.distance || 0),
    duration_s: Number(route.duration || 0),
    geometry: route.geometry,
    steps,
  };
}

async function loadProviderBookingDirections(from, to, force = false) {
  const addButton = document.getElementById('sn-booking-add-direction');
  const eta = document.getElementById('sn-booking-nav-eta');
  const routeKey = `${from.lat},${from.lng}:${to.lat},${to.lng}`;
  if (!force && routeKey === lastProviderRouteKey) return;
  lastProviderRouteKey = routeKey;
  const requestId = ++providerDirectionsRequestId;
  if (addButton) {
    addButton.disabled = true;
    addButton.textContent = 'Loading...';
  }
  if (eta) eta.textContent = 'Finding road route...';
  try {
    const params = new URLSearchParams({
      from_lat: from.lat,
      from_lng: from.lng,
      to_lat: to.lat,
      to_lng: to.lng,
    });
    let directions = null;
    try {
      const data = await providerGet(`/api/directions?${params}`);
      directions = data.directions;
    } catch {
      directions = await fetchProviderDirectionsFromOsrm(from, to);
    }
    if (requestId !== providerDirectionsRequestId) return;
    renderProviderDirections(directions, routeKey);
  } catch (error) {
    if (requestId === providerDirectionsRequestId && eta) {
      eta.textContent = error.message || 'Unable to build road directions. Use Google Maps or Waze.';
    }
  } finally {
    if (requestId === providerDirectionsRequestId && addButton) {
      addButton.disabled = false;
      addButton.textContent = 'Add Direction';
    }
  }
}

function renderProviderWaitingMap(providerLat, providerLng) {
  const host = document.getElementById('sn-booking-customer-map');
  if (!host) return false;
  if (!Number.isFinite(providerLat) || !Number.isFinite(providerLng) || !window.L) return false;
  if (providerBookingMap) {
    providerBookingMap.remove();
    providerBookingMap = null;
    providerBookingMapLayer = null;
    providerRouteLayer = null;
    providerRouteLine = null;
  }
  host.innerHTML = '';
  providerBookingMap = window.L.map('sn-booking-customer-map', {
    zoomControl: false,
    scrollWheelZoom: true,
  }).setView([providerLat, providerLng], 15);
  window.L.control.zoom({ position: 'bottomleft' }).addTo(providerBookingMap);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(providerBookingMap);
  providerRouteLayer = window.L.layerGroup().addTo(providerBookingMap);
  providerBookingMapLayer = window.L.featureGroup().addTo(providerBookingMap);
  const providerIcon = window.L.divIcon({
    className: '',
    html: '<div class="sn-booking-map-pin sn-booking-map-pin--provider"><span>You</span></div>',
    iconSize: [52, 52],
    iconAnchor: [26, 46],
  });
  window.L.marker([providerLat, providerLng], { icon: providerIcon })
    .bindPopup('<strong>Your provider location</strong><br>Customer pins appear here after booking requests arrive.')
    .addTo(providerBookingMapLayer);
  setTimeout(() => providerBookingMap?.invalidateSize(), 100);
  return true;
}

function renderBookingCustomerMap(booking, provider = getProviderUser(), options = {}) {
  const host = document.getElementById('sn-booking-customer-map');
  const caption = document.getElementById('sn-booking-map-caption');
  const status = document.getElementById('sn-booking-map-status');
  if (!host) return;

  const latitude = Number(booking?.customer_latitude);
  const longitude = Number(booking?.customer_longitude);
  const hasGps = Number.isFinite(latitude) && Number.isFinite(longitude);
  const providerLat = Number(provider?.latitude);
  const providerLng = Number(provider?.longitude);
  const hasProviderGps = Number.isFinite(providerLat) && Number.isFinite(providerLng);
  const isEstimatedCustomerPin = booking?.customer_location_source === 'estimated-address';
  const accuracy = isEstimatedCustomerPin
    ? 'Estimated from booking address'
    : booking?.customer_location_accuracy_m
      ? `+/- ${Math.round(booking.customer_location_accuracy_m)}m`
      : 'GPS accuracy unavailable';
  const distance = hasGps && hasProviderGps
    ? providerDistanceKm({ lat: providerLat, lng: providerLng }, { lat: latitude, lng: longitude })
    : null;
  clearProviderDirectionsUi(hasGps && hasProviderGps
    ? 'Tap Add Direction to refresh the provider-to-customer route.'
    : 'Road directions appear once both GPS pins are available.');
  const addDirectionButton = document.getElementById('sn-booking-add-direction');
  if (addDirectionButton) {
    addDirectionButton.disabled = !(hasGps && hasProviderGps);
    addDirectionButton.title = hasGps && hasProviderGps
      ? 'Build provider-to-customer road directions'
      : 'Customer and provider GPS pins are required for directions';
  }
  setProviderDirectionsLinks(
    hasProviderGps ? { lat: providerLat, lng: providerLng } : null,
    hasGps ? { lat: latitude, lng: longitude } : null,
  );

  if (caption) {
    caption.textContent = booking
      ? `${booking.customer_name || 'Customer'} - ${booking.address || 'No typed address'}`
      : 'No booking selected.';
  }
  if (status) status.textContent = distance === null
    ? (hasGps ? (isEstimatedCustomerPin ? 'Address estimate' : 'Customer GPS') : 'Address only')
    : `${distance.toFixed(1)} km away`;

  if (!booking) {
    if (status) status.textContent = hasProviderGps ? 'Provider GPS' : 'No bookings';
    const renderedProviderMap = renderProviderWaitingMap(providerLat, providerLng);
    if (renderedProviderMap) return;
    host.innerHTML = `
      <div class="sn-booking-map-empty">
        <strong>No booking selected</strong>
        <span>Accepted or pending customer requests with an address will appear on this map.</span>
      </div>
    `;
    return;
  }

  if (!hasGps) {
    if (providerBookingMap) {
      providerBookingMap.remove();
      providerBookingMap = null;
      providerBookingMapLayer = null;
      providerRouteLayer = null;
      providerRouteLine = null;
    }
    host.innerHTML = `
      <div class="sn-booking-map-empty">
        <strong>No customer location available</strong>
        <span>${esc(booking?.address || 'Ask the customer to add an address or allow GPS for this booking.')}</span>
      </div>
    `;
    return;
  }

  host.innerHTML = '';
  if (!window.L) {
    host.innerHTML = `
      <div class="sn-booking-map-empty">
        <strong>${latitude.toFixed(6)}, ${longitude.toFixed(6)}</strong>
        <span>${esc(accuracy)}</span>
      </div>
    `;
    return;
  }

  if (providerBookingMap) {
    providerBookingMap.remove();
    providerBookingMap = null;
    providerBookingMapLayer = null;
    providerRouteLayer = null;
    providerRouteLine = null;
  }

  providerBookingMap = window.L.map('sn-booking-customer-map', {
    zoomControl: false,
    scrollWheelZoom: true,
  }).setView([latitude, longitude], hasProviderGps ? 14 : 16);

  window.L.control.zoom({ position: 'bottomleft' }).addTo(providerBookingMap);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(providerBookingMap);

  providerRouteLayer = window.L.layerGroup().addTo(providerBookingMap);
  providerBookingMapLayer = window.L.featureGroup().addTo(providerBookingMap);
  const customerIcon = window.L.divIcon({
    className: '',
    html: '<div class="sn-booking-map-pin sn-booking-map-pin--customer"><span>C</span></div>',
    iconSize: [48, 48],
    iconAnchor: [24, 44],
  });
  window.L.marker([latitude, longitude], { icon: customerIcon })
    .bindPopup(`<strong>${esc(booking.customer_name || 'Customer')}</strong><br>${esc(booking.service || 'Booking request')}<br>${esc(booking.address || '')}<br>${esc(accuracy)}`)
    .addTo(providerBookingMapLayer);

  if (hasProviderGps) {
    const providerIcon = window.L.divIcon({
      className: '',
      html: '<div class="sn-booking-map-pin sn-booking-map-pin--provider"><span>You</span></div>',
      iconSize: [52, 52],
      iconAnchor: [26, 46],
    });
    window.L.marker([providerLat, providerLng], { icon: providerIcon })
      .bindPopup(`<strong>Your current provider location</strong><br>${providerLat.toFixed(6)}, ${providerLng.toFixed(6)}`)
      .addTo(providerBookingMapLayer);
    providerRouteLine = window.L.layerGroup([
      window.L.polyline([[providerLat, providerLng], [latitude, longitude]], {
        color: '#dbeafe',
        weight: 14,
        opacity: 0.9,
        dashArray: '10 12',
        lineCap: 'round',
      }),
      window.L.polyline([[providerLat, providerLng], [latitude, longitude]], {
        color: '#2563eb',
        weight: 9,
        opacity: 0.82,
        dashArray: '10 12',
        lineCap: 'round',
      }),
    ]).addTo(providerRouteLayer);
  }

  const bounds = providerBookingMapLayer.getBounds();
  if (bounds.isValid()) providerBookingMap.fitBounds(bounds.pad(0.28), { maxZoom: 16 });

  setTimeout(() => providerBookingMap?.invalidateSize(), 100);
  if (hasProviderGps && options.loadDirections) {
    loadProviderBookingDirections(
      { lat: providerLat, lng: providerLng },
      { lat: latitude, lng: longitude },
      options.force,
    );
  }
}

async function updateBookingStatus(bookingId, status) {
  const provider = getProviderUser();
  if (!provider?.id || !bookingId) return;
  await providerSend(`/api/provider/${provider.id}/bookings/${bookingId}/status`, 'PATCH', { status });
  loadProviderDatabase();
}

async function closeCompletedBooking(bookingId, bookingCard = null) {
  const provider = getProviderUser();
  if (!provider?.id || !bookingId) return;
  const confirmed = await openProviderModal({
    title: 'Close completed booking',
    message: 'This will move the completed booking from Booking Requests to Service History.',
    confirmText: 'Move to history',
  });
  if (!confirmed) return;
  const card = bookingCard || document.querySelector(`[data-booking-card="${CSS.escape(String(bookingId))}"]`);
  const closeButton = card?.querySelector('[data-close-booking]');
  if (closeButton) {
    closeButton.disabled = true;
    closeButton.textContent = 'Closing...';
  }
  await providerSend(`/api/provider/${provider.id}/bookings/${bookingId}/close`, 'PATCH');
  if (card) {
    const wasActive = card.classList.contains('active');
    card.remove();
    const nextCard = document.querySelector('[data-booking-card]');
    if (wasActive && nextCard) nextCard.click();
    if (!nextCard) renderBookingCustomerMap(null);
  }
  loadProviderDatabase();
}

function providerDateInputValue(value = new Date()) {
  const localInputDate = (date) => {
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 10);
  };
  if (!value) return localInputDate(new Date());
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? localInputDate(new Date()) : localInputDate(date);
}

function setScheduleStatus(message, type = 'info') {
  const status = document.getElementById('sn-provider-schedule-status');
  if (!status) return;
  status.textContent = message;
  status.hidden = false;
  status.className = `sn-profile-status sn-profile-status--${type}`;
}

function renderSchedule(availability, bookings) {
  const grid = document.querySelector('.sn-page-grid');
  if (!grid) return;
  const today = providerDateInputValue();
  const activeBookings = (bookings || [])
    .filter((booking) => !['completed', 'cancelled'].includes(String(booking.status || '').toLowerCase()))
    .slice(0, 8);
  const slots = [...(availability || [])].sort((a, b) => {
    const dateSort = String(a.available_date || '').localeCompare(String(b.available_date || ''));
    if (dateSort) return dateSort;
    return String(a.start_time || '').localeCompare(String(b.start_time || ''));
  });

  grid.innerHTML = `
    <article class="sn-panel sn-schedule-create-panel">
      <h3>Add Availability</h3>
      <form id="sn-provider-availability-form" class="sn-form-grid sn-schedule-form">
        <div class="sn-form-field">
          <label for="sn-availability-date">Date</label>
          <input id="sn-availability-date" name="available_date" type="date" min="${today}" value="${today}" required />
        </div>
        <div class="sn-form-field">
          <label for="sn-availability-start">Start Time</label>
          <input id="sn-availability-start" name="start_time" type="time" required />
        </div>
        <div class="sn-form-field">
          <label for="sn-availability-end">End Time</label>
          <input id="sn-availability-end" name="end_time" type="time" required />
        </div>
        <label class="sn-schedule-check">
          <input id="sn-availability-open" name="is_available" type="checkbox" checked />
          <span>Open for customer booking</span>
        </label>
        <div class="sn-actions-row full">
          <button class="btn btn-primary" type="submit">Save Availability</button>
        </div>
      </form>
      <p class="sn-profile-status" id="sn-provider-schedule-status" hidden></p>
    </article>
    <article class="sn-panel">
      <h3>Appointments</h3>
      <div class="sn-panel-list">${activeBookings.map(booking => `
        <div class="sn-module-card">
          <div>
            <strong>${esc(booking.scheduled_time || '-')}</strong>
            <span>${esc(booking.service || 'Service')} - ${esc(booking.customer_name || 'Customer')} - ${shortDate(booking.scheduled_date)}</span>
          </div>
          ${statusPill(booking.status)}
        </div>
      `).join('') || '<p>No active bookings yet.</p>'}</div>
    </article>
    <article class="sn-panel sn-schedule-slots-panel">
      <h3>Availability Slots</h3>
      <div class="sn-panel-list">${slots.map(slot => `
        <div class="sn-module-card sn-schedule-slot" data-slot-id="${esc(slot.id)}">
          <div>
            <strong>${shortDate(slot.available_date)}</strong>
            <span>${esc(slot.start_time || '-')} - ${esc(slot.end_time || '-')}</span>
          </div>
          <div class="sn-schedule-slot-actions">
            ${slot.is_available ? '<span class="sn-status-pill active">Open</span>' : '<span class="sn-status-pill pending">Closed</span>'}
            <button class="btn btn-outline btn-sm" type="button" data-schedule-action="toggle" data-next-state="${slot.is_available ? 'false' : 'true'}">${slot.is_available ? 'Close' : 'Reopen'}</button>
            <button class="btn btn-danger btn-sm" type="button" data-schedule-action="delete">Delete</button>
          </div>
        </div>
      `).join('') || '<p>No availability slots yet. Add one so customers can book you.</p>'}</div>
    </article>
  `;

  document.getElementById('sn-provider-availability-form')?.addEventListener('submit', saveAvailabilitySlot);
  grid.querySelectorAll('[data-schedule-action="toggle"]').forEach((button) => {
    button.addEventListener('click', () => updateAvailabilitySlot(
      button.closest('[data-slot-id]')?.dataset.slotId,
      button.dataset.nextState === 'true',
      button,
    ));
  });
  grid.querySelectorAll('[data-schedule-action="delete"]').forEach((button) => {
    button.addEventListener('click', () => removeAvailabilitySlot(button.closest('[data-slot-id]')?.dataset.slotId));
  });

  const addButton = document.querySelector('.sn-topbar-right .btn');
  if (addButton) {
    addButton.type = 'button';
    addButton.onclick = () => {
      document.querySelector('.sn-schedule-create-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById('sn-availability-date')?.focus();
    };
  }
}

async function saveAvailabilitySlot(event) {
  event.preventDefault();
  const provider = getProviderUser();
  if (!provider?.id) return;
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const formData = new FormData(form);
  const startTime = formData.get('start_time');
  const endTime = formData.get('end_time');
  if (startTime && endTime && String(endTime) <= String(startTime)) {
    setScheduleStatus('End time must be later than start time.', 'error');
    return;
  }

  const body = {
    available_date: formData.get('available_date'),
    start_time: startTime,
    end_time: endTime,
    is_available: formData.get('is_available') === 'on',
  };

  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Saving...';
  }
  try {
    await providerSend(`/api/provider/${provider.id}/availability`, 'POST', body);
    setScheduleStatus('Availability saved.', 'success');
    await loadProviderDatabase();
  } catch (error) {
    setScheduleStatus(error.message || 'Unable to save availability.', 'error');
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Save Availability';
    }
  }
}

async function updateAvailabilitySlot(slotId, isAvailable, button) {
  const provider = getProviderUser();
  if (!provider?.id || !slotId) return;
  if (button) button.disabled = true;
  try {
    await providerSend(`/api/provider/${provider.id}/availability/${slotId}`, 'PATCH', { is_available: isAvailable });
    await loadProviderDatabase();
  } catch (error) {
    await openProviderModal({
      title: 'Schedule not updated',
      message: error.message || 'Unable to update this availability slot.',
      confirmText: 'OK',
    });
  } finally {
    if (button) button.disabled = false;
  }
}

async function removeAvailabilitySlot(slotId) {
  const provider = getProviderUser();
  if (!provider?.id || !slotId) return;
  const confirmed = await openProviderModal({
    title: 'Delete availability',
    message: 'Customers will no longer be able to choose this time slot.',
    confirmText: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  await providerSend(`/api/provider/${provider.id}/availability/${slotId}`, 'DELETE');
  loadProviderDatabase();
}

function renderInbox(messages) {
  const layout = document.querySelector('.sn-inbox-layout');
  const convoList = document.getElementById('sn-convo-list');
  const chatPanel = document.getElementById('sn-chat-panel');
  const chatMessages = document.getElementById('sn-chat-messages');
  const chatInput = document.getElementById('sn-chat-input');
  const sendBtn = document.getElementById('sn-send-btn');
  const searchInput = document.querySelector('.sn-inbox-search input');
  if (!layout || !convoList || !chatPanel || !chatMessages) return;

  const conversations = [...messages.reduce((map, message) => {
    const key = String(message.customer_id || 'unknown');
    if (!map.has(key)) {
      map.set(key, {
        customer_id: message.customer_id,
        customer_name: message.customer_name || 'Customer',
        messages: [],
        unread: 0,
      });
    }
    const convo = map.get(key);
    convo.messages.push(message);
    if (message.sender_role === 'customer' && !message.is_read) convo.unread += 1;
    return map;
  }, new Map()).values()].map((convo) => ({
    ...convo,
    messages: convo.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
  })).sort((a, b) => new Date(b.messages.at(-1)?.created_at || 0) - new Date(a.messages.at(-1)?.created_at || 0));

  renderInbox.selectedCustomerId = renderInbox.selectedCustomerId || conversations[0]?.customer_id || null;
  if (!conversations.some((convo) => String(convo.customer_id) === String(renderInbox.selectedCustomerId))) {
    renderInbox.selectedCustomerId = conversations[0]?.customer_id || null;
  }

  function selectedConversation() {
    return conversations.find((convo) => String(convo.customer_id) === String(renderInbox.selectedCustomerId));
  }

  function visibleConversations() {
    const filter = searchInput?.value.trim().toLowerCase() || '';
    const activeTab = document.querySelector('.sn-inbox-tab.active')?.dataset.tab || 'all';
    return conversations.filter((convo) => {
      const matchesSearch = convo.customer_name.toLowerCase().includes(filter);
      const matchesTab = activeTab === 'unread' ? convo.unread > 0 : activeTab !== 'archived';
      return matchesSearch && matchesTab;
    });
  }

  function renderConversationList() {
    const visible = visibleConversations();
    if (!visible.length) {
      convoList.innerHTML = '<p class="sn-convo-end">No conversations yet.</p>';
      return;
    }

    convoList.innerHTML = visible.map((convo, index) => {
      const last = convo.messages.at(-1);
      const active = String(convo.customer_id) === String(renderInbox.selectedCustomerId);
      return `
        <button class="sn-convo-item ${active ? 'active' : ''}" type="button" data-customer-id="${convo.customer_id}">
          <div class="sn-convo-avatar sn-convo-avatar--${(index % 6) + 1}"></div>
          <div class="sn-convo-body">
            <div class="sn-convo-top"><span class="sn-convo-name">${esc(convo.customer_name)}</span><span class="sn-convo-time">${timeLabel(last?.created_at)}</span></div>
            <div class="sn-convo-preview">${esc(last?.message || 'No messages yet.')}</div>
          </div>
          ${convo.unread ? `<span class="sn-convo-unread">${convo.unread}</span>` : ''}
        </button>
      `;
    }).join('') + '<p class="sn-convo-end">No more conversations.</p>';
  }

  function renderChat() {
    const convo = selectedConversation();
    if (!convo) {
      chatMessages.innerHTML = '<p class="sn-convo-end">Select a customer conversation.</p>';
      return;
    }

    const chatName = chatPanel.querySelector('.sn-chat-name');
    const chatMeta = chatPanel.querySelector('.sn-chat-booking-ref');
    if (chatName) chatName.textContent = convo.customer_name;
    if (chatMeta) chatMeta.textContent = ' Direct conversation with customer';

    chatMessages.innerHTML = '<div class="sn-chat-day-divider">Conversation</div>' + convo.messages.map((message) => `
      <div class="sn-msg ${message.sender_role === 'provider' ? 'sn-msg--out' : 'sn-msg--in'}">
        <div class="sn-msg-bubble">${esc(message.message)}</div>
        <div class="sn-msg-time">${timeLabel(message.created_at)}</div>
      </div>
    `).join('');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function sendMessage() {
    const provider = getProviderUser();
    const text = chatInput?.value.trim();
    const convo = selectedConversation();
    if (!provider?.id || !text || !convo?.customer_id) return;

    if (sendBtn) sendBtn.disabled = true;
    try {
      await providerSend(`/api/provider/${provider.id}/messages`, 'POST', {
        customer_id: convo.customer_id,
        message: text,
      });
      chatInput.value = '';
      loadProviderDatabase();
    } catch {
      const msg = document.createElement('div');
      msg.className = 'sn-msg sn-msg--out';
      msg.innerHTML = '<div class="sn-msg-bubble">Message was not sent. Please check the auth server.</div>';
      chatMessages.appendChild(msg);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  convoList.onclick = (event) => {
    const item = event.target.closest('[data-customer-id]');
    if (!item) return;
    renderInbox.selectedCustomerId = item.dataset.customerId;
    const convo = selectedConversation();
    if (convo) convo.unread = 0;
    const provider = getProviderUser();
    if (provider?.id) {
      providerSend(`/api/provider/${provider.id}/messages/${renderInbox.selectedCustomerId}/read`, 'PATCH', {}).catch(() => {});
    }
    renderConversationList();
    renderChat();
    layout.classList.add('chat-open');
  };

  document.querySelectorAll('.sn-inbox-tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.sn-inbox-tab').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      renderConversationList();
    };
  });
  if (searchInput) searchInput.oninput = renderConversationList;
  document.querySelector('.sn-chat-notice-close')?.addEventListener('click', (event) => {
    event.target.closest('.sn-chat-notice')?.remove();
  }, { once: true });
  if (sendBtn) sendBtn.onclick = sendMessage;
  if (chatInput) {
    chatInput.onkeydown = (event) => {
      if (event.key === 'Enter') sendMessage();
    };
  }

  renderConversationList();
  renderChat();
}

function renderAssessment(assessment, metrics) {
  const grid = document.querySelector('.sn-page-grid');
  if (!grid) return;
  grid.innerHTML = `
    <article class="sn-panel"><h3>Skill Status</h3><p>Assessment Score: ${assessment?.score || 0}%</p><div class="sn-actions-row"><span class="sn-status-pill active">${assessment?.badge || metrics?.badge_status || 'Basic Verified'}</span></div></article>
  `;
}

function renderReviews(reviews, metrics) {
  const grid = document.querySelector('.sn-page-grid');
  if (!grid) return;
  grid.innerHTML = `
    <article class="sn-panel"><h3>Recent Feedback</h3><div class="sn-panel-list">${reviews.map(review => `
      <div class="sn-module-card"><div><strong>${review.comment || 'No comment'}</strong><span>${review.customer_name || 'Customer'} - ${shortDate(review.created_at)}</span></div><span class="sn-status-pill active">${review.rating}.0</span></div>
    `).join('') || '<p>No reviews yet.</p>'}</div></article>
  `;
}

function renderHistory(bookings) {
  const panel = document.querySelector('.sn-provider-history-shell') || document.querySelector('.sn-panel');
  if (!panel) return;
  document.querySelector('.sn-hero')?.remove();
  panel.classList.add('sn-provider-history-shell');
  const normalizedBookings = bookings.map((booking, index) => ({
    ...booking,
    avatarClass: `sn-hi-avatar--${(index % 5) + 1}`,
  }));
  const selected = normalizedBookings[0] || null;

  panel.innerHTML = `
    <div class="sn-history-layout sn-provider-history-layout">
      <aside class="sn-history-left">
        <div class="sn-history-left-header">
          <h2 class="sn-page-title">Service History</h2>
          <p class="sn-page-sub">View past, completed, cancelled, and ongoing services</p>
        </div>
        <div class="sn-history-search-row">
          <div class="sn-history-search-wrap">
            <input class="sn-history-search" id="sn-provider-history-search" type="search" placeholder="Search history..." />
          </div>
          <button class="sn-history-filter-btn" type="button" title="Filter history"></button>
        </div>
        <div class="sn-filter-tabs" id="sn-provider-history-tabs">
          <button class="sn-filter-tab active" type="button" data-filter="all">All</button>
          <button class="sn-filter-tab" type="button" data-filter="completed">Completed</button>
          <button class="sn-filter-tab" type="button" data-filter="cancelled">Cancelled</button>
          <button class="sn-filter-tab" type="button" data-filter="ongoing">Ongoing</button>
        </div>
        <div class="sn-history-list" id="sn-provider-history-list">
          ${normalizedBookings.map((booking, index) => renderProviderHistoryItem(booking, index === 0)).join('') || '<p class="sn-history-empty">No service history yet.</p>'}
        </div>
      </aside>
      <section class="sn-history-right">
        <div class="sn-detail-panel" id="sn-provider-history-detail">
          ${selected ? renderProviderHistoryDetail(selected) : '<div class="sn-detail-empty"><div class="sn-empty-title">No history selected</div><div class="sn-empty-sub">Completed and closed bookings will appear here.</div></div>'}
        </div>
      </section>
    </div>
  `;

  const list = panel.querySelector('#sn-provider-history-list');
  const detail = panel.querySelector('#sn-provider-history-detail');
  const search = panel.querySelector('#sn-provider-history-search');
  const tabs = panel.querySelectorAll('#sn-provider-history-tabs .sn-filter-tab');
  let activeFilter = 'all';

  function visibleBookings() {
    const query = search?.value.trim().toLowerCase() || '';
    return normalizedBookings.filter((booking) => {
      const status = String(booking.status || '').toLowerCase();
      const activeStatuses = ['ongoing', 'upcoming', 'pending', 'accepted'];
      const matchesFilter = activeFilter === 'all'
        || status === activeFilter
        || (activeFilter === 'ongoing' && activeStatuses.includes(status));
      const haystack = `${booking.customer_name || ''} ${booking.service || ''} ${booking.address || ''} ${status}`.toLowerCase();
      return matchesFilter && haystack.includes(query);
    });
  }

  function renderList() {
    const visible = visibleBookings();
    list.innerHTML = visible.map((booking, index) => renderProviderHistoryItem(booking, index === 0)).join('') || '<p class="sn-history-empty">No matching service records.</p>';
    const first = visible[0];
    detail.innerHTML = first ? renderProviderHistoryDetail(first) : '<div class="sn-detail-empty"><div class="sn-empty-title">No matching record</div><div class="sn-empty-sub">Try another status or search term.</div></div>';
  }

  list?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-history-id]');
    if (!item) return;
    const booking = normalizedBookings.find((entry) => String(entry.id) === String(item.dataset.historyId));
    if (!booking) return;
    list.querySelectorAll('.sn-history-item').forEach((button) => button.classList.toggle('active', button === item));
    detail.innerHTML = renderProviderHistoryDetail(booking);
  });
  search?.addEventListener('input', renderList);
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter || 'all';
      renderList();
    });
  });
}

function providerHistoryStatusPill(status) {
  const normalized = String(status || 'pending').toLowerCase();
  const cls = normalized === 'completed' ? 'sn-pill--completed'
    : normalized === 'cancelled' ? 'sn-pill--cancelled'
      : normalized === 'ongoing' || normalized === 'upcoming' ? 'sn-pill--ongoing'
        : 'sn-pill--pending';
  return `<span class="sn-status-pill ${cls}">${esc(normalized)}</span>`;
}

function renderProviderHistoryItem(booking, active = false) {
  return `
    <button class="sn-history-item ${active ? 'active' : ''}" type="button" data-history-id="${booking.id}" data-status="${esc(booking.status)}">
      <div class="sn-hi-avatar ${booking.avatarClass}"></div>
      <div class="sn-hi-info">
        <div class="sn-hi-name">${esc(booking.customer_name || 'Customer')}</div>
        <div class="sn-hi-meta">${esc(booking.service || 'Service')} - ${shortDate(booking.scheduled_date)}</div>
        <div class="sn-hi-amount">Total Amount <strong>${money(booking.amount)}</strong></div>
      </div>
      ${providerHistoryStatusPill(booking.status)}
    </button>
  `;
}

function renderProviderHistoryDetail(booking) {
  const isCompleted = String(booking.status).toLowerCase() === 'completed';
  const isCancelled = String(booking.status).toLowerCase() === 'cancelled';
  const bannerClass = isCancelled
    ? 'sn-completion-banner sn-completion-banner--cancelled'
    : isCompleted
      ? 'sn-completion-banner'
      : 'sn-completion-banner sn-completion-banner--active';
  const bannerTitle = isCompleted ? 'This service has been completed.'
    : isCancelled ? 'This booking was cancelled.'
      : 'This service is still active.';
  const bannerSub = isCompleted ? 'The booking is now part of your provider service history.'
    : isCancelled ? 'Cancelled bookings remain visible for record keeping.'
      : 'Ongoing and upcoming bookings stay visible until completed.';

  return `
    <div class="sn-detail-header">
      <div class="sn-detail-header-left">
        <div class="sn-detail-avatar ${booking.avatarClass}"></div>
        <div>
          <div class="sn-detail-name">${esc(booking.customer_name || 'Customer')}</div>
          <div class="sn-detail-sub">Booking ID: #SN-${String(booking.id).padStart(5, '0')} - ${esc(booking.service || 'Service')}</div>
        </div>
      </div>
      <div class="sn-detail-header-right">${providerHistoryStatusPill(booking.status)}</div>
    </div>
    <div class="${bannerClass}">
      <div class="sn-banner-text"><strong>${esc(bannerTitle)}</strong><span>${esc(bannerSub)}</span></div>
    </div>
    <div class="sn-detail-body">
      <section class="sn-detail-section">
        <h3>Booking Details</h3>
        <div class="sn-detail-rows">
          <div class="sn-dr"><span class="sn-dr-label">Booking Date</span><span class="sn-dr-value">${shortDate(booking.scheduled_date)} at ${esc(booking.scheduled_time)}</span></div>
          <div class="sn-dr"><span class="sn-dr-label">Service</span><span class="sn-dr-value">${esc(booking.service || '-')}</span></div>
          <div class="sn-dr"><span class="sn-dr-label">Address</span><span class="sn-dr-value">${esc(booking.address || '-')}</span></div>
          <div class="sn-dr"><span class="sn-dr-label">Amount</span><span class="sn-dr-value sn-dr-amount">${money(booking.amount)}</span></div>
          <div class="sn-dr"><span class="sn-dr-label">Payment Method</span><span class="sn-dr-value">${esc(booking.payment_method || 'cash')}</span></div>
          <div class="sn-dr"><span class="sn-dr-label">Status</span><span class="sn-dr-value">${providerHistoryStatusPill(booking.status)}</span></div>
        </div>
      </section>
      <aside class="sn-provider-info-card">
        <div class="sn-provider-info-title">Customer</div>
        <div class="sn-provider-info-body">
          <div class="sn-provider-info-avatar ${booking.avatarClass}"></div>
          <div>
            <div class="sn-provider-info-name">${esc(booking.customer_name || 'Customer')}</div>
            <div class="sn-provider-info-type">${esc(booking.customer_contact || 'No contact saved')}</div>
            <button class="btn btn-outline" type="button" disabled>Customer Record</button>
          </div>
        </div>
      </aside>
    </div>
  `;
}

function renderProviderReassessmentSection(provider, metrics, assessment) {
  const category = resolveProviderAssessmentCategory(provider, assessment);
  const currentScore = Number(assessment?.score ?? provider.assessment_score ?? 0);
  const currentBadge = assessment?.badge || metrics?.badge_status || provider.badge_status || 'Needs Reassessment';
  const questionCount = providerAssessmentBank(category).length;
  const hasQuestionBank = questionCount >= 10;

  return `
    <section class="sn-reassessment-section">
      <div class="sn-reassessment-head">
        <div>
          <h3>Skill Reassessment</h3>
          <p>Retake the ${esc(category)} exam if you failed or want to improve your badge.</p>
        </div>
        <div class="sn-reassessment-score">
          <span>${currentScore}%</span>
          <strong>${esc(currentBadge)}</strong>
        </div>
      </div>
      <div class="sn-reassessment-intro" id="sn-provider-reassessment-intro">
        <p>${hasQuestionBank
          ? 'You will receive 10 shuffled questions from your current provider category. Your newest score will be used for badge and admin verification checks.'
          : 'No category-specific exam is available for this category yet.'}</p>
        <button class="btn btn-primary" id="sn-provider-start-reassessment" type="button">Retake Assessment</button>
      </div>
      <div class="sn-reassessment-form" id="sn-provider-reassessment-form" hidden>
        <div class="sn-reassessment-list" id="sn-provider-reassessment-list"></div>
        <div class="sn-actions-row">
          <button class="btn btn-primary" id="sn-provider-submit-reassessment" type="button">Submit Reassessment</button>
          <button class="btn btn-outline" id="sn-provider-cancel-reassessment" type="button">Cancel</button>
        </div>
      </div>
    </section>
  `;
}

function startProviderReassessment(provider) {
  const category = resolveProviderAssessmentCategory(provider);
  const list = document.getElementById('sn-provider-reassessment-list');
  const form = document.getElementById('sn-provider-reassessment-form');
  const intro = document.getElementById('sn-provider-reassessment-intro');
  const bank = providerAssessmentBank(category);
  if (!list || !form || bank.length < 10) {
    setProviderProfileStatus('No reassessment questions are available for this category yet. Please set your Primary Category to one of the main service categories first.', 'error');
    return;
  }

  activeProviderReassessmentQuestions = shuffleProviderAssessment(bank).slice(0, 10);
  list.innerHTML = activeProviderReassessmentQuestions.map((item, index) => `
    <fieldset class="sn-reassessment-question">
      <legend><span>${index + 1}.</span><strong>${esc(item.q)}</strong></legend>
      ${item.o.map((option, optionIndex) => `
        <label class="sn-reassessment-option">
          <input type="radio" name="provider-reassessment-${index}" value="${optionIndex}">
          <span>${esc(option)}</span>
        </label>
      `).join('')}
    </fieldset>
  `).join('');
  intro.hidden = true;
  form.hidden = false;
  setProviderProfileStatus('', 'info');
}

function cancelProviderReassessment() {
  activeProviderReassessmentQuestions = [];
  const form = document.getElementById('sn-provider-reassessment-form');
  const intro = document.getElementById('sn-provider-reassessment-intro');
  if (form) form.hidden = true;
  if (intro) intro.hidden = false;
  setProviderProfileStatus('', 'info');
}

async function submitProviderReassessment(provider) {
  if (!provider?.id || !activeProviderReassessmentQuestions.length) return;
  const button = document.getElementById('sn-provider-submit-reassessment');
  const answers = activeProviderReassessmentQuestions.map((item, index) => {
    const selected = document.querySelector(`input[name="provider-reassessment-${index}"]:checked`);
    const selectedIndex = Number(selected?.value);
    return {
      question: item.q,
      answer: Number.isInteger(selectedIndex) ? item.o[selectedIndex] : '',
      correct: item.a,
    };
  });

  if (answers.some((item) => !item.answer)) {
    setProviderProfileStatus('Please answer all reassessment questions before submitting.', 'error');
    return;
  }

  const correctCount = answers.filter((item) => item.answer === item.correct).length;
  const score = Math.round((correctCount / answers.length) * 100);
  if (button) {
    button.disabled = true;
    button.textContent = 'Submitting...';
  }

  try {
    const data = await providerSend(`/api/provider/${provider.id}/reassessment`, 'POST', {
      category: resolveProviderAssessmentCategory(provider),
      score,
      answers,
    });
    if (data.user) localStorage.setItem('sn_provider_user', JSON.stringify(data.user));
    activeProviderReassessmentQuestions = [];
    await loadProviderDatabase();
    setProviderProfileStatus(`Reassessment submitted. New score: ${score}% (${data.assessment?.badge || data.user?.badge_status || 'updated'}).`, score >= 60 ? 'success' : 'error');
  } catch (error) {
    setProviderProfileStatus(error.message || 'Unable to submit reassessment.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Submit Reassessment';
    }
  }
}

function renderProfile(provider, metrics, assessment) {
  const panel = document.querySelector('.sn-panel');
  if (!panel) return;
  const accuracyLabel = provider.location_accuracy_m ? ` (+/- ${Math.round(provider.location_accuracy_m)}m)` : '';
  const updatedLabel = provider.location_updated_at ? ` - updated ${shortDateTime(provider.location_updated_at)}` : '';
  const locationLabel = provider.latitude && provider.longitude
    ? `${Number(provider.latitude).toFixed(6)}, ${Number(provider.longitude).toFixed(6)}${accuracyLabel}${updatedLabel}`
    : 'GPS location not saved yet';
  const documentLinks = renderProviderCredentialLinks(provider);
  panel.innerHTML = `
    <h2>Provider Information</h2>
    <div class="sn-form-grid">
      <div class="sn-form-field"><label>Business or Display Name</label><input id="sn-provider-full-name" value="${esc(provider.full_name || '')}" /></div>
      <div class="sn-form-field"><label>Contact Number</label><input id="sn-provider-contact" value="${esc(provider.contact || '')}" /></div>
      <div class="sn-form-field"><label>Primary Category</label><input id="sn-provider-category" value="${esc(providerCategoryLabel(provider.category) || '')}" /></div>
      <div class="sn-form-field"><label>Main Service</label><input id="sn-provider-service" value="${esc(provider.service || '')}" /></div>
      <div class="sn-form-field"><label>Verification Badge</label><input value="${esc(metrics?.badge_status || provider.verification_status || '')}" readonly /></div>
      <div class="sn-form-field"><label>Supporting Documents</label><input id="sn-provider-docs" type="file" multiple accept="image/*,.pdf,.doc,.docx" /></div>
      <div class="sn-form-field"><label>Front of ID</label><input id="sn-provider-id-front" type="file" accept="image/*,.pdf" /></div>
      <div class="sn-form-field"><label>Back of ID</label><input id="sn-provider-id-back" type="file" accept="image/*,.pdf" /></div>
      <div class="sn-form-field full"><label>Address</label><textarea id="sn-provider-address">${esc(provider.address || '')}</textarea></div>
      <div class="sn-form-field full"><label>GPS Service Location</label><input id="sn-provider-gps-label" value="${esc(locationLabel)}" readonly /></div>
    </div>
    <div class="sn-provider-documents">${documentLinks}</div>
    ${renderProviderReassessmentSection(provider, metrics, assessment)}
    <p class="sn-profile-status" id="sn-provider-profile-status" hidden></p>
    <div class="sn-actions-row"><button class="btn btn-primary" id="sn-provider-save-profile" type="button">Save Profile</button><button class="btn btn-outline" id="sn-provider-save-gps" type="button">Use GPS Location</button><button class="btn btn-outline" id="sn-provider-live-gps" type="button">${providerLocationWatchId === null ? 'Start Live Tracking' : 'Stop Live Tracking'}</button><button class="btn btn-outline" id="sn-provider-upload-credentials" type="button">Upload Credentials</button></div>
  `;
  document.getElementById('sn-provider-save-profile')?.addEventListener('click', saveProviderProfile);
  document.getElementById('sn-provider-save-gps')?.addEventListener('click', saveProviderGpsLocation);
  document.getElementById('sn-provider-live-gps')?.addEventListener('click', toggleProviderLiveTracking);
  document.getElementById('sn-provider-upload-credentials')?.addEventListener('click', uploadProviderCredentials);
  document.getElementById('sn-provider-start-reassessment')?.addEventListener('click', () => startProviderReassessment(provider));
  document.getElementById('sn-provider-cancel-reassessment')?.addEventListener('click', cancelProviderReassessment);
  document.getElementById('sn-provider-submit-reassessment')?.addEventListener('click', () => submitProviderReassessment(provider));
}

function providerUploadUrl(folder, filename) {
  return `${PROVIDER_API_BASE}/uploads/${folder}/${encodeURIComponent(filename)}`;
}

function renderProviderCredentialLinks(provider) {
  const docs = Array.isArray(provider.documents_files) ? provider.documents_files : [];
  const links = [
    ...docs.map((filename, index) => `<a href="${providerUploadUrl('provider-docs', filename)}" target="_blank" rel="noopener noreferrer">Document ${index + 1}</a>`),
    provider.id_front_file ? `<a href="${providerUploadUrl('customer-ids', provider.id_front_file)}" target="_blank" rel="noopener noreferrer">Front ID</a>` : '',
    provider.id_back_file ? `<a href="${providerUploadUrl('customer-ids', provider.id_back_file)}" target="_blank" rel="noopener noreferrer">Back ID</a>` : '',
  ].filter(Boolean);
  return links.length
    ? `<strong>Uploaded Credentials</strong><div>${links.join('')}</div>`
    : '<strong>Uploaded Credentials</strong><span>No credential files uploaded yet.</span>';
}

function setProviderProfileStatus(message, type = 'info') {
  const status = document.getElementById('sn-provider-profile-status');
  if (!status) return;
  status.textContent = message;
  status.className = `sn-profile-status sn-profile-status--${type}`;
  status.hidden = !message;
}

async function saveProviderProfile() {
  const provider = getProviderUser();
  if (!provider?.id) return;
  const button = document.getElementById('sn-provider-save-profile');
  const body = {
    full_name: document.getElementById('sn-provider-full-name')?.value.trim() || '',
    contact: document.getElementById('sn-provider-contact')?.value.trim() || '',
    category: document.getElementById('sn-provider-category')?.value.trim() || '',
    service: document.getElementById('sn-provider-service')?.value.trim() || '',
    address: document.getElementById('sn-provider-address')?.value.trim() || '',
  };
  if (Object.values(body).some((value) => !value)) {
    setProviderProfileStatus('Please complete display name, contact, category, service, and address.', 'error');
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = 'Saving...';
  }
  try {
    const data = await providerSend(`/api/provider/${provider.id}/profile`, 'PATCH', body);
    localStorage.setItem('sn_provider_user', JSON.stringify(data.user));
    const userName = document.getElementById('sn-user-name');
    if (userName) userName.textContent = data.user.full_name || 'Service Provider';
    setProviderProfileStatus('Profile saved successfully.', 'success');
  } catch (error) {
    setProviderProfileStatus(error.message || 'Unable to save provider profile.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Save Profile';
    }
  }
}

async function uploadProviderCredentials() {
  const provider = getProviderUser();
  if (!provider?.id) return;
  const docsInput = document.getElementById('sn-provider-docs');
  const frontInput = document.getElementById('sn-provider-id-front');
  const backInput = document.getElementById('sn-provider-id-back');
  const files = [
    ...(docsInput?.files || []),
    ...(frontInput?.files || []),
    ...(backInput?.files || []),
  ];
  if (!files.length) {
    setProviderProfileStatus('Choose at least one document or ID image before uploading.', 'error');
    return;
  }

  const button = document.getElementById('sn-provider-upload-credentials');
  const form = new FormData();
  Array.from(docsInput?.files || []).forEach((file) => form.append('docs', file));
  if (frontInput?.files?.[0]) form.append('idFront', frontInput.files[0]);
  if (backInput?.files?.[0]) form.append('idBack', backInput.files[0]);

  if (button) {
    button.disabled = true;
    button.textContent = 'Uploading...';
  }
  try {
    const data = await providerSendForm(`/api/provider/${provider.id}/credentials`, 'PATCH', form);
    localStorage.setItem('sn_provider_user', JSON.stringify(data.user));
    await loadProviderDatabase();
    setProviderProfileStatus('Credentials uploaded. Your verification is back under admin review.', 'success');
  } catch (error) {
    setProviderProfileStatus(error.message || 'Unable to upload credentials.', 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Upload Credentials';
    }
  }
}

async function saveProviderCoordinates(coords, label, suffix = '') {
  const provider = getProviderUser();
  const latitude = Number(coords.latitude);
  const longitude = Number(coords.longitude);
  const accuracy = Number(coords.accuracy);
  const data = await providerSend(`/api/provider/${provider.id}/location`, 'PATCH', {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
  });
  if (data.user) {
    localStorage.setItem('sn_provider_user', JSON.stringify(data.user));
    if (label) {
      const gpsLabel = `${Number(data.user.latitude).toFixed(6)}, ${Number(data.user.longitude).toFixed(6)}`;
      const accuracyText = data.user.location_accuracy_m ? ` (+/- ${Math.round(data.user.location_accuracy_m)}m)` : '';
      label.value = `${gpsLabel}${accuracyText}${suffix}`;
    }
  }
  return data.user;
}

async function saveProviderGpsLocation() {
  const provider = getProviderUser();
  const label = document.getElementById('sn-provider-gps-label');
  if (!provider?.id || !navigator.geolocation) {
    if (label) label.value = 'GPS is not available in this browser.';
    return;
  }
  if (label) label.value = 'Requesting GPS permission...';
  navigator.geolocation.getCurrentPosition(async (position) => {
    try {
      await saveProviderCoordinates(position.coords, label);
    } catch (error) {
      if (label) label.value = error.message || 'Unable to save GPS location.';
    }
  }, () => {
    if (label) label.value = 'GPS permission was denied.';
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
}

function stopProviderLiveTracking() {
  if (providerLocationWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(providerLocationWatchId);
  }
  providerLocationWatchId = null;
  const liveButton = document.getElementById('sn-provider-live-gps');
  if (liveButton) liveButton.textContent = 'Start Live Tracking';
  const label = document.getElementById('sn-provider-gps-label');
  if (label && label.value.includes(' - live')) label.value = label.value.replace(' - live', '');
}

function toggleProviderLiveTracking() {
  const provider = getProviderUser();
  const label = document.getElementById('sn-provider-gps-label');
  const liveButton = document.getElementById('sn-provider-live-gps');
  if (providerLocationWatchId !== null) {
    stopProviderLiveTracking();
    return;
  }
  if (!provider?.id || !navigator.geolocation) {
    if (label) label.value = 'GPS is not available in this browser.';
    return;
  }

  if (label) label.value = 'Starting live GPS tracking...';
  if (liveButton) liveButton.textContent = 'Stop Live Tracking';

  providerLocationWatchId = navigator.geolocation.watchPosition(async (position) => {
    try {
      await saveProviderCoordinates(position.coords, label, ' - live');
    } catch (error) {
      if (label) label.value = error.message || 'Unable to save live GPS location.';
    }
  }, (error) => {
    if (label) label.value = error.code === error.PERMISSION_DENIED
      ? 'GPS permission was denied.'
      : 'Unable to read live GPS location.';
    stopProviderLiveTracking();
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}

window.addEventListener('beforeunload', stopProviderLiveTracking);
