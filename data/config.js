/*
 * 標準設定。data/config.local.js が存在する場合、その設定を優先します。
 * config.local.js は管理者専用の配布設定として、通常のアプリ更新ZIPには含めません。
 */
(function () {
  'use strict';
  const defaults = {
    SHARED_PASSWORD: "medicinelistkpu",
    PASSWORD_IS_DEFAULT: false,
    LOGIN_SESSION_DAYS: 30,
    AUTH_PASSWORD_REVISION: "1"
  };
  const local = (window.APP_CONFIG && typeof window.APP_CONFIG === 'object') ? window.APP_CONFIG : {};
  window.APP_CONFIG = Object.assign({}, defaults, local);
})();
