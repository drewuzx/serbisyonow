const BOOKINGS = [
 {
 id: 'b1',
 status: 'ongoing',
 provider: 'Juan Plumbing Service',
 details: {
 bookingId: '#SN-1029',
 date: 'Apr 30, 2026',
 time: '10:00 AM',
 service: 'Plumbing repair',
 price: '500.00',
 address: 'Bian, Laguna',
 },
 timeline: [
 { state: 'done', title: 'Booking request sent', meta: 'Just now' },
 { state: 'done', title: 'Provider accepted', meta: 'A few minutes ago' },
 { state: 'active', title: 'Working in progress', meta: 'Estimated completion: 2 hrs' },
 ],
 },
 {
 id: 'b2',
 status: 'completed',
 provider: 'Maria Cleaning Service',
 details: {
 bookingId: '#SN-0983',
 date: 'Apr 22, 2026',
 time: '2:30 PM',
 service: 'Home cleaning',
 price: '750.00',
 address: 'Santa Rosa, Laguna',
 },
 timeline: [
 { state: 'done', title: 'Booking request sent', meta: 'Apr 22, 2026' },
 { state: 'done', title: 'Provider accepted', meta: 'Apr 22, 2026' },
 { state: 'done', title: 'Service completed', meta: 'Apr 22, 2026' },
 ],
 },
 {
 id: 'b3',
 status: 'cancelled',
 provider: 'Ryan AC Maintenance',
 details: {
 bookingId: '#SN-0941',
 date: 'Apr 18, 2026',
 time: '11:00 AM',
 service: 'AC maintenance',
 price: '1,200.00',
 address: 'Calamba, Laguna',
 },
 timeline: [
 { state: 'done', title: 'Booking request sent', meta: 'Apr 18, 2026' },
 { state: 'active', title: 'Booking cancelled', meta: 'By customer' },
 ],
 },
];

const API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));
const POLL_INTERVAL_MS = 5000; // check every 5 seconds
let _pollTimer = null;

function getCurrentCustomer() {
 try {
 const raw = localStorage.getItem('sn_customer_user');
 if (!raw) return null;
 return JSON.parse(raw);
 } catch {
 return null;
 }
}

function saveCurrentCustomer(user) {
 try {
 localStorage.setItem('sn_customer_user', JSON.stringify(user));
 } catch {
 // ignore
 }
}

function showVerificationToast(status) {
 const existing = document.getElementById('sn-verify-toast');
 if (existing) existing.remove();

 const isVerified = status === 'verified';
 const toast = document.createElement('div');
 toast.id = 'sn-verify-toast';
 toast.className = `sn-toast ${isVerified? 'sn-toast--success': 'sn-toast--danger'}`;

 toast.innerHTML = `
 <div class="sn-toast-icon">${isVerified? '': ''}</div><div class="sn-toast-text">
 ${isVerified? 'Your account has been verified!': 'Your account verification was declined.'}
 <div class="sn-toast-sub">${isVerified? 'You can now book services.': 'Please resubmit your documents in your profile.'}</div></div>
 `;

 document.body.appendChild(toast);

 setTimeout(() => {
 toast.style.opacity = '0';
 setTimeout(() => toast.remove(), 400);
 }, 6000);
}

function applyVerificationState(user) {
 const verifyBanner = document.getElementById('sn-verify-banner');
 const userName = document.getElementById('sn-user-name');
 const userStatus = document.getElementById('sn-user-status');
 const isVerified = Boolean(user?.is_verified);
 const status = user?.verification_status || (isVerified? 'verified': 'pending');

 if (userName) userName.textContent = user?.full_name || 'Customer';
 if (userStatus) {
 if (status === 'verified') userStatus.textContent = 'Verified customer';
 else if (status === 'rejected') userStatus.textContent = 'Verification declined';
 else userStatus.textContent = 'Awaiting verification';
 }

 if (!isVerified) {
 document.body.classList.add('sn-locked');
 if (verifyBanner) {
 verifyBanner.hidden = false;
 if (status === 'rejected') {
 verifyBanner.textContent = 'Your verification was declined by the admin. Please resubmit your documents.';
 verifyBanner.style.background = '#fef2f2';
 verifyBanner.style.borderLeft = '4px solid #dc2626';
 verifyBanner.style.color = '#991b1b';
 } else {
 verifyBanner.textContent = 'Your account is pending admin verification. You can view limited details, but booking actions are disabled until verified.';
 verifyBanner.style.background = '';
 verifyBanner.style.borderLeft = '';
 verifyBanner.style.color = '';
 }
 }
 } else {
 document.body.classList.remove('sn-locked');
 if (verifyBanner) verifyBanner.hidden = true;
 }
}

