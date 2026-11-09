'use strict';

(function returnToRememberedAccount() {
  const path = window.location.pathname;
  const fixedRole = path.endsWith('/customerLogin.html')
    ? 'customer'
    : path.endsWith('/providerLogin.html') ? 'provider' : '';
  const storageKey = role => `sn_${role}_user`;
  const apiBase = window.SN?.utils?.apiBase?.() || window.location.origin;

  function read(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  async function restoreRole(role) {
    let user = null;
    try { user = JSON.parse(read(storageKey(role)) || 'null'); } catch {}

    const logoutKey = `sn_${role}_logged_out`;
    const signedOut = read(logoutKey);
    if (signedOut && (!user?.auth_token || signedOut === user.auth_token)) return false;
    if (signedOut) {
      try { localStorage.removeItem(logoutKey); } catch {}
    }

    const request = (token, signal) => fetch(`${apiBase}/api/auth/${role}/session`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let response;
      try {
        response = await request(user?.auth_token, controller.signal);
        if (!response.ok && user?.auth_token) response = await request('', controller.signal);
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) return false;
      const data = await response.json();
      if (!data.user?.id || !data.user.auth_token) return false;

      try {
        localStorage.setItem(storageKey(role), JSON.stringify({ ...user, ...data.user }));
        localStorage.setItem('sn_last_account_role', role);
      } catch {}

      window.location.replace(role === 'provider'
        ? '/pages/provider/dashboard/dashboard.html'
        : '/pages/customer/dashboard/dashboard.html');
      return true;
    } catch {
      return false;
    }
  }

  async function restore() {
    if (fixedRole) return restoreRole(fixedRole);

    const lastRole = read('sn_last_account_role');
    const roles = lastRole === 'provider'
      ? ['provider', 'customer']
      : ['customer', 'provider'];
    for (const role of roles) {
      if (await restoreRole(role)) return;
    }
  }

  restore();
})();
