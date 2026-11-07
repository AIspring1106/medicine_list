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
    const v=String(value);
    try { const db=getSharedDatabase(); if(db) db.setRaw(key,v); else window.localStorage.setItem(key,v); }
    catch(e) { __volatileStore.set(key,v); }
  },
  removeItem(key){
    try { const db=getSharedDatabase(); if(db) db.removeRaw(key); else window.localStorage.removeItem(key); } catch(e) {}
    __volatileStore.delete(key);
  }
};

const STORAGE_BOOKMARKS = 'pharm_flashcards_bookmarks_v1';
const PATTERNS = [
  { key:'sales_to_generic', label:'販売名 → 一般名', ask:'salesName', ans:'genericName' },
  { key:'generic_to_sales', label:'一般名 → 販売名', ask:'genericName', ans:'salesName' },
  { key:'sales_to_effect', label:'販売名 → 薬効', ask:'salesName', ans:'effect' },
  { key:'effect_to_sales', label:'薬効 → 販売名', ask:'effect', ans:'salesName' },
  { key:'generic_to_effect', label:'一般名 → 薬効', ask:'genericName', ans:'effect' },
  { key:'effect_to_generic', label:'薬効 → 一般名', ask:'effect', ans:'genericName' },
];
const COLOR_OPTIONS = ['amber','emerald','sky','violet','rose','slate'];
const COLOR_META = {
  amber:   { label:'橙', accent:'#f59e0b', soft:'rgba(245,158,11,.14)', border:'rgba(245,158,11,.38)', text:'#8a5800', itemBg:'rgba(245,158,11,.055)' },
  emerald: { label:'緑', accent:'#22c55e', soft:'rgba(34,197,94,.13)', border:'rgba(34,197,94,.36)', text:'#166534', itemBg:'rgba(34,197,94,.055)' },
  sky:     { label:'水色', accent:'#0ea5e9', soft:'rgba(14,165,233,.13)', border:'rgba(14,165,233,.36)', text:'#075985', itemBg:'rgba(14,165,233,.055)' },
  violet:  { label:'紫', accent:'#8b5cf6', soft:'rgba(139,92,246,.13)', border:'rgba(139,92,246,.36)', text:'#5b21b6', itemBg:'rgba(139,92,246,.055)' },
  rose:    { label:'赤', accent:'#f43f5e', soft:'rgba(244,63,94,.12)', border:'rgba(244,63,94,.34)', text:'#9f1239', itemBg:'rgba(244,63,94,.05)' },
  slate:   { label:'灰', accent:'#64748b', soft:'rgba(100,116,139,.13)', border:'rgba(100,116,139,.34)', text:'#334155', itemBg:'rgba(100,116,139,.055)' }
};
function bookmarkColorMeta(color){ return COLOR_META[COLOR_OPTIONS.includes(color) ? color : 'sky']; }
function applyBookmarkButtonColor(button, color, saved){
  if(!button) return;
  const safeColor = COLOR_OPTIONS.includes(color) ? color : 'sky';
  const meta = saved
    ? bookmarkColorMeta(safeColor)
    : { accent:'#94a3b8', soft:'rgba(148,163,184,.10)', border:'rgba(148,163,184,.34)' };
  // 未保存は必ず同じグレーの輪郭アイコン。直前に選んだ色を未保存状態へ持ち越しません。
  button.dataset.bookmarkColor = saved ? safeColor : 'none';
  button.setAttribute('aria-pressed', saved ? 'true' : 'false');
  button.style.setProperty('--bookmark', meta.accent);
  button.style.setProperty('--bookmarkSoft', meta.soft);
  button.style.setProperty('--bookmarkBorder', meta.border);
  const svg = button.querySelector('svg');
  if(svg){
    svg.style.stroke = meta.accent;
    svg.style.fill = saved ? meta.accent : 'none';
  }
  button.classList.toggle('saved', !!saved);
}

