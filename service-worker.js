/* 医薬品リスト v1.2.7 / revision 1 */
const APP_VERSION='1.2.7';
const APP_REVISION=1;
const CACHE_PREFIX='medicine-learning-pwa-';
const CACHE_NAME=`${CACHE_PREFIX}v${APP_VERSION}-r${APP_REVISION}`;
const CORE_ASSETS=[
 './','./index.html','./1.indel.html','./2.style.css','./3.app.js','./database.js',
 './data/config.js','./data/medicines.json','./data/questions.json','./data/flashcards.json',
 './manifest.json','./version.json','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png',
 './modules/quiz-app.html','./modules/quiz.css','./modules/quiz.js',
 './modules/flashcard-app.html','./modules/flashcards.css','./modules/flashcards.js'
];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  await caches.delete(CACHE_NAME);
  const cache=await caches.open(CACHE_NAME);
  try{
   const results=await Promise.allSettled(CORE_ASSETS.map(async path=>{
    const url=new URL(path,self.registration.scope);
    const response=await fetch(new Request(url.href,{cache:'reload'}));
    if(!response.ok)throw new Error(`取得失敗 ${url.pathname}: HTTP ${response.status}`);
    await cache.put(url.href,response.clone());
   }));
   const failures=results.filter(r=>r.status==='rejected');
   if(failures.length)throw new Error(`コアファイル取得失敗 ${failures.length}件: ${failures[0].reason?.message||'unknown'}`);
  }catch(error){await caches.delete(CACHE_NAME);throw error;}
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
 if(url.pathname.endsWith('/version.json')||url.pathname.endsWith('/data/config.local.js')){
  event.respondWith(fetch(new Request(request,{cache:'no-store'})));return;
 }
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE_NAME);
  const hit=await cache.match(request,{ignoreSearch:true});if(hit)return hit;
  try{const response=await fetch(request);if(response.ok&&response.type!=='opaque')await cache.put(request,response.clone());return response;}
  catch(error){const fallback=await caches.match(request,{ignoreSearch:true});if(fallback)return fallback;
   if(request.mode==='navigate')return (await cache.match(new URL('./index.html',self.registration.scope).href))||Response.error();
   return Response.error();
  }
 })());
});
