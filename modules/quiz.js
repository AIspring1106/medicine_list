const __volatileStore = new Map();
function getSharedDatabase(){
  try { if(window.parent && window.parent !== window && window.parent.AppDB) return window.parent.AppDB; } catch(e) {}
  return null;
}
const safeLocalStorage = {
  getItem(key){
    if(__volatileStore.has(key)) return __volatileStore.get(key);
    try { const db=getSharedDatabase(); return db ? db.getRaw(key) : window.localStorage.getItem(key); }
    catch(e) { return null; }
  },
  setItem(key, value){
    const v = String(value);
    try { const db=getSharedDatabase(); if(db) db.setRaw(key,v); else window.localStorage.setItem(key,v); }
    catch(e) { __volatileStore.set(key, v); }
  },
  removeItem(key){
    try { const db=getSharedDatabase(); if(db) db.removeRaw(key); else window.localStorage.removeItem(key); } catch(e) {}
    __volatileStore.delete(key);
  }
};

const STORAGE_HISTORY = 'pharm_quiz_history_v2';
const STORAGE_WRONG_LOG = 'pharm_quiz_recent_wrong_v1';
const PATTERNS = [
  { key:'sales_to_generic', label:'販売名 → 一般名', ask:'salesName', ans:'genericName' },
  { key:'generic_to_sales', label:'一般名 → 販売名', ask:'genericName', ans:'salesName' },
  { key:'sales_to_effect', label:'販売名 → 薬効', ask:'salesName', ans:'effect' },
  { key:'effect_to_sales', label:'薬効 → 販売名', ask:'effect', ans:'salesName' },
  { key:'generic_to_effect', label:'一般名 → 薬効', ask:'genericName', ans:'effect' },
  { key:'effect_to_generic', label:'薬効 → 一般名', ask:'effect', ans:'genericName' },
];

const MAX_NORMAL_QUESTIONS = 108;
const MAX_HISTORY_ITEMS = 10;
const MAX_RECENT_WRONG = 1000;
const MAX_VISIBLE_WRONG = 10;

const els = {
  homeScreen:document.getElementById('homeScreen'),
  quizScreen:document.getElementById('quizScreen'),
  resultScreen:document.getElementById('resultScreen'),
  dataInput:document.getElementById('dataInput'),
  loadBtn:document.getElementById('loadBtn'),
  startBtn:document.getElementById('startBtn'),
  reviewWrongResultBtn:document.getElementById('reviewWrongResultBtn'),
  reviewAllWrongResultBtn:document.getElementById('reviewAllWrongResultBtn'),
  clearHistoryBtn:document.getElementById('clearHistoryBtn'),
  toggleWrongBtn:document.getElementById('toggleWrongBtn'),
  clearWrongBtn:document.getElementById('clearWrongBtn'),
  homeBtnTop:document.getElementById('homeBtnTop'),
  backHomeBtn:document.getElementById('backHomeBtn'),
  retryBtn:document.getElementById('retryBtn'),
  endBtn:document.getElementById('endBtn'),
  mainActionBtn:document.getElementById('mainActionBtn'),
  answerInput:document.getElementById('answerInput'),
  questionText:document.getElementById('questionText'),
  patternText:document.getElementById('patternText'),
  questionWrongCount:document.getElementById('questionWrongCount'),
  feedbackBox:document.getElementById('feedbackBox'),
  progressFill:document.getElementById('progressFill'),
  quizCounter:document.getElementById('quizCounter'),
  srcSales:document.getElementById('srcSales'),
  srcGeneric:document.getElementById('srcGeneric'),
  srcEffect:document.getElementById('srcEffect'),
  historyArea:document.getElementById('historyArea'),
  wrongHomeArea:document.getElementById('wrongHomeArea'),
  wrongCountBadge:document.getElementById('wrongCountBadge'),
  resultScore:document.getElementById('resultScore'),
  resultAccuracy:document.getElementById('resultAccuracy'),
  resultAnswered:document.getElementById('resultAnswered'),
  resultWrongArea:document.getElementById('resultWrongArea'),
  resultNote:document.getElementById('resultNote'),
  loadStatus:document.getElementById('loadStatus'),
  patternList:document.getElementById('patternList'),
  orderModeSelect:document.getElementById('orderModeSelect'),
  rangeModeSelect:document.getElementById('rangeModeSelect'),
  rangeInput:document.getElementById('rangeInput'),
  reviewAllWrongHomeBtn:document.getElementById('reviewAllWrongHomeBtn')
};