const els = {
  homeScreen:document.getElementById('homeScreen'),
  quizScreen:document.getElementById('quizScreen'),
  dataInput:document.getElementById('dataInput'),
  loadBtn:document.getElementById('loadBtn'),
  startBtn:document.getElementById('startBtn'),
  bookmarkedOnlyStart:document.getElementById('bookmarkedOnlyStart'),
  toggleBookmarkListBtn:document.getElementById('toggleBookmarkListBtn'),
  clearBookmarksBtn:document.getElementById('clearBookmarksBtn'),
  homeBtnTop:document.getElementById('homeBtnTop'),
  endBtn:document.getElementById('endBtn'),
  mainActionBtn:document.getElementById('mainActionBtn'),
  prevBtn:document.getElementById('prevBtn'),
  nextBtn:document.getElementById('nextBtn'),
  toggleBookmarkOnlyBtn:document.getElementById('toggleBookmarkOnlyBtn'),
  questionText:document.getElementById('questionText'),
  patternText:document.getElementById('patternText'),
  answerTitle:document.getElementById('answerTitle'),
  answerMeta:document.getElementById('answerMeta'),
  srcSales:document.getElementById('srcSales'),
  srcGeneric:document.getElementById('srcGeneric'),
  srcEffect:document.getElementById('srcEffect'),
  quizCounter:document.getElementById('quizCounter'),
  progressFill:document.getElementById('progressFill'),
  flashcard:document.getElementById('flashcard'),
  bookmarkBtn:document.getElementById('bookmarkBtn'),
  bookmarkBtnBack:document.getElementById('bookmarkBtnBack'),
  bookmarkMenu:document.getElementById('bookmarkMenu'),
  bookmarkMenuSwatches:document.getElementById('bookmarkMenuSwatches'),
  bookmarkMenuCloseBtn:document.getElementById('bookmarkMenuCloseBtn'),
  bookmarkMenuSaveBtn:document.getElementById('bookmarkMenuSaveBtn'),
  bookmarkMenuRemoveBtn:document.getElementById('bookmarkMenuRemoveBtn'),
  bookmarkNameEnabled:document.getElementById('bookmarkNameEnabled'),
  bookmarkNameInput:document.getElementById('bookmarkNameInput'),
  bookmarkCountBadge:document.getElementById('bookmarkCountBadge'),
  bookmarkHomeArea:document.getElementById('bookmarkHomeArea'),
  loadStatus:document.getElementById('loadStatus'),
  patternList:document.getElementById('patternList'),
  orderModeSelect:document.getElementById('orderModeSelect'),
  rangeModeSelect:document.getElementById('rangeModeSelect'),
  rangeInput:document.getElementById('rangeInput'),
};

const state = {
  items: [],
  selectedPatterns: new Set(PATTERNS.map(p=>p.key)),
  questions: [],
  currentIndex: 0,
  flipped: false,
  currentQuestion: null,
  bookmarks: loadBookmarks(),
  showBookmarkList: true,
  bookmarkOnlySession: false,
  bookmarkDraftColor: 'sky',
  bookmarkDraftName: '',
  bookmarkUseName: false,
  bookmarkMenuOpen: false,
  cardTransitionLocked: false,
  orderMode: 'random',
  rangeMode: 'all',
  rangeInput: '',
};

// 3Dカードのスタッキングコンテキストから切り離し、クリックを確実に受け取れるようにする。
function mountBookmarkMenuPortal(){
  if(els.bookmarkMenu && els.bookmarkMenu.parentElement !== document.body){
    document.body.appendChild(els.bookmarkMenu);
  }
}

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
    try{ if(window.parent && window.parent !== window && window.parent.AppShell){ window.parent.AppShell.returnToMenu('flashcards'); return; } }catch(e){}
  }
  [els.homeScreen, els.quizScreen].forEach(el=>el.classList.remove('active'));
  if(name==='home') els.homeScreen.classList.add('active');
  if(name==='quiz') els.quizScreen.classList.add('active');
  if(name==='home') renderHome();
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

function displayJoined(value){
  const parts = [...new Set(splitByCommaOnly(value))];
  return parts.length ? parts.join(' / ') : '-';
}

