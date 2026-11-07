/*
 * 初回移行用テンプレート。
 * このファイルを data/config.local.js にコピーし、SHARED_PASSWORD を
 * v1.2.5 で使っていた共通パスワードと同じ値に変更してください。
 * config.local.js は公開JavaScriptとして配信されます。機密用途には使用しないでください。
 */
window.APP_CONFIG = {
  SHARED_PASSWORD: "medicinelistkpu",
  PASSWORD_IS_DEFAULT: false,
  LOGIN_SESSION_DAYS: 30,
  AUTH_PASSWORD_REVISION: "1"
};
