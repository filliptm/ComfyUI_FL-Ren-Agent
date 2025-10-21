/**
 * Service Worker for Ren PWA
 * 
 * Provides offline support and caching for PWA assets.
 */

const CACHE_NAME = 'ren-pwa-v1';
const urlsToCache = [
    '/pwa',
    '/pwa/',
    '/pwa/static/app.js',
    '/pwa/static/styles.css',
    '/pwa/static/manifest.json',
    '/pwa/static/icons/icon-192.png',
    '/pwa/static/icons/icon-512.png',
    // Shared JS modules
    '/web/js/session_manager.js',
    '/web/js/ws_client.js',
    '/web/js/chat_ui.js',
    '/web/js/style.css',
    '/web/js/_components/MessageBubble.js',
];

// Install event - cache assets
self.addEventListener('install', event => {
    console.log('[ServiceWorker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[ServiceWorker] Caching app shell');
                return cache.addAll(urlsToCache);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
    console.log('[ServiceWorker] Activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[ServiceWorker] Removing old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
    // Skip WebSocket requests
    if (event.request.url.startsWith('ws://') || event.request.url.startsWith('wss://')) {
        return;
    }
    
    // Skip API requests (always fetch fresh)
    if (event.request.url.includes('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }
    
    // Network-first strategy for PWA assets
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // Clone the response
                const responseToCache = response.clone();
                
                // Update cache
                caches.open(CACHE_NAME)
                    .then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                
                return response;
            })
            .catch(() => {
                // If network fails, try cache
                return caches.match(event.request)
                    .then(response => {
                        if (response) {
                            return response;
                        }
                        // If not in cache either, return offline page
                        return new Response('Offline - Please check your connection', {
                            status: 503,
                            statusText: 'Service Unavailable',
                            headers: new Headers({
                                'Content-Type': 'text/plain'
                            })
                        });
                    });
            })
    );
});