function normalizeText(value){
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function loadBookmarks(){
  try{
    const raw = JSON.parse(safeLocalStorage.getItem(STORAGE_BOOKMARKS) || '[]');
    return Array.isArray(raw) ? raw : [];
  }catch{
    return [];
  }
}

function saveBookmarks(){
  safeLocalStorage.setItem(STORAGE_BOOKMARKS, JSON.stringify(state.bookmarks));
}

function bookmarkKey(item, patternKey){
  return [rowKey(item), patternKey].join('::');
}

function getSelectedPatterns(){
  return PATTERNS.filter(p=>state.selectedPatterns.has(p.key));
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

function buildQuestions(items, patterns, orderMode = state.orderMode){
  if(!items.length) throw new Error('問題の元データがありません。');
  if(!patterns.length) throw new Error('出題パターンを1つ以上選んでください。');
  if(state.bookmarkOnlySession){
    let bookmarked;
    const allowedItemKeys = new Set(items.map(rowKey));
    if(orderMode === 'ordered'){
      // 入力データの順番を優先し、同じ医薬品では選択パターン順に並べます。
      bookmarked = [];
      for(const item of items){
        for(const pattern of patterns){
          const entry = state.bookmarks.find(b => b.key === bookmarkKey(item, pattern.key));
          if(entry) bookmarked.push({ item: entry.item, pattern, fromBookmark: true });
        }
      }
    } else {
      bookmarked = shuffleArray(state.bookmarks
        .filter(b => allowedItemKeys.has(rowKey(b.item)) && patterns.some(p => p.key === b.patternKey))
        .map(b => ({ item: b.item, pattern: patterns.find(p => p.key === b.patternKey) || PATTERNS[0], fromBookmark: true })));
    }
    if(!bookmarked.length) throw new Error('ブックマークされたカードがありません。');
    return bookmarked;
  }
  const orderedItems = orderMode === 'ordered' ? [...items] : shuffleArray(items);
  return orderedItems.map(item=>({
    item,
    pattern: patterns[Math.floor(Math.random() * patterns.length)]
  }));
}

function isBookmarked(item, patternKey){
  return state.bookmarks.some(b => b.key === bookmarkKey(item, patternKey));
}

function getBookmark(item, patternKey){
  return state.bookmarks.find(b => b.key === bookmarkKey(item, patternKey)) || null;
}

function setBookmarkColor(item, patternKey, color, name = ''){
  const key = bookmarkKey(item, patternKey);
  const existing = state.bookmarks.find(b => b.key === key);
  const cleanName = String(name || '').trim().slice(0,40);
  if(existing){
    existing.color = COLOR_OPTIONS.includes(color) ? color : 'sky';
    if(cleanName) existing.name = cleanName;
    else delete existing.name;
    existing.updatedAt = new Date().toISOString();
  }else{
    const record = {
      key,
      color: COLOR_OPTIONS.includes(color) ? color : 'sky',
      item,
      patternKey,
      patternLabel: PATTERNS.find(p=>p.key === patternKey)?.label || patternKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if(cleanName) record.name = cleanName;
    state.bookmarks.unshift(record);
  }
  saveBookmarks();
}

function removeBookmark(item, patternKey){
  const key = bookmarkKey(item, patternKey);
  state.bookmarks = state.bookmarks.filter(b => b.key !== key);
  saveBookmarks();
}

function toggleBookmark(item, patternKey){
  const existing = getBookmark(item, patternKey);
  if(existing) removeBookmark(item, patternKey);
  else setBookmarkColor(item, patternKey, state.bookmarkDraftColor || 'sky');
}


function updateBookmarkSwatchSelection(){
  if(!els.bookmarkMenuSwatches) return;
  els.bookmarkMenuSwatches.querySelectorAll('.swatch[data-color]').forEach(btn=>{
    const active = btn.dataset.color === state.bookmarkDraftColor;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderBookmarkMenu(){
  els.bookmarkMenuSwatches.innerHTML = '';
  COLOR_OPTIONS.forEach(color=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch' + (state.bookmarkDraftColor === color ? ' active' : '');
    btn.dataset.color = color;
    btn.title = `${COLOR_META[color].label}（${color}）`;
    btn.setAttribute('aria-label', `${COLOR_META[color].label}色を選択`);
    btn.setAttribute('aria-pressed', state.bookmarkDraftColor === color ? 'true' : 'false');
    els.bookmarkMenuSwatches.appendChild(btn);
  });
}

function openBookmarkMenu(){
  if(!state.currentQuestion) return;
  const bm = getBookmark(state.currentQuestion.item, state.currentQuestion.pattern.key);
  state.bookmarkDraftColor = COLOR_OPTIONS.includes(bm?.color) ? bm.color : (COLOR_OPTIONS.includes(state.bookmarkDraftColor) ? state.bookmarkDraftColor : 'sky');
  state.bookmarkDraftName = bm?.name || '';
  state.bookmarkUseName = !!state.bookmarkDraftName;
  els.bookmarkMenuRemoveBtn.hidden = !bm;
  els.bookmarkNameEnabled.checked = state.bookmarkUseName;
  els.bookmarkNameInput.value = state.bookmarkDraftName;
  els.bookmarkNameInput.disabled = !state.bookmarkUseName;
  mountBookmarkMenuPortal();
  state.bookmarkMenuOpen = true;
  els.bookmarkMenu.hidden = false;
  els.bookmarkMenu.setAttribute('aria-hidden','false');
  renderBookmarkMenu();
  const selected = els.bookmarkMenuSwatches.querySelector(`[data-color="${state.bookmarkDraftColor}"]`);
  if(selected) selected.focus();
}

function closeBookmarkMenu(){
  state.bookmarkMenuOpen = false;
  els.bookmarkMenu.hidden = true;
  els.bookmarkMenu.setAttribute('aria-hidden','true');
}

function saveBookmarkFromMenu(){
  if(!state.currentQuestion) return;
  const name = state.bookmarkUseName ? els.bookmarkNameInput.value.trim().slice(0,40) : '';
  const selectedColor = COLOR_OPTIONS.includes(state.bookmarkDraftColor) ? state.bookmarkDraftColor : 'sky';
  setBookmarkColor(state.currentQuestion.item, state.currentQuestion.pattern.key, selectedColor, name);
  state.bookmarkDraftColor = selectedColor;
  state.bookmarkDraftName = name;
  closeBookmarkMenu();
  updateBookmarkUI();
  renderHome();
  syncParentBookmarkList();
}

function removeCurrentBookmarkFromCard(){
  if(!state.currentQuestion) return;
  const { item, pattern } = state.currentQuestion;
  const existing = getBookmark(item, pattern.key);
  if(!existing) return;
  removeBookmark(item, pattern.key);
  state.bookmarkDraftName = '';
  state.bookmarkUseName = false;
  closeBookmarkMenu();
  updateBookmarkUI();
  renderHome();
  syncParentBookmarkList();
}

function updateBookmarkUI(){
  if(!state.currentQuestion) return;
  const bm = getBookmark(state.currentQuestion.item, state.currentQuestion.pattern.key);
  const saved = !!bm;
  const color = bm?.color || state.bookmarkDraftColor || 'sky';
  const meta = bookmarkColorMeta(color);
  applyBookmarkButtonColor(els.bookmarkBtn, color, saved);
  applyBookmarkButtonColor(els.bookmarkBtnBack, color, saved);
  const nameLabel = bm?.name ? `「${bm.name}」` : '';
  els.bookmarkBtn.title = saved ? `保存済み ${nameLabel}（${meta.label}）。クリックして色変更または解除` : '未保存。クリックしてブックマークを追加';
  els.bookmarkBtnBack.title = els.bookmarkBtn.title;
  els.bookmarkBtn.setAttribute('aria-label', saved ? 'ブックマーク済み。設定を開く' : 'ブックマークを追加');
  els.bookmarkBtnBack.setAttribute('aria-label', els.bookmarkBtn.getAttribute('aria-label'));
  if(saved && !state.bookmarkMenuOpen) state.bookmarkDraftColor = color;
  if(state.bookmarkMenuOpen) updateBookmarkSwatchSelection();
  else renderBookmarkMenu();
}
function prepareSession(){
  const loaded = parseRows(els.dataInput.value);
  if(loaded.length) state.items = loaded;
  const patterns = getSelectedPatterns();
  if(!state.items.length){
    alert('データが読み込まれていません。販売名,一般名,薬効を貼り付けて読み込んでください。');
    return false;
  }
  if(!patterns.length){
    alert('出題パターンを1つ以上選んでください。');
    return false;
  }
  let selectedItems;
  try { selectedItems = selectRowsByRange(state.items); }
  catch(error) { alert(error.message || '行の範囲指定を確認してください。'); return false; }
  if(!selectedItems.length) { alert('指定範囲に該当する医薬品がありません。'); return false; }
  try { state.questions = buildQuestions(selectedItems, patterns, state.orderMode); }
  catch(error) { alert(error.message || '暗記カードを作成できませんでした。'); return false; }
  if(state.bookmarkOnlySession && !state.questions.length){
    alert('選択範囲内にブックマークされたカードがありません。');
    return false;
  }
  state.currentIndex = 0;
  state.flipped = false;
  state.currentQuestion = null;
  return true;
}

function startSession(){
  state.bookmarkOnlySession = els.bookmarkedOnlyStart.checked;
  if(!prepareSession()) return;
  showScreen('quiz');
  renderCard();
  updateActionButtonState();
}

function setCardFaceInstantly(flipped = false){
  state.cardTransitionLocked = true;
  els.flashcard.classList.add('no-transition');
  els.flashcard.classList.toggle('flipped', flipped);
  void els.flashcard.offsetHeight;
  requestAnimationFrame(() => {
    els.flashcard.classList.remove('no-transition');
    state.cardTransitionLocked = false;
  });
}

function renderCard(){
  const q = state.questions[state.currentIndex];
  if(!q) return;
  state.currentQuestion = q;
  state.flipped = false;
  setCardFaceInstantly(false);
  closeBookmarkMenu();
  els.quizCounter.textContent = `${state.currentIndex + 1} / ${state.questions.length}`;
  els.progressFill.style.width = `${(state.currentIndex / state.questions.length) * 100}%`;
  els.questionText.textContent = displayJoined(q.item[q.pattern.ask]);
  els.patternText.textContent = q.pattern.label;
  els.answerTitle.textContent = displayJoined(q.item[q.pattern.ans]);
  els.answerMeta.textContent = `出題元: ${displayJoined(q.pattern.ask)} → ${displayJoined(q.pattern.ans)}`;
  els.srcSales.textContent = displayJoined(q.item.salesName);
  els.srcGeneric.textContent = displayJoined(q.item.genericName);
  els.srcEffect.textContent = displayJoined(q.item.effect);
  updateBookmarkUI();
  updateActionButtonState();
}

function updateActionButtonState(){
  const hasQuestion = !!state.currentQuestion;
  els.mainActionBtn.disabled = !hasQuestion || state.flipped;
  els.mainActionBtn.textContent = '裏返す';
  els.mainActionBtn.classList.remove('next');
  els.mainActionBtn.classList.add('flip');

  els.prevBtn.disabled = !hasQuestion || state.currentIndex <= 0;
  els.nextBtn.disabled = !hasQuestion;
  els.nextBtn.textContent = (hasQuestion && state.currentIndex >= state.questions.length - 1) ? '終了' : '次へ進む';
}

function flipCard(){
  if(!state.currentQuestion) return;
  state.flipped = !state.flipped;
  els.flashcard.classList.toggle('flipped', state.flipped);
  updateActionButtonState();
}

function goPrevCard(){
  if(!state.currentQuestion || state.currentIndex <= 0) return;
  state.currentIndex -= 1;
  renderCard();
}

function goNextCard(){
  if(!state.currentQuestion) return;
  if(state.currentIndex >= state.questions.length - 1){
    finishSession();
    return;
  }
  state.currentIndex += 1;
  renderCard();
}

function finishSession(){
  state.currentQuestion = null;
  state.flipped = false;
  setCardFaceInstantly(false);
  alert('セッションを終了しました。');
  showScreen('home');
}

const BOOKMARK_PICKER_STYLE_ID = 'medicine-bookmark-color-picker-style';
const BOOKMARK_PICKER_CSS = `
.medicineBookmarkColorOverlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(15,23,42,.42);backdrop-filter:blur(4px)}
.medicineBookmarkColorOverlay[hidden]{display:none!important}
.medicineBookmarkColorDialog{width:min(360px,100%);padding:20px;border:1px solid #dbe7f3;border-radius:20px;background:#fff;color:#0f172a;box-shadow:0 20px 60px rgba(15,23,42,.25);font-family:system-ui,-apple-system,"Yu Gothic UI",Meiryo,sans-serif}
.medicineBookmarkColorDialog h2{margin:0 0 7px;font-size:1.08rem;font-weight:800}
.medicineBookmarkColorDialog p{margin:0 0 16px;color:#5b6b84;font-size:.88rem;line-height:1.55}
.medicineBookmarkColorPalette{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.medicineBookmarkColorChoice{min-height:76px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;border:1px solid #dbe7f3;border-radius:13px;background:#fff;color:#0f172a;font:inherit;font-size:.84rem;font-weight:750;cursor:pointer}
.medicineBookmarkColorChoice .medicineBookmarkColorCircle{width:27px;height:27px;border-radius:50%;background:var(--choice-color);border:2px solid rgba(15,23,42,.08);box-shadow:0 2px 6px rgba(15,23,42,.12)}
.medicineBookmarkColorChoice[aria-pressed="true"]{border:2px solid var(--choice-color);background:var(--choice-soft);box-shadow:0 0 0 2px rgba(15,23,42,.04)}
.medicineBookmarkColorActions{display:flex;justify-content:flex-end;gap:9px;margin-top:17px}
.medicineBookmarkColorActions button{border:1px solid #d5e3f3;border-radius:11px;padding:10px 16px;background:#f5f8fc;color:#0f172a;font:inherit;font-weight:750;cursor:pointer}
.medicineBookmarkColorActions button[data-save]{border-color:var(--choice-color,#0ea5e9);background:var(--choice-color,#0ea5e9);color:#fff}
`;

function ensureBookmarkColorPicker(doc){
  if(!doc || !doc.body) return null;
  if(!doc.getElementById(BOOKMARK_PICKER_STYLE_ID)){
    const style = doc.createElement('style');
    style.id = BOOKMARK_PICKER_STYLE_ID;
    style.textContent = BOOKMARK_PICKER_CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }
  let overlay = doc.getElementById('medicineBookmarkColorOverlay');
  if(overlay) return overlay;

  overlay = doc.createElement('div');
  overlay.id = 'medicineBookmarkColorOverlay';
  overlay.className = 'medicineBookmarkColorOverlay';
  overlay.hidden = true;
  overlay.setAttribute('role','presentation');
  const dialog = doc.createElement('section');
  dialog.className = 'medicineBookmarkColorDialog';
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-labelledby','medicineBookmarkColorTitle');
  const heading = doc.createElement('h2');
  heading.id = 'medicineBookmarkColorTitle';
  heading.textContent = 'ブックマークの色を選択';
  const note = doc.createElement('p');
  note.textContent = '色を選択して「保存」を押してください。何度でも変更できます。';
  const palette = doc.createElement('div');
  palette.className = 'medicineBookmarkColorPalette';
  palette.setAttribute('role','group');
  palette.setAttribute('aria-label','ブックマーク色');
  const actions = doc.createElement('div');
  actions.className = 'medicineBookmarkColorActions';
  const cancel = doc.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'キャンセル';
  const save = doc.createElement('button');
  save.type = 'button';
  save.dataset.save = 'true';
  save.textContent = '保存';
  actions.append(cancel, save);
  dialog.append(heading, note, palette, actions);
  overlay.appendChild(dialog);
  doc.body.appendChild(overlay);

  const picker = { overlay, dialog, palette, save, cancel, key:null, color:'sky', doc };
  overlay._medicineBookmarkPicker = picker;
  COLOR_OPTIONS.forEach(color=>{
    const meta = bookmarkColorMeta(color);
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'medicineBookmarkColorChoice';
    button.dataset.color = color;
    button.setAttribute('aria-pressed','false');
    button.setAttribute('aria-label',`${meta.label}色を選択`);
    button.style.setProperty('--choice-color',meta.accent);
    button.style.setProperty('--choice-soft',meta.soft);
    const circle = doc.createElement('span');
    circle.className = 'medicineBookmarkColorCircle';
    const label = doc.createElement('span');
    label.textContent = meta.label;
    button.append(circle,label);
    button.addEventListener('click',()=>{
      picker.color = color;
      updateBookmarkColorPickerSelection(picker);
    });
    palette.appendChild(button);
  });
  const close = ()=>{ picker.overlay.hidden = true; };
  cancel.addEventListener('click',close);
  overlay.addEventListener('click',event=>{ if(event.target === overlay) close(); });
  doc.addEventListener('keydown',event=>{
    if(event.key === 'Escape' && !picker.overlay.hidden) close();
  });
  save.addEventListener('click',()=>{
    const bm = state.bookmarks.find(entry=>entry.key === picker.key);
    if(!bm) { close(); return; }
    bm.color = COLOR_OPTIONS.includes(picker.color) ? picker.color : 'sky';
    bm.updatedAt = new Date().toISOString();
    saveBookmarks();
    if(state.currentQuestion && bookmarkKey(state.currentQuestion.item,state.currentQuestion.pattern.key) === bm.key){
      state.bookmarkDraftColor = bm.color;
      updateBookmarkUI();
    }
    close();
    renderHome();
    syncParentBookmarkList();
  });
  return overlay;
}

function updateBookmarkColorPickerSelection(picker){
  if(!picker) return;
  const meta = bookmarkColorMeta(picker.color);
  picker.palette.querySelectorAll('[data-color]').forEach(button=>{
    const active = button.dataset.color === picker.color;
    button.setAttribute('aria-pressed',active ? 'true' : 'false');
  });
  picker.save.style.setProperty('--choice-color',meta.accent);
}

function openBookmarkColorPicker(key, targetDoc = document){
  const bm = state.bookmarks.find(entry=>entry.key === key);
  if(!bm) return;
  const overlay = ensureBookmarkColorPicker(targetDoc);
  const picker = overlay?._medicineBookmarkPicker;
  if(!picker) return;
  picker.key = key;
  picker.color = COLOR_OPTIONS.includes(bm.color) ? bm.color : 'sky';
  updateBookmarkColorPickerSelection(picker);
  overlay.hidden = false;
  const selected = picker.palette.querySelector(`[data-color="${picker.color}"]`);
  if(selected) selected.focus();
}

function renderBookmarkList(){
  const list = [...state.bookmarks].slice(0, 200);
  els.bookmarkCountBadge.textContent = `${list.length}件`;
  els.bookmarkHomeArea.innerHTML = '';
  if(!list.length){
    els.bookmarkHomeArea.innerHTML = '<div class="muted">まだブックマークはありません。</div>';
    syncParentBookmarkList();
    return;
  }
  for(const b of list){
    const meta = bookmarkColorMeta(b.color);
    const item = document.createElement('div');
    item.className = 'item bookmarkListItem';
    item.style.background = meta.itemBg;
    item.style.borderColor = meta.border;
    item.style.borderLeftColor = meta.accent;
    item.innerHTML = `
      <div class="itemTop">
        <div>
          <div class="bookmarkListName">${escapeHtml(b.name || b.patternLabel || '問題')}</div>
          ${b.name ? `<div class="bookmarkListPattern">${escapeHtml(b.patternLabel || '出題形式')}</div>` : ''}
        </div>
        <span class="bookmarkColorBadge" style="background:${meta.soft};border-color:${meta.border};color:${meta.text}"><svg class="bookmarkColorIcon" viewBox="0 0 24 24" aria-hidden="true" style="fill:${meta.accent};stroke:${meta.accent}"><path d="M6 3.75A2.25 2.25 0 0 1 8.25 1.5h7.5A2.25 2.25 0 0 1 18 3.75v18l-6-3.75-6 3.75v-18Z"></path></svg>${meta.label}</span>
      </div>
      <div class="itemMeta">問題: ${escapeHtml(displayJoined(b.item?.[PATTERNS.find(p=>p.key===b.patternKey)?.ask || 'salesName']))}</div>
      <div class="itemMeta">答え: <b>${escapeHtml(displayJoined(b.item?.[PATTERNS.find(p=>p.key===b.patternKey)?.ans || 'genericName']))}</b></div>
      <div class="itemMeta">販売名: ${escapeHtml(displayJoined(b.item?.salesName))} / 一般名: ${escapeHtml(displayJoined(b.item?.genericName))} / 薬効: ${escapeHtml(displayJoined(b.item?.effect))}</div>
      <div class="row" style="margin-top:10px;">
        <button class="btn secondary" data-bookmark-name-edit="${escapeHtml(b.key)}">名前を編集</button>
        <button class="btn secondary" data-bookmark-edit="${escapeHtml(b.key)}">色を編集</button>
        <button class="btn danger" data-bookmark-remove="${escapeHtml(b.key)}">削除</button>
      </div>
    `;
    els.bookmarkHomeArea.appendChild(item);
  }
  els.bookmarkHomeArea.querySelectorAll('[data-bookmark-name-edit]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const key = btn.getAttribute('data-bookmark-name-edit');
      const bm = state.bookmarks.find(x=>x.key === key);
      if(!bm) return;
      const name = prompt('ブックマーク名を入力してください。空欄にすると名前なしになります。', bm.name || '');
      if(name === null) return;
      const cleanName = name.trim().slice(0,40);
      if(cleanName) bm.name = cleanName;
      else delete bm.name;
      bm.updatedAt = new Date().toISOString();
      saveBookmarks();
      renderHome();
      syncParentBookmarkList();
    });
  });
  els.bookmarkHomeArea.querySelectorAll('[data-bookmark-edit]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const key = btn.getAttribute('data-bookmark-edit');
      openBookmarkColorPicker(key, document);
    });
  });
  els.bookmarkHomeArea.querySelectorAll('[data-bookmark-remove]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const key = btn.getAttribute('data-bookmark-remove');
      state.bookmarks = state.bookmarks.filter(x=>x.key !== key);
      saveBookmarks();
      renderHome();
      syncParentBookmarkList();
      if(state.currentQuestion && bookmarkKey(state.currentQuestion.item, state.currentQuestion.pattern.key) === key) updateBookmarkUI();
    });
  });
  syncParentBookmarkList();
}

