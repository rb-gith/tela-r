'use strict';

/* =========================================================
   Tela — a simple catalogue for artworks (PWA)
   Pieces and photos live in this device's IndexedDB,
   settings in its localStorage. Nothing is sent anywhere.
   ========================================================= */

const DB_NAME = 'tela', DB_VERSION = 1;
const SETTINGS_KEY = 'tela-settings';
const STATUSES = ['available', 'sold', 'gifted', 'kept'];
const UNITS = ['cm', 'in'];
const FULL_SIDE = 2000, FULL_QUALITY = 0.88;
const THUMB_SIDE = 640, THUMB_QUALITY = 0.8;
const BACKUP_AFTER_DAYS = 30;
const DATA_FILE = 'tela-data.json';
const COFFEE_URL = 'https://buymeacoffee.com/gionzana';
const GITHUB_URL = 'https://github.com/rb-gith?tab=repositories';

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const tr = (key, ...args) => args.reduce((s, a) => s.replace('{}', () => a), TEXT[key]);
/* Accents are ignored, so "acrilico" also finds "acrílico" */
const plain = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ---------- Dates ---------- */
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const daysSince = k => Math.round((dateOf(todayKey()) - dateOf(k)) / 864e5);
const isDate = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

/* ---------- Settings ---------- */
function cleanSettings(s) {
  s = s && typeof s === 'object' ? s : {};
  return {
    artist: typeof s.artist === 'string' ? s.artist.slice(0, 80) : BRAND.defaultArtist,
    unit: UNITS.includes(s.unit) ? s.unit : 'cm',
    firstUsed: isDate(s.firstUsed) ? s.firstUsed : null,
    lastChange: isDate(s.lastChange) ? s.lastChange : null,
    lastBackup: isDate(s.lastBackup) ? s.lastBackup : null,
    snoozeUntil: isDate(s.snoozeUntil) ? s.snoozeUntil : null,
  };
}
let settings = cleanSettings(null);
try { settings = cleanSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY))); } catch (e) { /* use the defaults */ }
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
}
function markChanged() {
  const t = todayKey();
  settings.lastChange = t;
  if (!settings.firstUsed) settings.firstUsed = t;
  saveSettings();
}

