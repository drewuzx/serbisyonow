const CUSTOMER_API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));
window.snDisableCustomerTopbarSearch = true;

function getCurrentCustomer() {
 try {
 const raw = localStorage.getItem('sn_customer_user');
 if (!raw) return null;
 return JSON.parse(raw);
 } catch { return null; }
}

function esc(value) {
 return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function reviewDate(value) {
 if (!value) return '-';
 return new Date(value).toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' });
}

function updateReviewsNotificationCount(data) {
 const button = document.querySelector('.sn-topbar-right [title*="Notification"], .sn-topbar-right [title*="notification"]');
 const activeStatuses = new Set(['pending', 'accepted', 'upcoming', 'ongoing']);
 const activeBookings = (data.bookings || []).filter((booking) => activeStatuses.has(String(booking.status || '').toLowerCase())).length;
 const unreadMessages = (data.messages || []).filter((message) => message.sender_role === 'provider' && !message.is_read).length;
 const setBadge = (target, count, label) => {
  if (!target) return;
  target.classList.add('sn-has-count-badge');
  target.querySelector('.sn-dot')?.setAttribute('hidden', '');
  let badge = target.querySelector('.sn-badge-count');
  if (count <= 0) {
   badge?.remove();
   return;
  }
  if (!badge) {
   badge = document.createElement('span');
   badge.className = 'sn-badge-count';
   target.appendChild(badge);
  }
  badge.textContent = count > 99 ? '99+' : String(count);
  target.setAttribute('aria-label', `${count} ${label}`);
 };
 setBadge(button, activeBookings + unreadMessages, 'new notifications');
 setBadge(document.getElementById('sn-hamburger-top'), activeBookings + unreadMessages, 'new notifications');
 setBadge(document.querySelector('.sn-nav-item[href*="bookings"]'), activeBookings, 'active bookings');
 setBadge(document.querySelector('.sn-nav-item[href*="inbox"]'), unreadMessages, 'unread messages');
}

function showReviewSuccessToast() {
 const existing = document.getElementById('sn-review-success-toast');
 if (existing) existing.remove();
 const toast = document.createElement('div');
 toast.id = 'sn-review-success-toast';
 toast.className = 'sn-toast sn-toast--success';
 toast.innerHTML = '<div class="sn-toast-icon"></div><div class="sn-toast-text">Review submitted successfully.<div class="sn-toast-sub">Thank you for sharing your experience with the provider.</div></div>';
 document.body.appendChild(toast);
 setTimeout(() => {
  toast.style.opacity = '0';
  setTimeout(() => toast.remove(), 400);
 }, 6000);
}

function showReviewErrorToast(message) {
 const existing = document.getElementById('sn-review-error-toast');
 if (existing) existing.remove();
 const toast = document.createElement('div');
 toast.id = 'sn-review-error-toast';
 toast.className = 'sn-toast sn-toast--danger';
 toast.innerHTML = `<div class="sn-toast-icon">!</div><div class="sn-toast-text">Review not submitted.<div class="sn-toast-sub">${esc(message)}</div></div>`;
 document.body.appendChild(toast);
 setTimeout(() => {
  toast.style.opacity = '0';
  setTimeout(() => toast.remove(), 400);
 }, 6000);
}

function openReviewModal(providerName) {
 return new Promise((resolve) => {
 const backdrop = document.createElement('div');
 backdrop.className = 'sn-modal';
 backdrop.innerHTML = `
  <section class="sn-modal-card" role="dialog" aria-modal="true" aria-labelledby="sn-review-modal-title">
   <div class="sn-modal-head"><h2 id="sn-review-modal-title">Review ${esc(providerName)}</h2><button class="sn-modal-close" type="button" aria-label="Close">×</button></div>
   <label class="sn-modal-field"><span>Rating</span><select class="sn-modal-input" id="sn-review-rating"><option value="5">5 - Excellent</option><option value="4">4 - Good</option><option value="3">3 - Average</option><option value="2">2 - Poor</option><option value="1">1 - Very poor</option></select></label>
   <label class="sn-modal-field"><span>Comment</span><textarea class="sn-modal-input" id="sn-review-comment" rows="4" placeholder="Share your experience"></textarea></label>
   <div class="sn-modal-actions"><button class="sn-btn sn-btn-outline" type="button" data-review-cancel>Cancel</button><button class="sn-btn sn-btn-primary" type="button" data-review-submit>Submit Review</button></div>
  </section>`;
 const close = (result) => { backdrop.remove(); resolve(result); };
 backdrop.querySelector('.sn-modal-close').addEventListener('click', () => close(null));
 backdrop.querySelector('[data-review-cancel]').addEventListener('click', () => close(null));
 backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(null); });
 backdrop.querySelector('[data-review-submit]').addEventListener('click', () => close({
  rating: Number(backdrop.querySelector('#sn-review-rating').value),
  comment: backdrop.querySelector('#sn-review-comment').value.trim(),
 }));
 document.body.appendChild(backdrop);
 backdrop.querySelector('#sn-review-rating').focus();
 });
}

