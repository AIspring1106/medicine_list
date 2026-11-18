/* 医薬品リスト v1.2.7 / revision 9 */
const APP_VERSION='1.2.7';
const APP_REVISION=9;
const APP_BUILD_ID='r9-no-maintenance-pages-notify-icon-20261118';
const CACHE_PREFIX='medicine-learning-pwa-';
const CACHE_NAME=`${CACHE_PREFIX}v${APP_VERSION}-r${APP_REVISION}-${APP_BUILD_ID}`;
try{importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');}catch(error){console.warn('OneSignal worker extension unavailable; PWA cache remains active.',error);}
const CORE_ASSETS=[
 './','./index.html','./1.indel.html','./2.style.css','./3.app.js','./database.js',
 './data/config.js','./csv-reader.js','./xlsx-reader.js','./pdf-reader.js','./data/medicines.json','./data/questions.json','./data/flashcards.json',
 './manifest.json','./version.json','./privacy-policy.html','./terms-of-service.html','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png','./icons/notification-badge-96.png',
 './modules/quiz-app.html','./modules/quiz.css','./modules/quiz.js',
 './modules/flashcard-app.html','./modules/flashcards.css','./modules/flashcards.js'
];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  await caches.delete(CACHE_NAME);
  const cache=await caches.open(CACHE_NAME);
  const results=await Promise.allSettled(CORE_ASSETS.map(async path=>{
   const url=new URL(path,self.registration.scope);
   const response=await fetch(new Request(url.href,{cache:'reload'}));
   if(!response.ok)throw new Error(`取得失敗 ${url.pathname}: HTTP ${response.status}`);
   await cache.put(url.href,response.clone());
  }));
  const failures=results.filter(r=>r.status==='rejected');
  if(failures.length){await caches.delete(CACHE_NAME);throw new Error(`コアファイル取得失敗 ${failures.length}件: ${failures[0].reason?.message||'unknown'}`);}
 })());
});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME).map(key=>caches.delete(key)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);if(url.origin!==self.location.origin)return;
 if(url.pathname.endsWith('/version.json')){
  event.respondWith(fetch(new Request(request,{cache:'no-store'})));return;
 }
 if(url.pathname.endsWith('/data/config.local.js')){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE_NAME);
   try{const response=await fetch(new Request(request,{cache:'no-store'}));if(response.ok)await cache.put(request,response.clone());return response;}
   catch(error){const saved=await cache.match(request,{ignoreSearch:true});if(saved)return saved;throw error;}
  })());return;
 }
 if(request.mode==='navigate'){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE_NAME);
   try{
    const response=await fetch(request);
    if(response.ok){await cache.put(request,response.clone());return response;}
   }catch(error){/* オフライン時は既存キャッシュを使用 */}
   return (await cache.match(request,{ignoreSearch:true}))
    || (await cache.match(new URL('./index.html',self.registration.scope).href))
    || Response.error();
  })());return;
 }
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE_NAME);
  const hit=await cache.match(request,{ignoreSearch:true});if(hit)return hit;
  try{const response=await fetch(request);if(response.ok&&response.type!=='opaque')await cache.put(request,response.clone());return response;}
  catch(error){const fallback=await caches.match(request,{ignoreSearch:true});return fallback||Response.error();}
 })());
});
