'use strict';

(function rememberAccountSession() {
 const role = window.location.pathname.match(/\/pages\/(customer|provider)\//)?.[1];
 if (!role) return;
 const storageKey = `sn_${role}_user`;
 const logoutKey = `sn_${role}_logged_out`;
 const apiBase = window.SN_API_BASE || window.SN?.utils?.apiBase?.()
  || ((window.location.protocol === 'file:' || window.location.port === '5500')
   ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin);

 function storedUser() {
  try { return JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { return null; }
 }

 async function restore() {
  const current = storedUser();
  let signedOut;
  let initialValue;
  try {
   signedOut = localStorage.getItem(logoutKey);
   if (signedOut && (!current?.auth_token || current.auth_token === signedOut)) {
    if (/^[a-f0-9]{64}$/.test(signedOut)) {
     fetch(`${apiBase}/api/auth/${role}/logout`, {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { Authorization: `Bearer ${signedOut}` },
     }).catch(() => {});
    }
    return null;
   }
   if (signedOut) localStorage.removeItem(logoutKey);
   initialValue = localStorage.getItem(storageKey);
  } catch { return current; }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
   const response = await fetch(`${apiBase}/api/auth/${role}/session`, {
    credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    headers: current?.auth_token ? { Authorization: `Bearer ${current.auth_token}` } : {},
   });
   if (!response.ok) return current;
   const data = await response.json();
   // A delayed refresh must not restore an account after logout or account switching.
   if (localStorage.getItem(logoutKey) || localStorage.getItem(storageKey) !== initialValue) return storedUser();
   if (data.user?.id && data.user.auth_token && (!current?.id || String(current.id) === String(data.user.id))) {
    const user = { ...current, ...data.user };
    localStorage.setItem(storageKey, JSON.stringify(user));
    return user;
   }
  } catch {
   // A deployment or connection interruption must not erase a remembered login.
  } finally { clearTimeout(timeout); }
  return current;
 }

 function logout() {
  const user = storedUser();
  try {
   localStorage.setItem(logoutKey, user?.auth_token || 'signed-out');
   localStorage.removeItem(storageKey);
  } catch {}
  fetch(`${apiBase}/api/auth/${role}/logout`, {
   method: 'POST', credentials: 'same-origin', keepalive: true,
   headers: user?.auth_token ? { Authorization: `Bearer ${user.auth_token}` } : {},
  }).catch(() => {});
 }

 document.addEventListener('click', event => {
  if (event.target.closest?.('#sn-logout')) logout();
 }, true);
 function renewVisibleSession() {
  if (document.visibilityState === 'visible' && storedUser()?.id) restore();
 }
 document.addEventListener('visibilitychange', renewVisibleSession);
 window.addEventListener('pageshow', event => { if (event.persisted) renewVisibleSession(); });
 window.setInterval(renewVisibleSession, 15 * 60 * 1000);
 window.snAccountSession = { ready: restore(), restore, logout };
})();
