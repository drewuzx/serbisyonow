const FAVORITES_API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));

function getCurrentCustomer() {
 try {
 const raw = localStorage.getItem('sn_customer_user');
 if (!raw) return null;
 return JSON.parse(raw);
 } catch { return null; }
}

function favEsc(value) {
 return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function favMoney(value) {
 return `PHP ${Number(value || 0).toLocaleString('en-PH')}`;
}

function favBadge(provider) {
 const tier = provider.verified_tier || (provider.verification_status === 'verified' ? 'skilled' : 'basic');
 if (tier === 'top') return '<div class="sn-provider-badge sn-badge--top">Top Verified</div>';
 if (tier === 'skilled') return '<div class="sn-provider-badge sn-badge--verified">Skilled Verified</div>';
 return '<div class="sn-provider-badge sn-badge--basic">Basic Verified</div>';
}

async function favFetch(path, options = {}) {
 const response = await fetch(`${FAVORITES_API_BASE}${path}`, options);
 const data = await response.json().catch(() => ({}));
 if (!response.ok) throw new Error(data.message || 'Request failed.');
 return data;
}

function renderFavoriteCard(provider, index) {
 return `
  <div class="sn-fav-card" data-provider-id="${favEsc(provider.id)}">
   <div class="sn-fav-img sn-fav-img--${(index % 5) + 1}"></div>
   <div class="sn-fav-info">
    <div class="sn-fav-name-row">
     <span class="sn-fav-name">${favEsc(provider.full_name || provider.fullName || 'Service Provider')}</span>
     <span class="sn-fav-rating">* ${Number(provider.rating || 4.8).toFixed(1)}</span>
    </div>
    ${favBadge(provider)}
    <div class="sn-fav-price">Starts at <strong>${favMoney(provider.starting_price || 350)}</strong></div>
    <div class="sn-fav-loc">${favEsc(provider.address || 'Angeles City')}</div>
   </div>
   <div class="sn-fav-actions">
    <a class="sn-btn sn-btn-outline" href="../provider-profile/provider-profile.html?id=${encodeURIComponent(provider.id)}">View Profile</a>
    <a class="sn-btn sn-btn-primary" href="../bookings/bookings.html?provider_id=${encodeURIComponent(provider.id)}">Book Now</a>
   </div>
   <button class="sn-fav-heart sn-fav-heart--active" type="button" data-provider-id="${favEsc(provider.id)}" aria-label="Remove from favorites"></button>
  </div>
 `;
}

function setFavoritesStatus(message) {
 let status = document.getElementById('sn-favorites-live-status');
 const header = document.querySelector('.sn-page-header');
 if (!status && header) {
  status = document.createElement('p');
  status.id = 'sn-favorites-live-status';
  status.className = 'sn-favorites-live-status';
  header.appendChild(status);
 }
 if (status) status.textContent = message;
}

function renderFavoritesList(favorites) {
 const list = document.getElementById('sn-fav-list');
 if (!list) return;
 window.snCustomerFavorites = favorites;
 list.innerHTML = favorites.length
  ? favorites.map(renderFavoriteCard).join('')
  : '<div class="sn-customer-card"><p>No favorite providers yet.</p></div>';
 setFavoritesStatus(`${favorites.length} saved provider${favorites.length === 1 ? '' : 's'}`);
}

async function refreshFavorites(customer, options = {}) {
 try {
 const data = await favFetch(`/api/customer/${customer.id}/favorites`);
  renderFavoritesList(data.favorites || []);
 } catch (error) {
  if (!options.quiet) {
   renderFavoritesList([]);
   setFavoritesStatus(error.message || 'Favorites unavailable. Please try again.');
  }
  console.warn(error.message || error);
 }
}

async function removeFavorite(customer, providerId, card) {
 if (!providerId) {
  card?.remove();
  return;
 }
 card?.classList.add('is-removing');
 try {
  await favFetch(`/api/customer/${customer.id}/favorites/${providerId}`, { method: 'DELETE' });
  await refreshFavorites(customer, { quiet: true });
 } catch (error) {
  card?.classList.remove('is-removing');
  setFavoritesStatus(error.message || 'Unable to remove favorite.');
 }
}

function setupFavoriteActions(customer) {
 const list = document.getElementById('sn-fav-list');
 list?.addEventListener('click', (event) => {
  const heart = event.target.closest('.sn-fav-heart');
  if (!heart) return;
  event.preventDefault();
  removeFavorite(customer, heart.dataset.providerId, heart.closest('.sn-fav-card'));
 });

 document.addEventListener('sn:customer-favorites-rendered', (event) => {
  renderFavoritesList(event.detail?.favorites || []);
 });
 refreshFavorites(customer);
}

document.addEventListener('DOMContentLoaded', async () => {
 const currentCustomer = getCurrentCustomer();
 if (!currentCustomer) {
 window.location.href = '../../auth/customerLogin.html';
 return;
 }
 // Always re-fetch fresh verification status from the API before guarding
 // (localStorage may be stale if admin verified/rejected while user was already logged in)
 try {
 const _res = await fetch(`${FAVORITES_API_BASE}/api/auth/customer/status/${currentCustomer.id}`);
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

 setupFavoriteActions(currentCustomer);
});
