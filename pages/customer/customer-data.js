const CUSTOMER_API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));

(function snLoadFloatingChat() {
  if (document.querySelector('script[src*="floating-chat.js"]')) return;
  const script = document.createElement('script');
  script.src = '/shared/js/floating-chat.js';
  script.defer = true;
  document.head.appendChild(script);
})();

function snCurrentCustomer() {
 try {
 return JSON.parse(localStorage.getItem('sn_customer_user') || 'null');
 } catch {
 return null;
 }
}

async function snCustomerGet(path) {
 const response = await fetch(`${CUSTOMER_API_BASE}${path}`);
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(data.message || 'Failed to load customer data.');
 return data;
}

function snEsc(value) {
 return String(value?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function snMoney(value) {
 return `PHP ${Number(value || 0).toLocaleString('en-PH')}`;
}

function snDate(value) {
 if (!value) return '-';
 return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' });
}

function snStatusPill(status) {
 const value = String(status || 'pending').toLowerCase();
 return `<span class="sn-status-pill ${value}">${value}</span>`;
}

async function snSaveCustomerFavorite(customerId, providerId) {
 const response = await fetch(`${CUSTOMER_API_BASE}/api/customer/${customerId}/favorites`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider_id: providerId }),
 });
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(data.message || 'Unable to save favorite.');
 return data;
}

async function snDeleteCustomerFavorite(customerId, providerId) {
 const response = await fetch(`${CUSTOMER_API_BASE}/api/customer/${customerId}/favorites/${providerId}`, {
  method: 'DELETE',
 });
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(data.message || 'Unable to remove favorite.');
 return data;
}

function snBadge(provider) {
 const tier = provider.verified_tier || (provider.verification_status === 'verified'? 'skilled': 'basic');
 if (tier === 'top') return '<div class="sn-provider-badge sn-badge--top">Top-Tier Verified</div>';
 if (tier === 'skilled') return '<div class="sn-provider-badge sn-badge--verified">Skilled Verified</div>';
 return '<div class="sn-provider-badge sn-badge--basic">Basic Verified</div>';
}

function snRenderCustomerChrome(customer) {
 const userName = document.getElementById('sn-user-name');
 const userStatus = document.getElementById('sn-user-status');
 if (userName) userName.textContent = customer?.full_name || 'Customer';
 if (userStatus) {
 const status = customer?.verification_status || (customer?.is_verified? 'verified': 'pending');
 userStatus.textContent = status === 'verified'? 'Verified customer': status === 'rejected'? 'Verification declined': 'Awaiting verification';
 }
}

function snAttachCustomerSidebarFallback() {
 const shell = document.querySelector('.sn-shell');
 const overlay = document.getElementById('sn-overlay');
 const topButton = document.getElementById('sn-hamburger-top');
 const sideButton = document.getElementById('sn-hamburger');
 if (!shell) return;

 function isMobile() {
 return window.matchMedia('(max-width: 940px)').matches;
 }

 function openSidebar(event) {
 event?.preventDefault();
 event?.stopImmediatePropagation();
 shell.classList.remove('sidebar-collapsed');
 shell.classList.add('sidebar-open');
 if (isMobile()) document.body.style.overflow = 'hidden';
 }

 function closeSidebar(event) {
 event?.preventDefault();
 event?.stopImmediatePropagation();
 shell.classList.remove('sidebar-open');
 shell.classList.add('sidebar-collapsed');
 document.body.style.overflow = '';
 }

 topButton?.addEventListener('click', openSidebar, true);
 sideButton?.addEventListener('click', closeSidebar, true);
 overlay?.addEventListener('click', closeSidebar, true);
}

