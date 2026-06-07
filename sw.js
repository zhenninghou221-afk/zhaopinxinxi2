// Service Worker for 招聘信息网
// Enables PWA install + basic offline caching
var CACHE = 'zhaopin-v2';
var ASSETS = [
  '/',
  '/index.html',
  '/auth/css/style.css',
  '/auth/js/api.js',
  '/auth/js/app.js',
  '/auth/login.html',
  '/auth/register.html',
  '/404.html',
  '/manifest.json'
];

// Install: cache core assets
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ASSETS);
    }).catch(function() {})
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// Fetch: cache-first for assets, network-first for API
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  // Skip API/analytics — always go network
  if (url.pathname.startsWith('/api/')) return;
  // Skip non-GET
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      // Return cached, then update in background
      var fetched = fetch(e.request).then(function(response) {
        if (response && response.status === 200) {
          var copy = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, copy); });
        }
        return response;
      }).catch(function() { return cached; });
      return cached || fetched;
    })
  );
});