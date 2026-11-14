/* 標準設定。既存の data/config.local.js を優先して読み込みます。 */
(function(){
  const local = (window.APP_CONFIG && typeof window.APP_CONFIG === 'object') ? window.APP_CONFIG : {};
  const hasLegacyPassword = typeof local.SHARED_PASSWORD === 'string' && local.SHARED_PASSWORD.length > 0 && local.SHARED_PASSWORD !== 'CHANGE-THIS-PASSWORD';
  const defaultPasswordFlag = local.PASSWORD_IS_DEFAULT === undefined ? !hasLegacyPassword : Boolean(local.PASSWORD_IS_DEFAULT);
  const defaults = {
    SHARED_PASSWORD: 'medicinelistkpu',
    PASSWORD_IS_DEFAULT: false,
    LOGIN_SESSION_DAYS: 30,
    AUTH_PASSWORD_REVISION: '1'
  };
  window.APP_CONFIG = Object.assign({}, defaults, local);
})();