async function pollVerificationStatus() {
 const customer = getCurrentCustomer();
 if (!customer?.id) return;

 // Only poll if not yet verified
 if (customer.verification_status === 'verified' && customer.is_verified) {
 stopPolling();
 return;
 }

 try {
 const res = await fetch(`${API_BASE}/api/auth/customer/status/${customer.id}`);
 if (!res.ok) return;

 const data = await res.json();
 const updated = data.user;
 if (!updated) return;

 const prevStatus = customer.verification_status || (customer.is_verified? 'verified': 'pending');
 const newStatus = updated.verification_status || (updated.is_verified? 'verified': 'pending');

 // Status changed update localStorage and UI
 if (prevStatus!== newStatus) {
 saveCurrentCustomer({...customer,...updated });
 applyVerificationState(updated);
 showVerificationToast(newStatus);

 // Stop polling once a final status is reached
 if (newStatus === 'verified' || newStatus === 'rejected') {
 stopPolling();
 }
 }
 } catch {
 // Network error silently ignore, will retry
 }
}

function startPolling() {
 stopPolling();
 _pollTimer = setInterval(pollVerificationStatus, POLL_INTERVAL_MS);
}

function stopPolling() {
 if (_pollTimer) {
 clearInterval(_pollTimer);
 _pollTimer = null;
 }
}

function pillForStatus(status) {
 const map = {
 ongoing: { label: 'Ongoing', cls: 'sn-pill sn-pill-green' },
 completed: { label: 'Completed', cls: 'sn-pill sn-pill-blue' },
 cancelled: { label: 'Cancelled', cls: 'sn-pill sn-pill-red' },
 };
 return map[status] || { label: status, cls: 'sn-pill' };
}

function renderTimeline(items) {
 const el = document.getElementById('sn-timeline');
 if (!el) return;
 el.innerHTML = items.map(
 (t) => `
 <li class="${t.state}"><span class="dot"></span><div><strong>${t.title}</strong><div class="muted">${t.meta}</div></div></li>
 `.trim(),
 ).join('');
}

function renderDetails(booking) {
 const providerName = document.getElementById('sn-detail-provider');
 const statusPill = document.getElementById('sn-detail-status');
 const providerCardName = document.getElementById('sn-provider-name');
 const providerSideName = document.getElementById('sn-provider-name');

 if (providerName) providerName.textContent = booking.provider;
 if (providerCardName) providerCardName.textContent = booking.provider;
 if (providerSideName) providerSideName.textContent = booking.provider;

 if (statusPill) {
 const pill = pillForStatus(booking.status);
 statusPill.className = pill.cls;
 statusPill.textContent = pill.label;
 }

 const kv = document.getElementById('sn-detail-kv');
 if (kv) {
 kv.innerHTML = `
 <div><dt>Booking ID</dt><dd>${booking.details.bookingId}</dd></div><div><dt>Date</dt><dd>${booking.details.date}</dd></div><div><dt>Time</dt><dd>${booking.details.time}</dd></div><div><dt>Service</dt><dd>${booking.details.service}</dd></div><div><dt>Price</dt><dd>${booking.details.price}</dd></div><div><dt>Address</dt><dd>${booking.details.address}</dd></div>
 `.trim();
 }

 renderTimeline(booking.timeline);
}

function setSelected(id) {
 document.querySelectorAll('.sn-list-item').forEach((btn) => {
 btn.classList.toggle('selected', btn.dataset.id === id);
 });
 const booking = BOOKINGS.find((b) => b.id === id);
 if (booking) renderDetails(booking);
}

function setFilter(filter) {
 document.querySelectorAll('.sn-tab').forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
 document.querySelectorAll('.sn-list-item').forEach((item) => {
 const status = item.dataset.status;
 const visible = filter === 'all'? true: status === filter;
 item.style.display = visible? '': 'none';
 });

 // keep a visible item selected
 const selected = document.querySelector('.sn-list-item.selected');
 if (selected && selected.style.display === 'none') {
 const firstVisible = Array.from(document.querySelectorAll('.sn-list-item')).find((x) => x.style.display!== 'none');
 if (firstVisible) setSelected(firstVisible.dataset.id);
 }
}

