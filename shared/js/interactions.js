'use strict';

(() => {
  const controls = 'button, [role="button"], [role="tab"], summary, input[type="submit"], input[type="button"], input[type="reset"], a.btn, a.sn-btn, a.promotion-button, a.sn-nav-item, a.sn-avatar, a[class*="-button"], a[class*="-btn"]';
  let pressed = null;
  let releaseTimer;

  function clearPress() {
    clearTimeout(releaseTimer);
    pressed?.element.classList.remove('sn-is-pressed');
    pressed = null;
  }

  // Delegation also covers controls inserted later by modals and live updates.
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    clearPress();
    const element = event.target.closest?.(controls);
    if (!element || element.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]') || element.closest('[inert]')) return;
    pressed = { element, id: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now() };
    element.classList.add('sn-is-pressed');
  }, { passive: true });

  document.addEventListener('pointermove', event => {
    if (pressed?.id === event.pointerId && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 10) clearPress();
  }, { passive: true });

  document.addEventListener('pointerup', event => {
    if (pressed?.id !== event.pointerId) return;
    // Keep quick taps visible without delaying the control's normal click action.
    releaseTimer = setTimeout(clearPress, Math.max(0, 120 - (performance.now() - pressed.started)));
  }, { passive: true });
  document.addEventListener('pointercancel', clearPress, { passive: true });
  document.addEventListener('scroll', clearPress, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearPress(); });
  window.addEventListener('blur', clearPress);
  window.addEventListener('pagehide', clearPress);
})();
