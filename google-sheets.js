/* Google Sheets read-only integration for 医薬品リスト v1.2.7 revision 2 */
(function () {
  'use strict';

  const READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
  let tokenValue = '';
  let tokenExpiresAt = 0;
  let identityScriptPromise = null;

  function parseSpreadsheetLink(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) throw new Error('Googleスプレッドシートのリンクを入力してください。');
    let url;
    try { url = new URL(raw); }
    catch (error) { throw new Error(`リンクの形式を確認してください：${raw}`); }
    const host = url.hostname.toLowerCase();
    if (!(host === 'docs.google.com' || host === 'drive.google.com')) {
      throw new Error('Googleスプレッドシートの共有リンクを入力してください。');
    }
    let match = url.pathname.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/);
    if (!match && host === 'drive.google.com') {
      const id = url.searchParams.get('id') || (url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/) || [])[1];
      if (id) match = [null, id];
    }
    if (!match) throw new Error(`スプレッドシートIDをリンクから取得できません：${raw}`);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, '').replace(/^\?/, ''));
    const gidRaw = url.searchParams.get('gid') || hashParams.get('gid');
    const gid = gidRaw !== null && /^\d+$/.test(gidRaw) ? Number(gidRaw) : null;
    return {
      key: `${match[1]}::${gid === null ? 'first' : gid}`,
      spreadsheetId: match[1],
      gid,
      url: raw,
      title: '',
      sheetTitle: '',
      displayName: ''
    };
  }

  function loadIdentityServices() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (identityScriptPromise) return identityScriptPromise;
    identityScriptPromise = new Promise((resolve, reject) => {
      let script = document.getElementById('googleIdentityServicesScript');
      const timeout = window.setTimeout(() => reject(new Error('Google認証サービスを読み込めません。インターネット接続を確認してください。')), 15000);
      const finish = (error) => {
        window.clearTimeout(timeout);
        if (error) reject(error);
        else if (window.google?.accounts?.oauth2) resolve();
        else reject(new Error('Google認証サービスが利用できません。'));
      };
      if (!script) {
        script = document.createElement('script');
        script.id = 'googleIdentityServicesScript';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
      }
      script.addEventListener('load', () => finish(null), { once: true });
      script.addEventListener('error', () => finish(new Error('Google認証サービスを読み込めませんでした。')), { once: true });
      if (!script.isConnected) document.head.appendChild(script);
      if (window.google?.accounts?.oauth2) finish(null);
    }).catch(error => {
      identityScriptPromise = null;
      throw error;
    });
    return identityScriptPromise;
  }

  async function authorize(clientId) {
    const id = String(clientId || '').trim();
    if (!id) throw new Error('Google連携の設定がありません。data/config.local.js に GOOGLE_CLIENT_ID を設定してください。');
    if (tokenValue && tokenExpiresAt > Date.now() + 60000) return tokenValue;
    tokenValue = ''; tokenExpiresAt = 0;
    await loadIdentityServices();
    return new Promise((resolve, reject) => {
      let settled = false;
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: READONLY_SCOPE,
        callback: response => {
          if (settled) return;
          settled = true;
          if (response?.error || !response?.access_token) {
            reject(new Error(response?.error_description || response?.error || 'Google認証に失敗しました。'));
            return;
          }
          tokenValue = response.access_token;
          tokenExpiresAt = Date.now() + Math.max(60, Number(response.expires_in) || 3600) * 1000;
          resolve(tokenValue);
        },
        error_callback: error => {
          if (settled) return;
          settled = true;
          reject(new Error(error?.message || 'Google認証画面を開けませんでした。'));
        }
      });
      client.requestAccessToken({ prompt: tokenValue ? '' : 'select_account' });
    });
  }

  async function googleApiGet(url, token) {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const apiMessage = payload?.error?.message || `HTTP ${response.status}`;
      if (response.status === 403 || response.status === 404) {
        throw new Error(`スプレッドシートを閲覧できません。Googleログイン中のアカウントに閲覧権限があるか確認してください（${apiMessage}）。`);
      }
      throw new Error(`Google Sheets APIエラー：${apiMessage}`);
    }
    return payload;
  }

  async function getSpreadsheetInfo(source, token) {
    const fields = 'spreadsheetId,properties(title),sheets(properties(sheetId,title,index))';
    const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.spreadsheetId)}?fields=${encodeURIComponent(fields)}`;
    const payload = await googleApiGet(endpoint, token);
    const sheets = Array.isArray(payload.sheets) ? payload.sheets.map(item => item.properties || {}) : [];
    let selectedSheet = null;
    if (source.gid !== null && source.gid !== undefined) {
      selectedSheet = sheets.find(sheet => Number(sheet.sheetId) === Number(source.gid)) || null;
      if (!selectedSheet) throw new Error('リンクで指定されたシートタブ（gid）が見つかりません。リンクを確認してください。');
    } else {
      selectedSheet = sheets.slice().sort((a, b) => Number(a.index || 0) - Number(b.index || 0))[0] || null;
    }
    if (!selectedSheet?.title) throw new Error('読み込めるシートタブが見つかりません。');
    return {
      spreadsheetId: payload.spreadsheetId || source.spreadsheetId,
      title: String(payload.properties?.title || 'Googleスプレッドシート'),
      sheetTitle: String(selectedSheet.title),
      sheetId: Number(selectedSheet.sheetId)
    };
  }

  async function getSpreadsheetRows(source, token, sheetTitle) {
    const escapedTitle = String(sheetTitle).replace(/'/g, "''");
    const range = `'${escapedTitle}'!A1:C`;
    const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
    const payload = await googleApiGet(endpoint, token);
    return Array.isArray(payload.values) ? payload.values : [];
  }

  function quoteCsvCell(value) {
    const text = String(value ?? '').trim();
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function rowsToCsv(values) {
    const rows = Array.isArray(values) ? values.slice() : [];
    const first = Array.isArray(rows[0]) ? rows[0].slice(0, 3).map(value => String(value ?? '').trim().toLowerCase()) : [];
    const headers = [['販売名','一般名','薬効'], ['商品名','一般名','薬効'], ['brand name','generic name','indication']];
    if (headers.some(header => header.every((value, index) => first[index] === value))) rows.shift();
    return rows
      .map(row => [0, 1, 2].map(index => quoteCsvCell(Array.isArray(row) ? row[index] : '')).join(','))
      .filter(line => line.replace(/,/g, '').replace(/"/g, '').trim().length > 0)
      .join('\n');
  }

  window.GoogleSheetsBridge = Object.freeze({
    parseSpreadsheetLink,
    preloadIdentityServices: loadIdentityServices,
    authorize,
    getSpreadsheetInfo,
    getSpreadsheetRows,
    rowsToCsv
  });
})();
