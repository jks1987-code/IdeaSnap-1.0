'use strict';

// ===== Constants =====
const STORAGE_KEY = 'ideasnap_ideas';
const CATEGORIES  = ['Artistic', 'Improvement', 'Repair', 'Shopping', 'Writing']; // alphabetized
const RECENT_MAX  = 5;
const GEO_TIMEOUT = 6000;

// ===== DOM References =====
const recordBtn      = document.getElementById('recordBtn');
const recordLabel    = recordBtn.querySelector('.record-label');
const statusBar      = document.getElementById('statusBar');
const timerEl        = document.getElementById('timer');
const transcriptEl   = document.getElementById('transcript');
const transcriptText = document.getElementById('transcriptText');

const recentList     = document.getElementById('recentList');
const recentEmpty    = document.getElementById('recentEmpty');
const ideaCount      = document.getElementById('ideaCount');

const searchFilter   = document.getElementById('searchFilter');
const filterChips    = document.getElementById('filterChips');
const dateFrom       = document.getElementById('dateFrom');
const dateTo         = document.getElementById('dateTo');
const clearFilters   = document.getElementById('clearFilters');
const historyList    = document.getElementById('historyList');
const historyEmpty   = document.getElementById('historyEmpty');
const historyEmptyMsg= document.getElementById('historyEmptyMsg');
const historyCount   = document.getElementById('historyCount');
const exportBtn      = document.getElementById('exportBtn');
const importFile     = document.getElementById('importFile');
const clearAllBtn    = document.getElementById('clearAllBtn');

const detailModal    = document.getElementById('detailModal');
const closeDetailBtn = document.getElementById('closeDetailBtn');
const detailText     = document.getElementById('detailText');
const detailChips    = document.getElementById('detailChips');
const detailMeta     = document.getElementById('detailMeta');
const mediaPreview   = document.getElementById('mediaPreview');
const inputCameraPhoto = document.getElementById('inputCameraPhoto');
const inputCameraVideo = document.getElementById('inputCameraVideo');
const inputLibrary   = document.getElementById('inputLibrary');
const saveDetailBtn  = document.getElementById('saveDetailBtn');
const deleteDetailBtn= document.getElementById('deleteDetailBtn');

const noSpeechModal  = document.getElementById('noSpeechModal');
const manualInput    = document.getElementById('manualInput');
const saveManualBtn  = document.getElementById('saveManualBtn');
const closeModalBtn  = document.getElementById('closeModalBtn');

const toast          = document.getElementById('toast');

// ===== State =====
let recognition      = null;
let isRecording      = false;
let timerInterval    = null;
let elapsedSecs      = 0;
let currentText      = '';
let currentInterim   = '';
let toastTimeout     = null;
let activePage       = 'capture';

// Detail modal state
let detailIdeaId      = null;
let pendingMediaItems = []; // [{ type, dataUrl }, …]


// ============================================================
// TAB NAVIGATION
// ============================================================
document.querySelectorAll('.tab, .tab-link').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  activePage = name;
  document.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  document.getElementById('capturePage').classList.toggle('hidden', name !== 'capture');
  document.getElementById('historyPage').classList.toggle('hidden', name !== 'history');
  if (name === 'history') renderHistory();
}


// ============================================================
// SPEECH RECOGNITION
// ============================================================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function initSpeechRecognition() {
  if (!SpeechRecognition) return false;
  recognition = new SpeechRecognition();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = navigator.language || 'en-US';

  recognition.onresult = (event) => {
    let final = '', interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) final += t + ' ';
      else interim += t;
    }
    if (final) { currentText += final; currentInterim = ''; }
    else currentInterim = interim;
    transcriptText.textContent = currentText + interim;
  };

  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      showToast('Microphone access denied.');
      stopAndSave();
    } else if (e.error === 'no-speech' && isRecording) {
      try { recognition.start(); } catch (_) {}
    }
  };

  recognition.onend = () => {
    if (isRecording) { try { recognition.start(); } catch (_) {} }
  };

  return true;
}