document.addEventListener('DOMContentLoaded', () => {
 const currentCustomer = getCurrentCustomer();
 if (!currentCustomer) {
 window.location.href = '../../auth/customerLogin.html';
 return;
 }

 applyVerificationState(currentCustomer);

 // Start polling only if not yet verified
 if (currentCustomer.verification_status!== 'verified' ||!currentCustomer.is_verified) {
 startPolling();
 }

 const shell = document.querySelector('.sn-shell');
 const sidebar = document.getElementById('sn-sidebar');
 const overlay = document.getElementById('sn-overlay');
 const hamburger = document.getElementById('sn-hamburger');
 const hamburgerTop = document.getElementById('sn-hamburger-top');
 const logoutBtn = document.getElementById('sn-logout');
 const SIDEBAR_STORAGE_KEY = 'sn.dashboard.sidebarState'; // 'open' | 'collapsed'

 function isMobile() {
 return window.matchMedia('(max-width: 940px)').matches;
 }

 function getStoredState() {
 try {
 return localStorage.getItem(SIDEBAR_STORAGE_KEY);
 } catch {
 return null;
 }
 }

 function storeState(state) {
 try {
 localStorage.setItem(SIDEBAR_STORAGE_KEY, state);
 } catch {
 // ignore (storage disabled)
 }
 }

 function clearStoredState() {
 try {
 localStorage.removeItem(SIDEBAR_STORAGE_KEY);
 } catch {
 // ignore
 }
 }

 function closeSidebar() {
 if (!shell) return;
 shell.classList.remove('sidebar-open');
 shell.classList.add('sidebar-collapsed');
 hamburger?.setAttribute('aria-expanded', 'false');
 hamburger?.setAttribute('aria-label', 'Open menu');
 hamburgerTop?.setAttribute('aria-expanded', 'false');
 hamburgerTop?.setAttribute('aria-label', 'Open menu');
 document.body.style.overflow = '';

 if (!isMobile()) storeState('collapsed');
 }

 function openSidebar() {
 if (!shell) return;
 shell.classList.remove('sidebar-collapsed');
 shell.classList.add('sidebar-open');
 hamburger?.setAttribute('aria-expanded', 'true');
 hamburger?.setAttribute('aria-label', 'Close menu');
 hamburgerTop?.setAttribute('aria-expanded', 'true');
 hamburgerTop?.setAttribute('aria-label', 'Close menu');
 if (isMobile()) document.body.style.overflow = 'hidden';

 if (!isMobile()) storeState('open');
 }

 function toggleSidebar() {
 if (!shell) return;
 const open = shell.classList.contains('sidebar-open') ||!shell.classList.contains('sidebar-collapsed');
 open? closeSidebar(): openSidebar();
 }

 hamburger?.addEventListener('click', () => {
 toggleSidebar();
 });

 hamburgerTop?.addEventListener('click', () => {
 toggleSidebar();
 });

 overlay?.addEventListener('click', () => {
 if (isMobile()) closeSidebar();
 });

 document.addEventListener('keydown', (e) => {
 if (e.key === 'Escape') closeSidebar();
 });

 // Close after tapping nav item on mobile
 sidebar?.addEventListener('click', (e) => {
 const link = e.target.closest('.sn-nav-item');
 if (!link) return;
 if (isMobile()) closeSidebar();
 });

 window.addEventListener('resize', () => {
 // When switching between desktop/mobile, reset to a sane state.
 if (isMobile()) {
 closeSidebar();
 } else {
 document.body.style.overflow = '';
 const state = getStoredState();
 if (state === 'collapsed') closeSidebar();
 else openSidebar();
 }
 });

 logoutBtn?.addEventListener('click', () => {
 stopPolling();
 localStorage.removeItem('sn_customer_user');
 clearStoredState();
 window.location.href = '../../landing/index.html';
 });

 document.getElementById('sn-booking-list')?.addEventListener('click', (e) => {
 const btn = e.target.closest('.sn-list-item');
 if (!btn) return;
 setSelected(btn.dataset.id);
 });

 document.querySelector('.sn-tabs')?.addEventListener('click', (e) => {
 const tab = e.target.closest('.sn-tab');
 if (!tab) return;
 setFilter(tab.dataset.filter);
 });

 // init
 const initial = document.querySelector('.sn-list-item.selected')?.dataset.id || 'b1';
 setSelected(initial);
 setFilter('all');

 // default state:
 // - mobile: closed
 // - desktop: closed unless user previously chose "open"
 if (isMobile()) closeSidebar();
 else (getStoredState() === 'open'? openSidebar(): closeSidebar());
});