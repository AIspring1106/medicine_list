/*
 * service-worker.js - 医薬品リスト v1.2.6
 * 新版のコア資産をすべて取得できた場合だけ更新を有効化します。
 * 旧版キャッシュは新版のインストール・有効化が成功するまで維持します。
 */
const APP_VERSION = '1.2.6';
const CACHE_NAME = `medicine-learning-pwa-v${APP_VERSION}`;
const CACHE_PREFIX = 'medicine-learning-pwa-v';
const CORE_ASSETS = [
  './', './index.html', './1.indel.html', './2.style.css', './3.app.js', './database.js',
  './data/config.js', './data/medicines.json', './data/questions.json', './data/flashcards.json',
  './manifest.json', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './modules/quiz-app.html', './modules/quiz.css', './modules/quiz.js',
  './modules/flashcard-app.html', './modules/flashcards.css', './modules/flashcards.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // 部分キャッシュが残らないよう、今回のキャッシュを作り直します。
    await caches.delete(CACHE_NAME);
    const cache = await caches.open(CACHE_NAME);
    try {
      const results = await Promise.allSettled(CORE_ASSETS.map(async path => {
        const url = new URL(path, self.registration.scope);
        const request = new Request(url.href, { cache: 'reload' });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`Precache failed: ${url.href} (${response.status})`);
        await cache.put(url.href, response.clone());
        return url.href;
      }));
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length || results.length !== CORE_ASSETS.length) {
        const reason = failures[0]?.reason?.message || 'Incomplete app shell';
        throw new Error(`App shell precache failed (${failures.length}/${CORE_ASSETS.length}): ${reason}`);
      }
    } catch (error) {
      // Promise.allSettledにより全取得タスクの終了後にキャッシュを削除します。
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // ここでskipWaitingは呼ばず、画面側が完全取得後に明示的に切り替えます。
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

  // バージョン確認と管理者ローカル設定は常にネットワークへ。
  // config.local.js はアプリ更新ZIPに含めず、ブラウザ保存ハッシュを利用します。
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/data/config.local.js')) {
    event.respondWith(fetch(new Request(request, { cache: 'no-store' })));
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // コア資産は版ごとのスナップショットから返し、旧版・新版の混在を防ぎます。
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && response.ok && (response.type === 'basic' || response.type === 'default')) {
        // コア資産以外は通常のオンライン取得。任意データは必要に応じてキャッシュ。
        await cache.put(request, response.clone());
      }
      return response;
    } catch (error) {
      const fallback = await caches.match(request, { ignoreSearch: true });
      if (fallback) return fallback;
      if (request.mode === 'navigate') {
        return (await cache.match(new URL('./index.html', self.registration.scope).href)) || Response.error();
      }
      return Response.error();
    }
  })());
});
