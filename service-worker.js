/* 医薬品リスト v1.2.7 / revision 8 */
const APP_VERSION='1.2.7';
const APP_REVISION=8;
const APP_BUILD_ID='r8-session-resume-push-maintenance-20261116';
const CACHE_PREFIX='medicine-learning-pwa-';
const CACHE_NAME=`${CACHE_PREFIX}v${APP_VERSION}-r${APP_REVISION}-${APP_BUILD_ID}`;
try{importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');}catch(error){console.warn('OneSignal worker extension unavailable; PWA cache remains active.',error);}
const CORE_ASSETS=[
 './','./index.html','./1.indel.html','./2.style.css','./3.app.js','./database.js',
 './data/config.js','./csv-reader.js','./xlsx-reader.js','./pdf-reader.js','./data/medicines.json','./data/questions.json','./data/flashcards.json',
 './manifest.json','./version.json','./maintenance.json','./maintenance.html','./privacy-policy.html','./terms-of-service.html','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png',
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
 if(url.pathname.endsWith('/version.json')){
  event.respondWith(fetch(new Request(request,{cache:'no-store'})));return;
 }
 if(url.pathname.endsWith('/maintenance.json')){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE_NAME);
   try{
    const response=await fetch(new Request(request,{cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}}));
    if(response.ok)await cache.put(request,response.clone());
    return response;
   }catch(error){const saved=await cache.match(request,{ignoreSearch:true});if(saved)return saved;return new Response(JSON.stringify({enabled:true,message:'メンテナンス状態を確認できません。しばらくしてから再度アクセスしてください。'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8'}});}
  })());return;
 }
 if(url.searchParams.has('_health')){
  // 起動前の整合性確認はオンライン時にネット上の実ファイルを検証し、オフライン時だけ既存キャッシュへフォールバックします。
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE_NAME);
   const cleanUrl=new URL(request.url);cleanUrl.searchParams.delete('_health');
   try{
    const response=await fetch(new Request(cleanUrl.href,{method:'GET',cache:'no-store',headers:request.headers}));
    return response;
   }catch(error){
    const saved=await cache.match(cleanUrl.href,{ignoreSearch:true});
    if(saved)return saved;
    return new Response('必須ファイルを確認できません。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
   }
  })());return;
 }
 if(request.mode==='navigate'){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE_NAME);
   try{
    const statusUrl=new URL('./maintenance.json',self.registration.scope);
    const statusResponse=await fetch(new Request(statusUrl.href,{cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache'}}));
    if(!statusResponse.ok)throw new Error('maintenance marker missing');
    const status=await statusResponse.clone().json();
    if(status.enabled===true){
     const maintenanceUrl=new URL('./maintenance.html',self.registration.scope);
     const maintenanceResponse=await fetch(new Request(maintenanceUrl.href,{cache:'no-store'}));
     if(maintenanceResponse.ok)return maintenanceResponse;
     return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>メンテナンス中</title><body style="font-family:system-ui;text-align:center;padding:15vh 20px;background:#f4f7fb;color:#172033"><h1>メンテナンス中</h1><p>'+(String(status.message||'アプリを更新しています。しばらくしてから再度アクセスしてください。').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])))+'</p></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
    }
   }catch(error){
    // マーカー欠落・破損・取得不能は部分置換中とみなし、アプリ本体を返しません。
    const maintenance=await cache.match(new URL('./maintenance.html',self.registration.scope).href);
    if(maintenance)return maintenance;
    return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>メンテナンス中</title><body style="font-family:system-ui;text-align:center;padding:15vh 20px"><h1>メンテナンス中</h1><p>アプリの更新状態を確認できません。ファイル更新中または通信障害の可能性があります。しばらくしてから再度アクセスしてください。</p></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
   }
   const hit=await cache.match(request,{ignoreSearch:true});if(hit)return hit;
   try{
    const net=await fetch(request);
    if(net.ok){await cache.put(request,net.clone());return net;}
    const maintenance=await cache.match(new URL('./maintenance.html',self.registration.scope).href);
    if(maintenance)return maintenance;
    return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>メンテナンス中</title><body style="font-family:system-ui;text-align:center;padding:15vh 20px"><h1>メンテナンス中</h1><p>アプリの必須ファイルが見つかりません。更新作業中の可能性があります。</p></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
   }catch(error){return (await cache.match(new URL('./index.html',self.registration.scope).href))||Response.error();}
  })());return;
 }
 if(url.pathname.endsWith('/data/config.local.js')){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE_NAME);
   try{const response=await fetch(new Request(request,{cache:'no-store'}));if(response.ok)await cache.put(request,response.clone());return response;}
   catch(error){const saved=await cache.match(request,{ignoreSearch:true});if(saved)return saved;throw error;}
  })());return;
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