// ============================================================
// TIMER
// ============================================================
function startTimer() {
  elapsedSecs = 0;
  renderTimer();
  timerInterval = setInterval(() => { elapsedSecs++; renderTimer(); }, 1000);
}
function stopTimer() { clearInterval(timerInterval); timerInterval = null; }
function renderTimer() {
  const m = Math.floor(elapsedSecs / 60);
  const s = elapsedSecs % 60;
  timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}


// ============================================================
// RECORDING — ONE TAP = RECORD, SECOND TAP = SAVE
// ============================================================
recordBtn.addEventListener('click', () => {
  if (isRecording) stopAndSave();
  else startRecording();
});

function startRecording() {
  currentText    = '';
  currentInterim = '';
  transcriptText.textContent = '';

  if (!recognition && !initSpeechRecognition()) {
    noSpeechModal.classList.remove('hidden');
    return;
  }

  isRecording = true;
  recognition.start();
  startTimer();

  recordBtn.classList.add('recording');
  recordLabel.textContent = 'Tap to Stop';
  recordBtn.setAttribute('aria-label', 'Stop recording');
  statusBar.classList.remove('hidden');
  transcriptEl.classList.remove('hidden');
}

function stopAndSave() {
  if (!isRecording) return;
  isRecording = false;
  if (recognition) { try { recognition.stop(); } catch (_) {} }
  stopTimer();

  recordBtn.classList.remove('recording');
  recordLabel.textContent = 'Tap to Record';
  recordBtn.setAttribute('aria-label', 'Start recording');
  statusBar.classList.add('hidden');
  transcriptEl.classList.add('hidden');

  const text = (currentText + currentInterim).trim();
  if (!text) {
    showToast('No speech detected — try again!');
    return;
  }

  // Auto-save immediately — no confirmation needed
  autoSave(text);
}

function autoSave(text) {
  const idea = createIdea(text, '', null);
  const ideas = loadIdeas();
  ideas.unshift(idea);
  persistIdeas(ideas);
  renderRecent();
  showToast('Idea saved! Tap it to add details.');

  // Enrich with location asynchronously
  requestLocation(idea.id);
}


// ============================================================
// GEOLOCATION
// ============================================================
function requestLocation(ideaId) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const ideas = loadIdeas();
      const idx = ideas.findIndex(i => i.id === ideaId);
      if (idx !== -1) {
        ideas[idx].location = { lat, lng };
        persistIdeas(ideas);
        renderRecent();
        if (activePage === 'history') renderHistory();
      }
    },
    () => { /* denied or timed out — silently skip */ },
    { timeout: GEO_TIMEOUT, maximumAge: 30000 }
  );
}


// ============================================================
// DATA MODEL
// ============================================================
function createIdea(text, category, location) {
  return {
    id:        Date.now(),
    text,
    category:  category || '',
    createdAt: new Date().toISOString(),
    location:  location || null,
    hasMedia:  false
  };
}

function loadIdeas() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function persistIdeas(ideas) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas));
}

function deleteIdea(id) {
  persistIdeas(loadIdeas().filter(i => i.id !== id));
  deleteMedia(id);
  renderRecent();
  if (activePage === 'history') renderHistory();
  showToast('Idea deleted.');
}


// ============================================================
// MEDIA STORAGE — IndexedDB (far larger quota than localStorage)
// ============================================================
let _db = null;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ideasnap_media', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('media');
    req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
    req.onerror    = e => reject(e.target.error);
  });
}

async function saveMedia(ideaId, items) {
  // items = [{ type, dataUrl }, …]
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').put(items, ideaId);
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => { showToast('Storage error — media not saved.'); resolve(false); };
    });
  } catch {
    showToast('Storage error — media not saved.');
    return false;
  }
}

async function loadMedia(ideaId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx  = db.transaction('media', 'readonly');
      const req = tx.objectStore('media').get(ideaId);
      req.onsuccess = () => {
        const val = req.result;
        if (!val) { resolve([]); return; }
        // Migrate old single-object format { type, dataUrl } → array
        resolve(Array.isArray(val) ? val : [val]);
      };
      req.onerror = () => resolve([]);
    });
  } catch { return []; }
}

