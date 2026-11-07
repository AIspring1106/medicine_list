/* 3.app.js - アプリ全体の制御、ログイン、メニュー、CSV出力、PWA登録 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const APP_VERSION = '1.2.6';
  const APP_REVISION = 7;
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
  let selectedBookmarkKeys = new Set();
  let bookmarkSelectionInitialized = false;
  const ROUTE_MARKER = 'medicine-learning-pwa';
  const AUTH_SESSION_KEY = 'authSession';

  function cacheElements() {
    [
      'loginScreen','workspace','loginForm','commonPassword','loginError','passwordSetupNotice',
      'modeScreen','menuScreen','quizFrameWrap','flashFrameWrap','quizFrame','flashFrame',
      'sharedDataInput','loadStatus','patternList','modeBadge','startModeBtn','flashcardOnlySetting',
      'bookmarkedOnly','bookmarkList','bookmarkCount','wrongList','wrongCount','historyList','usageText',
      'installBtn','loginInstallBtn','installDialog','installDialogTitle','installDialogText','installDialogClose','updateBtn','updateHelp',
      'quizOrderMode','quizRangeMode','quizRangeInput',
      'quizBookmarkedOnly','quizBookmarkOnlySetting','quizBookmarkSelection','quizBookmarkSelectionCount','quizBookmarkOptions',
      'flashcardQuizWrongsOnly','flashBookmarkSelection','flashBookmarkSelectionCount','flashBookmarkOptions',
      'selectAllQuizBookmarksBtn','clearQuizBookmarksSelectionBtn','selectAllFlashBookmarksBtn','clearFlashBookmarksSelectionBtn',
      'quizHistorySection','bookmarkListSection'
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
  function selectRowsByRange(items, mode, rangeText) {
    if (mode !== 'custom') return items.slice();
    const raw = String(rangeText || '').trim();
    if (!raw) throw new Error('カスタム範囲を入力してください。入力例：1-10,21-30');
    const indices = new Set();
    for (const part of raw.split(/[,，]/)) {
      const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
      if (!match) throw new Error(`範囲「${part.trim()}」の形式が正しくありません。例：1-10,21-30`);
      const start = Number(match[1]), end = match[2] ? Number(match[2]) : start;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) throw new Error(`範囲「${part.trim()}」は正しくありません。`);
      if (end > items.length) throw new Error(`範囲「${part.trim()}」がデータ件数（${items.length}件）を超えています。`);
      for (let n = start; n <= end; n++) indices.add(n - 1);
    }
    return [...indices].sort((a,b)=>a-b).map(index=>items[index]);
  }
  function syncRangeInputs() {
    ui.quizRangeInput.disabled = ui.quizRangeMode.value !== 'custom';
  }
  function selectedPatterns() {
    return [...ui.patternList.querySelectorAll('input[type="checkbox"]:checked')].map(x => x.value);
  }
  function persistSettings() {
    const settings = {
      dataText: ui.sharedDataInput.value,
      patterns: selectedPatterns(),
      bookmarkedOnly: ui.bookmarkedOnly.checked,
      flashcardQuizWrongsOnly: ui.flashcardQuizWrongsOnly.checked,
      quizBookmarkedOnly: ui.quizBookmarkedOnly.checked,
      quizOrder: ui.quizOrderMode.value,
      quizRangeMode: ui.quizRangeMode.value,
      quizRangeInput: ui.quizRangeInput.value
    };
    if (bookmarkSelectionInitialized) settings.bookmarkSelectionKeys = [...selectedBookmarkKeys];
    window.AppDB.saveSettings(settings);
  }

  function getSessionDays() {
    const value = Number(config.LOGIN_SESSION_DAYS);
    return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 365) : 30;
  }
  const AUTH_CREDENTIAL_KEY = 'authPasswordCredential';
  function getPasswordRevision() { return String(config.AUTH_PASSWORD_REVISION || '1'); }
  async function sha256(value) {
    if (!crypto?.subtle || typeof TextEncoder === 'undefined') return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function constantTimeEqual(a,b) {
    a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;
    let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
  }
  function hasUsableCredential() {
    const saved=window.AppDB.get(AUTH_CREDENTIAL_KEY,null);
    const password=String(config.SHARED_PASSWORD||'');
    if(saved?.hash) return saved.revision===getPasswordRevision() || (config.PASSWORD_IS_DEFAULT!==true && !!password && password!=='CHANGE-THIS-PASSWORD');
    return !!password && password!=='CHANGE-THIS-PASSWORD';
  }
  async function verifyPassword(entered) {
    const revision=getPasswordRevision();
    const saved=window.AppDB.get(AUTH_CREDENTIAL_KEY,null);
    const enteredHash=await sha256(entered);
    if(saved?.hash && saved.revision===revision && enteredHash) return constantTimeEqual(enteredHash,saved.hash);
    if(saved?.hash && saved.revision!==revision && config.PASSWORD_IS_DEFAULT===true) return false;
    const expected=String(config.SHARED_PASSWORD||'');
    if(!expected || expected==='CHANGE-THIS-PASSWORD' || entered!==expected) return false;
    if(enteredHash) window.AppDB.set(AUTH_CREDENTIAL_KEY,{revision,hash:enteredHash,savedAt:new Date().toISOString()});
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
    ui.quizBookmarkOnlySetting.classList.toggle('hidden', mode !== 'quiz');
    ui.bookmarkListSection.classList.toggle('hidden', mode !== 'flash');
    ui.quizHistorySection.classList.toggle('hidden', mode !== 'quiz');
    ui.flashBookmarkSelection.classList.toggle('hidden', mode !== 'flash' || !ui.bookmarkedOnly.checked);
    ui.quizBookmarkSelection.classList.toggle('hidden', mode !== 'quiz' || !ui.quizBookmarkedOnly.checked);
    $('startModeBtn').textContent = mode === 'quiz' ? 'クイズを開始' : '暗記カードを開始';
    ui.usageText.innerHTML = mode === 'quiz'
      ? '1. 医薬品データを読み込み、出題パターン・順番・対象範囲を選びます。<br>2. 必要に応じて暗記カードのブックマークだけを出題できます。<br>3. 解答を入力して正誤を確認します。<br>4. 誤答の総復習も可能です。'
      : '1. 医薬品データを読み込み、出題パターンを選びます。<br>2. ブックマークを個別に選択して表示できます。<br>3. クイズで誤答した問題だけに絞ることもできます。<br>4. カード本体をタップして答えを確認します。';
    setScreen('menu');
    if (recordHistory) saveRoute({ page: 'menu', mode });
    renderSharedLists();
  }
  function updateDataStatus() {
    const count = parseRows(ui.sharedDataInput.value).length;
    ui.loadStatus.textContent = count ? `${count}件のデータを入力済み（重複除外後）` : '未読み込み';
  }
  function currentBookmarks() {
    try { return framesReady.flash && ui.flashFrame.contentWindow.appBridge ? ui.flashFrame.contentWindow.appBridge.getBookmarks() : []; }
    catch (error) { return []; }
  }
  function renderBookmarkSelectors() {
    const bookmarks=currentBookmarks();
    const liveKeys=new Set(bookmarks.map(b=>b.key));
    if (!bookmarkSelectionInitialized && bookmarks.length) {
      selectedBookmarkKeys=new Set(liveKeys);
      bookmarkSelectionInitialized=true;
      persistSettings();
    } else if (bookmarkSelectionInitialized) {
      let removedStaleKey = false;
      for (const key of [...selectedBookmarkKeys]) {
        if (!liveKeys.has(key)) { selectedBookmarkKeys.delete(key); removedStaleKey = true; }
      }
      if (removedStaleKey) persistSettings();
    }
    const render=(container,countNode)=>{
      if (!container) return;
      container.innerHTML='';
      if (!bookmarks.length) { container.innerHTML='<div class="muted">ブックマークがありません。</div>'; }
      bookmarks.forEach(b=>{
        const label=document.createElement('label'); label.className='bookmarkFilterOption';
        const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=selectedBookmarkKeys.has(b.key);
        cb.addEventListener('change',()=>{
          if(cb.checked)selectedBookmarkKeys.add(b.key);else selectedBookmarkKeys.delete(b.key);
          bookmarkSelectionInitialized=true; persistSettings(); renderBookmarkSelectors();
        });
        const text=document.createElement('span'); const title=document.createElement('strong'); title.textContent=b.name||b.patternLabel||'ブックマーク';
        const details=document.createElement('small'); details.textContent=`${b.patternLabel||b.patternKey}｜${b.item?.salesName||''} / ${b.item?.genericName||''}`;
        text.append(title,details); label.append(cb,text); container.appendChild(label);
      });
      if(countNode)countNode.textContent=`選択 ${bookmarks.filter(b=>selectedBookmarkKeys.has(b.key)).length} / ${bookmarks.length}件`;
    };
    render(ui.quizBookmarkOptions,ui.quizBookmarkSelectionCount);
    render(ui.flashBookmarkOptions,ui.flashBookmarkSelectionCount);
  }
  function setSetupInFrames() {
    const data=ui.sharedDataInput.value;
    const patterns=selectedPatterns();
    try { if(framesReady.quiz&&ui.quizFrame.contentWindow.appBridge) ui.quizFrame.contentWindow.appBridge.setSetup(data,patterns,ui.quizOrderMode.value,ui.quizRangeMode.value,ui.quizRangeInput.value,ui.quizBookmarkedOnly.checked,[...selectedBookmarkKeys],currentBookmarks()); } catch(error) { console.warn('Quiz setup was not ready.',error); }
    try { if(framesReady.flash&&ui.flashFrame.contentWindow.appBridge) ui.flashFrame.contentWindow.appBridge.setSetup(data,patterns,ui.bookmarkedOnly.checked,[...selectedBookmarkKeys],ui.flashcardQuizWrongsOnly.checked); } catch(error) { console.warn('Flashcard setup was not ready.',error); }
    persistSettings(); updateDataStatus(); renderBookmarkSelectors();
  }
  function launchMode() {
    if(!selectedMode)return;
    const items=parseRows(ui.sharedDataInput.value),patterns=selectedPatterns();
    if(!items.length){alert('データが入力されていません。「販売名,一般名,薬効」を入力してください。');return;}
    if(!patterns.length){alert('出題パターンを1つ以上選んでください。');return;}
    const quizMode=selectedMode==='quiz';
    if(quizMode){
      try {
        const rangeItems=selectRowsByRange(items,ui.quizRangeMode.value,ui.quizRangeInput.value);
        if(!rangeItems.length)throw new Error('指定範囲に該当する医薬品がありません。');
      } catch(error){alert(error.message);return;}
    }
    const quizReady=framesReady.quiz&&!!ui.quizFrame.contentWindow.appBridge;
    const flashReady=framesReady.flash&&!!ui.flashFrame.contentWindow.appBridge;
    const ready=quizMode?quizReady&&(!ui.quizBookmarkedOnly.checked||flashReady):flashReady;
    if(!ready){alert('学習画面またはブックマーク情報を読み込み中です。数秒後にもう一度お試しください。');return;}
    setSetupInFrames();
    const bookmarks=currentBookmarks();
    if(quizMode){
      if(ui.quizBookmarkedOnly.checked&&!selectedBookmarkKeys.size){alert('出題するブックマークを1件以上選択してください。');return;}
      setScreen('quiz'); saveRoute({page:'quiz',mode:'quiz'});
      ui.quizFrame.contentWindow.appBridge.launch(ui.sharedDataInput.value,patterns,ui.quizOrderMode.value,ui.quizRangeMode.value,ui.quizRangeInput.value,ui.quizBookmarkedOnly.checked,[...selectedBookmarkKeys],bookmarks);
    } else {
      if(ui.bookmarkedOnly.checked&&!selectedBookmarkKeys.size){alert('表示するブックマークを1件以上選択してください。');return;}
      setScreen('flash'); saveRoute({page:'flash',mode:'flash'});
      ui.flashFrame.contentWindow.appBridge.launch(ui.sharedDataInput.value,patterns,ui.bookmarkedOnly.checked,[...selectedBookmarkKeys],ui.flashcardQuizWrongsOnly.checked);
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
      el.innerHTML = `<div class="itemTop"><div class="itemTitle">${esc(b.name || b.patternLabel || '問題')}</div><span class="badge bookmarked" style="background:${meta.soft};border-color:${meta.border};color:${meta.text}" aria-label="ブックマーク色：${meta.label}">${esc(meta.label)}</span></div>${b.name ? `<div class="itemMeta">${esc(b.patternLabel || '')}</div>` : ''}<div class="itemMeta">問題: ${esc(b.item?.[pair[0]] || '')}</div><div class="itemMeta">答え: <b>${esc(b.item?.[pair[1]] || '')}</b></div><div class="itemMeta">クイズ誤答：<b>${framesReady.quiz && ui.quizFrame.contentWindow.appBridge ? ui.quizFrame.contentWindow.appBridge.getWrongCount(b.item,b.patternKey) : 0}回</b></div><div class="row" style="margin-top:10px"><button class="btn secondary" data-edit="${esc(b.key)}" type="button">色を変更</button><button class="btn secondary" data-rename="${esc(b.key)}" type="button">名前を編集</button><button class="btn danger" data-remove="${esc(b.key)}" type="button">削除</button></div>`;
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
    renderBookmarkSelectors();
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
  function renderSharedLists() { renderBookmarks(); renderWrongs(); renderHistory(); renderBookmarkSelectors(); }
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
    const entered=ui.commonPassword.value;
    const button=ui.loginForm.querySelector('button[type="submit"]');
    button.disabled=true; button.textContent='確認中…'; ui.loginError.textContent='';
    try {
      if(!hasUsableCredential()){ui.loginError.textContent='管理者設定が見つかりません。data/config.local.js の設定を確認してください。';return;}
      if(!await verifyPassword(entered)){ui.loginError.textContent='パスワードが正しくありません。初回移行時は従来のパスワードが data/config.local.js に設定されているか確認してください。';ui.commonPassword.select();return;}
      createLoginSession(); ui.loginScreen.classList.remove('active'); ui.workspace.classList.remove('hidden'); ui.loginError.textContent=''; ui.commonPassword.value='';
      history.replaceState({app:ROUTE_MARKER,page:'mode'},'',location.href); initializeWorkspace();
    } catch(error){console.error('Authentication failed:',error);ui.loginError.textContent='認証に失敗しました。HTTPS接続で再読み込みしてお試しください。';}
    finally{button.disabled=false;button.textContent='ログイン';}
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
    ui.flashcardQuizWrongsOnly.checked = !!saved.flashcardQuizWrongsOnly;
    ui.quizBookmarkedOnly.checked = !!saved.quizBookmarkedOnly;
    ui.quizOrderMode.value = saved.quizOrder === 'ordered' ? 'ordered' : 'random';
    ui.quizRangeMode.value = saved.quizRangeMode === 'custom' ? 'custom' : 'all';
    ui.quizRangeInput.value = String(saved.quizRangeInput || '');
    syncRangeInputs();
    if (Array.isArray(saved.bookmarkSelectionKeys)) { selectedBookmarkKeys = new Set(saved.bookmarkSelectionKeys.map(String)); bookmarkSelectionInitialized = true; }
    syncRangeInputs();
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

  async function clearApplicationCaches() {
    if (!('caches' in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('medicine-learning-pwa-'))
      .map(key => caches.delete(key)));
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

  function showUpdateError(message) {
    ui.updateBtn.disabled = false;
    ui.updateBtn.textContent = '更新を確認';
    if (ui.updateHelp) {
      ui.updateHelp.textContent = `${message} 通常の更新でサイトデータを削除する必要はありません。旧版の学習データはそのまま保持します。`;
    }
    alert(message);
  }

  async function showInstallInstructions() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isMac = /Macintosh|Mac OS X/i.test(ua) && !isIOS;
    const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|FxiOS/i.test(ua);
    const title = 'アプリをインストール';

    if (deferredInstallPrompt) {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      try {
        // beforeinstallprompt はクリック操作の直後に呼び出す必要があります。
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === 'accepted') {
          ui.installBtn.textContent = 'インストール済み';
          ui.loginInstallBtn.textContent = 'インストール済み';
        }
      } catch (error) {
        console.warn('Native install prompt was unavailable:', error);
        ui.installDialogTitle.textContent = title;
        ui.installDialogText.innerHTML = '<p>ブラウザーのメニューから「アプリをインストール」または「ホーム画面に追加」を選択してください。</p>';
        if (typeof ui.installDialog.showModal === 'function') ui.installDialog.showModal();
      }
      return;
    }

    let html = '';
    if (isIOS) {
      html = '<p><b>iPhone / iPad（Safari）</b></p><ol><li>Safariでこのアプリの公開URLを開きます。</li><li>画面下部または上部の「共有」ボタン（四角から上向き矢印）をタップします。</li><li>メニューから「ホーム画面に追加」を選びます。</li><li>「Webアプリとして開く」が表示されたらオンにします。</li><li>右上の「追加」をタップします。</li></ol><p class="tiny">追加したアイコンから、Safariのタブとは別のアプリ風画面で起動できます。Safari以外で開いている場合は、まずSafariで公開URLを開いてください。</p>';
    } else if (isMac && isSafari) {
      html = '<p><b>MacBook（macOS Sonoma 14以降・Safari）</b></p><ol><li>Safariでこのアプリの公開URLを開きます。</li><li>Safariの共有ボタン、またはメニューバーの「ファイル」を選びます。</li><li>「Dockに追加」を選択します。</li><li>アプリ名を確認して「追加」を押します。</li></ol><p class="tiny">追加後はDock、Launchpad、Spotlightから起動できます。Safari本体とはWebサイトのデータ領域が分かれるため、Safariで保存していた学習データがDock版へ自動共有されない場合があります。以後は同じ起動方法を継続して使ってください。</p>';
    } else if (isMac) {
      html = '<p><b>MacBook</b></p><p>Safariを使う場合は、macOS Sonoma 14以降でSafariの共有ボタンまたは「ファイル」→「Dockに追加」を選んでください。Chrome / Edgeでは、アドレスバー付近のインストールアイコン、またはブラウザーメニューの「アプリをインストール」を使用します。</p>';
    } else {
      html = '<p><b>このブラウザーでのインストール</b></p><p>ブラウザーのメニューから「アプリをインストール」または「ホーム画面に追加」を選択してください。Chrome / Edgeではアドレスバー付近のインストールアイコンから追加できる場合があります。</p>';
    }
    ui.installDialogTitle.textContent = title;
    ui.installDialogText.innerHTML = html;
    if (typeof ui.installDialog.showModal === 'function') ui.installDialog.showModal();
    else alert(ui.installDialogText.textContent);
  }
  function registerPwa() {
    const secureContext=location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1';
    if('serviceWorker' in navigator && secureContext){
      navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).then(async registration=>{
        swRegistration=registration;
        if(registration.waiting&&navigator.serviceWorker.controller)ui.updateBtn.textContent='更新を確認（更新あり）';
        registration.addEventListener('updatefound',()=>{
          const worker=registration.installing;if(!worker)return;
          worker.addEventListener('statechange',()=>{
            if(worker.state==='installed'&&navigator.serviceWorker.controller){ui.updateBtn.textContent='更新を確認（更新あり）';ui.updateHelp.textContent='新しいアプリ一式の取得が完了しました。更新を確認して切り替えてください。';}
          });
        });
        try{await registration.update();}catch(error){console.warn('Initial SW update check failed:',error);}
      }).catch(error=>{console.warn('SW registration failed:',error);ui.updateHelp.textContent='自動更新にはHTTPSまたはlocalhostが必要です。';});
    } else {
      ui.updateHelp.textContent='Service Workerによる自動更新にはHTTPSまたはlocalhostが必要です。アプリの閲覧自体は続行できます。';
    }
    window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;ui.installBtn.classList.remove('hidden');ui.loginInstallBtn.classList.remove('hidden');});
    window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;ui.installBtn.textContent='インストール済み';ui.loginInstallBtn.textContent='インストール済み';});
    ui.installBtn.addEventListener('click',showInstallInstructions);
    ui.loginInstallBtn.addEventListener('click',showInstallInstructions);
    ui.installDialogClose.addEventListener('click',()=>ui.installDialog.close());
    ui.installDialog.addEventListener('click',event=>{if(event.target===ui.installDialog)ui.installDialog.close();});
    ui.updateBtn.addEventListener('click',async()=>{
      ui.updateBtn.disabled=true;ui.updateBtn.textContent='更新を確認中…';ui.updateHelp.textContent='公開版と更新ファイル一式を確認しています。';
      try{
        const published=await fetchPublishedVersion();
        const versionOrder=compareVersions(published.version,APP_VERSION);
        const revisionOrder=versionOrder===0?Math.sign(published.revision-APP_REVISION):0;
        const hasUpdate=versionOrder>0||(versionOrder===0&&revisionOrder>0);
        if(versionOrder<0||(versionOrder===0&&revisionOrder<0))throw new Error(`公開側（v${published.version} revision ${published.revision}）が端末側より古い状態です。`);
        let registration=swRegistration;
        if('serviceWorker' in navigator&&secureContext){
          registration=registration||await navigator.serviceWorker.getRegistration()||await navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'});
          swRegistration=registration;const previousController=navigator.serviceWorker.controller;await registration.update();
          let state=null;if(registration.installing)state=await waitForWorkerState(registration.installing,['installed','activated'],90000);
          if(registration.waiting){ui.updateBtn.textContent='更新を適用中…';await activateWaitingWorker(registration);location.reload();return;}
          if(hasUpdate&&state==='activated'){await waitForControllerChange(previousController);location.reload();return;}
          if(hasUpdate)throw new Error('新版の全コアファイル取得を確認できませんでした。旧版と学習データは保持されています。GitHub Pagesの公開完了後に再試行してください。');
        } else if(hasUpdate){
          const url=new URL(location.href);url.searchParams.set('app-refresh',`${published.version}-r${published.revision}-${Date.now()}`);location.replace(url.href);return;
        }
        ui.updateBtn.disabled=false;ui.updateBtn.textContent='更新を確認';ui.updateHelp.textContent=`現在の版は v${APP_VERSION}（revision ${APP_REVISION}）です。学習データは保持されています。`;alert(`更新はありません。v${APP_VERSION} revision ${APP_REVISION} です。`);
      }catch(error){console.error(error);ui.updateBtn.disabled=false;ui.updateBtn.textContent='更新を確認';ui.updateHelp.textContent=`更新できませんでした：${error.message}。通常、サイトデータの削除は不要です。`;alert(ui.updateHelp.textContent);}
    });
    window.addEventListener('popstate',event=>{if(!hasValidLoginSession()){ui.workspace.classList.add('hidden');ui.loginScreen.classList.add('active');history.replaceState({app:ROUTE_MARKER,page:'login'},'',location.href);return;}restoreRoute(event.state);});
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
    ui.bookmarkedOnly.addEventListener('change', () => { ui.flashBookmarkSelection.classList.toggle('hidden', !ui.bookmarkedOnly.checked); persistSettings(); });
    ui.flashcardQuizWrongsOnly.addEventListener('change', persistSettings);
    ui.quizBookmarkedOnly.addEventListener('change', () => { ui.quizBookmarkSelection.classList.toggle('hidden', !ui.quizBookmarkedOnly.checked); persistSettings(); });
    ui.quizOrderMode.addEventListener('change', () => { persistSettings(); if(framesReady.quiz)setSetupInFrames(); });
    ui.quizRangeMode.addEventListener('change', () => { syncRangeInputs(); persistSettings(); if(framesReady.quiz)setSetupInFrames(); });
    ui.quizRangeInput.addEventListener('input', () => { persistSettings(); if(framesReady.quiz)setSetupInFrames(); });
    ui.selectAllQuizBookmarksBtn.addEventListener('click', () => { selectedBookmarkKeys=new Set(currentBookmarks().map(b=>b.key)); bookmarkSelectionInitialized=true; persistSettings(); renderBookmarkSelectors(); });
    ui.clearQuizBookmarksSelectionBtn.addEventListener('click', () => { selectedBookmarkKeys.clear(); bookmarkSelectionInitialized=true; persistSettings(); renderBookmarkSelectors(); });
    ui.selectAllFlashBookmarksBtn.addEventListener('click', () => { selectedBookmarkKeys=new Set(currentBookmarks().map(b=>b.key)); bookmarkSelectionInitialized=true; persistSettings(); renderBookmarkSelectors(); });
    ui.clearFlashBookmarksSelectionBtn.addEventListener('click', () => { selectedBookmarkKeys.clear(); bookmarkSelectionInitialized=true; persistSettings(); renderBookmarkSelectors(); });
    $('toggleBookmarksBtn').addEventListener('click', () => { showBookmarks = !showBookmarks; renderBookmarks(); });
    $('clearBookmarksBtn').addEventListener('click', () => {
      if (!confirm('ブックマークをすべて消去しますか？')) return;
      if (framesReady.flash) ui.flashFrame.contentWindow.appBridge.clearBookmarks(); else renderBookmarks(); renderBookmarkSelectors();
    });
    $('reviewAllWrongsBtn').addEventListener('click', () => {
      if (!framesReady.quiz || !ui.quizFrame.contentWindow.appBridge) { alert('クイズ画面を読み込めません。'); return; }
      const wrongs=ui.quizFrame.contentWindow.appBridge.getWrongs() || [];
      if (!wrongs.length) { alert('復習できる誤答がありません。'); return; }
      setScreen('quiz'); saveRoute({page:'quiz',mode:'quiz'});
      ui.quizFrame.contentWindow.appBridge.startAllWrongReview();
    });
    $('toggleWrongsBtn').addEventListener('click', () => { showWrongs = !showWrongs; renderWrongs(); });
    $('exportWrongCsvBtn').addEventListener('click', exportWrongCsv);
    $('clearWrongsBtn').addEventListener('click', () => {
      if (!confirm('直近の誤答をすべて消去しますか？')) return;
      if (framesReady.quiz) ui.quizFrame.contentWindow.appBridge.clearWrongs(); renderWrongs(); renderBookmarks();
    });
    $('clearHistoryBtn').addEventListener('click', () => {
      if (!confirm('履歴をすべて消去しますか？')) return;
      if (framesReady.quiz) ui.quizFrame.contentWindow.appBridge.clearHistory(); renderHistory();
    });
    $('logoutBtn').addEventListener('click', logout);
  }
  window.AppShell = {
    refreshBookmarkList() { renderBookmarks(); renderBookmarkSelectors(); },
    refreshWrongList() { renderWrongs(); renderBookmarks(); },
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
      ? 'パスワード設定を確認してください。初回移行時は data/config.local.js に従来のパスワードを設定します。'
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
