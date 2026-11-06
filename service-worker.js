/*
 * service-worker.js
 * オンライン時は常にサーバーの最新ファイルを優先し、取得できない場合だけキャッシュを使用します。
 * 新しいService Workerは待機状態になり、画面の「更新を適用」操作で切り替わります。
 */
const CACHE_NAME = 'medicine-learning-pwa-v1.1.0';
const CACHE_PREFIX = 'medicine-learning-pwa-';
const CORE_ASSETS = [
  './', './index.html', './1.indel.html', './2.style.css', './3.app.js', './database.js',
  './data/config.js', './data/medicines.json', './data/questions.json', './data/flashcards.json',
  './manifest.json', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './modules/quiz-app.html', './modules/quiz.css', './modules/quiz.js',
  './modules/flashcard-app.html', './modules/flashcards.css', './modules/flashcards.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    // skipWaitingはここでは呼ばず、利用者が更新を適用するまで現行画面を維持します。
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // no-cacheでブラウザHTTPキャッシュも再検証し、GitHub Pages上の更新を取り込みます。
      const freshRequest = new Request(request, { cache: 'no-cache' });
      const response = await fetch(freshRequest);
      if (response && response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return (await caches.match('./index.html')) || Response.error();
      }
      return Response.error();
    }
  })());
});