async function deleteMedia(ideaId) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').delete(ideaId);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    });
  } catch {}
}

// One-time migration: move any existing localStorage media into IndexedDB
async function migrateLocalStorageMedia() {
  const prefix = 'ideasnap_media_';
  const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix));
  for (const key of keys) {
    try {
      const data = JSON.parse(localStorage.getItem(key));
      if (data?.type && data?.dataUrl) {
        await saveMedia(Number(key.slice(prefix.length)), [{ type: data.type, dataUrl: data.dataUrl }]);
      }
    } catch {}
    localStorage.removeItem(key);
  }
}

async function resizeImage(file, maxW = 1200) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const ratio  = Math.min(1, maxW / img.width);
      const w = Math.round(img.width  * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}


// ============================================================
// CHIP HELPERS
// ============================================================
function initChipGroup(container) {
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
}

function getSelectedChip(container) {
  return container.querySelector('.chip.active')?.dataset.cat ?? '';
}

function setChipGroup(container, value) {
  container.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.cat === value);
  });
}

function resetChipGroup(container) { setChipGroup(container, ''); }


// ============================================================
// RENDER: RECENT IDEAS (Capture page)
// ============================================================
function renderRecent() {
  const all    = loadIdeas();
  const recent = all.slice(0, RECENT_MAX);

  ideaCount.textContent = all.length;
  recentEmpty.classList.toggle('hidden', all.length > 0);
  recentList.innerHTML = recent.map(ideaCardHTML).join('');

  recentList.querySelectorAll('.idea-item').forEach(li => {
    li.addEventListener('click', (e) => {
      // Don't open detail if a copy/delete button was clicked
      if (e.target.closest('.idea-actions')) return;
      openDetailModal(Number(li.dataset.id));
    });
    li.querySelector('.copy-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idea = loadIdeas().find(i => i.id === Number(li.dataset.id));
      if (idea) copyText(idea.text);
    });
    li.querySelector('.delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this idea? This cannot be undone.')) return;
      deleteIdea(Number(li.dataset.id));
    });
  });
}


// ============================================================
// RENDER: HISTORY (History page)
// ============================================================
function renderHistory() {
  const all      = loadIdeas();
  const filtered = filterIdeas(all);

  historyCount.textContent = filtered.length === all.length
    ? `${all.length} idea${all.length !== 1 ? 's' : ''}`
    : `${filtered.length} of ${all.length} ideas`;

  if (all.length === 0) {
    historyEmpty.classList.remove('hidden');
    historyEmptyMsg.textContent = 'No ideas yet.';
    historyList.innerHTML = '';
    return;
  }
  if (filtered.length === 0) {
    historyEmpty.classList.remove('hidden');
    historyEmptyMsg.textContent = 'No ideas match your filters.';
    historyList.innerHTML = '';
    return;
  }

  historyEmpty.classList.add('hidden');
  historyList.innerHTML = filtered.map(ideaCardHTML).join('');

  historyList.querySelectorAll('.idea-item').forEach(li => {
    li.addEventListener('click', (e) => {
      if (e.target.closest('.idea-actions')) return;
      openDetailModal(Number(li.dataset.id));
    });
    li.querySelector('.copy-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idea = loadIdeas().find(i => i.id === Number(li.dataset.id));
      if (idea) copyText(idea.text);
    });
    li.querySelector('.delete-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this idea? This cannot be undone.')) return;
      deleteIdea(Number(li.dataset.id));
    });
  });
}

function ideaCardHTML(idea) {
  const actions = `
    <div class="idea-actions">
      <button class="btn btn-icon copy-btn"          title="Copy"   aria-label="Copy">${iconCopy()}</button>
      <button class="btn btn-icon danger delete-btn" title="Delete" aria-label="Delete">${iconTrash()}</button>
    </div>`;

  return `
    <li class="idea-item" data-id="${idea.id}" title="Tap to view/edit details">
      <div class="idea-body">
        <div class="idea-top">
          ${idea.category ? badgeHTML(idea.category) : ''}
          ${idea.hasMedia ? '<span class="media-indicator">📷 media</span>' : ''}
        </div>
        <p class="idea-text">${escapeHtml(idea.text)}</p>
        <div class="idea-meta">
          <time datetime="${idea.createdAt}">${formatDate(idea.createdAt)}</time>
          ${locationInlineHTML(idea.location)}
        </div>
      </div>
      ${actions}
    </li>`;
}


