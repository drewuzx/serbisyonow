const API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));

function getCurrentCustomer() {
  try {
    const raw = localStorage.getItem('sn_customer_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCurrentCustomer(user) {
  try {
    localStorage.setItem('sn_customer_user', JSON.stringify(user));
  } catch {
    // Storage may be unavailable in private browser modes.
  }
}

function applyVerificationState(user) {
  const verifyBanner = document.getElementById('sn-verify-banner');
  const userName = document.getElementById('sn-user-name');
  const userStatus = document.getElementById('sn-user-status');
  const status = user?.verification_status || (user?.is_verified ? 'verified' : 'pending');
  const isVerified = status === 'verified' || user?.is_verified === true;

  if (userName) userName.textContent = user?.full_name || 'Customer';
  if (userStatus) {
    if (status === 'verified') userStatus.textContent = 'Verified customer';
    else if (status === 'rejected') userStatus.textContent = 'Verification declined';
    else userStatus.textContent = 'Awaiting verification';
  }

  document.body.classList.toggle('sn-locked', !isVerified);
  if (!verifyBanner) return;

  verifyBanner.hidden = isVerified;
  if (isVerified) return;
  if (status === 'rejected') {
    verifyBanner.textContent = 'Your verification was declined by the admin. Please resubmit your documents in your profile.';
    verifyBanner.style.background = '#fef2f2';
    verifyBanner.style.borderLeft = '4px solid #dc2626';
    verifyBanner.style.color = '#991b1b';
  } else {
    verifyBanner.textContent = 'Your account is pending admin verification. You can browse, but booking actions are disabled until verified.';
    verifyBanner.style.background = '';
    verifyBanner.style.borderLeft = '';
    verifyBanner.style.color = '';
  }
}

function showVerificationToast(status) {
  const existing = document.getElementById('sn-verify-toast');
  if (existing) existing.remove();

  const isVerified = status === 'verified';
  const toast = document.createElement('div');
  toast.id = 'sn-verify-toast';
  toast.className = `sn-toast ${isVerified ? 'sn-toast--success' : 'sn-toast--danger'}`;
  toast.innerHTML = `
    <div class="sn-toast-icon">${isVerified ? '' : '!'}</div>
    <div class="sn-toast-text">
      ${isVerified ? 'Your account has been verified!' : 'Your account verification was declined.'}
      <div class="sn-toast-sub">${isVerified ? 'You can now book services.' : 'Please resubmit your documents in your profile.'}</div>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, 6000);
}

function attachDashboardShell() {
  const shell = document.querySelector('.sn-shell');
  const sidebar = document.getElementById('sn-sidebar');
  const overlay = document.getElementById('sn-overlay');
  const hamburger = document.getElementById('sn-hamburger');
  const hamburgerTop = document.getElementById('sn-hamburger-top');
  const logoutBtn = document.getElementById('sn-logout');
  const storageKey = 'sn.dashboard.sidebarState';

  function isMobile() {
    return window.matchMedia('(max-width: 940px)').matches;
  }

  function storedState() {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  function storeState(state) {
    try {
      localStorage.setItem(storageKey, state);
    } catch {
      // Storage is optional.
    }
  }

  function clearStoredState() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Storage is optional.
    }
  }

  function closeSidebar() {
    if (!shell) return;
    shell.classList.remove('sidebar-open');
    shell.classList.add('sidebar-collapsed');
    hamburger?.setAttribute('aria-expanded', 'false');
    hamburgerTop?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (!isMobile()) storeState('collapsed');
  }

  function openSidebar() {
    if (!shell) return;
    shell.classList.remove('sidebar-collapsed');
    shell.classList.add('sidebar-open');
    hamburger?.setAttribute('aria-expanded', 'true');
    hamburgerTop?.setAttribute('aria-expanded', 'true');
    if (isMobile()) document.body.style.overflow = 'hidden';
    if (!isMobile()) storeState('open');
  }

  function toggleSidebar() {
    if (!shell) return;
    const open = shell.classList.contains('sidebar-open') || !shell.classList.contains('sidebar-collapsed');
    if (open) closeSidebar(); else openSidebar();
  }

  hamburger?.addEventListener('click', toggleSidebar);
  hamburgerTop?.addEventListener('click', toggleSidebar);
  overlay?.addEventListener('click', () => { if (isMobile()) closeSidebar(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSidebar(); });
  sidebar?.addEventListener('click', (event) => {
    if (isMobile() && event.target.closest('.sn-nav-item')) closeSidebar();
  });
  window.addEventListener('resize', () => {
    if (isMobile()) closeSidebar();
    else if (storedState() === 'open') openSidebar();
    else closeSidebar();
  });

  logoutBtn?.addEventListener('click', () => {
    logoutBtn.disabled = true;
    logoutBtn.querySelector('span:last-child').textContent = 'Logging out...';
    window.setTimeout(() => {
      localStorage.removeItem('sn_customer_user');
      clearStoredState();
      window.location.href = '../../landing/index.html';
    }, 350);
  });

  if (isMobile()) closeSidebar();
  else if (storedState() === 'open') openSidebar();
  else closeSidebar();
}

function attachDashboardSearch() {
  const old = document.querySelector('.sn-hero-search');
  if (!old || old.tagName === 'FORM') return;
  const wrapper = document.createElement('div'); wrapper.className = 'sn-home-search';
  const form = document.createElement('form'); form.className = old.className; form.setAttribute('role', 'search');
  form.append(...old.childNodes); old.replaceWith(wrapper); wrapper.append(form);
  wrapper.closest('.sn-hero').classList.add('sn-home-search-hero');
  const input = form.querySelector('input');
  input.id = 'sn-home-search-input'; input.name = 'q'; input.maxLength = 120; input.autocomplete = 'off';
  input.placeholder = 'Search services, providers, categories...';
  input.setAttribute('aria-label', 'Search services, providers, or categories');
  input.setAttribute('aria-controls', 'sn-home-search-results'); input.setAttribute('aria-expanded', 'false');
  const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'sn-home-search-submit';
  submit.title = 'Search'; submit.setAttribute('aria-label', 'Search');
  submit.innerHTML = '<img src="/shared/icons/lucide/arrow-right.svg" alt="" width="20" height="20">'; form.append(submit);
  const panel = document.createElement('div'); panel.id = 'sn-home-search-results'; panel.className = 'sn-home-search-results'; panel.hidden = true;
  panel.setAttribute('role', 'region'); panel.setAttribute('aria-label', 'Search matches');
  const status = document.createElement('p'); status.className = 'sn-home-search-status'; status.setAttribute('role', 'status');
  const list = document.createElement('ul'); list.className = 'sn-home-search-list';
  const all = document.createElement('a'); all.className = 'sn-home-search-all'; all.textContent = 'View all results'; all.hidden = true;
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'sn-home-search-retry'; retry.textContent = 'Retry'; retry.hidden = true;
  panel.append(status, list, all, retry); wrapper.append(panel);
  let timer, controller, version = 0, query = '';
  const searchUrl = value => `../search/search.html?${new URLSearchParams({ q: value })}`;
  const show = () => { panel.hidden = false; input.setAttribute('aria-expanded', 'true'); };
  const close = () => { clearTimeout(timer); controller?.abort(); version++; panel.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  async function search() {
    query = input.value.trim(); controller?.abort(); const current = ++version;
    list.replaceChildren(); all.hidden = retry.hidden = true;
    if (!query) { close(); return; }
    show(); status.textContent = 'Searching...'; controller = new AbortController();
    const requestController = controller;
    const timeout = setTimeout(() => requestController.abort(), 10000);
    try {
      const params = new URLSearchParams({ q: query, customerId: String(getCurrentCustomer()?.id || '') });
      const response = await fetch(`${API_BASE}/api/providers/search?${params}`, { signal: requestController.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Search unavailable');
      const data = await response.json();
      if (!Array.isArray(data.providers)) throw new Error('Invalid search response');
      if (current !== version) return;
      const providers = data.providers.slice(0, 5);
      status.textContent = providers.length ? 'Matching providers' : 'No available services or providers match your search.';
      for (const provider of providers) {
        const item = document.createElement('li'), link = document.createElement('a');
        link.href = `../provider-profile/provider-profile.html?id=${encodeURIComponent(provider.id)}`;
        const name = document.createElement('strong'); name.textContent = provider.full_name || 'Service provider';
        const details = document.createElement('span');
        details.textContent = (provider.matched_services || [provider.service || provider.category]).filter(Boolean).join(' / ');
        const rate = document.createElement('small'); rate.textContent = Number(provider.starting_price) > 0 ? `Starts at PHP ${Number(provider.starting_price).toLocaleString('en-PH')}` : 'Price not set';
        link.append(name, details, rate); item.append(link); list.append(item);
      }
      all.href = searchUrl(query); all.hidden = !providers.length;
    } catch (error) {
      if (current !== version) return;
      status.textContent = 'Search is unavailable right now. Please try again.'; retry.hidden = false;
    } finally { clearTimeout(timeout); }
  }
  function queueSearch() {
    clearTimeout(timer); controller?.abort(); version++;
    list.replaceChildren(); all.hidden = retry.hidden = true;
    if (!input.value.trim()) { close(); return; }
    show(); status.textContent = 'Searching...'; timer = setTimeout(search, 250);
  }
  input.addEventListener('input', event => { if (!event.isComposing) queueSearch(); });
  input.addEventListener('compositionend', queueSearch);
  input.addEventListener('focus', () => { if (input.value.trim() && panel.hidden) queueSearch(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && !panel.hidden) { event.preventDefault(); panel.querySelector('li a')?.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { input.focus(); close(); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const links = [...panel.querySelectorAll('li a')], index = links.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault(); const next = index + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) input.focus(); else links[Math.min(next, links.length - 1)]?.focus();
  });
  document.addEventListener('pointerdown', event => { if (!wrapper.contains(event.target)) close(); });
  wrapper.addEventListener('focusout', () => setTimeout(() => { if (!wrapper.contains(document.activeElement)) close(); }, 0));
  retry.onclick = () => { input.focus(); search(); };
  form.addEventListener('submit', event => {
    event.preventDefault(); const value = input.value.trim();
    if (!value) { close(); input.focus(); return; }
    close(); window.location.href = searchUrl(value);
  });
  window.addEventListener('pagehide', close);
}

document.addEventListener('DOMContentLoaded', async () => {
  await window.snAccountSessionReady;
  const currentCustomer = getCurrentCustomer();
  if (!currentCustomer) {
    window.location.href = '../../auth/customerLogin.html';
    return;
  }

  applyVerificationState(currentCustomer);
  attachDashboardShell();
  attachDashboardSearch();

  let previousStatus = currentCustomer.verification_status;
  document.addEventListener('sn:customer-account-updated', ({ detail: user }) => {
    applyVerificationState(user);
    if (previousStatus !== user.verification_status) showVerificationToast(user.verification_status);
    previousStatus = user.verification_status;
  });
});
