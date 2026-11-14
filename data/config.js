/* 標準設定。data/config.local.js があればそちらを優先します。 */
(function(){
  const defaults={SHARED_PASSWORD:"medicinelistkpu",PASSWORD_IS_DEFAULT:false,LOGIN_SESSION_DAYS:30,AUTH_PASSWORD_REVISION:"1",GOOGLE_CLIENT_ID:""};
  const local=(window.APP_CONFIG&&typeof window.APP_CONFIG==='object')?window.APP_CONFIG:{};
  window.APP_CONFIG=Object.assign({},defaults,local);
})();