function snAttachUniversalCustomerFilter(customer) {
 const path = window.location.pathname;
 if (path.includes('/customer/search/') || window.snDisableCustomerTopbarSearch) return;

 const sidebar = document.querySelector('.sn-sidebar');
 const topbar = document.querySelector('.sn-topbar');
 if (!sidebar || !topbar || document.getElementById('sn-universal-filter-panel')) return;

 const oldSearchWrap = topbar.querySelector('.sn-topbar-search');
 const oldSearchValue = oldSearchWrap?.querySelector('input[type="search"]')?.value || '';
 if (oldSearchWrap) oldSearchWrap.remove();

 const nav = sidebar.querySelector('.sn-nav');

 const searchInput = oldSearchWrap?.querySelector('input[type="search"]');
 if (searchInput && !searchInput.id) searchInput.id = 'sn-global-search';

 let filterButton = oldSearchWrap?.querySelector('.sn-topbar-pill');
 if (!filterButton) {
  filterButton = document.createElement('button');
  filterButton.className = 'sn-topbar-pill';
  filterButton.type = 'button';
  filterButton.title = 'Filters';
  if (oldSearchWrap) oldSearchWrap.appendChild(filterButton);
 }

 const categories = ['All', 'Home Repair', 'Cleaning', 'Personal Care', 'Appliance Maintenance', 'Home Installation'];
 const panel = document.createElement('section');
 panel.id = 'sn-universal-filter-panel';
 panel.className = 'sn-universal-filter-panel sn-unlocked-control';
 panel.hidden = true;
 panel.innerHTML = `
  <div class="sn-universal-filter-grid">
   <label><span>Search</span><input id="sn-universal-filter-q" type="text" value="${snEsc(searchInput?.value || '')}" placeholder="Search service or provider" /></label>
   <label><span>Category</span><select id="sn-universal-filter-category">${categories.map((category, index) => `<option value="${index === 0 ? '' : snEsc(category)}">${snEsc(category)}</option>`).join('')}</select></label>
   <label><span>Sort</span><select id="sn-universal-filter-sort"><option value="recommended">Recommended</option><option value="top">Top Verified</option><option value="highest">Highest Verified</option><option value="basic">Basic Verified</option><option value="available">Available First</option></select></label>
   <label><span>Location</span><input id="sn-universal-filter-location" type="text" value="${snEsc(customer?.address || '')}" placeholder="City, barangay, or address" /></label>
   <label class="sn-universal-filter-check"><input id="sn-universal-filter-available" type="checkbox" /><span>Available only</span></label>
  </div>
  <div class="sn-universal-filter-actions">
   <button class="sn-filter-action sn-filter-action--ghost" type="button" id="sn-universal-filter-reset">Reset</button>
   <button class="sn-filter-action sn-filter-action--primary" type="button" id="sn-universal-filter-apply">Apply Filters</button>
  </div>
 `;

 if (nav) sidebar.insertBefore(panel, nav);
 else sidebar.appendChild(panel);

 const sidebarSearchButton = sidebar.querySelector('#sn-universal-filter-button');
 if (sidebarSearchButton) sidebarSearchButton.remove();

 function goToSearch() {
  const params = new URLSearchParams({
   q: document.getElementById('sn-universal-filter-q')?.value.trim() || searchInput?.value.trim() || '',
   category: document.getElementById('sn-universal-filter-category')?.value || '',
   sort: document.getElementById('sn-universal-filter-sort')?.value || 'recommended',
   available: String(Boolean(document.getElementById('sn-universal-filter-available')?.checked)),
   location: document.getElementById('sn-universal-filter-location')?.value.trim() || customer?.address || '',
  });
  window.location.href = `../search/search.html?${params.toString()}`;
 }

 filterButton?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  const isOpen = panel.hidden;
  panel.hidden = !isOpen;
  filterButton.setAttribute('aria-expanded', String(isOpen));
 });

 document.addEventListener('click', (event) => {
  if (panel.hidden || event.target.closest('#sn-universal-filter-panel') || event.target.closest('#sn-universal-filter-button')) return;
  panel.hidden = true;
  filterButton?.setAttribute('aria-expanded', 'false');
 });

 searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') goToSearch();
 });
 document.getElementById('sn-universal-filter-apply')?.addEventListener('click', goToSearch);
 document.getElementById('sn-universal-filter-reset')?.addEventListener('click', () => {
  const q = document.getElementById('sn-universal-filter-q');
  const category = document.getElementById('sn-universal-filter-category');
  const sort = document.getElementById('sn-universal-filter-sort');
  const location = document.getElementById('sn-universal-filter-location');
  const available = document.getElementById('sn-universal-filter-available');
  if (q) q.value = '';
  if (category) category.value = '';
  if (sort) sort.value = 'recommended';
  if (location) location.value = customer?.address || '';
  if (available) available.checked = false;
 });
}