function syncParentBookmarkList(){
  // DOMのMutationObserverで親画面のボタンを置換すると、画面再描画時に
  // observer自身のDOM変更が連鎖して復帰処理を阻害することがあるため、親へ明示通知する。
  try{
    if(window.parent && window.parent !== window && window.parent.AppShell?.refreshBookmarkList){
      window.parent.AppShell.refreshBookmarkList();
    }
  }catch(error){ /* iframeを単独起動した場合は親画面同期を省略 */ }
}

function renderHome(){
  const loadedCount = state.items.length;
  els.loadStatus.textContent = loadedCount ? `${loadedCount}件のデータを読み込み済み` : '未読み込み';
  els.toggleBookmarkListBtn.textContent = state.showBookmarkList ? '表示 / 非表示' : '表示 / 非表示';
  els.bookmarkCountBadge.textContent = `${state.bookmarks.length}件`;
  if(state.showBookmarkList) renderBookmarkList();
  else els.bookmarkHomeArea.innerHTML = '<div class="muted">一覧は非表示です。「表示 / 非表示」で開けます。</div>';
}

function loadData(){
  state.items = parseRows(els.dataInput.value);
  els.loadStatus.textContent = state.items.length ? `${state.items.length}件のデータを読み込みました` : '読み込み失敗: 3列のデータが見つかりません';
  renderHome();
}

