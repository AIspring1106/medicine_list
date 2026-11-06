/* 3.app.js - アプリ全体の制御、ログイン、メニュー、CSV出力、PWA登録 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
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
  let refreshingForUpdate = false;
  const ROUTE_MARKER = 'medicine-learning-pwa';
  const AUTH_SESSION_KEY = 'authSession';

  function cacheElements() {
    [
      'loginScreen','workspace','loginForm','commonPassword','loginError','passwordSetupNotice',
      'modeScreen','menuScreen','quizFrameWrap','flashFrameWrap','quizFrame','flashFrame',
      'sharedDataInput','loadStatus','patternList','modeBadge','startModeBtn','flashcardOnlySetting',
      'bookmarkedOnly','bookmarkList','bookmarkCount','wrongList','wrongCount','historyList','usageText',
      'jsonDataFile','installBtn','updateBtn'
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
  function selectedPatterns() {
    return [...ui.patternList.querySelectorAll('input[type="checkbox"]:checked')].map(x => x.value);
  }
  function persistSettings() {
    window.AppDB.saveSettings({
      dataText: ui.sharedDataInput.value,
      patterns: selectedPatterns(),
      bookmarkedOnly: ui.bookmarkedOnly.checked
    });
  }

  function getSessionDays() {
    const value = Number(config.LOGIN_SESSION_DAYS);
    return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 365) : 30;
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
    $('startModeBtn').textContent = mode === 'quiz' ? 'クイズを開始' : '暗記カードを開始';
    ui.usageText.innerHTML = mode === 'quiz'
      ? '1. データを読み込み、出題パターンを選択します。<br>2. 問題に対する解答を入力し、「答えを表示」を押します。<br>3. 正誤と正答を確認し、「次へ」で進みます。<br>4. Enterキーでも主操作を実行できます。途中終了や誤答の復習も可能です。'
      : '1. データを読み込み、出題パターンを選択します。<br>2. カード本体をタップして裏返し、答えを確認します。<br>3. 「前に戻る」「次へ進む」でカードを移動します。<br>4. 保存マークからブックマーク色を選び、保存済みカードだけで学習することもできます。';
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
    try { if (framesReady.quiz && ui.quizFrame.contentWindow.appBridge) ui.quizFrame.contentWindow.appBridge.setSetup(data, patterns); } catch (error) { console.warn('Quiz setup was not ready.', error); }
    try { if (framesReady.flash && ui.flashFrame.contentWindow.appBridge) ui.flashFrame.contentWindow.appBridge.setSetup(data, patterns); } catch (error) { console.warn('Flashcard setup was not ready.', error); }
    persistSettings();
    updateDataStatus();
  }
  function launchMode() {
    if (!selectedMode) return;
    const count = parseRows(ui.sharedDataInput.value).length;
    const patterns = selectedPatterns();
    if (!count) { alert('データが入力されていません。「販売名,一般名,薬効」を入力して読み込んでください。'); return; }
    if (!patterns.length) { alert('出題パターンを1つ以上選んでください。'); return; }
    const bridgeReady = selectedMode === 'quiz'
      ? framesReady.quiz && !!ui.quizFrame.contentWindow.appBridge
      : framesReady.flash && !!ui.flashFrame.contentWindow.appBridge;
    if (!bridgeReady) { alert('学習画面を読み込み中です。数秒待ってから、もう一度「学習を開始」を押してください。'); return; }
    setSetupInFrames();
    if (selectedMode === 'quiz') {
      setScreen('quiz');
      saveRoute({ page: 'quiz', mode: 'quiz' });
      ui.quizFrame.contentWindow.appBridge.launch(ui.sharedDataInput.value, patterns);
    } else {
      setScreen('flash');
      saveRoute({ page: 'flash', mode: 'flash' });
      ui.flashFrame.contentWindow.appBridge.launch(ui.sharedDataInput.value, patterns, ui.bookmarkedOnly.checked);
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
  function loadJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        const items = Array.isArray(parsed) ? parsed : parsed.items;
        if (!Array.isArray(items)) throw new Error('items配列がありません');
        const rows = items.map((x) => {
          const sales = x.salesName ?? x.sales_name ?? x.sales ?? '';
          const generic = x.genericName ?? x.generic_name ?? x.generic ?? '';
          const effect = x.effect ?? x.category ?? '';
          if (!sales || !generic || !effect) throw new Error('各項目に salesName, genericName, effect が必要です');
          return `${sales},${generic},${effect}`;
        });
        ui.sharedDataInput.value = rows.join('\n');
        persistSettings(); setSetupInFrames();
        alert(`${rows.length}件の医薬品データを読み込みました。`);
      } catch (error) {
        alert(`JSONを読み込めませんでした。形式を確認してください。\n${error.message}`);
      } finally { ui.jsonDataFile.value = ''; }
    };
    reader.onerror = () => alert('ファイルを読み込めませんでした。');
    reader.readAsText(file, 'utf-8');
  }
  function authenticate(event) {
    event.preventDefault();
    const expected = String(config.SHARED_PASSWORD || '');
    const entered = ui.commonPassword.value;
    if (!expected || expected === 'CHANGE-THIS-PASSWORD') {
      ui.loginError.textContent = '管理者が data/config.js の SHARED_PASSWORD を変更してください。';
      return;
    }
    if (entered !== expected) {
      ui.loginError.textContent = 'パスワードが正しくありません。';
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
    workspaceInitialized = true;
    loadModeFrames();
    updateDataStatus();
    setSetupInFrames();
    setScreen('mode');
  }
  function registerPwa() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshingForUpdate && hadController) location.reload();
      });
      navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then(async registration => {
        swRegistration = registration;
        const showUpdateButton = () => {
          ui.updateBtn.classList.remove('hidden');
          ui.updateBtn.disabled = false;
          ui.updateBtn.textContent = '更新を適用';
        };
        ui.updateBtn.classList.remove('hidden');
        ui.updateBtn.textContent = '更新を確認';
        if (registration.waiting && navigator.serviceWorker.controller) showUpdateButton();
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) showUpdateButton();
          });
        });
        // 起動時にも公開先を確認し、更新があればwaiting workerとして検出します。
        try { await registration.update(); } catch (error) { console.warn('Service Worker update check failed:', error); }
        if (registration.waiting && navigator.serviceWorker.controller) showUpdateButton();
      }).catch(err => console.warn('Service Worker registration failed:', err));
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
    ui.updateBtn.addEventListener('click', async () => {
      ui.updateBtn.disabled = true;
      ui.updateBtn.textContent = '確認中…';
      try {
        if (swRegistration) {
          await swRegistration.update();
          // 更新workerのインストールが進行中なら、installedになるまで待ちます。
          const installing = swRegistration.installing;
          if (installing) {
            await new Promise(resolve => {
              const finish = () => {
                if (['installed', 'activated', 'redundant'].includes(installing.state)) {
                  installing.removeEventListener('statechange', finish);
                  resolve();
                }
              };
              installing.addEventListener('statechange', finish);
              finish();
              window.setTimeout(resolve, 15000);
            });
          }
        }
        const waiting = swRegistration && swRegistration.waiting;
        if (waiting && navigator.serviceWorker.controller) {
          refreshingForUpdate = true;
          ui.updateBtn.textContent = '更新中…';
          waiting.postMessage({ type: 'SKIP_WAITING' });
          // controllerchangeが起きないブラウザ向けの保険です。
          window.setTimeout(() => {
            if (refreshingForUpdate) location.reload();
          }, 5000);
        } else {
          // Service Workerに変更がなくても、Network-firstで公開済みの最新ファイルを取得します。
          location.reload();
        }
      } catch (error) {
        console.warn('Update check failed:', error);
        ui.updateBtn.disabled = false;
        ui.updateBtn.textContent = '更新を確認';
        alert('更新を確認できませんでした。インターネット接続を確認して、もう一度お試しください。');
      }
    });
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
    $('loadJsonBtn').addEventListener('click', () => ui.jsonDataFile.click());
    ui.jsonDataFile.addEventListener('change', () => { if (ui.jsonDataFile.files?.[0]) loadJsonFile(ui.jsonDataFile.files[0]); });
    ui.sharedDataInput.addEventListener('input', () => { persistSettings(); updateDataStatus(); });
    ui.patternList.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => { persistSettings(); if (framesReady.quiz || framesReady.flash) setSetupInFrames(); }));
    ui.bookmarkedOnly.addEventListener('change', persistSettings);
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
    if (hasValidLoginSession() && config.SHARED_PASSWORD && config.SHARED_PASSWORD !== 'CHANGE-THIS-PASSWORD') {
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
