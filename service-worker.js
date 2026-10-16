// Service Worker Ma Cuisine
// CACHE_VERSION doit suivre la version du site
const CACHE_VERSION = 'v40.004';
const CACHE_NAME = `ma-cuisine-${CACHE_VERSION}`;
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './favicon.svg',
    './manifest.json'
];

// Installation : mettre en cache le shell de l'application
// reponse no-store : toujours telecharger les fichiers frais du reseau,
// jamais depuis le cache HTTP du navigateur (sinon on recopie une vieille version)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(
                APP_SHELL.map(url => new Request(url, { cache: 'no-store' }))
            ))
            .then(() => self.skipWaiting())
    );
});

// Mise a jour immediate quand la page le demande (evite de rester bloque sur une vieille version)
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Activation : purger les anciens caches et prendre le contrôle
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Interception des requêtes :
// - fichiers du site : cache d'abord, puis réseau (et mise à jour du cache)
// - Firestore et tout le reste : réseau uniquement (jamais de cache, jamais d'ecrasement de donnees)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET') return;

    // Firestore / Firebase : réseau d'abord avec fallback cache (pour ouvrir l'app hors ligne)
    if (url.hostname === 'www.gstatic.com' && url.pathname.includes('firebasejs')) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    if (url.origin !== self.location.origin) return;

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then(cached => {
            const fetchPromise = fetch(new Request(event.request, { cache: 'no-store' })).then(response => {
                if (response && response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);

            return cached || fetchPromise;
        })
    );
});