function handleMainAction(){
  if(!state.currentQuestion) return;
  flipCard();
}

function clearBookmarks(){
  if(!confirm('ブックマークをすべて消去しますか？')) return;
  state.bookmarks = [];
  saveBookmarks();
  renderHome();
  updateBookmarkUI();
}

function endSession(){
  if(confirm('セッションを終了してホームに戻りますか？')){
    finishSession();
  }
}

document.addEventListener('keydown', e=>{
  if(!els.quizScreen.classList.contains('active')) return;
  if(e.key === 'Enter'){
    e.preventDefault();
    flipCard();
  }else if(e.key === 'ArrowLeft'){
    e.preventDefault();
    goPrevCard();
  }else if(e.key === 'ArrowRight'){
    e.preventDefault();
    goNextCard();
  }
});

els.loadBtn.addEventListener('click', loadData);
els.startBtn.addEventListener('click', startSession);
els.orderModeSelect.addEventListener('change', ()=>{ state.orderMode = els.orderModeSelect.value === 'ordered' ? 'ordered' : 'random'; });
els.rangeModeSelect.addEventListener('change', syncRangeInput);
els.rangeInput.addEventListener('input', syncRangeInput);
els.toggleBookmarkListBtn.addEventListener('click', ()=>{
  state.showBookmarkList = !state.showBookmarkList;
  renderHome();
});
els.clearBookmarksBtn.addEventListener('click', clearBookmarks);
els.homeBtnTop.addEventListener('click', ()=>showScreen('home'));
els.endBtn.addEventListener('click', endSession);
els.mainActionBtn.addEventListener('click', handleMainAction);
els.flashcard.addEventListener('click', ()=>{
  if(!state.currentQuestion) return;
  flipCard();
});
els.prevBtn.addEventListener('click', goPrevCard);
els.nextBtn.addEventListener('click', goNextCard);
els.bookmarkBtn.addEventListener('click', (e)=>{
  e.stopPropagation();
  if(!state.currentQuestion) return;
  if(state.bookmarkMenuOpen) closeBookmarkMenu();
  else openBookmarkMenu();
});
els.bookmarkBtnBack.addEventListener('click', (e)=>{
  e.stopPropagation();
  if(!state.currentQuestion) return;
  if(state.bookmarkMenuOpen) closeBookmarkMenu();
  else openBookmarkMenu();
});
els.bookmarkMenuCloseBtn.addEventListener('click', closeBookmarkMenu);
els.bookmarkMenuSaveBtn.addEventListener('click', saveBookmarkFromMenu);
els.bookmarkMenuRemoveBtn.addEventListener('click', removeCurrentBookmarkFromCard);
els.bookmarkMenuSwatches.addEventListener('click', event=>{
  const button = event.target.closest('button.swatch[data-color]');
  if(!button || !els.bookmarkMenuSwatches.contains(button)) return;
  event.preventDefault();
  event.stopPropagation();
  const color = button.dataset.color;
  if(!COLOR_OPTIONS.includes(color)) return;
  state.bookmarkDraftColor = color;
  updateBookmarkSwatchSelection();
});
els.bookmarkMenu.addEventListener('click', event=>{
  if(event.target === els.bookmarkMenu) closeBookmarkMenu();
});
els.bookmarkNameEnabled.addEventListener('change',()=>{
  state.bookmarkUseName = els.bookmarkNameEnabled.checked;
  els.bookmarkNameInput.disabled = !state.bookmarkUseName;
  if(state.bookmarkUseName) els.bookmarkNameInput.focus();
});
els.bookmarkNameInput.addEventListener('input',()=>{
  state.bookmarkDraftName = els.bookmarkNameInput.value.slice(0,40);
});
document.addEventListener('click', e=>{
  if(!state.bookmarkMenuOpen) return;
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  const clickedInside = path.includes(els.bookmarkMenu) || path.includes(els.bookmarkBtn) || path.includes(els.bookmarkBtnBack)
    || els.bookmarkMenu.contains(e.target) || els.bookmarkBtn.contains(e.target) || els.bookmarkBtnBack.contains(e.target);
  if(!clickedInside) closeBookmarkMenu();
});
document.addEventListener('keydown', e=>{
  if(state.bookmarkMenuOpen && e.key === 'Escape'){
    e.preventDefault();
    closeBookmarkMenu();
  }
});
els.toggleBookmarkOnlyBtn.addEventListener('click', ()=>{
  state.bookmarkOnlySession = !state.bookmarkOnlySession;
  els.bookmarkedOnlyStart.checked = state.bookmarkOnlySession;
  els.toggleBookmarkOnlyBtn.textContent = `保存済みのみで開始: ${state.bookmarkOnlySession ? 'ON' : 'OFF'}`;
});


