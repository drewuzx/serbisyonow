const API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));
const POLL_INTERVAL_MS = 5000;
let verificationPollTimer = null;

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

async function pollVerificationStatus() {
  const customer = getCurrentCustomer();
  if (!customer?.id) return;

  if (customer.verification_status === 'verified' && customer.is_verified) {
    stopPolling();
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/auth/customer/status/${customer.id}`);
    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    if (!data.user) return;

    const previousStatus = customer.verification_status || (customer.is_verified ? 'verified' : 'pending');
    const nextStatus = data.user.verification_status || (data.user.is_verified ? 'verified' : 'pending');
    const merged = { ...customer, ...data.user };
    saveCurrentCustomer(merged);
    applyVerificationState(merged);

    if (previousStatus !== nextStatus) showVerificationToast(nextStatus);
    if (nextStatus === 'verified' || nextStatus === 'rejected') stopPolling();
  } catch {
    // Keep polling quietly while the network/server is unavailable.
  }
}

function startPolling() {
  stopPolling();
  verificationPollTimer = setInterval(pollVerificationStatus, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (verificationPollTimer) {
    clearInterval(verificationPollTimer);
    verificationPollTimer = null;
  }
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
    stopPolling();
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

document.addEventListener('DOMContentLoaded', () => {
  const currentCustomer = getCurrentCustomer();
  if (!currentCustomer) {
    window.location.href = '../../auth/customerLogin.html';
    return;
  }

  applyVerificationState(currentCustomer);
  attachDashboardShell();

  if (currentCustomer.verification_status !== 'verified' || !currentCustomer.is_verified) {
    startPolling();
  }
});
