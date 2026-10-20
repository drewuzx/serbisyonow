'use strict';

(function registerSerbisyoNowPwa() {
  const mobileLayout = window.matchMedia('(max-width: 940px)');
  mobileLayout.addEventListener('change', () => {
    const shell = document.querySelector('.sn-shell');
    if (!shell) return;
    shell.classList.remove('sidebar-open');
    shell.classList.add('sidebar-collapsed');
    if (!document.querySelector('dialog[open], [aria-modal="true"]')) document.body.style.overflow = '';
  });
  window.snLiveRefreshReady = new Promise(resolve => {
    const script = document.createElement('script');
    script.src = '/shared/js/live-refresh.js';
    script.onload = () => resolve(window.snLiveRefresh);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  window.snStartLiveRefresh = (...args) => window.snLiveRefreshReady.then(live => live?.register(...args));
  if (/\/pages\/(customer|provider)\//.test(window.location.pathname)) {
    window.snAccountSessionReady = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = '/shared/js/account-session.js';
      script.onload = () => resolve(window.snAccountSession?.ready);
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
    window.snAccountSessionReady.then(() => {
      const photos = document.createElement('script');
      photos.src = '/shared/js/profile-photos.js';
      document.head.appendChild(photos);
      const script = document.createElement('script');
      script.src = '/shared/js/system-feedback.js';
      document.head.appendChild(script);
    });
  }
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