renderPatternCheckboxes();
syncRangeInput();
renderBookmarkMenu();
els.toggleBookmarkOnlyBtn.textContent = `保存済みのみで開始: ${state.bookmarkOnlySession ? 'ON' : 'OFF'}`;
renderHome();
mountBookmarkMenuPortal();

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
  launch(data, patterns, bookmarkedOnly, orderMode = state.orderMode, rangeMode = 'all', rangeInput = ''){
    this.setSetup(data, patterns, orderMode, rangeMode, rangeInput);
    els.bookmarkedOnlyStart.checked = !!bookmarkedOnly;
    state.bookmarkOnlySession = !!bookmarkedOnly;
    startSession();
  },
  refresh(){ renderHome(); },
  getBookmarks(){ return state.bookmarks.map(b=>JSON.parse(JSON.stringify(b))); },
  openBookmarkColorPicker(key, targetDoc){ openBookmarkColorPicker(key, targetDoc || document); return true; },
  editBookmark(key, color, name){
    if(!COLOR_OPTIONS.includes(color)) return false;
    const bm = state.bookmarks.find(x=>x.key===key);
    if(!bm) return false;
    bm.color = color;
    if(name !== undefined){ const clean=String(name || '').trim().slice(0,40); if(clean) bm.name=clean; else delete bm.name; }
    bm.updatedAt = new Date().toISOString();
    saveBookmarks(); renderHome(); updateBookmarkUI(); syncParentBookmarkList(); return true;
  },
  renameBookmark(key, name){
    const bm = state.bookmarks.find(x=>x.key===key);
    if(!bm) return false;
    const clean=String(name || '').trim().slice(0,40);
    if(clean) bm.name=clean; else delete bm.name;
    bm.updatedAt = new Date().toISOString();
    saveBookmarks(); renderHome(); syncParentBookmarkList(); return true;
  },
  removeBookmark(key){
    state.bookmarks = state.bookmarks.filter(x=>x.key!==key);
    saveBookmarks(); renderHome(); updateBookmarkUI(); syncParentBookmarkList();
  },
  clearBookmarks(){ state.bookmarks=[]; saveBookmarks(); renderHome(); updateBookmarkUI(); syncParentBookmarkList(); }
};