function snInboxHref(peerId) {
  return peerId
    ? `../dashboard/dashboard.html#messages=${peerId}`
    : '../dashboard/dashboard.html#messages';
}

function snNotificationItems(data) {
 const messages = (data.messages || []).filter(message => message.sender_role === 'provider').slice(0, 5).map(message => ({
  id: `message-${message.id}`,
  kind: 'Message',
  title: message.provider_name || 'Service Provider',
  body: message.message || 'New message received.',
  time: message.created_at,
  href: snInboxHref(),
 }));
 const bookings = (data.bookings || []).slice(0, 5).map(booking => ({
  id: `booking-${booking.id}-${booking.status}`,
  kind: 'Booking',
  title: booking.provider_name || 'Booking update',
  body: `${booking.service || 'Service'} is ${booking.status || 'pending'}.`,
  time: booking.created_at,
  href: '../bookings/bookings.html',
 }));
 return [...messages, ...bookings]
  .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))
  .slice(0, 8);
}

function snUnreadCustomerMessages(data) {
 return (data.messages || []).filter(message => message.sender_role === 'provider' && !message.is_read).length;
}

function snActiveCustomerBookings(data) {
 const active = new Set(['pending', 'accepted', 'upcoming', 'ongoing']);
 return (data.bookings || []).filter(booking => active.has(String(booking.status || '').toLowerCase())).length;
}

function snStoredList(key) {
 try {
  const parsed = JSON.parse(localStorage.getItem(key) || '[]');
  return Array.isArray(parsed) ? parsed : [];
 } catch {
  return [];
 }
}

function snSeenNoticeKey(role, userId) {
 return `sn_${role}_seen_notifications_${userId}`;
}

function snUnseenNotices(role, userId, items) {
 const seen = new Set(snStoredList(snSeenNoticeKey(role, userId)).map(String));
 return items.filter(item => !seen.has(String(item.id)));
}

function snMarkNoticesSeen(role, userId, items) {
 const key = snSeenNoticeKey(role, userId);
 const seen = new Set(snStoredList(key).map(String));
 items.forEach(item => seen.add(String(item.id)));
 localStorage.setItem(key, JSON.stringify([...seen].slice(-150)));
}