/* ---------- Storage: pieces, full photos and thumbnails ---------- */
let db;
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('pieces', { keyPath: 'id' });
      d.createObjectStore('full');
      d.createObjectStore('thumbs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const STORES = ['pieces', 'full', 'thumbs'];
function write(fill) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    fill(tx);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function request(store, method, ...args) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store)[method](...args);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function allThumbs() {
  return new Promise((resolve, reject) => {
    const found = new Map();
    const req = db.transaction('thumbs').objectStore('thumbs').openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(found); return; }
      found.set(cur.key, cur.value);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/* In memory: the pieces' details and a picture address for each thumbnail */
let pieces = [];
const thumbUrls = new Map();
function setThumb(id, blob) {
  if (thumbUrls.has(id)) URL.revokeObjectURL(thumbUrls.get(id));
  thumbUrls.set(id, URL.createObjectURL(blob));
}
function clearThumbs() {
  thumbUrls.forEach(u => URL.revokeObjectURL(u));
  thumbUrls.clear();
}
const pieceById = id => pieces.find(p => p.id === id);
const newestFirst = (a, b) => b.created - a.created;

/* Everything read from a backup file is reduced to known fields and types */
function cleanPiece(p) {
  const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const size = v => Number.isFinite(v) && v > 0 ? v : null;
  return {
    id: String(p.id || uid()),
    title: text(p.title, 200),
    technique: text(p.technique, 200),
    height: size(p.height),
    width: size(p.width),
    unit: UNITS.includes(p.unit) ? p.unit : 'cm',
    year: Number.isInteger(p.year) && p.year > 0 ? p.year : null,
    status: STATUSES.includes(p.status) ? p.status : 'available',
    series: text(p.series, 200),
    location: text(p.location, 200),
    notes: typeof p.notes === 'string' ? p.notes : '',
    w: Number(p.w) > 0 ? Number(p.w) : 1,
    h: Number(p.h) > 0 ? Number(p.h) : 1,
    created: Number(p.created) || Date.now(),
  };
}

/* ---------- Photos: resized once, when they are added ---------- */
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}
function resizeTo(img, side, quality) {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => {
    c.toBlob(b => b ? resolve({ blob: b, w: c.width, h: c.height }) : reject(new Error('resize failed')), 'image/jpeg', quality);
  });
}
async function processPhoto(file) {
  const { img, url } = await loadImage(file);
  try {
    const full = await resizeTo(img, FULL_SIDE, FULL_QUALITY);
    const thumb = await resizeTo(img, THUMB_SIDE, THUMB_QUALITY);
    return { full: full.blob, thumb: thumb.blob, w: full.w, h: full.h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function thumbFrom(blob) {
  const { img, url } = await loadImage(blob);
  try { return { thumb: (await resizeTo(img, THUMB_SIDE, THUMB_QUALITY)).blob, w: img.naturalWidth, h: img.naturalHeight }; }
  finally { URL.revokeObjectURL(url); }
}

/* ---------- Navigation: each page is a history entry, so the phone's back button works ---------- */
const ui = { route: null, query: '', status: null, y: 0, filtersX: 0, draft: null, justAdded: null, fullUrl: null, card: null };
history.scrollRestoration = 'manual';
const depth = () => (history.state && history.state.d) || 0;
function go(hash) {
  history.pushState({ d: depth() + 1 }, '', '#' + hash);
  render();
}
function back() {
  if (depth() > 0) { history.back(); return; }
  history.replaceState({ d: 0 }, '', location.pathname + location.search);
  render();
}
function goHome() {
  const d = depth();
  if (d > 0) { history.go(-d); return; }
  history.replaceState({ d: 0 }, '', location.pathname + location.search);
  render();
}
addEventListener('popstate', render);

function currentRoute() {
  const [name, arg] = location.hash.slice(1).split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : null };
}

/* ---------- Rendering ---------- */
const app = $('#app');
function render() {
  if (!db) return;
  const key = location.hash;
  const sameRoute = key === ui.route;
  const y = scrollY;
  if (ui.route === '') {
    ui.y = y;
    const f = $('.filters');
    if (f) ui.filtersX = f.scrollLeft;
  }
  if (!sameRoute && viewer.open) viewer.close();

  const { name, arg } = currentRoute();
  const piece = arg && pieceById(arg);
  if (name === 'add') app.innerHTML = formHtml(null);
  else if (name === 'edit' && piece) app.innerHTML = formHtml(piece);
  else if (name === 'piece' && piece) app.innerHTML = pieceHtml(piece);
  else if (name === 'settings') app.innerHTML = settingsHtml();
  else if (name === 'home') app.innerHTML = homeHtml();
  else { back(); return; }
  ui.route = key;

  if (name === 'home') {
    const f = $('.filters');
    if (f) f.scrollLeft = ui.filtersX;
    scrollTo(0, sameRoute ? y : ui.justAdded ? 0 : ui.y);
    ui.justAdded = null;
  } else {
    scrollTo(0, sameRoute ? y : 0);
  }
  if (name !== 'add' && name !== 'edit') ui.draft = null;
  if (name === 'piece') showFullPhoto(piece); else dropFullPhoto();
  if (name === 'settings') showStorageUse();
}

const creditHtml = () => `<footer class="credit">
  <p>${tr('madeBy')} · <a href="${COFFEE_URL}" target="_blank" rel="noopener">${tr('coffee')}</a></p>
  <p>${tr('moreApps', `<a href="${GITHUB_URL}" target="_blank" rel="noopener">${tr('github')}</a>`)}</p>
</footer>`;

/* ---------- Gallery ---------- */
function homeHtml() {
  const pills = [null, ...STATUSES].map(s => `<button class="pill" data-act="status-filter" data-status="${s || ''}" aria-pressed="${ui.status === s}">${tr(s ? 'status_' + s : 'all')}</button>`).join('');
  return `<div class="view">
    <header class="topbar">
      <h1><img class="logo" src="${BRAND.logo}" alt="${esc(BRAND.logoAlt)}"></h1>
      <button class="icon-btn" data-act="settings" aria-label="${tr('settings')}">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2.2" /><circle cx="10" cy="17" r="2.2" /></svg>
      </button>
    </header>
    ${noticeHtml()}
    ${pieces.length ? `<input class="field-search" type="search" id="search" value="${esc(ui.query)}" placeholder="${tr('search')}" aria-label="${tr('search')}">
      <div class="pills filters" role="group" aria-label="${tr('statuses')}">${pills}</div>` : ''}
    <div id="gallery">${galleryHtml()}</div>
    ${creditHtml()}
  </div>
  <button class="fab" data-act="add">${tr('addPiece')}</button>`;
}
function matches(p) {
  if (ui.status && p.status !== ui.status) return false;
  const term = plain(ui.query.trim());
  return !term || plain(`${p.title} ${p.technique} ${p.series}`).includes(term);
}
/* Each piece goes into the shorter column, so the two stay balanced and nothing is cropped */
function galleryHtml() {
  if (!pieces.length) return `<div class="empty"><h2>${tr('emptyTitle')}</h2><p>${tr('emptyText')}</p></div>`;
  const list = pieces.filter(matches).sort(newestFirst);
  if (!list.length) return `<p class="none">${tr('noResults')}</p>`;
  const cols = [[], []], heights = [0, 0];
  list.forEach(p => {
    const i = heights[0] <= heights[1] ? 0 : 1;
    cols[i].push(p);
    heights[i] += p.h / p.w + 0.2;
  });
  const card = p => `<button class="card" data-act="open" data-id="${esc(p.id)}">
    <img src="${thumbUrls.get(p.id) || ''}" width="${p.w}" height="${p.h}" alt="" loading="lazy"><span>${esc(p.title)}</span></button>`;
  return `<p class="count">${list.length === 1 ? tr('countOne') : tr('countMany', list.length)}</p>
    <div class="columns">${cols.map(c => `<div class="column">${c.map(card).join('')}</div>`).join('')}</div>`;
}
function backupDue() {
  if (!pieces.length || !settings.lastChange) return false;
  const t = todayKey();
  if (settings.snoozeUntil && t < settings.snoozeUntil) return false;
  if (settings.lastBackup && settings.lastChange <= settings.lastBackup) return false;
  return daysSince(settings.lastBackup || settings.firstUsed || t) >= BACKUP_AFTER_DAYS;
}
function noticeHtml() {
  if (!backupDue()) return '';
  return `<div class="notice"><p>${settings.lastBackup ? tr('backupOld', daysSince(settings.lastBackup)) : tr('backupNever')}</p><div>
    <button class="btn small" data-act="snooze">${tr('later')}</button>
    <button class="btn small primary" data-act="export">${tr('backupNow')}</button>
  </div></div>`;
}

/* ---------- Piece page: a museum label under the picture ---------- */
const sizeText = p => p.height && p.width ? `${p.height} × ${p.width} ${p.unit}` : p.height ? `${p.height} ${p.unit}` : p.width ? `${p.width} ${p.unit}` : '';
/* The details that may leave the phone on a shared card */
const publicLine = p => [p.year, p.technique, sizeText(p)].filter(Boolean).join(' · ');

function pieceHtml(p) {
  const line = publicLine(p);
  const extra = (key, value) => value ? `<p class="label">${tr(key)}</p><p class="value">${esc(value)}</p>` : '';
  return `<div class="view">
    <header class="topbar">
      <button class="icon-btn" data-act="back" aria-label="${tr('back')}">‹</button>
      <button class="link-btn" data-act="edit">${tr('edit')}</button>
    </header>
    <button class="picture" data-act="full" aria-label="${tr('openFull')}">
      <img id="piece-photo" src="${thumbUrls.get(p.id) || ''}" width="${p.w}" height="${p.h}" alt="${esc(p.title)}">
    </button>
    <h2 class="piece-title">${esc(p.title)}</h2>
    ${line ? `<p class="piece-meta">${esc(line)}</p>` : ''}
    <p class="piece-status"><span class="pill">${tr('status_' + p.status)}</span></p>
    ${extra('series', p.series)}${extra('location', p.location)}${extra('notes', p.notes)}
    <div class="btns"><button class="btn primary wide" data-act="share">${tr('share')}</button></div>
  </div>`;
}
function dropFullPhoto() {
  if (ui.fullUrl) URL.revokeObjectURL(ui.fullUrl.url);
  ui.fullUrl = null;
  ui.card = null;
}
/* The large photo replaces the thumbnail, and the share card gets ready, as soon as they load */
async function showFullPhoto(p) {
  if (ui.fullUrl && ui.fullUrl.id === p.id) {
    const shown = $('#piece-photo');
    if (shown) shown.src = ui.fullUrl.url;
    return;
  }
  dropFullPhoto();
  const blob = await request('full', 'get', p.id);
  if (!blob || currentRoute().arg !== p.id) return;
  dropFullPhoto();
  ui.fullUrl = { id: p.id, url: URL.createObjectURL(blob) };
  const shown = $('#piece-photo');
  if (shown) shown.src = ui.fullUrl.url;
  ui.card = makeCard(p, blob).catch(() => null);
}

/* ---------- Shared picture card ---------- */
function wrapText(x, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (line && x.measureText(next).width > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
async function makeCard(p, blob) {
  const W = 1080, M = 60, GAP = 12, MAX_PICTURE = 1300;
  const { img, url } = await loadImage(blob);
  try {
    const text = W - M * 2;
    let pw = text, ph = text * img.naturalHeight / img.naturalWidth;
    if (ph > MAX_PICTURE) { pw = pw * MAX_PICTURE / ph; ph = MAX_PICTURE; }
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    const titleFont = '400 60px Georgia, "Noto Serif", serif', metaFont = '400 34px Georgia, "Noto Serif", serif', artistFont = '400 36px Georgia, "Noto Serif", serif';
    x.font = titleFont;
    const titleLines = wrapText(x, p.title, text);
    x.font = metaFont;
    const metaLines = wrapText(x, publicLine(p), text);
    const artist = settings.artist.trim();
    let h = M + ph + 54 + titleLines.length * 70 + GAP;
    h += metaLines.length * 46;
    if (artist) h += 34 + 46;
    h += M;
    c.width = W;
    c.height = Math.ceil(h);
    x.fillStyle = '#F7F2EA';
    x.fillRect(0, 0, c.width, c.height);

    const px = (W - pw) / 2;
    x.save();
    x.beginPath();
    x.roundRect(px, M, pw, ph, 18);
    x.clip();
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, px, M, pw, ph);
    x.restore();

    let y = M + ph + 54;
    x.textBaseline = 'top';
    x.fillStyle = '#2E1A47';
    x.font = titleFont;
    titleLines.forEach(l => { x.fillText(l, M, y); y += 70; });
    y += GAP;
    x.fillStyle = '#6C6C6A';
    x.font = metaFont;
    metaLines.forEach(l => { x.fillText(l, M, y); y += 46; });
    if (artist) {
      y += 34;
      x.fillStyle = '#2E1A47';
      x.font = artistFont;
      x.fillText(artist, M, y);
      const dotX = M + x.measureText(artist).width + 20;
      x.fillStyle = '#F2994A';
      x.beginPath();
      x.arc(dotX, y + 27, 8, 0, Math.PI * 2);
      x.fill();
    }
    return await new Promise((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('card failed')), 'image/jpeg', 0.92));
  } finally {
    URL.revokeObjectURL(url);
  }
}
const slug = s => plain(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'piece';
function saveFile(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function sharePiece(p) {
  toast(tr('preparingCard'));
  try {
    const blob = await (ui.card || request('full', 'get', p.id).then(b => makeCard(p, b)));
    if (!blob) throw new Error('no card');
    const name = `${slug(p.title)}.jpg`;
    const file = new File([blob], name, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      hideToast();
      await navigator.share({ files: [file] });
    } else {
      saveFile(blob, name);
      toast(tr('cardSaved'));
    }
  } catch (e) {
    if (e.name === 'AbortError') hideToast(); else toast(tr('shareFailed'));
  }
}

/* ---------- Add or edit a piece ---------- */
const distinct = key => [...new Set(pieces.map(p => p[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const listHtml = (id, key) => `<datalist id="${id}">${distinct(key).map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;

function formHtml(p) {
  const isNew = !p;
  const unit = isNew ? settings.unit : p.unit;
  const status = isNew ? 'available' : p.status;
  const v = key => isNew || p[key] == null ? '' : esc(p[key]);
  const statusChoices = STATUSES.map(s => `<label class="choice"><input type="radio" name="status" value="${s}" ${s === status ? 'checked' : ''}><span class="pill">${tr('status_' + s)}</span></label>`).join('');
  const unitChoices = UNITS.map(u => `<label class="choice"><input type="radio" name="unit" value="${u}" ${u === unit ? 'checked' : ''}><span class="pill">${u}</span></label>`).join('');
  const photo = isNew
    ? `<button type="button" class="photo-pick" data-act="pick-photo" id="photo-pick">${tr('photo')}</button><p class="photo-note" id="photo-note" data-act="pick-photo" hidden>${tr('changePhoto')}</p>`
    : `<button type="button" class="photo-pick has-photo" data-act="pick-photo" id="photo-pick"><img src="${thumbUrls.get(p.id) || ''}" alt=""></button><p class="photo-note" id="photo-note" data-act="pick-photo">${tr('changePhoto')}</p>`;
  return `<div class="view"><form id="piece-form" data-id="${isNew ? '' : esc(p.id)}">
    <header class="topbar">
      <button type="button" class="icon-btn" data-act="back" aria-label="${tr('back')}">‹</button>
      <h1>${tr(isNew ? 'newPiece' : 'editPiece')}</h1>
    </header>
    ${photo}
    <label class="field"><span>${tr('title')}</span>
      <input type="text" name="title" value="${v('title')}" maxlength="200" required pattern=".*\\S.*" title="${tr('titleError')}" autocomplete="off"></label>
    <label class="field"><span>${tr('technique')}</span>
      <input type="text" name="technique" value="${v('technique')}" maxlength="200" list="list-technique" autocomplete="off"></label>
    <div class="group"><span class="field-label">${tr('size')}</span><div class="size-row">
      <label class="field"><span>${tr('height')}</span><input type="number" name="height" value="${v('height')}" min="0.1" max="99999" step="any" inputmode="decimal"></label>
      <span class="times">×</span>
      <label class="field"><span>${tr('width')}</span><input type="number" name="width" value="${v('width')}" min="0.1" max="99999" step="any" inputmode="decimal"></label>
      <div class="pills">${unitChoices}</div>
    </div></div>
    <label class="field year-field"><span>${tr('year')}</span>
      <input type="number" name="year" value="${v('year')}" min="1" max="9999" step="1" inputmode="numeric"></label>
    <div class="group"><span class="field-label">${tr('status')}</span><div class="pills">${statusChoices}</div></div>
    <label class="field"><span>${tr('series')}</span>
      <input type="text" name="series" value="${v('series')}" maxlength="200" list="list-series" autocomplete="off"></label>
    <label class="field"><span>${tr('location')}</span>
      <input type="text" name="location" value="${v('location')}" maxlength="200" list="list-location" autocomplete="off"></label>
    <label class="field"><span>${tr('notes')}</span><textarea name="notes" rows="3">${v('notes')}</textarea></label>
    <div class="btns">
      ${isNew ? '' : `<button type="button" class="btn danger" data-act="delete">${tr('delete')}</button>`}
      <button class="btn primary grow">${tr('save')}</button>
    </div>
    ${listHtml('list-technique', 'technique')}${listHtml('list-series', 'series')}${listHtml('list-location', 'location')}
  </form></div>`;
}

async function choosePhoto(file) {
  const pick = $('#photo-pick');
  if (!file || !pick) return;
  toast(tr('preparingPhoto'));
  try {
    const draft = await processPhoto(file);
    ui.draft = draft;
    const url = URL.createObjectURL(draft.thumb);
    const shown = $('#photo-pick');
    if (shown) {
      shown.classList.add('has-photo');
      shown.innerHTML = `<img src="${url}" alt="">`;
      shown.querySelector('img').addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      $('#photo-note').hidden = false;
    }
    hideToast();
  } catch (e) {
    toast(tr('photoFailed'));
  }
}

async function submitPiece(form) {
  const d = new FormData(form);
  const id = form.dataset.id;
  const old = id && pieceById(id);
  if (!old && !ui.draft) { toast(tr('photoRequired')); return; }
  const num = key => { const v = parseFloat(d.get(key)); return v > 0 ? v : null; };
  const piece = cleanPiece({
    id: old ? old.id : uid(),
    title: d.get('title'),
    technique: d.get('technique'),
    height: num('height'),
    width: num('width'),
    unit: d.get('unit'),
    year: parseInt(d.get('year'), 10) || null,
    status: d.get('status'),
    series: d.get('series'),
    location: d.get('location'),
    notes: d.get('notes').trim(),
    w: ui.draft ? ui.draft.w : old.w,
    h: ui.draft ? ui.draft.h : old.h,
    created: old ? old.created : Date.now(),
  });
  const draft = ui.draft;
  try {
    await write(tx => {
      tx.objectStore('pieces').put(piece);
      if (draft) {
        tx.objectStore('full').put(draft.full, piece.id);
        tx.objectStore('thumbs').put(draft.thumb, piece.id);
      }
    });
  } catch (e) {
    toast(tr('saveFailed'));
    return;
  }
  if (old) pieces[pieces.indexOf(old)] = piece; else pieces.push(piece);
  if (draft) setThumb(piece.id, draft.thumb);
  settings.unit = piece.unit;
  markChanged();
  ui.draft = null;
  if (old) dropFullPhoto();
  else {
    ui.justAdded = piece.id;
    /* Ask the browser not to clear the catalogue when the phone runs low on space */
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  toast(tr('saved'));
  back();
}

async function deletePiece(p) {
  if (!confirm(tr('confirmDelete', p.title))) return;
  try {
    await write(tx => STORES.forEach(s => tx.objectStore(s).delete(p.id)));
  } catch (e) {
    toast(tr('saveFailed'));
    return;
  }
  pieces = pieces.filter(x => x !== p);
  if (thumbUrls.has(p.id)) { URL.revokeObjectURL(thumbUrls.get(p.id)); thumbUrls.delete(p.id); }
  markChanged();
  toast(tr('deleted'));
  goHome();
}

/* ---------- Settings ---------- */
function settingsHtml() {
  const demo = /[?&]demo\b/.test(location.search);
  return `<div class="view settings">
    <header class="topbar">
      <button class="icon-btn" data-act="back" aria-label="${tr('back')}">‹</button>
      <h1>${tr('settings')}</h1>
    </header>
    <h3>${tr('artist')}</h3>
    <p class="note">${tr('artistNote')}</p>
    <label class="field" style="margin-top:0"><input type="text" id="artist" value="${esc(settings.artist)}" maxlength="80" aria-label="${tr('artist')}" autocomplete="off"></label>
    <h3>${tr('backup')}</h3>
    <p class="note">${tr('backupNote')}${settings.lastBackup ? ' ' + tr('backupLast', dateOf(settings.lastBackup).toLocaleDateString('en-GB', { dateStyle: 'medium' })) : ''}</p>
    <p class="note" id="storage-use" hidden></p>
    <div class="btns">
      <button class="btn primary" data-act="export">${tr('export')}</button>
      <label class="btn">${tr('import')}<input type="file" accept=".zip,application/zip,application/x-zip-compressed" id="import-file" hidden></label>
    </div>
    ${demo ? `<h3>${tr('demo')}</h3><div class="btns">
      <button class="btn" data-act="demo">${tr('loadSample')}</button>
      <button class="btn danger" data-act="reset">${tr('resetAll')}</button></div>` : ''}
    ${creditHtml()}
  </div>`;
}
async function showStorageUse() {
  if (!navigator.storage || !navigator.storage.estimate || !pieces.length) return;
  try {
    const { usage } = await navigator.storage.estimate();
    const el = $('#storage-use');
    if (el && usage) { el.textContent = tr('storageUsed', Math.max(1, Math.round(usage / 1e6))); el.hidden = false; }
  } catch (e) { /* the number is only a nicety */ }
}

/* ---------- Export and restore: one ZIP does both ---------- */
const csvCell = v => {
  let s = v == null ? '' : String(v);
  /* Stop a spreadsheet from running a title like =SUM(...) as a formula */
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function imageNames(list) {
  const names = new Map();
  list.forEach((p, i) => names.set(p.id, `images/${String(i + 1).padStart(3, '0')}-${slug(p.title)}.jpg`));
  return names;
}
function csvFor(list, names) {
  const head = ['Title', 'Technique', 'Height', 'Width', 'Unit', 'Year', 'Status', 'Series', 'Location', 'Notes', 'Image'];
  const rows = list.map(p => [p.title, p.technique, p.height, p.width, p.height || p.width ? p.unit : '', p.year, tr('status_' + p.status), p.series, p.location, p.notes, names.get(p.id)]);
  /* The mark at the start tells Excel to read accents correctly */
  return '﻿' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
}
async function exportZip() {
  const list = pieces.slice().sort((a, b) => a.created - b.created);
  const names = imageNames(list);
  const stamp = todayKey();
  try {
    toast(tr('exporting', 0, list.length));
    const files = [];
    for (const p of list) {
      const blob = await request('full', 'get', p.id);
      if (blob) files.push({ name: names.get(p.id), blob });
    }
    const data = {
      app: 'tela',
      version: 1,
      settings: { artist: settings.artist, unit: settings.unit },
      pieces: list.map(p => Object.assign({}, p, { image: names.get(p.id) })),
    };
    files.push({ name: 'catalogue.csv', blob: new Blob([csvFor(list, names)], { type: 'text/csv' }) });
    files.push({ name: DATA_FILE, blob: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }) });
    const zip = await ZIP.write(files, (done, total) => toast(tr('exporting', Math.min(done, list.length), list.length)));
    saveFile(zip, `tela-${stamp}.zip`);
    settings.lastBackup = stamp;
    settings.snoozeUntil = null;
    saveSettings();
    toast(tr('exported'));
    render();
    return zip;
  } catch (e) {
    toast(tr('exportFailed'));
    return null;
  }
}
async function importZip(file) {
  let data, entries;
  try {
    entries = await ZIP.read(file);
    if (!entries.has(DATA_FILE)) throw new Error('no data');
    data = JSON.parse(await (await entries.get(DATA_FILE)()).text());
    if (!data || data.app !== 'tela' || !Array.isArray(data.pieces)) throw new Error('bad data');
  } catch (e) {
    toast(tr('notBackup'));
    return;
  }
  const label = data.pieces.length === 1 ? tr('countOne') : tr('countMany', data.pieces.length);
  if (!confirm(tr('confirmImport', label))) return;

  const restored = [];
  let skipped = 0;
  try {
    for (let i = 0; i < data.pieces.length; i++) {
      toast(tr('importing', i + 1, data.pieces.length));
      const raw = data.pieces[i];
      const getImage = raw && typeof raw.image === 'string' && entries.get(raw.image);
      const piece = raw && typeof raw.title === 'string' && raw.title.trim() && cleanPiece(raw);
      if (!getImage || !piece) { skipped++; continue; }
      try {
        const full = new Blob([await getImage()], { type: 'image/jpeg' });
        const { thumb, w, h } = await thumbFrom(full);
        restored.push({ piece: Object.assign(piece, { w, h }), full, thumb });
      } catch (e) {
        skipped++;
      }
    }
    await write(tx => {
      STORES.forEach(s => tx.objectStore(s).clear());
      restored.forEach(r => {
        tx.objectStore('pieces').put(r.piece);
        tx.objectStore('full').put(r.full, r.piece.id);
        tx.objectStore('thumbs').put(r.thumb, r.piece.id);
      });
    });
  } catch (e) {
    toast(tr('saveFailed'));
    return;
  }
  clearThumbs();
  pieces = restored.map(r => r.piece);
  restored.forEach(r => setThumb(r.piece.id, r.thumb));
  const incoming = cleanSettings(Object.assign({}, data.settings));
  settings.artist = incoming.artist;
  settings.unit = incoming.unit;
  markChanged();
  settings.lastBackup = todayKey();
  saveSettings();
  ui.query = '';
  ui.status = null;
  toast(skipped ? tr('importedSkipped', skipped) : tr('imported'));
  render();
}

/* Sample pieces for trying the app (only reachable with ?demo in the URL) */
async function loadDemo(count = 12, side = FULL_SIDE) {
  if (!confirm(tr('confirmDemo'))) return;
  const colors = ['#6F7393', '#E8DCC8', '#2E1F55', '#D9A441', '#A7B1A2', '#C98B7B', '#3F5E73', '#8C5A6E'];
  const shapes = [[3, 4], [4, 3], [1, 1], [2, 3], [3, 2], [4, 5]];
  const techniques = ['Oil on canvas', 'Charcoal on paper', 'Acrylic on board', 'Watercolour', 'Pastel on paper'];
  const made = [];
  for (let i = 0; i < count; i++) {
    const [a, b] = shapes[i % shapes.length];
    const c = document.createElement('canvas');
    c.width = a >= b ? side : Math.round(side * a / b);
    c.height = a >= b ? Math.round(side * b / a) : side;
    const x = c.getContext('2d');
    x.fillStyle = colors[i % colors.length];
    x.fillRect(0, 0, c.width, c.height);
    /* Many soft strokes, so the file sizes are closer to a real painting's */
    for (let n = 0; n < 900; n++) {
      x.globalAlpha = 0.12;
      x.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      x.beginPath();
      x.ellipse(Math.random() * c.width, Math.random() * c.height, 20 + Math.random() * 170, 8 + Math.random() * 60, Math.random() * 3, 0, 7);
      x.fill();
    }
    x.globalAlpha = 1;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', FULL_QUALITY));
    const draft = await processPhoto(blob);
    made.push({
      piece: cleanPiece({
        id: uid(), title: `Sample piece ${i + 1}`, technique: techniques[i % techniques.length], height: 30 + i * 5, width: 40 + i * 5, unit: 'cm',
        year: 2026 - (i % 4), status: STATUSES[i % STATUSES.length], series: i % 2 ? 'Water' : 'Portraits', location: 'Studio',
        notes: i % 3 ? '' : 'A short note about this piece.', w: draft.w, h: draft.h, created: Date.now() - i * 1000,
      }),
      draft,
    });
  }
  await write(tx => {
    STORES.forEach(s => tx.objectStore(s).clear());
    made.forEach(({ piece, draft }) => {
      tx.objectStore('pieces').put(piece);
      tx.objectStore('full').put(draft.full, piece.id);
      tx.objectStore('thumbs').put(draft.thumb, piece.id);
    });
  });
  clearThumbs();
  pieces = made.map(m => m.piece);
  made.forEach(m => setThumb(m.piece.id, m.draft.thumb));
  markChanged();
  goHome();
}
async function resetAll() {
  if (!confirm(tr('confirmReset'))) return;
  await write(tx => STORES.forEach(s => tx.objectStore(s).clear()));
  clearThumbs();
  pieces = [];
  goHome();
}

/* ---------- Full-screen picture with pinch and double-tap zoom ---------- */
const viewer = $('#viewer');
const view = { s: 1, x: 0, y: 0, points: new Map(), startDist: 0, startScale: 1, lastTap: 0, moved: false };
function applyView() {
  const img = viewer.querySelector('img');
  if (!img) return;
  const maxX = innerWidth * (view.s - 1) / 2, maxY = innerHeight * (view.s - 1) / 2;
  view.x = Math.min(maxX, Math.max(-maxX, view.x));
  view.y = Math.min(maxY, Math.max(-maxY, view.y));
  img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
}
function openViewer(url, alt) {
  viewer.innerHTML = `<button class="icon-btn" data-act="viewer-close" aria-label="${tr('close')}">×</button><img src="${url}" alt="${esc(alt)}" draggable="false">`;
  Object.assign(view, { s: 1, x: 0, y: 0, lastTap: 0 });
  view.points.clear();
  viewer.showModal();
  applyView();
}
const pointDist = () => { const [a, b] = [...view.points.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
viewer.addEventListener('pointerdown', e => {
  if (e.target.closest('.icon-btn')) return;
  viewer.setPointerCapture(e.pointerId);
  view.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
  view.moved = false;
  if (view.points.size === 2) { view.startDist = pointDist(); view.startScale = view.s; }
});
viewer.addEventListener('pointermove', e => {
  const prev = view.points.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) view.moved = true;
  view.points.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (view.points.size === 2 && view.startDist) {
    view.s = Math.min(6, Math.max(1, view.startScale * pointDist() / view.startDist));
  } else if (view.points.size === 1 && view.s > 1) {
    view.x += dx;
    view.y += dy;
  }
  applyView();
});
function endPoint(e) {
  if (!view.points.delete(e.pointerId)) return;
  if (view.points.size < 2) view.startDist = 0;
  if (view.moved || view.points.size) return;
  const now = Date.now();
  if (now - view.lastTap < 300) {
    view.s = view.s > 1 ? 1 : 2.5;
    view.x = view.y = 0;
    view.lastTap = 0;
    applyView();
  } else {
    view.lastTap = now;
  }
}
viewer.addEventListener('pointerup', endPoint);
viewer.addEventListener('pointercancel', endPoint);
viewer.addEventListener('close', () => { viewer.innerHTML = ''; });

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 2600);
}
function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
}

/* ---------- Events ---------- */
const photoInput = $('#photo-input');
photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  photoInput.value = '';
  choosePhoto(file);
});

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const route = currentRoute();
  const piece = route.arg && pieceById(route.arg);
  switch (b.dataset.act) {
    case 'back': back(); break;
    case 'add': ui.draft = null; go('add'); break;
    case 'settings': go('settings'); break;
    case 'open': go('piece/' + encodeURIComponent(b.dataset.id)); break;
    case 'edit': go('edit/' + encodeURIComponent(piece.id)); break;
    case 'delete': deletePiece(piece); break;
    case 'pick-photo': photoInput.click(); break;
    case 'status-filter': {
      const next = b.dataset.status || null;
      ui.status = ui.status === next ? null : next;
      render();
      break;
    }
    case 'full': {
      const shown = $('#piece-photo');
      openViewer(ui.fullUrl ? ui.fullUrl.url : shown.src, piece.title);
      break;
    }
    case 'viewer-close': viewer.close(); break;
    case 'share': sharePiece(piece); break;
    case 'export': exportZip(); break;
    case 'snooze': {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      settings.snoozeUntil = keyOf(d);
      saveSettings();
      render();
      break;
    }
    case 'demo': loadDemo(); break;
    case 'reset': resetAll(); break;
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'piece-form') submitPiece(e.target);
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'search') {
    ui.query = el.value;
    $('#gallery').innerHTML = galleryHtml();
  } else if (el.id === 'artist') {
    settings.artist = el.value;
    saveSettings();
  }
});

document.addEventListener('change', e => {
  if (e.target.id === 'import-file') {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importZip(file);
  }
});

/* ---------- Start ---------- */
(async () => {
  app.innerHTML = `<p class="none">${tr('loading')}</p>`;
  try {
    db = await openDb();
    const [saved, thumbs] = await Promise.all([request('pieces', 'getAll'), allThumbs()]);
    pieces = saved;
    thumbs.forEach((blob, id) => setThumb(id, blob));
  } catch (e) {
    db = null;
    app.innerHTML = `<p class="none">${tr('storageError')}</p>`;
    return;
  }
  render();
})();

/* ---------- Offline support ---------- */
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