async function submitReview(booking) {
 const result = await openReviewModal(booking.provider_name || 'Provider');
 if (!result) return;
 const customer = getCurrentCustomer();
 const response = await fetch(`${CUSTOMER_API_BASE}/api/customer/${customer.id}/reviews`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ provider_id: booking.provider_id, booking_id: booking.id, ...result }),
 });
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(data.message || `Unable to submit review. Server response: ${response.status}.`);
 const refreshed = await fetch(`${CUSTOMER_API_BASE}/api/customer/${customer.id}/dashboard`);
 const refreshedData = await refreshed.json().catch(() => ({}));
 if (!refreshed.ok) throw new Error(refreshedData.message || 'Review was saved, but the page could not refresh.');
 renderLiveReviews(refreshedData.bookings || [], refreshedData.reviews || []);
 showReviewSuccessToast();
}

function renderLiveReviews(bookings, reviews) {
 const toRatePanel = document.getElementById('sn-to-rate');
 const myReviewsPanel = document.getElementById('sn-my-reviews');
 if (!toRatePanel || !myReviewsPanel) return;

 const reviewedBookingIds = new Set(reviews.map((review) => String(review.booking_id)).filter(Boolean));
 const toRate = bookings.filter((booking) =>
  String(booking.status || '').toLowerCase() === 'completed' && !reviewedBookingIds.has(String(booking.id))
 );
 const header = document.querySelector('.sn-page-header');
 let status = document.getElementById('sn-reviews-live-status');
 if (!status && header) {
  status = document.createElement('p');
  status.id = 'sn-reviews-live-status';
  status.className = 'sn-reviews-live-status';
  header.appendChild(status);
 }
 if (status) status.textContent = `${toRate.length} service${toRate.length === 1 ? '' : 's'} to review`;

 toRatePanel.innerHTML = toRate.length ? toRate.map((booking, index) => `
  <div class="sn-review-card">
   <div class="sn-review-img sn-review-img--${(index % 5) + 1}"></div>
   <div class="sn-review-info">
	<div class="sn-review-name-row"><span class="sn-review-name">${esc(booking.provider_name || 'Provider')}</span></div>
	<div class="sn-review-meta-row"><span class="sn-review-meta">${reviewDate(booking.scheduled_date)} - ${esc(booking.service || 'Service')}</span></div>
	<div class="sn-review-meta-row"><span class="sn-review-meta">${esc(booking.address || 'Address unavailable')}</span></div>
   </div>
    <div class="sn-review-rate-col"><button class="sn-btn sn-btn-primary sn-btn-sm" type="button" data-review-booking="${booking.id}">Review</button></div>
  </div>
 `).join('') : '<div class="sn-empty-state">No completed services waiting for a review.</div>';

 toRatePanel.querySelectorAll('[data-review-booking]').forEach((button) => {
   button.addEventListener('click', async () => {
    const booking = toRate.find((item) => String(item.id) === button.dataset.reviewBooking);
    if (!booking) return;
    button.disabled = true;
   try { await submitReview(booking); } catch (error) { showReviewErrorToast(error.message); button.disabled = false; }
   });
 });

 myReviewsPanel.innerHTML = reviews.length ? reviews.map((review, index) => `
  <div class="sn-review-card">
   <div class="sn-review-img sn-review-img--${(index % 5) + 1}"></div>
   <div class="sn-review-info">
	<div class="sn-review-name-row"><span class="sn-review-name">${esc(review.provider_name || 'Provider')}</span></div>
	<div class="sn-review-meta-row"><span class="sn-review-meta">${reviewDate(review.created_at)} - ${esc(review.service || 'Service')}</span></div>
	<div class="sn-review-meta-row"><span class="sn-review-meta">${esc(review.comment || 'No comment')}</span></div>
   </div>
   <div class="sn-review-rate-col"><div class="sn-stars live-rating" aria-label="${review.rating} out of 5">${'★'.repeat(Number(review.rating) || 0)}${'☆'.repeat(5 - (Number(review.rating) || 0))}</div></div>
  </div>
 `).join('') : '<div class="sn-empty-state">You have not submitted any reviews yet.</div>';
}

