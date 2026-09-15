/* ============================================================
 SerbisyoNow Booking History JS
 Consistent with bookings.js patterns
 ============================================================ */

const CUSTOMER_HISTORY_API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));

function getCurrentCustomer() {
 try {
 const raw = localStorage.getItem('sn_customer_user');
 if (!raw) return null;
 return JSON.parse(raw);
 } catch { return null; }
}

// Date Sorting Functions
function parseHistoryDate(dateString) {
 // Parse "May 05, 2026 at 9:00 AM" format
 try {
  return new Date(dateString);
 } catch {
  return null;
 }
}

function sortHistoryByDate(items, order = 'desc') {
 return items.sort((a, b) => {
  const dateA = parseHistoryDate(a.date);
  const dateB = parseHistoryDate(b.date);
  
  if (!dateA || !dateB) return 0;
  
  return order === 'desc' ? dateB - dateA : dateA - dateB;
 });
}

function applySortOrder(order) {
 const items = document.querySelectorAll('.sn-history-item');
 const sortedData = sortHistoryByDate([...HISTORY_DATA], order);
 const sortedIds = sortedData.map(item => item.id);
 
 // Reorder DOM items
 const list = document.getElementById('sn-history-list');
 const itemsArray = Array.from(items);
 
 itemsArray.sort((a, b) => {
  const idA = parseInt(a.dataset.id, 10);
  const idB = parseInt(b.dataset.id, 10);
  return sortedIds.indexOf(idA) - sortedIds.indexOf(idB);
 });
 
 itemsArray.forEach(item => list.appendChild(item));
 
 // Update button states
 document.getElementById('sort-asc')?.classList.toggle('active', order === 'asc');
 document.getElementById('sort-desc')?.classList.toggle('active', order === 'desc');
}

// Mock history data replace with real API call later
const HISTORY_DATA = [
 {
 id: 1,
 status: 'completed',
 providerName: 'Juan Plumbing Services',
 avatarClass: 'sn-hi-avatar--1',
 bookingId: '#JBK-10024',
 serviceTag: 'Pipe Repair',
 verified: true,
 date: 'May 05, 2026 at 9:00 AM',
 service: 'Pipe Repair',
 address: 'Blk 12 Lot 5, Quezon Street, Balibago Angeles City, Pampanga',
 amount: '600.00',
 payment: 'Cash',
 completedAt: 'May 05, 2026 at 1:30 PM',
 reason: null,
 },
 {
 id: 2,
 status: 'completed',
 providerName: 'Jane Nail Services',
 avatarClass: 'sn-hi-avatar--2',
 bookingId: '#JBK-10025',
 serviceTag: 'Nail Care',
 verified: true,
 date: 'May 05, 2026 at 10:00 AM',
 service: 'Cleaning & Gel Nail Extensions',
 address: 'Blk 12 Lot 5, Quezon Street, Balibago Angeles City, Pampanga',
 amount: '980.00',
 payment: 'Cash',
 completedAt: 'May 05, 2026 at 2:00 PM',
 reason: null,
 },
 {
 id: 3,
 status: 'completed',
 providerName: 'Gina Cleaning Services',
 avatarClass: 'sn-hi-avatar--3',
 bookingId: '#JBK-10026',
 serviceTag: 'Deep Cleaning',
 verified: true,
 date: 'May 05, 2026 at 9:00 AM',
 service: 'Deep Cleaning',
 address: 'Blk 12 Lot 5, Quezon Street, Balibago Angeles City, Pampanga',
 amount: '850.00',
 payment: 'Cash',
 completedAt: 'May 05, 2026 at 3:30 PM',
 reason: null,
 },
 {
 id: 4,
 status: 'cancelled',
 providerName: 'Melchor Plumbing',
 avatarClass: 'sn-hi-avatar--4',
 bookingId: '#JBK-10027',
 serviceTag: 'Plumbing',
 verified: false,
 date: 'May 05, 2026 at 11:00 AM',
 service: 'Fixed Sink Leak',
 address: 'Blk 12 Lot 5, Quezon Street, Balibago Angeles City, Pampanga',
 amount: '600.00',
 payment: 'Cash',
 completedAt: null,
 reason: 'Booked the wrong service',
 },
 {
 id: 5,
 status: 'cancelled',
 providerName: 'Roland Plumbing Solutions',
 avatarClass: 'sn-hi-avatar--5',
 bookingId: '#JBK-10028',
 serviceTag: 'Plumbing',
 verified: false,
 date: 'May 05, 2026 at 1:00 PM',
 service: 'Fixed Sink Leak',
 address: 'Blk 12 Lot 5, Quezon Street, Balibago Angeles City, Pampanga',
 amount: '600.00',
 payment: 'Cash',
 completedAt: null,
 reason: 'Duplicate booking',
 },
];

