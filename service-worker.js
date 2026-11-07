/*
 * service-worker.js - 医薬品リスト v1.2.5
 * オンラインでは常にサーバーの最新レスポンスを再検証し、通信不能時のみキャッシュへフォールバックします。
 */
const CACHE_NAME = 'medicine-learning-pwa-v1.2.5';
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
    // HTTPキャッシュを介さず新しいアプリシェルを取得します。
    const requests = CORE_ASSETS.map(path => new Request(path, { cache: 'reload' }));
    const results = await Promise.allSettled(requests.map(async request => {
      const response = await fetch(request);
      if (!response.ok) throw new Error(`Precache failed: ${request.url} (${response.status})`);
      await cache.put(request, response);
    }));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) {
      // コアHTML/JSの取得に失敗した場合はインストールを失敗させ、稼働中のworkerを維持します。
      throw new Error(`App shell precache failed (${failures.length}/${requests.length})`);
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
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

  // 版番号は必ずネットワークから取得し、Service Workerキャッシュへ保存しません。
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // reload/no-storeでブラウザーHTTPキャッシュも再検証します。
      const freshRequest = new Request(request, { cache: 'no-store' });
      const response = await fetch(freshRequest);
      if (response && response.ok && (response.type === 'basic' || response.type === 'default')) {
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
