'use strict';

(() => {
 const logo = document.getElementById('admin-login-reveal');
 const admin = document.getElementById('admin-login-choice');
 if (!logo || !admin) return;
 let clicks = 0;
 let clickTimer;
 let hideTimer;

 function resetClicks() {
  clearTimeout(clickTimer);
  clicks = 0;
 }
 function hideAdmin() {
  clearTimeout(hideTimer);
  resetClicks();
  if (document.activeElement === admin) logo.focus({ preventScroll: true });
  admin.hidden = true;
  logo.setAttribute('aria-expanded', 'false');
 }
 logo.addEventListener('click', () => {
  if (!admin.hidden) return;
  if (clicks === 0) clickTimer = setTimeout(resetClicks, 3000);
  clicks += 1;
  if (clicks !== 3) return;
  resetClicks();
  admin.hidden = false;
  logo.setAttribute('aria-expanded', 'true');
  hideTimer = setTimeout(hideAdmin, 5000);
 });
 // Never retain a revealed entry when returning through the browser's page cache.
 window.addEventListener('pagehide', hideAdmin);
 window.addEventListener('pageshow', hideAdmin);
 document.addEventListener('visibilitychange', () => {
  if (document.hidden) hideAdmin();
 });
})();