function snSetCountBadge(target, count, label = 'new notifications') {
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

function snFindNavItem(fragment) {
 return document.querySelector(`.sn-nav-item[href*="${fragment}"]`);
}

function snUpdateCustomerNotificationBadges(data, notificationCountOverride = null) {
 const unreadMessages = snUnreadCustomerMessages(data);
 const activeBookings = snActiveCustomerBookings(data);
 const notificationCount = notificationCountOverride ?? (unreadMessages + activeBookings);
 const messageButton = document.querySelector('.sn-topbar-right [title*="Message"], .sn-topbar-right [title*="message"]');
 const notificationButton = document.getElementById('sn-notification-button')
  || document.querySelector('.sn-topbar-right [title*="Notification"], .sn-topbar-right [title*="notification"]');
 snSetCountBadge(messageButton, unreadMessages, 'unread messages');
 snSetCountBadge(notificationButton, notificationCount, 'new notifications');
 snSetCountBadge(document.getElementById('sn-hamburger-top'), notificationCount, 'new notifications');
 snSetCountBadge(snFindNavItem('inbox'), unreadMessages, 'unread messages');
 snSetCountBadge(snFindNavItem('bookings'), activeBookings, 'active bookings');
 return { unreadMessages, activeBookings, notificationCount };
}

function snShowToast(item) {
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
 toast.innerHTML = `<strong>${snEsc(item.kind)}: ${snEsc(item.title)}</strong><span>${snEsc(item.body)}</span>`;
 toast.addEventListener('click', () => {
  if (window.snFloatingChat) {
    window.snFloatingChat.toggleList();
    return;
  }
  window.location.href = item.href;
});
 host.appendChild(toast);
 window.setTimeout(() => toast.remove(), 5200);
}

function snRenderNotificationPanel(items, unseenIds = new Set()) {
 const panel = document.getElementById('sn-notification-panel');
 if (!panel) return;
 panel.innerHTML = `
  <div class="sn-notification-head">
   <strong>Notifications</strong>
   <span>${unseenIds.size ? `${unseenIds.size} new` : `${items.length} update${items.length === 1 ? '' : 's'}`}</span>
  </div>
  <div class="sn-notification-list">
   ${items.map(item => `
    <a class="sn-notification-item ${unseenIds.has(String(item.id)) ? 'is-unseen' : ''}" href="${item.href}">
     <span class="sn-notification-kind">${snEsc(item.kind)}</span>
     <strong>${snEsc(item.title)}</strong>
     <small>${snEsc(item.body)}</small>
    </a>
   `).join('') || '<p class="sn-notification-empty">No notifications yet.</p>'}
  </div>
 `;
}

function snAttachTopbarRealtime(customer, initialData = {}) {
 const topbar = document.querySelector('.sn-topbar');
 const right = topbar?.querySelector('.sn-topbar-right');
 if (!topbar || !right || document.getElementById('sn-notification-panel')) return;

 const messageButton = right.querySelector('[title*="Message"], [title*="message"]');
 const notificationButton = right.querySelector('[title*="Notification"], [title*="notification"]');
 messageButton?.classList.add('sn-topbar-message-btn');
 notificationButton?.classList.add('sn-topbar-notification-btn');
if (messageButton) {
  messageButton.addEventListener('click', (event) => {
    event.preventDefault();
    if (window.snFloatingChat) window.snFloatingChat.toggleList();
    else window.location.href = snInboxHref();
  });
  messageButton.setAttribute('aria-label', 'Open messages');
}
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

 let latestKey = localStorage.getItem(`sn_customer_latest_notice_${customer.id}`) || '';
 let currentData = initialData || {};
 let initialized = false;
 const dot = notificationButton?.querySelector('.sn-dot');

 function applyData(data, notify = false) {
  currentData = data || {};
  const items = snNotificationItems(data);
  const unseenItems = snUnseenNotices('customer', customer.id, items);
  const unseenIds = new Set(unseenItems.map(item => String(item.id)));
  snRenderNotificationPanel(items, unseenIds);
  const counts = snUpdateCustomerNotificationBadges(data, unseenItems.length);
  if (dot) dot.hidden = counts.notificationCount <= 0;
  const newest = unseenItems[0];
  if (newest?.id && newest.id !== latestKey) {
   if (notify && initialized) snShowToast(newest);
   latestKey = newest.id;
   localStorage.setItem(`sn_customer_latest_notice_${customer.id}`, latestKey);
  }
  initialized = true;
 }

 notificationButton?.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  const isOpen = panel.hidden;
  panel.hidden = !isOpen;
  notificationButton.setAttribute('aria-expanded', String(isOpen));
  if (isOpen) {
   snMarkNoticesSeen('customer', customer.id, snNotificationItems(currentData));
   applyData(currentData, false);
  }
 });
 document.addEventListener('click', (event) => {
  if (panel.hidden || event.target.closest('#sn-notification-panel') || event.target.closest('#sn-notification-button')) return;
  panel.hidden = true;
  notificationButton?.setAttribute('aria-expanded', 'false');
 });

 applyData(initialData, false);
 if (!window.snCustomerNotificationTimer) {
  window.snCustomerNotificationTimer = window.setInterval(async () => {
   if (document.visibilityState !== 'visible') return;
   try {
    const data = await snCustomerGet(`/api/customer/${customer.id}/dashboard`);
    applyData(data, true);
   } catch (error) {
    console.warn(error.message || error);
   }
  }, 5000);
 }
}