// ============================================================
// DETAIL MODAL
// ============================================================
async function openDetailModal(id) {
  const idea = loadIdeas().find(i => i.id === id);
  if (!idea) return;

  detailIdeaId      = id;
  pendingMediaItems = [];

  detailText.value = idea.text;
  setChipGroup(detailChips, idea.category || '');

  // Load existing media
  pendingMediaItems = await loadMedia(id);
  renderMediaPreview();

  // Render date and location
  renderDetailMeta(idea);

  detailModal.classList.remove('hidden');
  detailText.focus();
}

function closeDetailModal() {
  detailModal.classList.add('hidden');
  detailIdeaId      = null;
  pendingMediaItems = [];
  mediaPreview.innerHTML = '';
  detailText.value = '';
}

closeDetailBtn.addEventListener('click', closeDetailModal);
detailModal.addEventListener('click', (e) => {
  if (e.target === detailModal) closeDetailModal();
});

// Save changes
saveDetailBtn.addEventListener('click', async () => {
  const id   = detailIdeaId;
  const text = detailText.value.trim();
  if (!text) { showToast('Idea text cannot be empty.'); return; }

  const category = getSelectedChip(detailChips);
  const ideas    = loadIdeas();
  const idx      = ideas.findIndex(i => i.id === id);
  if (idx === -1) return;

  ideas[idx].text     = text;
  ideas[idx].category = category;

  // Handle media changes
  if (pendingMediaItems.length > 0) {
    const ok = await saveMedia(id, pendingMediaItems);
    ideas[idx].hasMedia = ok;
  } else {
    await deleteMedia(id);
    ideas[idx].hasMedia = false;
  }

  persistIdeas(ideas);
  renderRecent();
  if (activePage === 'history') renderHistory();
  closeDetailModal();
  showToast('Idea updated!');
});

// Delete from detail modal
deleteDetailBtn.addEventListener('click', () => {
  const id = detailIdeaId;
  if (!confirm('Delete this idea? This cannot be undone.')) return;
  closeDetailModal();
  deleteIdea(id);
});

