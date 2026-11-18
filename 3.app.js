/* 3.app.js - アプリ全体の制御、ログイン、メニュー、データ取込、PWA登録 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const APP_VERSION = '1.2.7';
  const APP_REVISION = 9;
  const APP_BUILD_ID = 'r9-no-maintenance-pages-notify-icon-20261118';
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
  let uploadedDataFiles = [];
  let selectedUploadedFileKey = '';
  let pendingUpdateMeta = null;
  let pendingUpdateRegistration = null;
  let lastNotifiedBuild = '';
  const ROUTE_MARKER = 'medicine-learning-pwa';
  const AUTH_SESSION_KEY = 'authSession';
  const LEGAL_CONSENT_KEY = 'legalConsent';
  const PRIVACY_POLICY_VERSION = '1.2';
  const TERMS_OF_SERVICE_VERSION = '1.3';
  const PERSISTED_ROUTE_KEY = 'activeRoute';
  let oneSignalInstance = null;
  let oneSignalReadyPromise = null;
  let oneSignalLoadError = null;

  function cacheElements() {
    [
      'loginScreen','workspace','loginForm','commonPassword','loginError','passwordSetupNotice','privacyConsent','termsConsent',
      'modeScreen','menuScreen','quizFrameWrap','flashFrameWrap','quizFrame','flashFrame',
      'sharedDataInput','dataFilesInput','uploadedFilesList','selectedFileStatus','loadDataBtn','loadStatus','clearInputDataBtn','patternList','modeBadge','startModeBtn','flashcardOnlySetting',
      'bookmarkedOnly','bookmarkList','bookmarkCount','wrongList','wrongCount','historyList','usageText',
      'installBtn','loginInstallBtn','installDialog','installDialogTitle','installDialogText','installDialogClose','updateBtn','updateHelp','notificationPermissionBtn','resumeModeBtn',
      'updateNoticeDialog','updateNoticeTitle','updateNoticeBody','updateNoticeLater','updateNoticeApply',
      'quizOrderMode','quizRangeMode','quizRangeInput','medicineRangeSetting','modeSettingsTitle','modeSettingsDescription','quizOrderLabel','quizRangeLabel','quizRangeHelp',
      'quizBookmarkedOnly','quizBookmarkOnlySetting','quizBookmarkSelection','quizBookmarkSelectionCount','quizBookmarkOptions',
      'flashcardQuizWrongsOnly','flashBookmarkSelection','flashBookmarkSelectionCount','flashBookmarkOptions',
      'selectAllQuizBookmarksBtn','clearQuizBookmarksSelectionBtn','selectAllFlashBookmarksBtn','clearFlashBookmarksSelectionBtn',
      'quizHistorySection','bookmarkListSection'
    ].forEach(id => ui[id] = $(id));
  }
  function esc(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }
  function parseCsvRecords(text) {
    if (!window.MedicineCsvReader?.parseRecords) throw new Error('CSV解析機能を読み込めませんでした。ページを再読み込みしてください。');
    return window.MedicineCsvReader.parseRecords(text);
  }
  function parseRows(text) {
    const map = new Map();
    for (const columns of parseCsvRecords(text)) {
      if (!Array.isArray(columns) || columns.length < 3) continue;
      const salesName = String(columns[0] ?? '').trim();
      const genericName = String(columns[1] ?? '').trim();
      const effect = columns.slice(2).join(',').trim();
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
    // 標準設定の既知の初期値ではログインを許可しない。管理者が固有の共通パスワードを設定する必要があります。
    if (config.PASSWORD_IS_DEFAULT === true) return false;
    const saved=window.AppDB.get(AUTH_CREDENTIAL_KEY,null);
    const password=String(config.SHARED_PASSWORD||'');
    if(saved?.hash) return saved.revision===getPasswordRevision() || (!!password && password!=='CHANGE-THIS-PASSWORD');
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
  function hasCurrentLegalConsent() {
    const record = window.AppDB.get(LEGAL_CONSENT_KEY, null);
    return !!record
      && record.privacyPolicyVersion === PRIVACY_POLICY_VERSION
      && record.termsOfServiceVersion === TERMS_OF_SERVICE_VERSION
      && !!record.acceptedAt;
  }
  function restoreLegalConsentChecks() {
    const accepted = hasCurrentLegalConsent();
    ui.privacyConsent.checked = accepted;
    ui.termsConsent.checked = accepted;
  }
  function saveLegalConsent() {
    window.AppDB.set(LEGAL_CONSENT_KEY, {
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      termsOfServiceVersion: TERMS_OF_SERVICE_VERSION,
      acceptedAt: new Date().toISOString()
    });
  }
  function saveRoute(route, replace = false) {
    const state = { app: ROUTE_MARKER, ...route };
    window.AppDB.set(PERSISTED_ROUTE_KEY, { page: state.page, mode: state.mode || null, savedAt: Date.now() });
    if (replace) history.replaceState(state, '', location.href);
    else {
      const current = history.state;
      const same = current && current.app === ROUTE_MARKER && current.page === state.page && current.mode === state.mode;
      if (!same) history.pushState(state, '', location.href);
    }
  }
  function restoreRoute(route) {
    if (!route || route.app !== ROUTE_MARKER) route = { app: ROUTE_MARKER, page: 'mode' };
    window.AppDB.set(PERSISTED_ROUTE_KEY, { page: route.page, mode: route.mode || null, savedAt: Date.now() });
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
    ui.medicineRangeSetting.classList.remove('hidden');
    ui.quizBookmarkOnlySetting.classList.toggle('hidden', mode !== 'quiz');
    ui.modeSettingsTitle.textContent = mode === 'quiz' ? '出題設定' : '表示設定';
    ui.modeSettingsDescription.textContent = mode === 'quiz'
      ? '出題したい方向を1つ以上選択してください。選択したパターンを混ぜて出題します。'
      : '表示したい方向を1つ以上選択してください。選択したパターンを混ぜて暗記カードを表示します。';
    ui.quizOrderLabel.textContent = mode === 'quiz' ? '出題順' : '表示順';
    ui.quizRangeLabel.textContent = mode === 'quiz' ? '出題する医薬品' : '表示する医薬品';
    ui.quizRangeHelp.innerHTML = mode === 'quiz'
      ? '例：<b>1-10,21-30</b>（1～10行目と21～30行目）。空行・不正行・重複行を除外した後の番号です。最大108問。'
      : '例：<b>1-10,21-30</b>（1～10行目と21～30行目）。空行・不正行・重複行を除外した後の番号です。';
    // ブックマーク一覧はクイズ・暗記カードの両モードで共通表示する。
    ui.bookmarkListSection.classList.remove('hidden');
    ui.quizHistorySection.classList.toggle('hidden', mode !== 'quiz');
    ui.flashBookmarkSelection.classList.toggle('hidden', mode !== 'flash' || !ui.bookmarkedOnly.checked);
    ui.quizBookmarkSelection.classList.toggle('hidden', mode !== 'quiz' || !ui.quizBookmarkedOnly.checked);
    $('startModeBtn').textContent = mode === 'quiz' ? 'クイズを開始' : '暗記カードを開始';
    refreshSessionControls();
    ui.usageText.innerHTML = mode === 'quiz'
      ? '1. 医薬品データを読み込み、出題パターン・順番・対象範囲を選びます。<br>2. 必要に応じて暗記カードのブックマークだけを出題できます。<br>3. 解答を入力して正誤を確認します。<br>4. 誤答の総復習も可能です。'
      : '1. 医薬品データを読み込み、表示パターン・表示順・表示する医薬品を選びます。<br>2. ブックマークを個別に選択して表示できます。<br>3. クイズで誤答した問題だけに絞ることもできます。<br>4. カード本体をタップして答えを確認します。';
    setScreen('menu');
    if (recordHistory) saveRoute({ page: 'menu', mode });
    renderSharedLists();
  }
  function updateDataStatus() {
    const count = parseRows(ui.sharedDataInput.value).length;
    ui.loadStatus.textContent = count ? `${count}件のデータを入力済み（重複除外後）` : '未読み込み';
  }

  function fileIdentity(file) { return `${file.name}::${file.size}::${file.lastModified}`; }
  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  function renderUploadedFiles() {
    const host = ui.uploadedFilesList;
    host.replaceChildren();
    if (!uploadedDataFiles.length) {
      const empty = document.createElement('div'); empty.className = 'muted';
      empty.textContent = 'ファイルはまだ追加されていません。'; host.appendChild(empty);
    }
    uploadedDataFiles.forEach((entry, index) => {
      const row = document.createElement('div'); row.className = 'uploadedFileRow';
      const label = document.createElement('label');
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'uploadedDataFile';
      radio.checked = entry.key === selectedUploadedFileKey;
      radio.addEventListener('change', () => { selectedUploadedFileKey = entry.key; renderUploadedFiles(); });
      const text = document.createElement('span');
      const name = document.createElement('strong'); name.textContent = entry.file.name;
      const detail = document.createElement('small'); detail.textContent = `${formatFileSize(entry.file.size)}｜追加 ${index + 1}件目`;
      text.append(name, detail); label.append(radio, text);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn secondary';
      remove.textContent = '除外'; remove.setAttribute('aria-label', `${entry.file.name}を候補から除外`);
      remove.addEventListener('click', () => {
            uploadedDataFiles = uploadedDataFiles.filter(item => item.key !== entry.key);
        if (selectedUploadedFileKey === entry.key) selectedUploadedFileKey = uploadedDataFiles[0]?.key || '';
        renderUploadedFiles();
      });
      row.append(label, remove); host.appendChild(row);
    });
    ui.loadDataBtn.disabled = !uploadedDataFiles.some(entry => entry.key === selectedUploadedFileKey);
  }
  async function readTextFile(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('ファイルを読み込めませんでした。'));
      reader.readAsText(file, 'UTF-8');
    });
  }
  function rowsToCsv(rows) {
    if (!window.MedicineCsvReader?.stringifyRows) throw new Error('CSV出力機能を読み込めませんでした。ページを再読み込みしてください。');
    return window.MedicineCsvReader.stringifyRows(rows, 3);
  }
  function commitImportedData(contents, fileName, count) {
    ui.sharedDataInput.value = contents;
    setSetupInFrames();
    ui.selectedFileStatus.textContent = `「${fileName}」から${count}件を読み込みました。`;
    updateDataStatus();
  }
  async function importSelectedDataFile() {
    const entry = uploadedDataFiles.find(item => item.key === selectedUploadedFileKey);
    if (!entry) { alert('読み込むファイルを選択してください。'); return; }
    ui.loadDataBtn.disabled = true; ui.loadDataBtn.textContent = '読み込み中…';
    try {
      const ext = entry.file.name.toLowerCase().split('.').pop();
      let contents = '';
      if (ext === 'csv') {
        // CSVの1行目は項目名として必ず読み飛ばす。
        const records = parseCsvRecords(await readTextFile(entry.file));
        contents = rowsToCsv(records.slice(1));
      } else if (ext === 'xlsx') {
        if (!window.XlsxReader?.readFirstWorksheetAsRows) throw new Error('XLSX読み込み機能を読み込めませんでした。ページを再読み込みしてください。');
        const matrix = await window.XlsxReader.readFirstWorksheetAsRows(await entry.file.arrayBuffer());
        contents = rowsToCsv(matrix);
      } else if (ext === 'pdf') {
        if (!window.PdfTableReader?.readAllTablesAsRows) throw new Error('PDF読み込み機能を読み込めませんでした。ページを再読み込みしてください。');
        const result = await window.PdfTableReader.readAllTablesAsRows(await entry.file.arrayBuffer());
        contents = rowsToCsv(result.rows);
        const count = parseRows(contents).length;
        if (!count) throw new Error('PDFの全ページから有効な3列データを検出できませんでした。');
        commitImportedData(contents, entry.file.name, count);
        const skipped = result.skippedRows ? ` 不完全な行${result.skippedRows}件を除外しました。` : '';
        ui.selectedFileStatus.textContent = `PDF全${result.pages}ページを走査し、${result.tablePages}ページから${count}件を読み込みました。${skipped} 先頭行に列名がない形式も対応しています。`;
        return;
      } else {
        throw new Error('読み込めるファイルは .csv・.xlsx・.pdf 形式です。');
      }
      const count = parseRows(contents).length;
      if (!count) throw new Error('有効な3列データが見つかりません。A列＝販売名、B列＝一般名、C列＝薬効の順に入力されているか確認してください。');
      commitImportedData(contents, entry.file.name, count);
    } catch (error) {
      console.error('Data import failed:', error);
      ui.selectedFileStatus.textContent = `読み込み失敗：${error.message}`;
      alert(`ファイルを読み込めませんでした。\n${error.message}`);
    } finally {
      ui.loadDataBtn.textContent = '選択したファイルを読み込む';
      renderUploadedFiles();
    }
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
    try { if(framesReady.flash&&ui.flashFrame.contentWindow.appBridge) ui.flashFrame.contentWindow.appBridge.setSetup(data,patterns,ui.bookmarkedOnly.checked,[...selectedBookmarkKeys],ui.flashcardQuizWrongsOnly.checked,ui.quizOrderMode.value,ui.quizRangeMode.value,ui.quizRangeInput.value); } catch(error) { console.warn('Flashcard setup was not ready.',error); }
    persistSettings(); updateDataStatus(); renderBookmarkSelectors();
  }
  function getModeBridge(mode) {
    const frame = mode === 'quiz' ? ui.quizFrame : ui.flashFrame;
    try { return framesReady[mode] && frame?.contentWindow?.appBridge ? frame.contentWindow.appBridge : null; }
    catch (error) { return null; }
  }
  function refreshSessionControls() {
    if (!ui.resumeModeBtn) return;
    const bridge = selectedMode ? getModeBridge(selectedMode) : null;
    let info = null;
    try { info = bridge?.getSessionInfo?.() || null; } catch (error) { /* iframe準備中 */ }
    const canResume = !!info?.available && info.status === 'paused';
    ui.resumeModeBtn.hidden = !canResume;
    ui.resumeModeBtn.textContent = selectedMode === 'quiz' ? '中断したクイズを再開' : '中断した暗記カードを再開';
  }
  function resumeSelectedSession() {
    if (!selectedMode) return;
    const bridge = getModeBridge(selectedMode);
    if (!bridge?.resumeSavedSession) { alert('セッション情報を読み込めません。ページを再読み込みしてください。'); return; }
    try {
      const restored = bridge.resumeSavedSession();
      if (!restored) { refreshSessionControls(); alert('再開できる中断セッションが見つかりません。'); return; }
      setScreen(selectedMode);
      saveRoute({ page: selectedMode, mode: selectedMode });
      refreshSessionControls();
    } catch (error) {
      console.error('Session resume failed:', error);
      alert(`セッションを再開できませんでした：${error.message || '不明なエラー'}`);
    }
  }

  function launchMode() {
    if(!selectedMode)return;
    const items=parseRows(ui.sharedDataInput.value),patterns=selectedPatterns();
    if(!items.length){alert('データが入力されていません。「販売名,一般名,薬効」を入力してください。');return;}
    if(!patterns.length){alert('出題パターンを1つ以上選んでください。');return;}
    const quizMode=selectedMode==='quiz';
    try {
      const rangeItems=selectRowsByRange(items,ui.quizRangeMode.value,ui.quizRangeInput.value);
      if(!rangeItems.length)throw new Error('指定範囲に該当する医薬品がありません。');
    } catch(error){alert(error.message);return;}
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
      ui.flashFrame.contentWindow.appBridge.launch(ui.sharedDataInput.value,patterns,ui.bookmarkedOnly.checked,[...selectedBookmarkKeys],ui.flashcardQuizWrongsOnly.checked,ui.quizOrderMode.value,ui.quizRangeMode.value,ui.quizRangeInput.value);
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
      if(!ui.privacyConsent.checked || !ui.termsConsent.checked) {
        ui.loginError.textContent='プライバシーポリシーと利用規約の両方を確認し、同意してください。';
        return;
      }
      if(!hasUsableCredential()){ui.loginError.textContent='管理者設定が見つかりません。data/config.local.js の設定を確認してください。';return;}
      if(!await verifyPassword(entered)){ui.loginError.textContent='パスワードが正しくありません。初回移行時は従来のパスワードが data/config.local.js に設定されているか確認してください。';ui.commonPassword.select();return;}
      saveLegalConsent();
      createLoginSession(); ui.loginScreen.classList.remove('active'); ui.workspace.classList.remove('hidden'); ui.loginError.textContent=''; ui.commonPassword.value='';
      history.replaceState({app:ROUTE_MARKER,page:'mode'},'',location.href); initializeWorkspace({ page: 'mode' });
    } catch(error){console.error('Authentication failed:',error);ui.loginError.textContent='認証に失敗しました。HTTPS接続で再読み込みしてお試しください。';}
    finally{button.disabled=false;button.textContent='ログイン';}
  }
  function logout() {
    clearLoginSession();
    window.AppDB.remove(PERSISTED_ROUTE_KEY);
    ui.workspace.classList.add('hidden');
    ui.loginScreen.classList.add('active');
    ui.commonPassword.value = '';
    history.replaceState({ app: ROUTE_MARKER, page: 'login' }, '', location.href);
  }
  function loadModeFrames() {
    if (!ui.quizFrame.hasAttribute('src')) {
      ui.quizFrame.addEventListener('load', () => { framesReady.quiz = true; if (workspaceInitialized) { setSetupInFrames(); renderSharedLists(); refreshSessionControls(); } });
      ui.quizFrame.src = './modules/quiz-app.html';
    }
    if (!ui.flashFrame.hasAttribute('src')) {
      ui.flashFrame.addEventListener('load', () => { framesReady.flash = true; if (workspaceInitialized) { setSetupInFrames(); renderSharedLists(); refreshSessionControls(); } });
      ui.flashFrame.src = './modules/flashcard-app.html';
    }
  }
  function initializeWorkspace(initialRoute = null) {
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
    workspaceInitialized = true;
    loadModeFrames();
    updateDataStatus();
    setSetupInFrames();
    const route = initialRoute && ['mode','menu','quiz','flash'].includes(initialRoute.page)
      ? initialRoute : { page: 'mode' };
    if (route.page === 'menu') {
      selectMode(route.mode === 'flash' ? 'flash' : 'quiz', false);
      setScreen('menu');
    } else if (route.page === 'quiz' || route.page === 'flash') {
      selectedMode = route.page;
      setScreen(route.page);
    } else {
      selectedMode = null;
      setScreen('mode');
    }
    saveRoute(route, true);
    refreshSessionControls();
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
    const buildId = String(payload.buildId || '');
    const notesSource = payload.releaseNotes ?? payload.changes ?? [];
    const releaseNotes = Array.isArray(notesSource)
      ? notesSource.map(item => String(item).trim()).filter(Boolean)
      : String(notesSource).split(/\r?\n/).map(item => item.replace(/^[-・*]\s*/, '').trim()).filter(Boolean);
    return { version, revision, buildId, releaseNotes };
  }

  function describeBuild(meta) {
    const supplement = meta.buildId && meta.buildId !== APP_BUILD_ID ? '・追加更新' : '';
    return `v${meta.version}（revision ${meta.revision}${supplement}）`;
  }
  function isNewerBuild(meta) {
    const versionOrder = compareVersions(meta.version, APP_VERSION);
    const revisionOrder = versionOrder === 0 ? Math.sign(meta.revision - APP_REVISION) : 0;
    if (versionOrder > 0 || (versionOrder === 0 && revisionOrder > 0)) return true;
    return versionOrder === 0 && revisionOrder === 0 && !!meta.buildId && meta.buildId !== APP_BUILD_ID;
  }
  function showUpdateNotice(meta, isUpdate) {
    pendingUpdateMeta = isUpdate ? meta : null;
    const installed = `端末側：v${APP_VERSION}（revision ${APP_REVISION}）`;
    const published = `公開版：${meta.buildLabel || describeBuild(meta)}`;
    ui.updateNoticeTitle.textContent = isUpdate ? '更新があります' : '更新確認結果';
    ui.updateNoticeBody.replaceChildren();
    const status = document.createElement('p');
    status.textContent = isUpdate ? `${published} が利用できます。\n${installed}` : `現在の公開版は ${published} です。\n${installed}。新しい更新はありません。`;
    ui.updateNoticeBody.appendChild(status);
    const heading = document.createElement('p'); heading.style.fontWeight = '700'; heading.textContent = '更新内容';
    ui.updateNoticeBody.appendChild(heading);
    const notes = meta.releaseNotes?.length ? meta.releaseNotes : ['今回の更新内容は公開情報に記載されていません。'];
    const list = document.createElement('ul');
    notes.forEach(note => { const li = document.createElement('li'); li.textContent = note; list.appendChild(li); });
    ui.updateNoticeBody.appendChild(list);
    status.style.whiteSpace = 'pre-line';
    ui.updateNoticeApply.hidden = !isUpdate;
    ui.updateNoticeApply.disabled = false;
    ui.updateNoticeLater.textContent = isUpdate ? '後で' : '閉じる';
    ui.updateNoticeApply.textContent = '今すぐ更新';
    if (typeof ui.updateNoticeDialog.showModal === 'function') {
      if (!ui.updateNoticeDialog.open) ui.updateNoticeDialog.showModal();
    } else {
      const message = `${ui.updateNoticeTitle.textContent}\n${published}\n${notes.map(note => `・${note}`).join('\n')}`;
      if (isUpdate && confirm(`${message}\n\n今すぐ更新しますか？`)) applyAvailableUpdate();
      else alert(message);
    }
  }
  async function announceUpdate(meta, registration) {
    if (!isNewerBuild(meta)) return false;
    const key = `${meta.version}-r${meta.revision}-${meta.buildId || ''}`;
    if (lastNotifiedBuild === key) return true;
    lastNotifiedBuild = key;
    pendingUpdateMeta = meta;
    pendingUpdateRegistration = registration || pendingUpdateRegistration;
    showUpdateNotice(meta, true);
    // GitHub Commit起点のOneSignal Web Pushで通知します。更新確認操作ではPushを送信しません。
    return true;
  }
  async function checkForUpdateOnStartup(registration) {
    try {
      const meta = await fetchPublishedVersion();
      if (!isNewerBuild(meta)) return;
      if (registration) {
        try {
          await registration.update();
          if (registration.installing) {
            try { await waitForWorkerState(registration.installing, ['installed','activated'], 90000); }
            catch (error) { console.warn('Update worker is not ready yet:', error); }
          }
          if (registration.waiting) pendingUpdateRegistration = registration;
        } catch (error) { console.warn('Service Worker update check failed:', error); }
      }
      await announceUpdate(meta, registration);
    } catch (error) {
      console.info('Startup update check skipped:', error.message);
    }
  }
  function renderNotificationPermissionState(permission = (('Notification' in window) ? Notification.permission : 'unsupported')) {
    if (!ui.notificationPermissionBtn) return;
    if (!String(config.ONESIGNAL_APP_ID || '').trim()) {
      ui.notificationPermissionBtn.textContent = '通知サービス未設定';
      ui.notificationPermissionBtn.disabled = true;
      return;
    }
    if (!oneSignalInstance) {
      ui.notificationPermissionBtn.textContent = oneSignalLoadError ? '通知サービスを利用できません' : '通知サービス準備中';
      ui.notificationPermissionBtn.disabled = true;
      return;
    }
    if (permission === 'unsupported' || !oneSignalInstance.Notifications.isPushSupported()) {
      ui.notificationPermissionBtn.textContent = 'この端末は通知非対応';
      ui.notificationPermissionBtn.disabled = true;
      return;
    }
    const subscribed = oneSignalInstance?.User?.PushSubscription?.optedIn === true;
    if (subscribed) {
      ui.notificationPermissionBtn.textContent = '通知は有効です';
      ui.notificationPermissionBtn.disabled = true;
      ui.updateHelp.textContent = 'Commit後の更新情報をPush通知で受け取れます。';
      return;
    }
    ui.notificationPermissionBtn.disabled = false;
    if (permission === 'denied') ui.notificationPermissionBtn.textContent = '通知設定を確認する';
    else if (permission === 'granted') ui.notificationPermissionBtn.textContent = '通知を登録する';
    else ui.notificationPermissionBtn.textContent = '通知を有効にする';
  }

  function notificationBlockedHelp() {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const androidSteps = 'Androidでは、(1) Chromeで本アプリのサイト設定を開き「通知」を許可、(2) 端末の「設定」→「アプリ」→使用中のブラウザー（Chrome等）→「通知」も許可、(3) アプリを完全に終了して再起動してください。インストール型PWAではアプリアイコン長押しからアプリ情報／サイト設定を開ける場合があります。';
    const genericSteps = 'ブラウザーのアドレスバー左側にあるサイト情報から「通知」を許可し、ページを再読み込みしてください。';
    return isAndroid
      ? `このサイトの通知権限がブロックされています。端末の通知スイッチとは別に、ブラウザー側のサイト通知権限も必要です。${androidSteps} 画面内の更新案内は引き続き利用できます。`
      : `このサイトの通知権限がブロックされています。${genericSteps} 画面内の更新案内は引き続き利用できます。`;
  }

  function watchNotificationPermissionChanges() {
    if (!('permissions' in navigator) || !navigator.permissions?.query) return;
    navigator.permissions.query({ name: 'notifications' }).then(status => {
      const refresh = () => {
        const permission = ('Notification' in window) ? Notification.permission : 'unsupported';
        renderNotificationPermissionState(permission);
        if (permission === 'granted') ui.updateHelp.textContent = 'ブラウザーの通知権限が許可されました。Push購読が完了するとCommit後の更新通知を受け取れます。';
      };
      status.addEventListener?.('change', refresh);
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
      refresh();
    }).catch(() => { /* Permissions API非対応ブラウザー */ });
  }

  async function enableDesktopNotifications() {
    if (!window.isSecureContext) {
      ui.updateHelp.textContent = '通知を利用するにはHTTPSで配信されたページ、またはlocalhostで開いてください。';
      return;
    }
    if (!config.ONESIGNAL_APP_ID) {
      ui.updateHelp.textContent = 'Commit時の自動通知はOneSignal連携が必要です。管理者は data/config.js の ONESIGNAL_APP_ID と GitHub Secrets の ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY を設定してください。';
      return;
    }
    if (!oneSignalInstance) {
      ui.updateHelp.textContent = oneSignalLoadError
        ? `通知サービスを初期化できませんでした：${oneSignalLoadError}`
        : '通知サービスを準備中です。数秒後にもう一度お試しください。';
      return;
    }
    try {
      // Notifications.requestPermission() はクリック操作から直接呼び出し、ブラウザーのユーザー操作要件を満たす。
      const permissionPromise = oneSignalInstance.Notifications.requestPermission();
      const granted = await permissionPromise;
      if (granted) {
        await oneSignalInstance.User.PushSubscription.optIn();
        ui.updateHelp.textContent = '通知が有効になりました。今後GitHubでCommitされた更新を自動通知します。';
        renderNotificationPermissionState('granted');
      } else {
        ui.updateHelp.textContent = Notification.permission === 'denied'
          ? notificationBlockedHelp()
          : '通知の許可が完了していません。ブラウザーのサイト設定から通知を許可してください。';
        renderNotificationPermissionState(Notification.permission);
      }
    } catch (error) {
      console.warn('OneSignal permission request failed:', error);
      ui.updateHelp.textContent = `通知を有効にできませんでした：${error.message || 'ブラウザー設定を確認してください。'}`;
      renderNotificationPermissionState(('Notification' in window) ? Notification.permission : 'unsupported');
    }
  }

  function initializePushNotifications() {
    const appId = String(config.ONESIGNAL_APP_ID || '').trim();
    if (!appId) {
      if (ui.updateHelp) ui.updateHelp.textContent = 'Commit時の自動通知は未設定です。管理者がOneSignal App IDとGitHub Actions Secretsを設定すると利用できます。';
      if (ui.notificationPermissionBtn) ui.notificationPermissionBtn.textContent = '通知設定が必要';
      return;
    }
    if (!window.isSecureContext || !('serviceWorker' in navigator)) {
      oneSignalLoadError = 'Push通知にはHTTPSとService Workerが必要です。';
      if (ui.updateHelp) ui.updateHelp.textContent = oneSignalLoadError;
      renderNotificationPermissionState(('Notification' in window) ? Notification.permission : 'unsupported');
      return;
    }
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    oneSignalReadyPromise = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('OneSignal SDKの読み込みがタイムアウトしました。')), 20000);
      window.OneSignalDeferred.push(async OneSignal => {
        try {
          const appScope = new URL('./', document.baseURI).pathname;
          await OneSignal.init({
            appId,
            serviceWorkerPath: new URL('./service-worker.js', document.baseURI).pathname,
            serviceWorkerParam: { scope: appScope },
            allowLocalhostAsSecureOrigin: location.hostname === 'localhost' || location.hostname === '127.0.0.1',
            });
          oneSignalInstance = OneSignal;
          // Pushタップ時は必ずアプリの実際の配置ディレクトリへ遷移させます。
          // GitHub PagesのProject Pagesなら /<repository>/ がアプリのスコープになります。
          const appEntryUrl = new URL('./', document.baseURI).href;
          await OneSignal.Notifications.setDefaultUrl(appEntryUrl);
          oneSignalLoadError = null;
          clearTimeout(timeout);
          OneSignal.User.PushSubscription.addEventListener('change', () => renderNotificationPermissionState(('Notification' in window) ? Notification.permission : 'unsupported'));
          renderNotificationPermissionState(('Notification' in window) ? Notification.permission : 'unsupported');
          resolve(OneSignal);
        } catch (error) {
          clearTimeout(timeout);
          oneSignalLoadError = error.message || String(error);
          reject(error);
        }
      });
      const script = document.createElement('script');
      script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
      script.defer = true;
      script.onerror = () => {
        clearTimeout(timeout);
        oneSignalLoadError = 'OneSignal SDKを取得できません。通信設定を確認してください。';
        reject(new Error(oneSignalLoadError));
      };
      document.head.appendChild(script);
    });
    oneSignalReadyPromise.catch(error => {
      console.warn('OneSignal initialization skipped:', error);
      if (ui.updateHelp) ui.updateHelp.textContent = `Commit通知サービスを初期化できませんでした：${error.message}`;
      renderNotificationPermissionState(('Notification' in window) ? Notification.permission : 'unsupported');
    });
  }

  async function notifyUpdateAvailable(registration) {
    if (!registration?.waiting || !navigator.serviceWorker.controller) return;
    try {
      const meta = await fetchPublishedVersion();
      await announceUpdate(meta, registration);
    } catch (error) {
      console.warn('Could not load release notes for waiting update:', error);
      if (!lastNotifiedBuild) {
        lastNotifiedBuild = 'pending-worker';
        pendingUpdateRegistration = registration;
        showUpdateNotice({ version: APP_VERSION, revision: APP_REVISION + 1, buildLabel: '新しいアプリファイル（版情報は未取得）', releaseNotes: ['新しいアプリファイルを取得しました。公開版番号や更新内容は、通信可能な状態で「更新を確認」から再確認してください。'] }, true);
      }
    }
  }
  async function applyAvailableUpdate() {
    ui.updateNoticeApply.disabled = true;
    try {
      const registration = pendingUpdateRegistration || swRegistration || (('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistration() : null);
      if (registration?.waiting) {
        await activateWaitingWorker(registration);
        location.reload();
        return;
      }
      // Service Worker待機版がない場合でも、旧シェルキャッシュを避けて公開済みファイルを再取得します。
      await clearApplicationCaches();
      const url = new URL(location.href);
      url.searchParams.set('app-refresh', `${pendingUpdateMeta?.version || APP_VERSION}-r${pendingUpdateMeta?.revision || APP_REVISION}-${Date.now()}`);
      location.replace(url.href);
    } catch (error) {
      console.error('Update activation failed:', error);
      alert(`更新を適用できませんでした：${error.message}`);
      ui.updateNoticeApply.disabled = false;
    }
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
    initializePushNotifications();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type !== 'OPEN_UPDATE_NOTICE') return;
        if (pendingUpdateMeta) showUpdateNotice(pendingUpdateMeta, true);
        else void checkForUpdateOnStartup(swRegistration);
      });
    }
    const secureContext=location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1';
    if('serviceWorker' in navigator && secureContext){
      navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'}).then(async registration=>{
        swRegistration=registration;
        if ('Notification' in window) { renderNotificationPermissionState(Notification.permission); if (Notification.permission === 'denied') ui.updateHelp.textContent = notificationBlockedHelp(); }
        void checkForUpdateOnStartup(registration);
        if(registration.waiting&&navigator.serviceWorker.controller){
          ui.updateBtn.textContent='更新を確認（更新あり）';
          void notifyUpdateAvailable(registration);
        }
        registration.addEventListener('updatefound',()=>{
          const worker=registration.installing;if(!worker)return;
          worker.addEventListener('statechange',()=>{
            if(worker.state==='installed'&&navigator.serviceWorker.controller){
              ui.updateBtn.textContent='更新を確認（更新あり）';
              ui.updateHelp.textContent='新しいアプリ一式の取得が完了しました。更新内容を確認して適用できます。';
              void notifyUpdateAvailable(registration);
            }
          });
        });
      }).catch(error=>{console.warn('SW registration failed:',error);ui.updateHelp.textContent='自動更新にはHTTPSまたはlocalhostが必要です。';void checkForUpdateOnStartup(null);});
    } else {
      ui.updateHelp.textContent='Service Workerによる自動更新にはHTTPSまたはlocalhostが必要です。アプリの閲覧自体は続行できます。';
      void checkForUpdateOnStartup(null);
    }
    window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;ui.installBtn.classList.remove('hidden');ui.loginInstallBtn.classList.remove('hidden');});
    window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;ui.installBtn.textContent='インストール済み';ui.loginInstallBtn.textContent='インストール済み';});
    ui.installBtn.addEventListener('click',showInstallInstructions);
    ui.loginInstallBtn.addEventListener('click',showInstallInstructions);
    ui.installDialogClose.addEventListener('click',()=>ui.installDialog.close());
    ui.installDialog.addEventListener('click',event=>{if(event.target===ui.installDialog)ui.installDialog.close();});
    ui.updateNoticeLater.addEventListener('click',()=>ui.updateNoticeDialog.close());
    if (ui.notificationPermissionBtn) ui.notificationPermissionBtn.addEventListener('click', enableDesktopNotifications);
    if (!('Notification' in window)) { ui.notificationPermissionBtn.disabled=true; ui.notificationPermissionBtn.textContent='通知非対応'; } else { renderNotificationPermissionState(Notification.permission); if (Notification.permission === 'denied') ui.updateHelp.textContent = notificationBlockedHelp(); watchNotificationPermissionChanges(); }
    ui.updateNoticeApply.addEventListener('click',applyAvailableUpdate);
    ui.updateNoticeDialog.addEventListener('click',event=>{if(event.target===ui.updateNoticeDialog)ui.updateNoticeDialog.close();});
    ui.updateBtn.addEventListener('click',async()=>{
      ui.updateBtn.disabled=true;ui.updateBtn.textContent='更新を確認中…';ui.updateHelp.textContent='公開版の番号と更新内容を確認しています。';
      try{
        const published=await fetchPublishedVersion();
        const versionOrder=compareVersions(published.version,APP_VERSION);
        const revisionOrder=versionOrder===0?Math.sign(published.revision-APP_REVISION):0;
        if(versionOrder<0||(versionOrder===0&&revisionOrder<0)) throw new Error(`公開側（${describeBuild(published)}）が端末側より古い状態です。`);
        const hasUpdate=versionOrder>0||(versionOrder===0&&revisionOrder>0)||(versionOrder===0&&revisionOrder===0&&!!published.buildId&&published.buildId!==APP_BUILD_ID);
        let registration=swRegistration;
        if('serviceWorker' in navigator&&secureContext){
          registration=registration||await navigator.serviceWorker.getRegistration()||await navigator.serviceWorker.register('./service-worker.js',{updateViaCache:'none'});
          swRegistration=registration;
          await registration.update();
          if(registration.installing) await waitForWorkerState(registration.installing,['installed','activated'],90000);
          if(registration.waiting) pendingUpdateRegistration=registration;
          else if(hasUpdate) throw new Error('新版の全コアファイル取得を確認できませんでした。公開先への配置完了後に再試行してください。');
        }
        if(hasUpdate){
          ui.updateHelp.textContent=`${describeBuild(published)} の更新が見つかりました。更新内容を確認してください。`;
          await announceUpdate(published, registration);
        } else {
          ui.updateHelp.textContent=`公開版 ${describeBuild(published)} を確認しました。新しい更新はありません。`;
          showUpdateNotice(published,false);
        }
      }catch(error){
        console.error(error);
        ui.updateHelp.textContent=`更新情報を取得できませんでした：${error.message}`;
        alert(ui.updateHelp.textContent);
      }finally{
        ui.updateBtn.disabled=false;
        ui.updateBtn.textContent='更新を確認';
      }
    });
    window.addEventListener('popstate',event=>{if(!hasValidLoginSession()){ui.workspace.classList.add('hidden');ui.loginScreen.classList.add('active');history.replaceState({app:ROUTE_MARKER,page:'login'},'',location.href);return;}restoreRoute(event.state);});
  }

  function bindEvents() {
    ui.loginForm.addEventListener('submit', authenticate);
    $('chooseQuizBtn').addEventListener('click', () => selectMode('quiz'));
    $('chooseFlashBtn').addEventListener('click', () => selectMode('flash'));
    $('changeModeBtn').addEventListener('click', () => navigateBack('mode'));
    $('startModeBtn').addEventListener('click', launchMode);
    ui.resumeModeBtn.addEventListener('click', resumeSelectedSession);
    ui.dataFilesInput.addEventListener('change', () => {
        const incoming = [...(ui.dataFilesInput.files || [])];
      for (const file of incoming) {
        // CSV・XLSX・PDFを拡張子で判定し、MIMEが空の端末にも対応します。
        if (!/\.(csv|xlsx|pdf)$/i.test(file.name)) continue;
        const key = fileIdentity(file);
        if (!uploadedDataFiles.some(entry => entry.key === key)) uploadedDataFiles.push({ key, file });
      }
      if (!selectedUploadedFileKey && uploadedDataFiles.length) selectedUploadedFileKey = uploadedDataFiles[0].key;
      const acceptedCount = incoming.filter(file => /\.(csv|xlsx|pdf)$/i.test(file.name)).length;
      if (incoming.length && acceptedCount === 0) ui.selectedFileStatus.textContent = '医薬品データは .csv・.xlsx・.pdf ファイルのみ選択できます。';
      else if (incoming.length > acceptedCount) ui.selectedFileStatus.textContent = `${acceptedCount}件を追加しました。対象外の形式は除外しました。`;
      else ui.selectedFileStatus.textContent = uploadedDataFiles.length ? `${uploadedDataFiles.length}個のCSV・XLSX・PDFファイルを読み込み候補に追加しました。` : '';
      ui.dataFilesInput.value = '';
      renderUploadedFiles();
    });
    $('loadDataBtn').addEventListener('click', importSelectedDataFile);
    ui.sharedDataInput.addEventListener('input', () => { persistSettings(); updateDataStatus(); });
    ui.patternList.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => { persistSettings(); if (framesReady.quiz || framesReady.flash) setSetupInFrames(); }));
    ui.bookmarkedOnly.addEventListener('change', () => { ui.flashBookmarkSelection.classList.toggle('hidden', !ui.bookmarkedOnly.checked); persistSettings(); });
    ui.flashcardQuizWrongsOnly.addEventListener('change', persistSettings);
    ui.quizBookmarkedOnly.addEventListener('change', () => { ui.quizBookmarkSelection.classList.toggle('hidden', !ui.quizBookmarkedOnly.checked); persistSettings(); });
    ui.quizOrderMode.addEventListener('change', () => { persistSettings(); if(framesReady.quiz || framesReady.flash)setSetupInFrames(); });
    ui.quizRangeMode.addEventListener('change', () => { syncRangeInputs(); persistSettings(); if(framesReady.quiz || framesReady.flash)setSetupInFrames(); });
    ui.quizRangeInput.addEventListener('input', () => { persistSettings(); if(framesReady.quiz || framesReady.flash)setSetupInFrames(); });
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
    if (ui.clearInputDataBtn) ui.clearInputDataBtn.addEventListener('click', () => { if (confirm('入力済みの医薬品データと「○○件のデータを入力済み」の件数表示を削除しますか？学習履歴・誤答・ブックマーク・設定は残ります。')) clearMedicineData(); });
    $('logoutBtn').addEventListener('click', logout);
  }
  function clearMedicineData() {
    // 入力済みデータの唯一の永続保存値を消去し、両iframeのメモリ状態・件数表示も明示的にリセット。
    ui.sharedDataInput.value = '';
    uploadedDataFiles = [];
    selectedUploadedFileKey = '';
    ui.dataFilesInput.value = '';
    ui.selectedFileStatus.textContent = '入力済みの医薬品データと件数表示を削除しました。学習履歴・誤答・ブックマークは保持しています。';
    const settings = window.AppDB.getSettings();
    settings.dataText = '';
    window.AppDB.saveSettings(settings);
    renderUploadedFiles();
    for (const [mode, frame] of [['quiz', ui.quizFrame], ['flash', ui.flashFrame]]) {
      try {
        const bridge = framesReady[mode] && frame?.contentWindow?.appBridge;
        if (bridge?.clearMedicineData) bridge.clearMedicineData();
        else if (bridge?.setSetup) {
          if (mode === 'quiz') bridge.setSetup('', selectedPatterns(), ui.quizOrderMode.value, ui.quizRangeMode.value, ui.quizRangeInput.value, false, [], currentBookmarks());
          else bridge.setSetup('', selectedPatterns(), false, [], false, ui.quizOrderMode.value, ui.quizRangeMode.value, ui.quizRangeInput.value);
        }
      } catch (error) { console.warn(`${mode} medicine data reset failed`, error); }
    }
    updateDataStatus();
    return true;
  }
  window.AppShell = {
    clearMedicineData,
    refreshBookmarkList() { renderBookmarks(); renderBookmarkSelectors(); },
    refreshWrongList() { renderWrongs(); renderBookmarks(); },
    returnToMenu(mode) {
      const fallbackMode = mode === 'quiz' ? 'quiz' : 'flash';
      selectMode(fallbackMode, false);
      setScreen('menu');
      saveRoute({ page: 'menu', mode: fallbackMode }, true);
      refreshSessionControls();
    },
    refreshSessionControls() { refreshSessionControls(); }
  };
  function init() {
    cacheElements();
    renderUploadedFiles();
    bindEvents();
    restoreLegalConsentChecks();
    registerPwa();
    loadModeFrames();
    ui.passwordSetupNotice.textContent = config.PASSWORD_IS_DEFAULT
      ? '管理者設定が未完了です。data/config.local.js の SHARED_PASSWORD を実際の共通パスワードに変更し、PASSWORD_IS_DEFAULT を false にしてから再読み込みしてください。'
      : '';
    const validSession = hasValidLoginSession();
    const usableCredential = hasUsableCredential();
    if (validSession && usableCredential && hasCurrentLegalConsent()) {
      ui.loginScreen.classList.remove('active');
      ui.workspace.classList.remove('hidden');
      const persistedRoute = window.AppDB.get(PERSISTED_ROUTE_KEY, null);
      const initialRoute = persistedRoute && ['mode','menu','quiz','flash'].includes(persistedRoute.page)
        ? persistedRoute : { page: 'mode' };
      history.replaceState({ app: ROUTE_MARKER, ...initialRoute }, '', location.href);
      initializeWorkspace(initialRoute);
    } else {
      // 有効な既存セッションがあっても、規約改訂後など同意が未更新なら再同意を求めます。
      if (!validSession || !usableCredential) clearLoginSession();
      history.replaceState({ app: ROUTE_MARKER, page: 'login' }, '', location.href);
    }
  }
  init();
})();