function renderProviderCard(provider, favoriteIds = new Set()) {
 const providerId = String(provider.id);
 const isFavorite = favoriteIds.has(providerId);
 return `
 <div class="sn-provider-card"><button class="sn-fav-btn ${isFavorite ? 'sn-fav-btn--active' : ''}" type="button" data-provider-id="${snEsc(providerId)}" aria-label="${isFavorite ? 'Saved to favorites' : 'Favorite provider'}">♥</button><div class="sn-provider-img sn-provider-img--1"></div><div class="sn-provider-info"><div class="sn-provider-name-row"><span class="sn-provider-title">${snEsc(provider.full_name)}</span><span class="sn-rating">${Number(provider.rating || 4.8).toFixed(1)}</span></div>
 ${snBadge(provider)}
 <div class="sn-provider-loc">${snEsc(provider.address || 'Angeles City')}</div>
 ${provider.recommendation_reason? `<div class="sn-recommend-reason">${snEsc(provider.recommendation_reason)}</div>`: ''}
 <div class="sn-provider-meta"><span class="sn-provider-tag">${snEsc(provider.service || provider.category || 'Service')}</span><span class="sn-provider-price">Starts at <strong>${snMoney(provider.starting_price || 350)}</strong></span></div></div></div>
 `;
}

document.addEventListener('click', async (event) => {
 const favoriteButton = event.target.closest('.sn-fav-btn[data-provider-id]');
 if (!favoriteButton) return;

 event.preventDefault();
 const customer = snCurrentCustomer();
 if (!customer?.id) {
  window.location.href = '../auth/customerLogin.html';
  return;
 }

 const providerId = String(favoriteButton.dataset.providerId);
 const currentState = favoriteButton.classList.contains('sn-fav-btn--active');
 const nextState = !currentState;
 favoriteButton.disabled = true;
 favoriteButton.classList.toggle('sn-fav-btn--active', nextState);
 favoriteButton.setAttribute('aria-label', nextState ? 'Saved to favorites' : 'Favorite provider');

 try {
  if (nextState) {
   await snSaveCustomerFavorite(customer.id, providerId);
  } else {
   await snDeleteCustomerFavorite(customer.id, providerId);
  }
 } catch (error) {
  favoriteButton.classList.toggle('sn-fav-btn--active', currentState);
  favoriteButton.setAttribute('aria-label', currentState ? 'Saved to favorites' : 'Favorite provider');
  console.warn(error.message || error);
 } finally {
  favoriteButton.disabled = false;
 }
});

function renderCustomerBooking(booking) {
 return `
 <div class="sn-booking-group" data-status="${snEsc(booking.status)}" data-booking-id="${snEsc(booking.id)}"><div class="sn-customer-booking-card" data-booking-id="${snEsc(booking.id)}"><div class="sn-customer-booking-main"><div class="sn-customer-booking-icon">&#128197;</div><div><strong class="sn-booking-provider-name">${snEsc(booking.provider_name || 'Provider')}</strong><div class="sn-provider-badge sn-badge--verified">${snEsc(booking.provider_category || 'Service Booking')}</div><div class="sn-booking-service-type">${snEsc(booking.service)}</div></div></div><div class="sn-customer-booking-meta"><span>Date: ${snDate(booking.scheduled_date)}</span><span>Time: ${snEsc(booking.scheduled_time)}</span><span>Location: ${snEsc(booking.address || '-')}</span><span>Payment: ${snEsc(booking.payment_method || 'cash')}</span></div><div class="sn-customer-booking-amount"><strong>${snMoney(booking.amount)}</strong><div style="margin:8px 0">${snStatusPill(booking.status)}</div><button class="sn-btn sn-btn-outline" type="button" data-booking-action="details" data-booking-id="${snEsc(booking.id)}">View Details</button></div></div></div>
 `;
}