document.addEventListener('DOMContentLoaded', async () => {
 const currentCustomer = getCurrentCustomer();
 if (!currentCustomer) {
 window.location.href = '../../auth/customerLogin.html';
 return;
 }
 // Always re-fetch fresh verification status from the API before guarding
 // (localStorage may be stale if admin verified/rejected while user was already logged in)
 try {
 const _res = await fetch(`${CUSTOMER_HISTORY_API_BASE}/api/auth/customer/status/${currentCustomer.id}`);
 if (_res.ok) {
 const _data = await _res.json().catch(() => ({}));
 if (_data.user) {
 const _merged = {...currentCustomer,..._data.user };
 localStorage.setItem('sn_customer_user', JSON.stringify(_merged));
 Object.assign(currentCustomer, _merged);
 }
 }
 } catch (_) { /* server offline use cached localStorage value */ }

 const _vStatus = currentCustomer?.verification_status || 'pending';
 // Show banner and lock content if not verified
 const verifyBanner = document.getElementById('sn-verify-banner');
 if (_vStatus!== 'verified') {
 document.body.classList.add('sn-locked');
 if (verifyBanner) {
 verifyBanner.hidden = false;
 if (_vStatus === 'rejected') {
 verifyBanner.textContent = 'Your verification was declined by the admin. Please resubmit your documents.';
 verifyBanner.style.background = '#fef2f2';
 verifyBanner.style.borderLeft = '4px solid #dc2626';
 verifyBanner.style.color = '#991b1b';
 } else {
 verifyBanner.textContent = 'Your account is pending admin verification. Actions are disabled until verified.';
 }
 }
 } else {
 document.body.classList.remove('sn-locked');
 if (verifyBanner) verifyBanner.hidden = true;
 }


 // Populate sidebar greeting
 const status = currentCustomer?.verification_status || 'pending';
 const userName = document.getElementById('sn-user-name');
 const userStatus = document.getElementById('sn-user-status');
 if (userName) userName.textContent = currentCustomer?.full_name || 'Customer';
 if (userStatus) {
 userStatus.textContent = status === 'verified'? 'Verified customer': status === 'rejected'? 'Verification declined': 'Awaiting verification';
 }

 // Sidebar toggle (same pattern as all other pages)
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
 const open = shell.classList.contains('sidebar-open') ||!shell.classList.contains('sidebar-collapsed');
 if (open) closeSidebar(); else openSidebar();
 }

 hamburger?.addEventListener('click', toggleSidebar);
 hamburgerTop?.addEventListener('click', toggleSidebar);
 overlay?.addEventListener('click', () => { if (isMobile()) closeSidebar(); });
 logoutBtn?.addEventListener('click', () => { localStorage.removeItem('sn_customer_user'); window.location.href = '../../landing/index.html'; });
 if (isMobile()) closeSidebar(); else openSidebar();

 // Filter Tabs 
 const tabs = document.querySelectorAll('.sn-filter-tab');
 const items = document.querySelectorAll('.sn-history-item');

 tabs.forEach(tab => {
 tab.addEventListener('click', () => {
 tabs.forEach(t => t.classList.remove('active'));
 tab.classList.add('active');
 const filter = tab.dataset.filter;
 items.forEach(item => {
 if (filter === 'all' || item.dataset.status === filter) {
 item.style.display = '';
 } else {
 item.style.display = 'none';
 }
 });
 });
 });

 // Detail Panel Population 
 function populateDetail(booking) {
 const isCompleted = booking.status === 'completed';

 // Header
 document.getElementById('detail-avatar').className = `sn-detail-avatar ${booking.avatarClass}`;
 document.getElementById('detail-provider-name').textContent = booking.providerName;
 document.getElementById('detail-booking-id').textContent = ` Booking ID: ${booking.bookingId}`;
 document.getElementById('detail-service-tag').textContent = booking.serviceTag;

 const verifiedBadge = document.getElementById('detail-verified');
 if (booking.verified) {
 verifiedBadge.style.display = '';
 } else {
 verifiedBadge.style.display = 'none';
 }

 // Banner
 const banner = document.getElementById('sn-completion-banner');
 const bannerTitle = document.getElementById('banner-title');
 const bannerSub = document.getElementById('banner-sub');
 banner.style.display = '';
 if (isCompleted) {
 banner.className = 'sn-completion-banner';
 bannerTitle.textContent = 'This booking has been completed.';
 bannerSub.textContent = 'Thank you for using SerbisyoNow!';
 } else {
 banner.className = 'sn-completion-banner sn-completion-banner--cancelled';
 bannerTitle.textContent = 'This booking was cancelled.';
 bannerSub.textContent = booking.reason? `Reason: ${booking.reason}`: '';
 }

 // Detail rows
 document.getElementById('detail-date').textContent = booking.date;
 document.getElementById('detail-service').textContent = booking.service;
 document.getElementById('detail-address').textContent = booking.address;
 document.getElementById('detail-amount').textContent = booking.amount;
 document.getElementById('detail-payment').textContent = booking.payment;

 const statusBadge = document.getElementById('detail-status-badge');
 statusBadge.innerHTML = isCompleted? '<span class="sn-status-pill sn-pill--completed"> Completed</span>': '<span class="sn-status-pill sn-pill--cancelled"> Cancelled</span>';

 const completedRow = document.getElementById('detail-completed-row');
 const reasonRow = document.getElementById('detail-reason-row');

 if (isCompleted) {
 completedRow.style.display = '';
 reasonRow.classList.add('sn-dr--hidden');
 document.getElementById('detail-completed-at').textContent = booking.completedAt;
 } else {
 completedRow.style.display = 'none';
 reasonRow.classList.remove('sn-dr--hidden');
 document.getElementById('detail-reason').textContent = booking.reason || '';
 }

 // Provider card
 document.getElementById('detail-card-avatar').className = `sn-provider-info-avatar ${booking.avatarClass}`;
 document.getElementById('detail-card-name').textContent = booking.providerName;
 }

 // History Item Click 
 items.forEach(item => {
 item.addEventListener('click', () => {
 items.forEach(i => i.classList.remove('active'));
 item.classList.add('active');

 const id = Number(item.dataset.id);
 const booking = HISTORY_DATA.find(b => b.id === id);
 if (booking) populateDetail(booking);
 });
 });

 // Banner Close 
 document.getElementById('sn-banner-close')?.addEventListener('click', () => {
 document.getElementById('sn-completion-banner').style.display = 'none';
 });

 // Search 
 document.getElementById('history-search')?.addEventListener('input', function () {
 const q = this.value.toLowerCase().trim();
 items.forEach(item => {
 const name = item.querySelector('.sn-hi-name')?.textContent.toLowerCase() || '';
 const meta = item.querySelector('.sn-hi-meta')?.textContent.toLowerCase() || '';
 item.style.display = (name.includes(q) || meta.includes(q))? '': 'none';
 });
 });

 // Date Sort Buttons
 document.getElementById('sort-asc')?.addEventListener('click', () => applySortOrder('asc'));
 document.getElementById('sort-desc')?.addEventListener('click', () => applySortOrder('desc'));
 
 // Default sort descending
 applySortOrder('desc');

 // Load first item by default
 populateDetail(HISTORY_DATA[0]);
});

