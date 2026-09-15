'use strict';

const SW_VERSION = 'serbisyonow-pwa-v16';
const APP_SHELL_CACHE = `${SW_VERSION}-app-shell`;
const RUNTIME_CACHE = `${SW_VERSION}-runtime`;

const APP_SHELL_URLS = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/image_logo/main_logo.svg',
  '/shared/css/variables.css',
  '/shared/css/sn-topbar.css',
  '/shared/css/auth.css',
  '/shared/css/pwa-responsive.css',
  '/shared/js/app.js',
  '/shared/js/forgotPassword.js',
  '/shared/js/pwa-register.js',
  '/shared/js/resetPassword.js',
  '/pages/landing/index.html',
  '/pages/landing/landing.css',
  '/pages/landing/js/landing.js',
  '/pages/auth/forgotPassword.html',
  '/pages/auth/googleAuthBridge.html',
  '/pages/auth/resetPassword.html',
  '/images/LANDING%20PAGE/Cover%20Image/landingCover.png',
  '/images/LANDING%20PAGE/How%20SerbisyoNow%20works_%20(For%20Customers)/Request%20Service.png',
  '/images/LANDING%20PAGE/How%20SerbisyoNow%20works_%20(For%20Customers)/Match%20with%20Providers.png',
  '/images/LANDING%20PAGE/How%20SerbisyoNow%20works_%20(For%20Customers)/Book%20%26%20Get%20it%20done.png'
];

function isApiRequest(url) {
  return url.pathname.startsWith('/api/') || url.port === '3000';
}

function isCacheableSameOrigin(requestUrl, request) {
  return request.method === 'GET' && requestUrl.origin === self.location.origin && !isApiRequest(requestUrl);
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const requestUrl = new URL(request.url);

  if (!isCacheableSameOrigin(requestUrl, request)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('/offline.html')))
    );
    return;
  }

  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