// Render detail metadata: date + location button
function renderDetailMeta(idea) {
  let html = `
    <div class="detail-date-line">
      <svg viewBox="0 0 24 24" fill="none" width="13" height="13" style="flex-shrink:0">
        <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
        <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <time datetime="${idea.createdAt}">${formatDate(idea.createdAt)}</time>
    </div>`;

  if (idea.location) {
    const { lat, lng } = idea.location;
    const url   = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=15`;
    const label = `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`;
    html += `
      <button class="detail-location-btn" onclick="window.open('${url}','_blank','noopener')" type="button">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14" style="flex-shrink:0">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
                fill="currentColor" opacity=".8"/>
          <circle cx="12" cy="9" r="2.5" fill="#fff"/>
        </svg>
        <span class="location-coords">${label}</span>
        <span class="location-hint">Open map →</span>
      </button>`;
  }

  detailMeta.innerHTML = html;
}


// ============================================================
// MEDIA CAPTURE (from detail modal)
// ============================================================
inputCameraPhoto.addEventListener('change', (e) => handleFileInput(e.target.files[0]));
inputCameraVideo.addEventListener('change', (e) => handleFileInput(e.target.files[0]));
inputLibrary.addEventListener('change',     (e) => handleFileInput(e.target.files[0]));

async function handleFileInput(file) {
  if (!file) return;

  // Reset inputs so same file can be re-selected if needed
  inputCameraPhoto.value = '';
  inputCameraVideo.value = '';
  inputLibrary.value     = '';

  if (file.type.startsWith('image/')) {
    showToast('Processing image…');
    const dataUrl = await resizeImage(file);
    if (!dataUrl) { showToast('Could not load image.'); return; }
    pendingMediaItems.push({ type: 'image', dataUrl });
    renderMediaPreview();
  } else if (file.type.startsWith('video/')) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingMediaItems.push({ type: 'video', dataUrl: ev.target.result });
      renderMediaPreview();
    };
    reader.onerror = () => showToast('Could not load video.');
    showToast('Loading video…');
    reader.readAsDataURL(file);
  } else {
    showToast('Unsupported file type.');
  }
}

function renderMediaPreview() {
  if (pendingMediaItems.length === 0) { mediaPreview.innerHTML = ''; return; }

  const thumbs = pendingMediaItems.map((m, i) => {
    const inner = m.type === 'image'
      ? `<img src="${m.dataUrl}" alt="Photo ${i + 1}" />`
      : `<video src="${m.dataUrl}" controls playsinline></video>`;
    return `<div class="media-thumb" data-idx="${i}">
      ${inner}
      <button class="remove-media-btn" title="Remove" aria-label="Remove media">✕</button>
    </div>`;
  }).join('');

  const hasImage = pendingMediaItems.some(m => m.type === 'image');
  const hint = hasImage ? `<p class="media-save-hint">Long-press image → "Add to Photos"</p>` : '';
  mediaPreview.innerHTML = `<div class="media-gallery">${thumbs}</div>${hint}`;

  mediaPreview.querySelectorAll('.remove-media-btn').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      pendingMediaItems.splice(i, 1);
      renderMediaPreview();
    });
  });
}


// ============================================================
// HISTORY FILTERS
// ============================================================
function filterIdeas(ideas) {
  const search   = searchFilter.value.trim().toLowerCase();
  const category = getSelectedChip(filterChips);
  const from     = dateFrom.value ? new Date(dateFrom.value) : null;
  const to       = dateTo.value   ? new Date(dateTo.value + 'T23:59:59') : null;

  return ideas.filter(idea => {
    if (search   && !idea.text.toLowerCase().includes(search)) return false;
    if (category && idea.category !== category)                return false;
    const d = new Date(idea.createdAt);
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });
}

searchFilter.addEventListener('input',  () => { if (activePage === 'history') renderHistory(); });
dateFrom.addEventListener('change',     () => { if (activePage === 'history') renderHistory(); });
dateTo.addEventListener('change',       () => { if (activePage === 'history') renderHistory(); });
clearFilters.addEventListener('click',  () => {
  searchFilter.value = '';
  dateFrom.value     = '';
  dateTo.value       = '';
  resetChipGroup(filterChips);
  renderHistory();
});


// ============================================================
// EXPORT CSV
// ============================================================
exportBtn.addEventListener('click', () => {
  const ideas = loadIdeas();
  if (!ideas.length) { showToast('No ideas to export.'); return; }

  const header = ['id', 'text', 'category', 'createdAt', 'lat', 'lng'];
  const rows   = ideas.map(idea => [
    idea.id,
    idea.text,
    idea.category || '',
    idea.createdAt,
    idea.location?.lat ?? '',
    idea.location?.lng ?? ''
  ]);

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  downloadFile(csv, `ideas-${dateStr(new Date())}.csv`, 'text/csv');
  showToast('Ideas exported!');
});


// ============================================================
// IMPORT CSV
// ============================================================
importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => { importCSV(ev.target.result); importFile.value = ''; };
  reader.readAsText(file);
});

function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) { showToast('No data found in file.'); return; }

  const headers = rows[0].map(h => h.toLowerCase().trim());
  const col     = (...names) => names.map(n => headers.indexOf(n)).find(i => i !== -1) ?? -1;

  const textIdx = col('text');
  const catIdx  = col('category', 'classification');
  const dateIdx = col('createdat', 'date', 'created_at');
  const latIdx  = col('lat', 'latitude');
  const lngIdx  = col('lng', 'lon', 'longitude');

  if (textIdx === -1) { showToast('CSV must have a "text" column.'); return; }

  const existing = loadIdeas();
  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    const row  = rows[i];
    const text = row[textIdx]?.trim();
    if (!text) continue;
    const cat = catIdx  !== -1 ? row[catIdx]?.trim()  : '';
    const dt  = dateIdx !== -1 ? row[dateIdx]?.trim() : '';
    const lat = latIdx  !== -1 ? parseFloat(row[latIdx]) : NaN;
    const lng = lngIdx  !== -1 ? parseFloat(row[lngIdx]) : NaN;

    existing.push({
      id:        Date.now() + count,
      text,
      category:  CATEGORIES.includes(cat) ? cat : '',
      createdAt: dt ? new Date(dt).toISOString() : new Date().toISOString(),
      location:  (!isNaN(lat) && !isNaN(lng)) ? { lat, lng } : null,
      hasMedia:  false
    });
    count++;
  }

  existing.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  persistIdeas(existing);
  renderRecent();
  renderHistory();
  showToast(`Imported ${count} idea${count !== 1 ? 's' : ''}.`);
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cell += ch; }
    } else {
      if      (ch === '"') { inQ = true; }
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else { cell += ch; }
    }
  }
  if (cell || row.length) { row.push(cell); if (row.some(c => c !== '')) rows.push(row); }
  return rows;
}


// ============================================================
// CLEAR ALL
// ============================================================
clearAllBtn.addEventListener('click', () => {
  const ideas = loadIdeas();
  if (!ideas.length) { showToast('No ideas to clear.'); return; }
  if (!confirm('Delete ALL saved ideas? This cannot be undone.')) return;
  ideas.forEach(idea => deleteMedia(idea.id));
  localStorage.removeItem(STORAGE_KEY);
  renderRecent();
  renderHistory();
  showToast('All ideas cleared.');
});


// ============================================================
// NO-SPEECH FALLBACK MODAL
// ============================================================
saveManualBtn.addEventListener('click', () => {
  const text = manualInput.value.trim();
  if (!text) return;
  autoSave(text);
  manualInput.value = '';
  noSpeechModal.classList.add('hidden');
});
closeModalBtn.addEventListener('click', () => noSpeechModal.classList.add('hidden'));
noSpeechModal.addEventListener('click', (e) => {
  if (e.target === noSpeechModal) noSpeechModal.classList.add('hidden');
});


// ============================================================
// CLIPBOARD
// ============================================================
function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
  } else {
    const ta = Object.assign(document.createElement('textarea'),
      { value: text, style: 'position:fixed;opacity:0' });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('Copied!');
  }
}


// ============================================================
// TOAST
// ============================================================
function showToast(msg, ms = 2600) {
  clearTimeout(toastTimeout);
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), ms);
}


// ============================================================
// HTML HELPERS
// ============================================================
function badgeHTML(category) {
  if (!category) return '';
  return `<span class="badge badge-${escapeHtml(category)}">${escapeHtml(category)}</span>`;
}

function locationInlineHTML(loc) {
  if (!loc) return '';
  const { lat, lng } = loc;
  return `
    <a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=15"
       target="_blank" rel="noopener noreferrer"
       class="location-link" title="View on map"
       onclick="event.stopPropagation()">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" opacity=".85"/>
      </svg>
      ${lat.toFixed(4)}°, ${lng.toFixed(4)}°
    </a>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function dateStr(d) { return d.toISOString().slice(0, 10); }

function downloadFile(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}


// ============================================================
// SVG ICONS
// ============================================================
function iconCopy() {
  return `<svg viewBox="0 0 24 24" fill="none" width="15" height="15">
    <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/>
  </svg>`;
}

function iconTrash() {
  return `<svg viewBox="0 0 24 24" fill="none" width="15" height="15">
    <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M10 11v6m4-6v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2"/>
  </svg>`;
}


// ============================================================
// INIT
// ============================================================
initChipGroup(detailChips);
initChipGroup(filterChips);

filterChips.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (activePage === 'history') renderHistory();
  });
});

renderRecent();
migrateLocalStorageMedia(); // one-time: move any old localStorage media into IndexedDB
