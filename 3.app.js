/* 3.app.js - アプリ全体の制御、ログイン、メニュー、CSV出力、PWA登録 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const APP_VERSION = '1.2.6';
  // v1.2.6内の更新識別子。画面機能の修正配布時も製品バージョン表記は維持します。
  const APP_REVISION = 2;
  const PATTERN_KEYS = ['sales_to_generic','generic_to_sales','sales_to_effect','effect_to_sales','generic_to_effect','effect_to_generic'];
  const config = window.APP_CONFIG || {};
  const ui = {};
  let selectedMode = null;
  let showBookmarks = true;
  let showWrongs = false;
  let framesReady = { quiz: false, flash: false };
  let workspaceInitialized = false;
  let deferredInstallPrompt = null;
  let swRegistration = null;
  const ROUTE_MARKER = 'medicine-learning-pwa';
  const AUTH_SESSION_KEY = 'authSession';
  const AUTH_CREDENTIAL_KEY = 'authPasswordCredential';

  function cacheElements() {
    [
      'loginScreen','workspace','loginForm','commonPassword','loginError','passwordSetupNotice',
      'modeScreen','menuScreen','quizFrameWrap','flashFrameWrap','quizFrame','flashFrame',
      'sharedDataInput','loadStatus','patternList','modeBadge','startModeBtn','flashcardOnlySetting',
      'bookmarkedOnly','quizOrderMode','flashcardOrderMode','quizRangeMode','quizRangeInput','flashcardRangeMode','flashcardRangeInput','quizOrderSetting','flashcardOrderSetting','quizWrongOptionsCard','reviewAllWrongsBtn','bookmarkList','bookmarkCount','wrongList','wrongCount','historyList','usageText',
      'installBtn','updateBtn','updateHelp','loginUpdateBtn','loginUpdateHelp'
    ].forEach(id => ui[id] = $(id));
  }
  function esc(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }
  function parseRows(text) {
    const rows = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const map = new Map();
    for (const row of rows) {
      const i = row.indexOf(','); if (i < 0) continue;
      const j = row.indexOf(',', i + 1); if (j < 0) continue;
      const salesName = row.slice(0, i).trim();
      const genericName = row.slice(i + 1, j).trim();
      const effect = row.slice(j + 1).trim();
      if (!salesName || !genericName || !effect) continue;
      const record = { salesName, genericName, effect };
      map.set(JSON.stringify(record), record);
    }
    return [...map.values()];
  }
  // 1始まりの範囲指定（例：1-10,21-30）を、重複除外後の医薬品配列に適用します。
  function selectRowsByRange(items, mode, rangeText) {
    if (mode !== 'custom') return items.slice();
    const raw = String(rangeText || '').trim();
    if (!raw) throw new Error('カスタム範囲を入力してください。入力例：1-10,21-30');
    const selected = new Set();
    const parts = raw.split(/[,，]/);
    for (const part of parts) {
      const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!match) throw new Error(`範囲「${part.trim()}」の形式が正しくありません。例：1-10,21-30`);
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        throw new Error(`範囲「${part.trim()}」が正しくありません。開始行は1以上、終了行は開始行以上にしてください。`);
      }
      if (end > items.length) {
        throw new Error(`範囲「${part.trim()}」はデータ件数（${items.length}件）を超えています。1～${items.length}の範囲で指定してください。`);
      }
      for (let row = start; row <= end; row += 1) selected.add(row - 1);
    }
    return [...selected].sort((a,b) => a-b).map(index => items[index]);
  }
  function setRangeInputEnabled(modeElement, inputElement) {
    if (modeElement && inputElement) inputElement.disabled = modeElement.value !== 'custom';
  }
  function selectedPatterns() {
    return [...ui.patternList.querySelectorAll('input[type="checkbox"]:checked')].map(x => x.value);
  }
  function persistSettings() {
    window.AppDB.saveSettings({
      dataText: ui.sharedDataInput.value,
      patterns: selectedPatterns(),
      bookmarkedOnly: ui.bookmarkedOnly.checked,
      quizOrder: ui.quizOrderMode.value,
      flashcardOrder: ui.flashcardOrderMode.value,
      quizRangeMode: ui.quizRangeMode.value,
      quizRangeInput: ui.quizRangeInput.value,
      flashcardRangeMode: ui.flashcardRangeMode.value,
      flashcardRangeInput: ui.flashcardRangeInput.value
    });
  }

  function getSessionDays() {
    const value = Number(config.LOGIN_SESSION_DAYS);
    return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 365) : 30;
  }
  function getPasswordRevision() {
    return String(config.AUTH_PASSWORD_REVISION || '1');
  }
  async function hashPassword(value) {
    if (!window.crypto || !window.crypto.subtle || typeof TextEncoder === 'undefined') return null;
    const data = new TextEncoder().encode(String(value));
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function safeEqual(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
  function hasUsableCredential() {
    const saved = window.AppDB.get(AUTH_CREDENTIAL_KEY, null);
    const expected = String(config.SHARED_PASSWORD || '');
    if (saved && saved.hash) {
      if (saved.revision === getPasswordRevision()) return true;
      // 古いrevisionを新しい既定値で意図せず上書きしないよう、
      // 管理者が明示的にPASSWORD_IS_DEFAULT=falseへ変更した場合だけ再設定を許可します。
      return config.PASSWORD_IS_DEFAULT !== true && !!expected && expected !== 'CHANGE-THIS-PASSWORD';
    }
    return !!expected && expected !== 'CHANGE-THIS-PASSWORD';
  }
  async function verifyPassword(entered) {
    const revision = getPasswordRevision();
    const saved = window.AppDB.get(AUTH_CREDENTIAL_KEY, null);
    const enteredHash = await hashPassword(entered);

    if (saved && saved.hash && saved.revision === revision && enteredHash) {
      return safeEqual(enteredHash, saved.hash);
    }
    if (saved && saved.hash && saved.revision !== revision && config.PASSWORD_IS_DEFAULT === true) {
      return false;
    }

    const expected = String(config.SHARED_PASSWORD || '');
    if (!expected || expected === 'CHANGE-THIS-PASSWORD' || entered !== expected) return false;

    // 初回の成功ログイン時に照合用ハッシュを端末へ保存します。
    // 以後はアプリのconfig.jsが更新されても同じ認証情報を維持できます。
    if (enteredHash) {
      window.AppDB.set(AUTH_CREDENTIAL_KEY, {
        revision,
        hash: enteredHash,
        savedAt: new Date().toISOString()
      });
    }
    return true;
  }
  function createLoginSession() {
    const now = Date.now();
    const days = getSessionDays();
    window.AppDB.set(AUTH_SESSION_KEY, { authenticatedAt: now, expiresAt: now + days * 24 * 60 * 60 * 1000 });
  }
  function hasValidLoginSession() {
    let session = window.AppDB.get(AUTH_SESSION_KEY, null);
    // 旧版のsessionStorageログインを、新版の期限付きログインへ一度だけ引き継ぎます。
    if (!session) {
      try {
        if (sessionStorage.getItem('medicine_learning_authenticated') === '1') {
          sessionStorage.removeItem('medicine_learning_authenticated');
          createLoginSession();
          session = window.AppDB.get(AUTH_SESSION_KEY, null);
        }
      } catch (error) { /* sessionStorageが使えない場合は通常のログインを要求します。 */ }
    }
    if (!session || !Number.isFinite(Number(session.expiresAt)) || Number(session.expiresAt) <= Date.now()) {
      window.AppDB.remove(AUTH_SESSION_KEY);
      return false;
    }
    return true;
  }
  function clearLoginSession() {
    window.AppDB.remove(AUTH_SESSION_KEY);
  }
  function saveRoute(route, replace = false) {
    const state = { app: ROUTE_MARKER, ...route };
    if (replace) history.replaceState(state, '', location.href);
    else {
      const current = history.state;
      const same = current && current.app === ROUTE_MARKER && current.page === state.page && current.mode === state.mode;
      if (!same) history.pushState(state, '', location.href);
    }
  }
  function restoreRoute(route) {
    if (!route || route.app !== ROUTE_MARKER) route = { app: ROUTE_MARKER, page: 'mode' };
    if (!hasValidLoginSession()) {
      ui.workspace.classList.add('hidden');
      ui.loginScreen.classList.add('active');
      history.replaceState({ app: ROUTE_MARKER, page: 'login' }, '', location.href);
      return;
    }
    ui.loginScreen.classList.remove('active');
    ui.workspace.classList.remove('hidden');
    if (route.page === 'menu') {
      selectMode(route.mode === 'flash' ? 'flash' : 'quiz', false);
    } else if (route.page === 'quiz' || route.page === 'flash') {
      selectedMode = route.page;
      setScreen(route.page);
    } else {
      selectedMode = null;
      setScreen('mode');
    }
  }
  function navigateBack(fallbackPage = 'mode', fallbackMode = null) {
    const state = history.state;
    if (state && state.app === ROUTE_MARKER && history.length > 1) {
      history.back();
      return;
    }
    const fallback = { app: ROUTE_MARKER, page: fallbackPage };
    if (fallbackMode) fallback.mode = fallbackMode;
    history.replaceState(fallback, '', location.href);
    restoreRoute(fallback);
  }
  function setScreen(screen) {
    [ui.modeScreen, ui.menuScreen, ui.quizFrameWrap, ui.flashFrameWrap].forEach(el => el.classList.remove('active'));
    if (screen === 'mode') ui.modeScreen.classList.add('active');
    if (screen === 'menu') ui.menuScreen.classList.add('active');
    if (screen === 'quiz') ui.quizFrameWrap.classList.add('active');
    if (screen === 'flash') ui.flashFrameWrap.classList.add('active');
    window.scrollTo(0, 0);
  }
  function selectMode(mode, recordHistory = true) {
    selectedMode = mode;
    ui.modeBadge.textContent = mode === 'quiz' ? '医薬品クイズ' : '暗記カード';
    ui.flashcardOnlySetting.classList.toggle('hidden', mode !== 'flash');
    ui.quizOrderSetting.classList.toggle('hidden', mode !== 'quiz');
    ui.flashcardOrderSetting.classList.toggle('hidden', mode !== 'flash');
    ui.quizWrongOptionsCard.classList.toggle('hidden', mode !== 'quiz');
    $('startModeBtn').textContent = mode === 'quiz' ? 'クイズを開始' : '暗記カードを開始';
    ui.usageText.innerHTML = mode === 'quiz'
      ? '1. データを読み込み、出題パターンと出題順（入力順／ランダム）を選択します。<br>2. 問題に対する解答を入力し、「答えを表示」を押します。<br>3. 正誤と正答を確認し、「次へ」で進みます。<br>4. Enterキーでも主操作を実行できます。途中終了や過去の誤答の総復習も可能です。'
      : '1. データを読み込み、出題パターンとカード順（入力順／ランダム）を選択します。<br>2. カード本体をタップして裏返し、答えを確認します。<br>3. 「前に戻る」「次へ進む」でカードを移動します。<br>4. 保存マークからブックマーク色を選び、保存済みカードだけで学習することもできます。';
    setScreen('menu');
    if (recordHistory) saveRoute({ page: 'menu', mode });
    renderSharedLists();
  }
  function updateDataStatus() {
    const count = parseRows(ui.sharedDataInput.value).length;
    ui.loadStatus.textContent = count ? `${count}件のデータを入力済み（重複除外後）` : '未読み込み';
  }
  function setSetupInFrames() {
    const data = ui.sharedDataInput.value;
    const patterns = selectedPatterns();
    try { if (framesReady.quiz && ui.quizFrame.contentWindow.appBridge) ui.quizFrame.contentWindow.appBridge.setSetup(data, patterns, ui.quizOrderMode.value, ui.quizRangeMode.value, ui.quizRangeInput.value); } catch (error) { console.warn('Quiz setup was not ready.', error); }
    try { if (framesReady.flash && ui.flashFrame.contentWindow.appBridge) ui.flashFrame.contentWindow.appBridge.setSetup(data, patterns, ui.flashcardOrderMode.value, ui.flashcardRangeMode.value, ui.flashcardRangeInput.value); } catch (error) { console.warn('Flashcard setup was not ready.', error); }
    persistSettings();
    updateDataStatus();
  }
  function launchMode() {
    if (!selectedMode) return;
    const count = parseRows(ui.sharedDataInput.value).length;
    const patterns = selectedPatterns();
    if (!count) { alert('データが入力されていません。「販売名,一般名,薬効」を入力して読み込んでください。'); return; }
    if (!patterns.length) { alert('出題パターンを1つ以上選んでください。'); return; }
    const rangeMode = selectedMode === 'quiz' ? ui.quizRangeMode.value : ui.flashcardRangeMode.value;
    const rangeInput = selectedMode === 'quiz' ? ui.quizRangeInput.value : ui.flashcardRangeInput.value;
    try {
      const selectedItems = selectRowsByRange(parseRows(ui.sharedDataInput.value), rangeMode, rangeInput);
      if (!selectedItems.length) { alert('指定範囲に該当する医薬品がありません。'); return; }
    } catch (error) { alert(error.message || '行の範囲指定を確認してください。'); return; }
    const bridgeReady = selectedMode === 'quiz'
      ? framesReady.quiz && !!ui.quizFrame.contentWindow.appBridge
      : framesReady.flash && !!ui.flashFrame.contentWindow.appBridge;
    if (!bridgeReady) { alert('学習画面を読み込み中です。数秒待ってから、もう一度「学習を開始」を押してください。'); return; }
    setSetupInFrames();
    if (selectedMode === 'quiz') {
      setScreen('quiz');
      saveRoute({ page: 'quiz', mode: 'quiz' });
      ui.quizFrame.contentWindow.appBridge.launch(ui.sharedDataInput.value, patterns, ui.quizOrderMode.value, ui.quizRangeMode.value, ui.quizRangeInput.value);
    } else {
      setScreen('flash');
      saveRoute({ page: 'flash', mode: 'flash' });
      ui.flashFrame.contentWindow.appBridge.launch(ui.sharedDataInput.value, patterns, ui.bookmarkedOnly.checked, ui.flashcardOrderMode.value, ui.flashcardRangeMode.value, ui.flashcardRangeInput.value);
    }
  }
  function groupWrong(records) {
    const map = new Map();
    for (const w of records || []) {
      const key = JSON.stringify([w.source?.salesName || '', w.source?.genericName || '', w.source?.effect || '', w.patternKey || '']);
      if (!map.has(key)) map.set(key, { ...w, count: 0 });
      map.get(key).count++;
      if (new Date(w.time || 0) > new Date(map.get(key).time || 0)) {
        map.get(key).time = w.time;
        map.get(key).userAnswer = w.userAnswer;
        map.get(key).correctText = w.correctText;
      }
    }
    return [...map.values()].sort((a,b) => new Date(b.time || 0) - new Date(a.time || 0));
  }
  function renderBookmarks() {
    if (!framesReady.flash || !ui.flashFrame.contentWindow.appBridge) {
      ui.bookmarkList.innerHTML = '<div class="muted">読み込み中です。</div>'; return;
    }
    const list = ui.flashFrame.contentWindow.appBridge.getBookmarks().slice(0, 200);
    ui.bookmarkCount.textContent = `${list.length}件`;
    if (!showBookmarks) { ui.bookmarkList.innerHTML = '<div class="muted">一覧は非表示です。</div>'; return; }
    if (!list.length) { ui.bookmarkList.innerHTML = '<div class="muted">まだブックマークはありません。</div>'; return; }
    ui.bookmarkList.innerHTML = '';
    const colorMeta = {
      amber:{ label:'橙', accent:'#f59e0b', soft:'rgba(245,158,11,.14)', border:'rgba(245,158,11,.38)', text:'#8a5800', itemBg:'rgba(245,158,11,.055)' },
      emerald:{ label:'緑', accent:'#22c55e', soft:'rgba(34,197,94,.13)', border:'rgba(34,197,94,.36)', text:'#166534', itemBg:'rgba(34,197,94,.055)' },
      sky:{ label:'水色', accent:'#0ea5e9', soft:'rgba(14,165,233,.13)', border:'rgba(14,165,233,.36)', text:'#075985', itemBg:'rgba(14,165,233,.055)' },
      violet:{ label:'紫', accent:'#8b5cf6', soft:'rgba(139,92,246,.13)', border:'rgba(139,92,246,.36)', text:'#5b21b6', itemBg:'rgba(139,92,246,.055)' },
      rose:{ label:'赤', accent:'#f43f5e', soft:'rgba(244,63,94,.12)', border:'rgba(244,63,94,.34)', text:'#9f1239', itemBg:'rgba(244,63,94,.05)' },
      slate:{ label:'灰', accent:'#64748b', soft:'rgba(100,116,139,.13)', border:'rgba(100,116,139,.34)', text:'#334155', itemBg:'rgba(100,116,139,.055)' }
    };
    for (const b of list) {
      const names = {
        sales_to_generic:['salesName','genericName'], generic_to_sales:['genericName','salesName'],
        sales_to_effect:['salesName','effect'], effect_to_sales:['effect','salesName'],
        generic_to_effect:['genericName','effect'], effect_to_generic:['effect','genericName']
      };
      const p = PATTERN_KEYS.includes(b.patternKey) ? b.patternKey : 'sales_to_generic';
      const pair = names[p];
      const meta = colorMeta[b.color] || colorMeta.sky;
      const el = document.createElement('div'); el.className = 'item';
      el.style.background = meta.itemBg;
      el.style.borderColor = meta.border;
      el.style.borderLeft = `4px solid ${meta.accent}`;
      el.innerHTML = `<div class="itemTop"><div class="itemTitle">${esc(b.name || b.patternLabel || '問題')}</div><span class="badge bookmarked" style="background:${meta.soft};border-color:${meta.border};color:${meta.text}" aria-label="ブックマーク色：${meta.label}">${esc(meta.label)}</span></div>${b.name ? `<div class="itemMeta">${esc(b.patternLabel || '')}</div>` : ''}<div class="itemMeta">問題: ${esc(b.item?.[pair[0]] || '')}</div><div class="itemMeta">答え: <b>${esc(b.item?.[pair[1]] || '')}</b></div><div class="row" style="margin-top:10px"><button class="btn secondary" data-edit="${esc(b.key)}" type="button">色を変更</button><button class="btn secondary" data-rename="${esc(b.key)}" type="button">名前を編集</button><button class="btn danger" data-remove="${esc(b.key)}" type="button">削除</button></div>`;
      ui.bookmarkList.appendChild(el);
    }
    ui.bookmarkList.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => {
      if (!framesReady.flash || !ui.flashFrame.contentWindow.appBridge) return;
      ui.flashFrame.contentWindow.appBridge.openBookmarkColorPicker(btn.dataset.edit, document);
    }));
    ui.bookmarkList.querySelectorAll('[data-rename]').forEach(btn => btn.addEventListener('click', () => {
      if (!framesReady.flash || !ui.flashFrame.contentWindow.appBridge) return;
      const current = ui.flashFrame.contentWindow.appBridge.getBookmarks().find(item => item.key === btn.dataset.rename);
      if (!current) return;
      const value = prompt('ブックマーク名を入力してください。空欄にすると名前なしになります。', current.name || '');
      if (value === null) return;
      ui.flashFrame.contentWindow.appBridge.renameBookmark(btn.dataset.rename, value.trim().slice(0,40));
    }));
    ui.bookmarkList.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
      if (confirm('このブックマークを削除しますか？') && framesReady.flash) ui.flashFrame.contentWindow.appBridge.removeBookmark(btn.dataset.remove);
    }));
  }
  function renderWrongs() {
    if (!framesReady.quiz || !ui.quizFrame.contentWindow.appBridge) { ui.wrongList.innerHTML = '<div class="muted">読み込み中です。</div>'; return; }
    const all = ui.quizFrame.contentWindow.appBridge.getWrongs() || [];
    const grouped = groupWrong(all);
    ui.wrongCount.textContent = `${grouped.length}件`;
    ui.reviewAllWrongsBtn.disabled = grouped.length === 0;
    $('exportWrongCsvBtn').disabled = all.length === 0;
    if (!showWrongs) { ui.wrongList.innerHTML = '<div class="muted">「表示 / 非表示」で一覧を開けます。</div>'; return; }
    if (!grouped.length) { ui.wrongList.innerHTML = '<div class="muted">間違えた問題はありません。</div>'; return; }
    ui.wrongList.innerHTML = '';
    for (const w of grouped.slice(0, 10)) {
      const el = document.createElement('div'); el.className = 'item';
      el.innerHTML = `<div class="itemTop"><div class="itemTitle">${esc(w.patternLabel || '問題')}</div><span class="badge bad">誤答 ${esc(String(w.count || 1))}回</span></div><div class="itemMeta">問題: ${esc(w.askedText || '')}</div><div class="itemMeta">正答: <b>${esc(w.correctText || '-')}</b></div><div class="itemMeta">最後の入力: ${esc(w.userAnswer || '-')}</div>`;
      ui.wrongList.appendChild(el);
    }
  }
  function renderHistory() {
    if (!framesReady.quiz || !ui.quizFrame.contentWindow.appBridge) { ui.historyList.innerHTML = '<div class="muted">読み込み中です。</div>'; return; }
    const list = ui.quizFrame.contentWindow.appBridge.getHistory().slice(0, 10);
    ui.historyList.innerHTML = '';
    if (!list.length) { ui.historyList.innerHTML = '<div class="muted">まだ履歴はありません。</div>'; return; }
    list.forEach((h, i) => {
      const d = new Date(h.time); const when = isNaN(d.getTime()) ? '不明な日時' : d.toLocaleString('ja-JP');
      const suffix = h.reviewMode === 'allWrong' ? '（総復習）' : h.reviewMode === 'sessionWrong' ? '（誤答復習）' : '';
      const el = document.createElement('div'); el.className = 'item';
      el.innerHTML = `<div class="itemTop"><div class="itemTitle">${i+1}. ${esc(when)}${suffix}${h.earlyFinish ? '（途中終了）' : ''}</div><span class="badge good">${Number(h.accuracy || 0).toFixed(1)}%</span></div><div class="itemMeta">正解数: <b>${Number(h.score || 0)}</b> / <b>${Number(h.total || 0)}</b></div>`;
      ui.historyList.appendChild(el);
    });
  }
  function renderSharedLists() { renderBookmarks(); renderWrongs(); renderHistory(); }
  function csvCell(value) {
    let v = String(value ?? '').replaceAll('\r', ' ').replaceAll('\n', ' ');
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    return '"' + v.replaceAll('"', '""') + '"';
  }
  function exportWrongCsv() {
    if (!framesReady.quiz || !ui.quizFrame.contentWindow.appBridge) { alert('誤答データを読み込めません。'); return; }
    const wrongs = [...(ui.quizFrame.contentWindow.appBridge.getWrongs() || [])]
      .sort((a,b) => new Date(b.time || 0) - new Date(a.time || 0));
    if (!wrongs.length) { alert('出力する誤答はありません。'); return; }
    const rows = [['誤答日時','出題形式','問題','正答','入力内容']];
    for (const w of wrongs) rows.push([
      w.time ? new Date(w.time).toLocaleString('ja-JP') : '',
      w.patternLabel || '', w.askedText || '', w.correctText || '', w.userAnswer || ''
    ]);
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0,10).replaceAll('-','');
    a.href = url; a.download = `医薬品クイズ_誤答一覧_${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function authenticate(event) {
    event.preventDefault();
    const entered = ui.commonPassword.value;
    const submitButton = ui.loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = '確認中…';
    ui.loginError.textContent = '';
    try {
      if (!hasUsableCredential()) {
        ui.loginError.textContent = '管理者設定が見つかりません。data/config.local.js に従来の共通パスワードを設定してください。';
        return;
      }
      const valid = await verifyPassword(entered);
      if (!valid) {
        ui.loginError.textContent = 'パスワードが正しくありません。更新後に設定が初期化された可能性がある場合は、管理者に従来のパスワード設定を確認してください。';
        ui.commonPassword.select();
        return;
      }
      createLoginSession();
      ui.loginScreen.classList.remove('active');
      ui.workspace.classList.remove('hidden');
      ui.loginError.textContent = '';
      ui.commonPassword.value = '';
      history.replaceState({ app: ROUTE_MARKER, page: 'mode' }, '', location.href);
      initializeWorkspace();
    } catch (error) {
      console.error('Authentication failed:', error);
      ui.loginError.textContent = '認証処理に失敗しました。HTTPS接続で再読み込みしてからお試しください。';
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'ログイン';
    }
  }
  function logout() {
    clearLoginSession();
    ui.workspace.classList.add('hidden');
    ui.loginScreen.classList.add('active');
    ui.commonPassword.value = '';
    history.replaceState({ app: ROUTE_MARKER, page: 'login' }, '', location.href);
  }
  function loadModeFrames() {
    if (!ui.quizFrame.hasAttribute('src')) {
      ui.quizFrame.addEventListener('load', () => { framesReady.quiz = true; if (workspaceInitialized) { setSetupInFrames(); renderSharedLists(); } });
      ui.quizFrame.src = './modules/quiz-app.html';
    }
    if (!ui.flashFrame.hasAttribute('src')) {
      ui.flashFrame.addEventListener('load', () => { framesReady.flash = true; if (workspaceInitialized) { setSetupInFrames(); renderSharedLists(); } });
      ui.flashFrame.src = './modules/flashcard-app.html';
    }
  }
  function initializeWorkspace() {
    const saved = window.AppDB.getSettings();
    ui.sharedDataInput.value = saved.dataText || '';
    if (Array.isArray(saved.patterns)) {
      ui.patternList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = saved.patterns.includes(cb.value));
    }
    ui.bookmarkedOnly.checked = !!saved.bookmarkedOnly;
    ui.quizOrderMode.value = saved.quizOrder === 'ordered' ? 'ordered' : 'random';
    ui.flashcardOrderMode.value = saved.flashcardOrder === 'ordered' ? 'ordered' : 'random';
    ui.quizRangeMode.value = saved.quizRangeMode === 'custom' ? 'custom' : 'all';
    ui.quizRangeInput.value = String(saved.quizRangeInput || '');
    ui.flashcardRangeMode.value = saved.flashcardRangeMode === 'custom' ? 'custom' : 'all';
    ui.flashcardRangeInput.value = String(saved.flashcardRangeInput || '');
    setRangeInputEnabled(ui.quizRangeMode, ui.quizRangeInput);
    setRangeInputEnabled(ui.flashcardRangeMode, ui.flashcardRangeInput);
    workspaceInitialized = true;
    loadModeFrames();
    updateDataStatus();
    setSetupInFrames();
    setScreen('mode');
  }
  function compareVersions(left, right) {
    const a = String(left).split('.').map(Number);
    const b = String(right).split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
      const delta = (a[index] || 0) - (b[index] || 0);
      if (delta !== 0) return delta > 0 ? 1 : -1;
    }
    return 0;
  }

  async function fetchPublishedVersion() {
    const url = new URL('./version.json', document.baseURI);
    url.searchParams.set('_', String(Date.now()));
    const response = await fetch(url.href, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    if (!response.ok) throw new Error(`version.json の取得に失敗しました（HTTP ${response.status}）`);
    const payload = await response.json();
    const version = String(payload.version || '').trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('公開版番号が不正です。');
    const revision = Number.isSafeInteger(Number(payload.revision)) && Number(payload.revision) >= 1 ? Number(payload.revision) : 1;
    return { version, revision };
  }

  function waitForWorkerState(worker, acceptedStates, timeoutMs = 30000) {
    if (!worker) return Promise.resolve(null);
    if (acceptedStates.includes(worker.state)) return Promise.resolve(worker.state);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.removeEventListener('statechange', onStateChange);
        error ? reject(error) : resolve(value);
      };
      const onStateChange = () => {
        if (acceptedStates.includes(worker.state)) finish(null, worker.state);
        else if (worker.state === 'redundant') finish(new Error('更新用Service Workerのインストールに失敗しました。'));
      };
      const timer = setTimeout(() => finish(new Error('Service Workerの更新処理がタイムアウトしました。')), timeoutMs);
      worker.addEventListener('statechange', onStateChange);
      onStateChange();
    });
  }

  function waitForControllerChange(previousController, timeoutMs = 6000) {
    if (navigator.serviceWorker.controller && navigator.serviceWorker.controller !== previousController) return Promise.resolve();
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener('controllerchange', finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      navigator.serviceWorker.addEventListener('controllerchange', finish);
    });
  }

  async function activateWaitingWorker(registration) {
    const waiting = registration?.waiting;
    if (!waiting) return false;
    const previousController = navigator.serviceWorker.controller;
    const activated = waitForWorkerState(waiting, ['activated']);
    waiting.postMessage({ type: 'SKIP_WAITING' });
    await activated;
    await waitForControllerChange(previousController);
    return true;
  }

  function setUpdateButtons(disabled, label) {
    [ui.updateBtn, ui.loginUpdateBtn].filter(Boolean).forEach(button => {
      button.disabled = !!disabled;
      button.textContent = label;
    });
  }
  function setUpdateMessage(message) {
    [ui.updateHelp, ui.loginUpdateHelp].filter(Boolean).forEach(node => { node.textContent = message; });
  }
  function showUpdateError(message) {
    setUpdateButtons(false, '更新を確認');
    setUpdateMessage(`${message} 学習データは端末内に保存されています。サイトデータの削除は行わず、まずオンライン状態で再試行してください。`);
    alert(message);
  }

  async function checkAndApplyUpdate() {
    setUpdateButtons(true, '更新を確認中…');
    setUpdateMessage('公開版と更新ファイル一式を確認しています。ダウンロードが完了するまで画面を閉じないでください。');
    try {
      const published = await fetchPublishedVersion();
      const publishedVersion = published.version;
      const versionOrder = compareVersions(publishedVersion, APP_VERSION);
      const revisionOrder = versionOrder === 0 ? Math.sign(published.revision - APP_REVISION) : 0;
      const hasUpdate = versionOrder > 0 || revisionOrder > 0;
      if (versionOrder < 0 || (versionOrder === 0 && revisionOrder < 0)) {
        throw new Error(`公開側（v${publishedVersion} revision ${published.revision}）が端末側（v${APP_VERSION} revision ${APP_REVISION}）より古い状態です。GitHub Pagesの公開状態を確認してください。`);
      }

      const secureContext = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if ('serviceWorker' in navigator && secureContext) {
        let registration = swRegistration || await navigator.serviceWorker.getRegistration();
        if (!registration) registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
        swRegistration = registration;
        const previousController = navigator.serviceWorker.controller;
        await registration.update();

        // installイベントがコア資産すべてを取得し終えるまで待機します。
        let installing = registration.installing;
        const installedState = installing
          ? await waitForWorkerState(installing, ['installed', 'activated'], 90000)
          : null;
        if (registration.waiting) {
          setUpdateButtons(true, '更新を適用中…');
          setUpdateMessage('新しいアプリ一式の取得が完了しました。アプリを切り替えています。');
          await activateWaitingWorker(registration);
          location.reload();
          return;
        }
        // Service Workerが初回登録として直接activateしたケースも反映します。
        if (hasUpdate && installedState === 'activated') {
          await waitForControllerChange(previousController, 10000);
          location.reload();
          return;
        }

        if (hasUpdate) {
          throw new Error(`公開版 v${publishedVersion} revision ${published.revision} を確認しましたが、新版の完全な取得を確認できませんでした。配信が完了してから、もう一度「更新を確認」を押してください。旧版のキャッシュと学習データは保持しています。`);
        }
      } else if (hasUpdate) {
        // Service Worker非対応環境では通常の再読み込みへフォールバックします。
        const refreshedUrl = new URL(location.href);
        refreshedUrl.searchParams.set('app-refresh', `${publishedVersion}-r${published.revision}-${Date.now()}`);
        location.replace(refreshedUrl.href);
        return;
      }

      setUpdateButtons(false, '更新を確認');
      const message = `現在のバージョン（v${APP_VERSION} revision ${APP_REVISION}）は公開最新版です。学習履歴・ブックマーク・設定は保持されています。`;
      setUpdateMessage(message);
      alert(`更新はありません。現在のバージョンは v${APP_VERSION} です（revision ${APP_REVISION}）。`);
    } catch (error) {
      console.error('Update check failed:', error);
      showUpdateError(`更新を確認できませんでした。インターネット接続とGitHub Pagesの公開状態を確認してください。詳細: ${error.message}`);
    }
  }

  function registerPwa() {
    const secureContext = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && secureContext) {
      navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then(async registration => {
        swRegistration = registration;
        if (registration.waiting && navigator.serviceWorker.controller) {
          setUpdateButtons(false, '更新を適用');
          setUpdateMessage('新しいアプリ一式の取得が完了しています。ログイン前でも更新を適用できます。');
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', async () => {
            if (installing.state !== 'installed' || !navigator.serviceWorker.controller) return;
            // ログイン画面で待機している場合だけ、自動で切り替えて再読み込みします。
            // 学習中の画面を突然リロードしないため、ログイン後は手動適用にします。
            if (ui.loginScreen.classList.contains('active') && ui.workspace.classList.contains('hidden')) {
              try {
                setUpdateButtons(true, '更新を適用中…');
                setUpdateMessage('新版の全ファイル取得が完了しました。更新を適用しています。');
                await activateWaitingWorker(registration);
                location.reload();
              } catch (error) {
                console.warn('Automatic update activation failed:', error);
                setUpdateButtons(false, '更新を適用');
              }
            } else {
              setUpdateButtons(false, '更新を適用');
              setUpdateMessage('新しいアプリ一式のダウンロードが完了しました。「更新を適用」を押すと切り替わります。');
            }
          });
        });
        try { await registration.update(); }
        catch (error) { console.warn('Initial Service Worker update check failed:', error); }
      }).catch(err => {
        console.warn('Service Worker registration failed:', err);
        setUpdateMessage('Service Workerを登録できません。HTTPSまたはlocalhostで開いていることを確認してください。');
      });
    } else {
      setUpdateMessage('この環境では自動更新を利用できません。HTTPSまたはlocalhostで開いてください。');
    }

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault(); deferredInstallPrompt = event;
      ui.installBtn.classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; ui.installBtn.classList.add('hidden'); });
    ui.installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      ui.installBtn.classList.add('hidden');
    });

    ui.updateBtn.addEventListener('click', checkAndApplyUpdate);
    ui.loginUpdateBtn.addEventListener('click', checkAndApplyUpdate);

    window.addEventListener('popstate', event => {
      if (!hasValidLoginSession()) {
        ui.workspace.classList.add('hidden');
        ui.loginScreen.classList.add('active');
        history.replaceState({ app: ROUTE_MARKER, page: 'login' }, '', location.href);
        return;
      }
      restoreRoute(event.state);
    });
  }
  function bindEvents() {
    ui.loginForm.addEventListener('submit', authenticate);
    $('chooseQuizBtn').addEventListener('click', () => selectMode('quiz'));
    $('chooseFlashBtn').addEventListener('click', () => selectMode('flash'));
    $('changeModeBtn').addEventListener('click', () => navigateBack('mode'));
    $('startModeBtn').addEventListener('click', launchMode);
    $('loadDataBtn').addEventListener('click', () => {
      setSetupInFrames();
      const count = parseRows(ui.sharedDataInput.value).length;
      alert(count ? `${count}件のデータを読み込みました。` : '読み込み失敗: 3列のデータが見つかりません。');
    });
    ui.sharedDataInput.addEventListener('input', () => { persistSettings(); updateDataStatus(); });
    ui.patternList.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => { persistSettings(); if (framesReady.quiz || framesReady.flash) setSetupInFrames(); }));
    ui.bookmarkedOnly.addEventListener('change', persistSettings);
    ui.quizOrderMode.addEventListener('change', () => { persistSettings(); if (framesReady.quiz) setSetupInFrames(); });
    ui.flashcardOrderMode.addEventListener('change', () => { persistSettings(); if (framesReady.flash) setSetupInFrames(); });
    ui.quizRangeMode.addEventListener('change', () => { setRangeInputEnabled(ui.quizRangeMode, ui.quizRangeInput); persistSettings(); if (framesReady.quiz) setSetupInFrames(); });
    ui.quizRangeInput.addEventListener('input', () => { persistSettings(); if (framesReady.quiz) setSetupInFrames(); });
    ui.flashcardRangeMode.addEventListener('change', () => { setRangeInputEnabled(ui.flashcardRangeMode, ui.flashcardRangeInput); persistSettings(); if (framesReady.flash) setSetupInFrames(); });
    ui.flashcardRangeInput.addEventListener('input', () => { persistSettings(); if (framesReady.flash) setSetupInFrames(); });
    $('reviewAllWrongsBtn').addEventListener('click', () => {
      if (!framesReady.quiz || !ui.quizFrame.contentWindow.appBridge) { alert('クイズ画面を読み込めません。'); return; }
      const wrongs = ui.quizFrame.contentWindow.appBridge.getWrongs() || [];
      if (!wrongs.length) { alert('復習できる誤答がありません。'); renderWrongs(); return; }
      setSetupInFrames();
      setScreen('quiz');
      saveRoute({ page: 'quiz', mode: 'quiz' });
      ui.quizFrame.contentWindow.appBridge.startAllWrongReview();
    });
    $('toggleBookmarksBtn').addEventListener('click', () => { showBookmarks = !showBookmarks; renderBookmarks(); });
    $('clearBookmarksBtn').addEventListener('click', () => {
      if (!confirm('ブックマークをすべて消去しますか？')) return;
      if (framesReady.flash) ui.flashFrame.contentWindow.appBridge.clearBookmarks(); else renderBookmarks();
    });
    $('toggleWrongsBtn').addEventListener('click', () => { showWrongs = !showWrongs; renderWrongs(); });
    $('exportWrongCsvBtn').addEventListener('click', exportWrongCsv);
    $('clearWrongsBtn').addEventListener('click', () => {
      if (!confirm('直近の誤答をすべて消去しますか？')) return;
      if (framesReady.quiz) ui.quizFrame.contentWindow.appBridge.clearWrongs(); renderWrongs();
    });
    $('clearHistoryBtn').addEventListener('click', () => {
      if (!confirm('履歴をすべて消去しますか？')) return;
      if (framesReady.quiz) ui.quizFrame.contentWindow.appBridge.clearHistory(); renderHistory();
    });
    $('logoutBtn').addEventListener('click', logout);
  }
  window.AppShell = {
    refreshBookmarkList() { renderBookmarks(); },
    returnToMenu(mode) {
      // 学習画面から共通メニューへ戻す。通常は直前のメニュー履歴へ戻ります。
      const fallbackMode = mode === 'quiz' ? 'quiz' : 'flash';
      if (history.state && history.state.app === ROUTE_MARKER && history.state.page === fallbackMode) {
        history.back();
      } else {
        selectMode(fallbackMode, false);
        saveRoute({ page: 'menu', mode: fallbackMode });
      }
    }
  };
  function init() {
    cacheElements();
    bindEvents();
    registerPwa();
    loadModeFrames();
    ui.passwordSetupNotice.textContent = config.PASSWORD_IS_DEFAULT
      ? '初期設定のままです。管理者は data/config.js の SHARED_PASSWORD を変更してから配布してください。'
      : '';
    if (hasValidLoginSession() && hasUsableCredential()) {
      ui.loginScreen.classList.remove('active');
      ui.workspace.classList.remove('hidden');
      history.replaceState({ app: ROUTE_MARKER, page: 'mode' }, '', location.href);
      initializeWorkspace();
    } else {
      clearLoginSession();
      history.replaceState({ app: ROUTE_MARKER, page: 'login' }, '', location.href);
    }
  }
  init();
})();