document.addEventListener('DOMContentLoaded', async () => {
 const currentCustomer = getCurrentCustomer();
 if (!currentCustomer) {
 window.location.href = '../../auth/customerLogin.html';
 return;
 }
 document.querySelector('.sn-topbar-search')?.remove();
 // Always re-fetch fresh verification status from the API before guarding
 // (localStorage may be stale if admin verified/rejected while user was already logged in)
 try {
 const _res = await fetch(`${CUSTOMER_API_BASE}/api/auth/customer/status/${currentCustomer.id}`);
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


 // Sidebar greeting
 const status = currentCustomer?.verification_status || 'pending';
 const userName = document.getElementById('sn-user-name');
 const userStatus = document.getElementById('sn-user-status');
 if (userName) userName.textContent = currentCustomer?.full_name || 'Customer';
 if (userStatus) {
 userStatus.textContent = status === 'verified'? 'Verified customer': status === 'rejected'? 'Verification declined': 'Awaiting verification';
 }

 // Sidebar toggle
 const shell = document.querySelector('.sn-shell');
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

 // Tabs
 const toRatePanel = document.getElementById('sn-to-rate');
 const myReviewsPanel = document.getElementById('sn-my-reviews');
 try {
 const response = await fetch(`${CUSTOMER_API_BASE}/api/customer/${currentCustomer.id}/dashboard`);
 const data = await response.json().catch(() => ({}));
 if (response.ok) {
  renderLiveReviews(data.bookings || [], data.reviews || []);
  updateReviewsNotificationCount(data);
 }
 } catch (_) { /* keep the page usable if the server is offline */ }

 document.querySelectorAll('.sn-filter-tab').forEach(tab => {
 tab.addEventListener('click', () => {
 document.querySelectorAll('.sn-filter-tab').forEach(t => t.classList.remove('active'));
 tab.classList.add('active');
 if (tab.dataset.tab === 'to-rate') {
 toRatePanel.style.display = '';
 myReviewsPanel.style.display = 'none';
 } else {
 toRatePanel.style.display = 'none';
 myReviewsPanel.style.display = '';
 }
 });
 });

 // Star rating
 document.querySelectorAll('.sn-stars').forEach(starsEl => {
 const stars = starsEl.querySelectorAll('.sn-star');
 let selected = 0;

 stars.forEach(star => {
 star.addEventListener('mouseover', () => {
 const val = parseInt(star.dataset.val);
 stars.forEach(s => {
 s.textContent = parseInt(s.dataset.val) <= val? '': '';
 s.classList.toggle('filled', parseInt(s.dataset.val) <= val);
 });
 });

 star.addEventListener('mouseleave', () => {
 stars.forEach(s => {
 s.textContent = parseInt(s.dataset.val) <= selected? '': '';
 s.classList.toggle('filled', parseInt(s.dataset.val) <= selected);
 });
 });

 star.addEventListener('click', () => {
 selected = parseInt(star.dataset.val);
 stars.forEach(s => {
 s.textContent = parseInt(s.dataset.val) <= selected? '': '';
 s.classList.toggle('filled', parseInt(s.dataset.val) <= selected);
 });
 });
 });

 starsEl.addEventListener('mouseleave', () => {
 stars.forEach(s => {
 s.textContent = parseInt(s.dataset.val) <= selected? '': '';
 s.classList.toggle('filled', parseInt(s.dataset.val) <= selected);
 });
 });
 });
});