function renderCustomerRows(items, emptyText) {
 return `<div class="sn-customer-list">${items.join('') || `<div class="sn-customer-card"><p>${emptyText}</p></div>`}</div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
 const customer = snCurrentCustomer();
 if (!customer?.id) return;
 snRenderCustomerChrome(customer);
 snAttachCustomerSidebarFallback();
 snAttachUniversalCustomerFilter(customer);

 try {
 const data = await snCustomerGet(`/api/customer/${customer.id}/dashboard`);
 const path = window.location.pathname;
 snAttachTopbarRealtime(customer, data);

 const dashboardCatalog = [
  { name: 'Home Repair', description: 'Plumbing, electrical, appliance, carpentry, roofing, painting, and welding.', image: 'Repairs.png', services: ['Plumbing', 'Electrical', 'Appliance', 'Carpentry', 'Roofing', 'Painting', 'Welding'] },
  { name: 'Cleaning', description: 'House cleaning, laundry, drains, and move-in or move-out cleaning.', image: 'Cleaning.png', services: ['House Cleaning', 'Deep Cleaning', 'Laundry Service', 'Drain Cleaning', 'Move-in / Move-out Cleaning'] },
  { name: 'Personal Care', description: 'Massage, nail care, grooming, and wellness services.', image: 'Personal Care.png', services: ['Massage Therapy', 'Nail Care', 'Haircut and Grooming', 'Home Wellness Care'] },
  { name: 'Appliance Maintenance', description: 'Refrigerator, aircon, washing machine, and appliance installation services.', image: 'Appliance Maintenance.png', services: ['Refrigerator Repair', 'Aircon Cleaning', 'Washing Machine Repair', 'Small Appliance Repair', 'Appliance Installation'] },
  { name: 'Home Installation', description: 'Pipes, fixtures, shelves, curtains, blinds, and general installations.', image: 'Installationn.png', services: ['Pipe Installation', 'Light Fixture Installation', 'Shelf Installation', 'Curtain and Blinds Installation', 'General Fixture Installation'] },
  { name: 'Outdoor & Property Maintenance', description: 'Grass cutting, garden cleanup, gutters, outdoor repairs, and property maintenance.', image: 'Outdoor & Property Repair.png', services: ['Grass Cutting', 'Garden Cleanup', 'Gutter Cleaning', 'Outdoor Repair', 'Property Maintenance'] },
 ];
 const verifiedProviders = data.providers || [];
 const categoryData = new Map((data.categories || []).map(category => [category.name, category]));
 const providerCountForCategory = (categoryName) => verifiedProviders.filter(provider => {
  const providerCategory = String(provider.category || '').trim().toLowerCase();
  return providerCategory === categoryName.trim().toLowerCase();
 }).length;
 const categoryGrid = document.querySelector('.sn-categories,.sn-category-list');
 if (categoryGrid) {
 const isCardList = categoryGrid.classList.contains('sn-category-list');
 categoryGrid.innerHTML = dashboardCatalog.map(category => {
  const record = categoryData.get(category.name) || {};
  const count = providerCountForCategory(category.name);
  return isCardList
   ? `<a class="sn-category-card" href="../search/search.html?category=${encodeURIComponent(category.name)}"><strong>${snEsc(category.name)}</strong><span>${snEsc(category.description)}</span></a>`
  : `<button class="sn-cat" type="button" data-category="${snEsc(category.name)}"><div class="sn-cat-icon"><img src="../../../images/LANDING PAGE/Service Catergory Images/${snEsc(category.image)}" alt="" /></div><span class="sn-cat-count">${count} provider${count === 1 ? '' : 's'}</span><span>${snEsc(category.name)}</span></button>`;
 }).join('');
 }

 const providerGrid = document.querySelector('.sn-providers-grid');
 if (providerGrid) {
 const recommendedProviders = data.recommendations?.length? data.recommendations: data.providers || [];
  const allProviders = [...new Map([...recommendedProviders, ...(data.providers || [])].map(provider => [provider.id, provider])).values()];
 const favoriteIds = new Set((data.favorites || []).map(provider => String(provider.id)));
 const hasRealProviderIds = [...providerGrid.querySelectorAll('.sn-fav-btn')].some(button => button.dataset.providerId);
 const providerTitle = providerGrid.closest('.sn-section')?.querySelector('.sn-section-head h2');
  const chipRow = document.querySelector('.sn-chips');
  const allLandingServices = ['Plumbing', 'Electrical', 'Appliance', 'Carpentry', 'Roofing', 'Painting', 'Welding'];
  const fallbackServices = Object.fromEntries(dashboardCatalog.map(category => [category.name, category.services]));
  const categoryServices = new Map((data.categories || []).map(category => [category.name, category.services || []]));
  const categoryAliases = {
   'Home Installations': 'Home Installation',
   'Outdoor & Property': 'Outdoor & Property Maintenance',
  };
 if (providerTitle && data.recommendations?.length) providerTitle.textContent = 'Recommended For You';
 const emptyText = 'No providers match this selection yet.';
 const assignStaticFavoriteIds = () => {
  const buttons = providerGrid.querySelectorAll('.sn-fav-btn');
  buttons.forEach((button, index) => {
   const provider = allProviders[index] || recommendedProviders[index];
   if (!provider?.id) return;
   const id = String(provider.id);
   button.dataset.providerId = id;
   const isFavorite = favoriteIds.has(id);
   button.classList.toggle('sn-fav-btn--active', isFavorite);
   button.setAttribute('aria-label', isFavorite ? 'Saved to favorites' : 'Favorite provider');
  });
 };
 const renderDashboardProviders = (filter = '') => {
  const normalizedFilter = filter.toLowerCase();
  const visibleProviders = normalizedFilter
  ? allProviders.filter(provider => [provider.category, provider.service, provider.full_name].some(value => String(value || '').toLowerCase().includes(normalizedFilter)))
   : recommendedProviders;
  providerGrid.innerHTML = visibleProviders.map(provider => renderProviderCard(provider, favoriteIds)).join('') || `<div class="sn-customer-card"><p>${emptyText}</p></div>`;
  if (providerTitle) providerTitle.textContent = normalizedFilter ? `${filter} Providers` : 'Recommended For You';
 };
 if (!hasRealProviderIds || !providerGrid.querySelector('.sn-fav-btn[data-provider-id]')) {
  assignStaticFavoriteIds();
  renderDashboardProviders();
 }

 const renderServiceChips = (category = '') => {
  if (!chipRow) return;
  const canonicalCategory = categoryAliases[category] || category;
  const services = fallbackServices[canonicalCategory] || categoryServices.get(canonicalCategory) || allLandingServices;
  chipRow.innerHTML = services.map((service, index) => `<button class="sn-chip${index === 0 ? ' active' : ''}" type="button">${snEsc(service)}</button>`).join('');
  chipRow.querySelectorAll('.sn-chip').forEach(button => button.addEventListener('click', () => {
   filterDashboardProviders(button, button.textContent.trim());
  }));
 };
 renderServiceChips();
 const filterDashboardProviders = (button, filter) => {
  document.querySelectorAll('.sn-cat, .sn-chip').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  renderDashboardProviders(filter);
  providerGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
 };
 document.querySelectorAll('.sn-cat').forEach(button => button.addEventListener('click', () => {
  const label = button.dataset.category || '';
  const selectedCategory = categoryAliases[label] || label;
  renderServiceChips(selectedCategory);
  filterDashboardProviders(button, selectedCategory);
 }));
 document.querySelectorAll('.sn-chip').forEach(button => button.addEventListener('click', () => {
  filterDashboardProviders(button, button.textContent.trim());
 }));
 }

 const bookings = document.getElementById('sn-bookings');
 if (bookings && data.bookings) {
 window.snCustomerBookings = data.bookings;
 bookings.innerHTML = data.bookings.map(renderCustomerBooking).join('') || '<div class="sn-customer-card"><p>No bookings yet.</p></div>';
 document.dispatchEvent(new CustomEvent('sn:customer-bookings-rendered', { detail: { bookings: data.bookings } }));
 }

 const favCards = document.querySelector('.sn-favorites-grid,.sn-fav-grid,.sn-favorites-list,.sn-fav-list');
 if (favCards && data.favorites) {
 const favoriteIds = new Set((data.favorites || []).map(provider => String(provider.id)));
 window.snCustomerFavorites = data.favorites;
 favCards.classList.add('sn-providers-grid');
 favCards.innerHTML = data.favorites.map(provider => renderProviderCard(provider, favoriteIds)).join('') || '<div class="sn-customer-card"><p>No favorite providers yet.</p></div>';
 document.dispatchEvent(new CustomEvent('sn:customer-favorites-rendered', { detail: { favorites: data.favorites } }));
 }

 const myReviews = document.getElementById('sn-my-reviews');
 if (myReviews && data.reviews) {
 myReviews.style.display = '';
 myReviews.innerHTML = renderCustomerRows(data.reviews.map(review => `
 <div class="sn-customer-row"><div><strong>${snEsc(review.provider_name || 'Provider')}</strong><span>${snEsc(review.comment || 'No comment')}</span><small>${snDate(review.created_at)}</small></div><span class="sn-status-pill active">${review.rating}/5</span></div>
 `), 'No reviews yet.');
 }

 const convoList = document.querySelector('.sn-convo-list');
 if (convoList && data.messages) {
 convoList.innerHTML = data.messages.map(message => `
 <button class="sn-convo-item" type="button" data-provider-id="${message.provider_id}"><div class="sn-convo-avatar"></div><div class="sn-convo-body"><div class="sn-convo-top"><span class="sn-convo-name">${snEsc(message.provider_name || 'Provider')}</span><span class="sn-convo-time">${snDate(message.created_at)}</span></div><div class="sn-convo-preview">${snEsc(message.message)}</div></div>
 ${message.is_read? '': '<span class="sn-convo-unread">1</span>'}
 </button>
 `).join('') || '<div class="sn-customer-card"><p>No conversations yet.</p></div>';
 }

 const chatMessages = document.getElementById('sn-chat-messages');
 if (chatMessages && data.messages?.length) {
 chatMessages.innerHTML = '<div class="sn-chat-day-divider">Conversation</div>' + data.messages.slice().reverse().map(message => `
 <div class="sn-msg ${message.sender_role === 'customer'? 'sn-msg--out': 'sn-msg--in'}"><div class="sn-msg-bubble">${snEsc(message.message)}</div><div class="sn-msg-time">${snDate(message.created_at)}</div></div>
 `).join('');
 }

 if (path.includes('/history/')) {
 const list = document.getElementById('sn-booking-list');
 if (list && data.bookings) {
 list.innerHTML = data.bookings.map(booking => `
 <button class="sn-list-item" type="button" data-id="${booking.id}" data-status="${snEsc(booking.status)}"><strong>${snEsc(booking.service)}</strong><span>${snEsc(booking.provider_name || 'Provider')} - ${snDate(booking.scheduled_date)}</span>${snStatusPill(booking.status)}
 </button>
 `).join('');
 }
 }
 } catch (error) {
 console.warn(error.message || error);
 }
});
