'use strict';

(function registerSerbisyoNowPwa() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
      .then(registration => {
        registration.update();
        if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        window.SerbisyoNowPWA = {
          registration,
          canInstall: false,
          deferredPrompt: null,
        };
      })
      .catch(error => {
        console.warn('SerbisyoNow PWA registration failed:', error);
      });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!window.__serbisyoNowReloaded) {
      window.__serbisyoNowReloaded = true;
      window.location.reload();
    }
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    window.SerbisyoNowPWA = {
      ...(window.SerbisyoNowPWA || {}),
      canInstall: true,
      deferredPrompt: event,
    };
    window.dispatchEvent(new CustomEvent('serbisyonow:pwa-install-ready'));
  });

  window.addEventListener('appinstalled', () => {
    window.SerbisyoNowPWA = {
      ...(window.SerbisyoNowPWA || {}),
      canInstall: false,
      deferredPrompt: null,
    };
    window.dispatchEvent(new CustomEvent('serbisyonow:pwa-installed'));
  });
})();