const state = {
  items: [],
  selectedPatterns: new Set(PATTERNS.map(p=>p.key)),
  questions: [],
  currentIndex: 0,
  completedCount: 0,
  score: 0,
  answeredCount: 0,
  sessionWrongs: [],
  revealed: false,
  currentQuestion: null,
  reviewMode: 'normal',
  orderMode: 'random',
  rangeMode: 'all',
  rangeInput: '',
  bookmarkedOnly: false,
  selectedBookmarkKeys: new Set(),
  bookmarkRecords: [],
};

let showWrongList = false;

function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

function showScreen(name){
  if(name==='home'){
    try{ if(window.parent && window.parent !== window && window.parent.AppShell){ window.parent.AppShell.returnToMenu('quiz'); return; } }catch(e){}
  }
  [els.homeScreen, els.quizScreen, els.resultScreen].forEach(el=>el.classList.remove('active'));
  if(name==='home') els.homeScreen.classList.add('active');
  if(name==='quiz') els.quizScreen.classList.add('active');
  if(name==='result') els.resultScreen.classList.add('active');
  if(name==='home') renderHome();
}

function loadHistory(){
  try{return JSON.parse(safeLocalStorage.getItem(STORAGE_HISTORY) || '[]');}
  catch{return [];}
}

function saveHistory(history){
  safeLocalStorage.setItem(STORAGE_HISTORY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
}

function loadWrongLog(){
  try{
    const current = JSON.parse(safeLocalStorage.getItem(STORAGE_WRONG_LOG) || '[]');
    if(Array.isArray(current) && current.length) return current;
    const legacy = JSON.parse(safeLocalStorage.getItem('pharm_quiz_wrong_log_v7') || '[]');
    if(Array.isArray(legacy) && legacy.length){
      safeLocalStorage.setItem(STORAGE_WRONG_LOG, JSON.stringify(legacy.slice(0, MAX_RECENT_WRONG)));
      return legacy;
    }
    return [];
  }
  catch{return [];}
}

function saveWrongLog(log){
  safeLocalStorage.setItem(STORAGE_WRONG_LOG, JSON.stringify(log.slice(0, MAX_RECENT_WRONG)));
}

function splitLines(text){
  return String(text || '').replaceAll('\r','\n').split('\n').map(s=>s.trim()).filter(Boolean);
}

function parseRows(text){
  const rows = splitLines(text);
  const items = [];
  for(const row of rows){
    const i1 = row.indexOf(',');
    if(i1 < 0) continue;
    const i2 = row.indexOf(',', i1 + 1);
    if(i2 < 0) continue;
    const salesName = row.slice(0, i1).trim();
    const genericName = row.slice(i1 + 1, i2).trim();
    const effect = row.slice(i2 + 1).trim();
    if(salesName && genericName && effect) items.push({ salesName, genericName, effect });
  }
  return dedupeRows(items);
}

function rowKey(item){
  return [item.salesName, item.genericName, item.effect].join('\u0001');
}

function dedupeRows(items){
  const map = new Map();
  for(const item of items){
    const key = rowKey(item);
    if(!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function splitByCommaOnly(value){
  return String(value ?? '').split(/[,，]/).map(s=>s.trim()).filter(Boolean);
}

function normalizeText(value){
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    // 文字と数字だけを残し、記号・空白・区切り文字をすべて除去
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function compareAnswer(user, correctRaw, pattern = null){
  const userNorm = normalizeText(user);
  if(!userNorm) return false;

  const options = splitByCommaOnly(correctRaw)
    .map(normalizeText)
    .filter(Boolean);

  return options.includes(userNorm);
}

function displayJoined(value){
  const parts = [...new Set(splitByCommaOnly(value))];
  return parts.length ? parts.join(' / ') : '-';
}

function renderPatternCheckboxes(){
  els.patternList.innerHTML = '';
  PATTERNS.forEach(p=>{
    const label = document.createElement('label');
    label.className = 'check';
    label.innerHTML = `
      <input type="checkbox" ${state.selectedPatterns.has(p.key) ? 'checked' : ''} data-pattern="${p.key}">
      <div><b>${escapeHtml(p.label)}</b><span>この方向で出題します</span></div>
    `;
    els.patternList.appendChild(label);
  });
  els.patternList.querySelectorAll('input[type="checkbox"]').forEach(cb=>{
    cb.addEventListener('change',()=>{
      const key = cb.getAttribute('data-pattern');
      if(cb.checked) state.selectedPatterns.add(key);
      else state.selectedPatterns.delete(key);
    });
  });
}

function getSelectedPatterns(){
  return PATTERNS.filter(p=>state.selectedPatterns.has(p.key));
}

function groupWrongRecords(records){
  const map = new Map();
  for(const w of records){
    const key = JSON.stringify([
      w.source?.salesName || '',
      w.source?.genericName || '',
      w.source?.effect || '',
      w.patternKey || '',
    ]);
    if(!map.has(key)){
      map.set(key, {...w, count: 0});
    }
    map.get(key).count += 1;
  }
  return [...map.values()];
}

function getCumulativeWrongCount(question){
  if(!question) return 0;
  const key = JSON.stringify([
    question.item?.salesName || '',
    question.item?.genericName || '',
    question.item?.effect || '',
    question.pattern?.key || '',
  ]);
  const grouped = groupWrongRecords(loadWrongLog());
  const found = grouped.find(w => JSON.stringify([
    w.source?.salesName || '',
    w.source?.genericName || '',
    w.source?.effect || '',
    w.patternKey || '',
  ]) === key);
  return found ? Number(found.count || 0) : 0;
}

function renderQuestionWrongCount(question, justAnsweredWrong = false){
  if(!els.questionWrongCount) return;
  const count = getCumulativeWrongCount(question);
  els.questionWrongCount.hidden = count <= 0;
  if(count > 0){
    els.questionWrongCount.textContent = justAnsweredWrong
      ? `${count}回誤答（累計）`
      : `過去の誤答：${count}回`;
  } else {
    els.questionWrongCount.textContent = '';
  }
}

function selectRowsByRange(items, mode = state.rangeMode, rangeText = state.rangeInput){
  if(mode !== 'custom') return items.slice();
  const raw = String(rangeText || '').trim();
  if(!raw) throw new Error('カスタム範囲を入力してください。入力例：1-10,21-30');
  const selected = new Set();
  for(const part of raw.split(/[,，]/)){
    const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if(!match) throw new Error(`範囲「${part.trim()}」の形式が正しくありません。例：1-10,21-30`);
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if(!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start)
      throw new Error(`範囲「${part.trim()}」が正しくありません。開始行は1以上、終了行は開始行以上にしてください。`);
    if(end > items.length)
      throw new Error(`範囲「${part.trim()}」はデータ件数（${items.length}件）を超えています。1～${items.length}の範囲で指定してください。`);
    for(let row = start; row <= end; row += 1) selected.add(row - 1);
  }
  return [...selected].sort((a,b)=>a-b).map(index=>items[index]);
}

function syncRangeInput(){
  if(els.rangeInput && els.rangeModeSelect) els.rangeInput.disabled = els.rangeModeSelect.value !== 'custom';
  if(els.rangeModeSelect) state.rangeMode = els.rangeModeSelect.value === 'custom' ? 'custom' : 'all';
  if(els.rangeInput) state.rangeInput = els.rangeInput.value;
}

function shuffleArray(values){
  const result = [...values];
  for(let i = result.length - 1; i > 0; i -= 1){
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function buildNormalQuestions(items, patterns, maxCount = MAX_NORMAL_QUESTIONS, orderMode = state.orderMode){
  if(!items.length) throw new Error('問題の元データがありません。');
  if(!patterns.length) throw new Error('出題パターンを1つ以上選んでください。');
  const questionCount = Math.min(maxCount, items.length);
  const orderedItems = orderMode === 'ordered' ? [...items] : shuffleArray(items);
  const chosen = orderedItems.slice(0, questionCount);
  return chosen.map(item=>({
    item,
    pattern: patterns[Math.floor(Math.random() * patterns.length)],
    wrongCount: 0,
  }));
}

function buildReviewQuestionsFromWrongs(wrongs, orderMode = state.orderMode){
  const grouped = groupWrongRecords(wrongs || []);
  if(!grouped.length) throw new Error('復習できる誤答がありません。');
  const ordered = orderMode === 'ordered' ? grouped : shuffleArray(grouped);
  return ordered.map(w=>({
    item: w.source,
    pattern: PATTERNS.find(p=>p.key === w.patternKey) || PATTERNS[0],
    wrongCount: w.count || 0,
  }));
}

function buildBookmarkedQuestions(items, patterns, orderMode = state.orderMode){
  const allowedItemKeys = new Set(items.map(rowKey));
  const selectedKeys = state.selectedBookmarkKeys;
  const eligible = (state.bookmarkRecords || []).filter(bookmark =>
    selectedKeys.has(bookmark.key) &&
    allowedItemKeys.has(rowKey(bookmark.item || {})) &&
    patterns.some(pattern => pattern.key === bookmark.patternKey)
  ).map(bookmark => ({
    item: items.find(item => rowKey(item) === rowKey(bookmark.item || {})),
    pattern: PATTERNS.find(pattern => pattern.key === bookmark.patternKey),
    wrongCount: getCumulativeWrongCount({ item: bookmark.item, pattern: { key: bookmark.patternKey } })
  })).filter(question => question.item && question.pattern);
  const unique = [...new Map(eligible.map(question => [JSON.stringify([rowKey(question.item), question.pattern.key]), question])).values()];
  const ordered = orderMode === 'ordered'
    ? unique.sort((a,b) => items.findIndex(x => rowKey(x) === rowKey(a.item)) - items.findIndex(x => rowKey(x) === rowKey(b.item)) || PATTERNS.findIndex(x => x.key === a.pattern.key) - PATTERNS.findIndex(x => x.key === b.pattern.key))
    : shuffleArray(unique);
  if(!ordered.length) throw new Error('選択したブックマークに該当する問題がありません。ブックマークの選択、出題方向、行の範囲を確認してください。');
  return ordered.slice(0, MAX_NORMAL_QUESTIONS);
}

function prepareQuiz(mode = 'normal', wrongSource = null){
  const loaded = parseRows(els.dataInput.value);
  if(loaded.length) state.items = loaded;

  state.reviewMode = mode;
  state.score = 0;
  state.answeredCount = 0;
  state.completedCount = 0;
  state.currentIndex = 0;
  state.revealed = false;
  state.currentQuestion = null;
  state.sessionWrongs = [];

  if(mode === 'normal'){
    const patterns = getSelectedPatterns();
    if(!state.items.length){
      alert('データが読み込まれていません。販売名,一般名,薬効を貼り付けて読み込んでください。');
      return false;
    }
    let selectedItems;
    try { selectedItems = selectRowsByRange(state.items); }
    catch(error) { alert(error.message || '行の範囲指定を確認してください。'); return false; }
    if(!selectedItems.length) { alert('指定範囲に該当する医薬品がありません。'); return false; }
    try {
      state.questions = state.bookmarkedOnly
        ? buildBookmarkedQuestions(selectedItems, patterns, state.orderMode)
        : buildNormalQuestions(selectedItems, patterns, MAX_NORMAL_QUESTIONS, state.orderMode);
    } catch(error) {
      alert(error.message || '問題を作成できませんでした。');
      return false;
    }
    return true;
  }

  const sourceWrongs = wrongSource ? wrongSource.slice() : loadWrongLog();
  try{
    state.questions = buildReviewQuestionsFromWrongs(sourceWrongs, state.orderMode);
    return true;
  }catch(err){
    alert(err.message || '開始できませんでした。');
    return false;
  }
}

function startQuiz(mode = 'normal', wrongSource = null){
  if(!prepareQuiz(mode, wrongSource)) return;
  showScreen('quiz');
  renderQuestion();
  els.answerInput.focus();
}

function updateActionButtonState(){
  if(state.revealed){
    els.mainActionBtn.disabled = false;
    els.mainActionBtn.textContent = (state.currentIndex === state.questions.length - 1) ? '結果へ' : '次へ';
    return;
  }
  const hasAnswer = els.answerInput.value.trim().length > 0;
  els.mainActionBtn.disabled = !hasAnswer;
  els.mainActionBtn.textContent = '答えを表示';
}

function renderQuestion(){
  const q = state.questions[state.currentIndex];
  if(!q) return;
  state.currentQuestion = q;
  state.revealed = false;
  els.answerInput.value = '';
  els.answerInput.disabled = false;
  els.answerInput.readOnly = false;
  els.feedbackBox.style.display = 'none';
  els.feedbackBox.className = 'feedback';
  els.quizCounter.textContent = `${state.currentIndex + 1} / ${state.questions.length}`;
  els.progressFill.style.width = `${(state.completedCount / state.questions.length) * 100}%`;
  els.questionText.textContent = displayJoined(q.item[q.pattern.ask]);
  els.patternText.textContent = q.pattern.label;
  renderQuestionWrongCount(q);
  els.srcSales.textContent = displayJoined(q.item.salesName);
  els.srcGeneric.textContent = displayJoined(q.item.genericName);
  els.srcEffect.textContent = displayJoined(q.item.effect);
  updateActionButtonState();
}

function addWrongRecord(q, userAnswer, correctRaw){
  const record = {
    time: new Date().toISOString(),
    source: q.item,
    patternKey: q.pattern.key,
    patternLabel: q.pattern.label,
    askField: q.pattern.ask,
    askedText: displayJoined(q.item[q.pattern.ask]),
    userAnswer: userAnswer || '（未入力）',
    correctText: displayJoined(correctRaw),
  };
  state.sessionWrongs.push(record);
  const log = loadWrongLog();
  log.push(record);
  saveWrongLog(log);
}

function revealAnswer(){
  if(state.revealed || !state.currentQuestion) return;
  const q = state.currentQuestion;
  const userAnswer = els.answerInput.value.trim();
  if(!userAnswer) return;
  const correctRaw = q.item[q.pattern.ans];
  const ok = compareAnswer(userAnswer, correctRaw, q.pattern);

  state.revealed = true;
  state.answeredCount += 1;
  if(ok) state.score += 1;
  else addWrongRecord(q, userAnswer, correctRaw);

  els.answerInput.readOnly = true;
  els.answerInput.disabled = false;
  els.feedbackBox.style.display = 'block';
  els.feedbackBox.className = 'feedback ' + (ok ? 'correct' : 'incorrect');
  const cumulativeWrongCount = getCumulativeWrongCount(q);
  renderQuestionWrongCount(q, !ok);
  const wrongCountText = ok ? '' : `<div class="small">この問題の累積誤答回数: <b>${escapeHtml(String(cumulativeWrongCount))}回誤答</b></div>`;
  els.feedbackBox.innerHTML = ok
    ? `<div class="title">正解</div><div class="small">入力: ${escapeHtml(userAnswer)}</div><div>正答: <b>${escapeHtml(displayJoined(correctRaw))}</b></div>${cumulativeWrongCount ? `<div class="small">これまでの誤答回数: <b>${escapeHtml(String(cumulativeWrongCount))}回</b></div>` : ''}`
    : `<div class="title">不正解</div><div class="small">入力: ${escapeHtml(userAnswer)}</div><div>正答: <b>${escapeHtml(displayJoined(correctRaw))}</b></div><div class="small">別解: ${escapeHtml(displayJoined(correctRaw))}</div>${wrongCountText}`;

  updateActionButtonState();
  els.answerInput.focus();
}

function nextQuestionOrResult(){
  if(!state.revealed){
    revealAnswer();
    return;
  }
  state.completedCount += 1;
  if(state.currentIndex >= state.questions.length - 1){
    finishQuiz();
    return;
  }
  state.currentIndex += 1;
  renderQuestion();
  els.answerInput.focus();
}

function finishQuiz(){
  const total = state.answeredCount;
  const accuracy = total ? (state.score / total) * 100 : 0;
  const record = {
    time: new Date().toISOString(),
    score: state.score,
    total,
    accuracy,
    reviewMode: state.reviewMode,
  };
  const history = loadHistory();
  history.unshift(record);
  saveHistory(history);
  renderResult(record);
  showScreen('result');
}

function finishEarly(){
  if(!state.questions.length) return;
  const total = state.answeredCount;
  const accuracy = total ? (state.score / total) * 100 : 0;
  const record = {
    time: new Date().toISOString(),
    score: state.score,
    total,
    accuracy,
    reviewMode: state.reviewMode,
    earlyFinish: true,
  };
  const history = loadHistory();
  history.unshift(record);
  saveHistory(history);
  renderResult(record);
  showScreen('result');
}

function renderWrongList(container, list){
  container.innerHTML = '';
  const rows = list.slice(0, MAX_VISIBLE_WRONG);
  if(!rows.length){
    container.innerHTML = '<div class="muted">間違えた問題はありません。</div>';
    return;
  }
  for(const w of rows){
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${escapeHtml(w.patternLabel || '問題')}</div>
        <span class="badge bad">誤答 ${escapeHtml(String(w.count || 1))}回</span>
      </div>
      <div class="itemMeta">問題: ${escapeHtml(w.askedText || displayJoined(w.source?.[PATTERNS.find(p=>p.key===w.patternKey)?.ask || 'salesName']))}</div>
      <div class="itemMeta">あなたの入力: ${escapeHtml(w.userAnswer || '（復習一覧では省略）')}</div>
      <div class="itemMeta">正答: <b>${escapeHtml(w.correctText || '-')}</b></div>
      <div class="itemMeta">この問題の誤答回数: <b>${escapeHtml(String(w.count || 1))}</b></div>
    `;
    container.appendChild(el);
  }
}

function renderHistory(){
  const history = loadHistory().slice(0, MAX_HISTORY_ITEMS);
  els.historyArea.innerHTML = '';
  if(!history.length){
    els.historyArea.innerHTML = '<div class="muted">まだ履歴はありません。</div>';
    return;
  }
  history.forEach((h, i)=>{
    const when = new Date(h.time);
    const timeText = isNaN(when.getTime()) ? '不明な日時' : when.toLocaleString('ja-JP');
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="itemTop">
        <div class="itemTitle">${i + 1}. ${escapeHtml(timeText)}${h.reviewMode === 'allWrong' ? '（総復習）' : h.reviewMode === 'sessionWrong' ? '（誤答復習）' : ''}${h.earlyFinish ? '（途中終了）' : ''}</div>
        <span class="badge good">${escapeHtml((h.accuracy || 0).toFixed(1))}%</span>
      </div>
      <div class="itemMeta">正解数: <b>${escapeHtml(String(h.score || 0))}</b> / <b>${escapeHtml(String(h.total || 0))}</b></div>
      <div class="itemMeta">正答率: <b>${escapeHtml((h.accuracy || 0).toFixed(1))}%</b></div>
    `;
    els.historyArea.appendChild(el);
  });
}

function updateReviewButtons(){
  const currentWrongCount = groupWrongRecords(state.sessionWrongs).length;
  const allWrongCount = groupWrongRecords(loadWrongLog()).length;

  // 結果側: その場で表示されている誤答がある時だけ復習可能
  els.reviewWrongResultBtn.disabled = currentWrongCount === 0;
  els.reviewAllWrongResultBtn.disabled = allWrongCount === 0;
  els.reviewAllWrongHomeBtn.disabled = allWrongCount === 0;
}

function renderHome(){
  const wrongAllGrouped = groupWrongRecords(loadWrongLog()).slice(0, MAX_VISIBLE_WRONG);
  els.wrongCountBadge.textContent = `${wrongAllGrouped.length}件`;
  renderHistory();
  if(showWrongList) renderWrongList(els.wrongHomeArea, wrongAllGrouped);
  else els.wrongHomeArea.innerHTML = '<div class="muted">「表示 / 非表示」で一覧を開けます。</div>';
  els.loadStatus.textContent = state.items.length
    ? `${state.items.length}件のデータを読み込み済み${loadHistory().length ? ` / 履歴 ${loadHistory().length}件` : ''}`
    : '未読み込み';
  updateReviewButtons();
}

function renderResult(record){
  els.resultScore.textContent = `正解 ${record.score} / ${record.total}`;
  els.resultAccuracy.textContent = `正答率 ${(record.total ? record.accuracy : 0).toFixed(1)}%`;
  els.resultAnswered.textContent = `解答済み ${record.total}`;
  els.resultNote.textContent = record.total
    ? (record.earlyFinish ? '途中終了の結果を保存しました。' : 'この結果は履歴に保存されました。')
    : '解答済みがないため、集計対象はありませんでした。';
  const groupedSessionWrong = groupWrongRecords(state.sessionWrongs);
  renderWrongList(els.resultWrongArea, groupedSessionWrong);
  renderHome();
  els.reviewWrongResultBtn.disabled = groupedSessionWrong.length === 0;
}

function loadData(){
  state.items = parseRows(els.dataInput.value);
  els.loadStatus.textContent = state.items.length ? `${state.items.length}件のデータを読み込みました` : '読み込み失敗: 3列のデータが見つかりません';
  renderHome();
}

function handleMainAction(){
  if(state.revealed) nextQuestionOrResult();
  else revealAnswer();
}

function retryQuiz(){
  if(!state.items.length){
    alert('先にデータを読み込んでください。');
    showScreen('home');
    return;
  }
  startQuiz('normal');
}

function clearWrongLog(){
  if(!confirm('直近の誤答をすべて消去しますか？')) return;
  safeLocalStorage.removeItem(STORAGE_WRONG_LOG);
  safeLocalStorage.removeItem('pharm_quiz_wrong_log_v7');
  state.sessionWrongs = [];
  renderHome();
  // 親メニューの誤答一覧・ブックマーク側誤答数にも削除を即時反映します。
  try{
    if(window.parent && window.parent !== window && window.parent.AppShell?.refreshWrongList){
      window.parent.AppShell.refreshWrongList();
    }
  }catch(error){ /* iframe単独起動時は親画面同期を省略 */ }
}

function startReviewFromResultWrong(){
  const source = state.sessionWrongs.slice();
  if(groupWrongRecords(source).length === 0){
    alert('復習できる誤答がありません。');
    return;
  }
  startQuiz('sessionWrong', source);
}

function startReviewFromAllWrong(){
  const source = loadWrongLog().slice();
  if(groupWrongRecords(source).length === 0){
    alert('復習できる誤答がありません。');
    return;
  }
  startQuiz('allWrong', source);
}

function handleEnterAsClick(){
  if(!els.quizScreen.classList.contains('active')) return;
  els.mainActionBtn.click();
}

document.addEventListener('keydown', e=>{
  if(e.key !== 'Enter') return;
  if(!els.quizScreen.classList.contains('active')) return;
  e.preventDefault();
  handleEnterAsClick();
});

els.loadBtn.addEventListener('click', loadData);
els.startBtn.addEventListener('click', ()=>startQuiz('normal'));
els.reviewAllWrongHomeBtn.addEventListener('click', startReviewFromAllWrong);
els.orderModeSelect.addEventListener('change', ()=>{ state.orderMode = els.orderModeSelect.value === 'ordered' ? 'ordered' : 'random'; });
els.rangeModeSelect.addEventListener('change', syncRangeInput);
els.rangeInput.addEventListener('input', syncRangeInput);
els.reviewWrongResultBtn.addEventListener('click', startReviewFromResultWrong);
els.reviewAllWrongResultBtn.addEventListener('click', startReviewFromAllWrong);
els.clearHistoryBtn.addEventListener('click', ()=>{
  if(!confirm('履歴をすべて消去しますか？')) return;
  safeLocalStorage.removeItem(STORAGE_HISTORY);
  renderHome();
});
els.toggleWrongBtn.addEventListener('click', ()=>{
  showWrongList = !showWrongList;
  renderHome();
});
els.clearWrongBtn.addEventListener('click', clearWrongLog);
els.homeBtnTop.addEventListener('click', ()=>showScreen('home'));
els.backHomeBtn.addEventListener('click', ()=>showScreen('home'));
els.retryBtn.addEventListener('click', retryQuiz);
els.endBtn.addEventListener('click', finishEarly);
els.mainActionBtn.addEventListener('click', handleMainAction);
els.answerInput.addEventListener('input', updateActionButtonState);



renderPatternCheckboxes();
syncRangeInput();
renderHome();

window.appBridge = {
  setSetup(data, patterns, orderMode = state.orderMode, rangeMode = 'all', rangeInput = ''){
    els.dataInput.value = String(data || '');
    state.orderMode = orderMode === 'ordered' ? 'ordered' : 'random';
    els.orderModeSelect.value = state.orderMode;
    state.rangeMode = rangeMode === 'custom' ? 'custom' : 'all';
    state.rangeInput = String(rangeInput || '');
    els.rangeModeSelect.value = state.rangeMode;
    els.rangeInput.value = state.rangeInput;
    syncRangeInput();
    state.selectedPatterns = new Set(patterns || PATTERNS.map(p=>p.key));
    renderPatternCheckboxes();
    loadData();
    return state.items.length;
  },
  launch(data, patterns, orderMode = state.orderMode, rangeMode = 'all', rangeInput = '', bookmarkedOnly = false, selectedBookmarkKeys = [], bookmarkRecords = []){
    this.setSetup(data, patterns, orderMode, rangeMode, rangeInput);
    state.bookmarkedOnly = !!bookmarkedOnly;
    state.selectedBookmarkKeys = new Set(Array.isArray(selectedBookmarkKeys) ? selectedBookmarkKeys : []);
    state.bookmarkRecords = Array.isArray(bookmarkRecords) ? bookmarkRecords : [];
    startQuiz('normal');
  },
  startAllWrongReview(){ startReviewFromAllWrong(); },
  refresh(){ renderHome(); },
  getHistory(){ return loadHistory().map(x=>({...x})); },
  getWrongs(){ return loadWrongLog().map(x=>JSON.parse(JSON.stringify(x))); },
  getWrongCount(item, patternKey){
    const row = rowKey(item || {});
    return groupWrongRecords(loadWrongLog()).filter(record => rowKey(record.source || {}) === row && record.patternKey === patternKey).reduce((sum, record) => sum + Number(record.count || 0), 0);
  },
  clearHistory(){ safeLocalStorage.removeItem(STORAGE_HISTORY); renderHome(); },
  clearWrongs(){
    safeLocalStorage.removeItem(STORAGE_WRONG_LOG);
    safeLocalStorage.removeItem('pharm_quiz_wrong_log_v7');
    state.sessionWrongs=[]; renderHome();
  }
};
