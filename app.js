'use strict';

// ===== Constants =====
const STORAGE_KEY  = 'ideasnap_ideas';
const CATEGORIES   = ['Writing', 'Artistic', 'Improvement', 'Repair', 'Code'];
const RECENT_MAX   = 5;
const GEO_TIMEOUT  = 6000; // ms to wait for GPS before saving without location

// ===== DOM References =====
const recordBtn       = document.getElementById('recordBtn');
const recordLabel     = recordBtn.querySelector('.record-label');
const statusBar       = document.getElementById('statusBar');
const statusText      = document.getElementById('statusText');
const timerEl         = document.getElementById('timer');
const transcriptEl    = document.getElementById('transcript');
const transcriptText  = document.getElementById('transcriptText');
const classifyBar     = document.getElementById('classifyBar');
const captureChips    = document.getElementById('captureChips');
const actionBar       = document.getElementById('actionBar');
const saveBtn         = document.getElementById('saveBtn');
const discardBtn      = document.getElementById('discardBtn');
const recentList      = document.getElementById('recentList');
const recentEmpty     = document.getElementById('recentEmpty');
const ideaCount       = document.getElementById('ideaCount');

const searchFilter    = document.getElementById('searchFilter');
const filterChips     = document.getElementById('filterChips');
const dateFrom        = document.getElementById('dateFrom');
const dateTo          = document.getElementById('dateTo');
const clearFilters    = document.getElementById('clearFilters');
const historyList     = document.getElementById('historyList');
const historyEmpty    = document.getElementById('historyEmpty');
const historyEmptyMsg = document.getElementById('historyEmptyMsg');
const historyCount    = document.getElementById('historyCount');
const exportBtn       = document.getElementById('exportBtn');
const importFile      = document.getElementById('importFile');
const clearAllBtn     = document.getElementById('clearAllBtn');

const toast           = document.getElementById('toast');
const noSpeechModal   = document.getElementById('noSpeechModal');
const manualInput     = document.getElementById('manualInput');
const modalChips      = document.getElementById('modalChips');
const saveManualBtn   = document.getElementById('saveManualBtn');
const closeModalBtn   = document.getElementById('closeModalBtn');

// ===== State =====
let recognition   = null;
let isRecording   = false;
let timerInterval = null;
let elapsedSecs   = 0;
let currentText   = '';
let toastTimeout  = null;
let activePage    = 'capture';

// ===== Tab Navigation =====
document.querySelectorAll('.tab, .tab-link').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  activePage = name;
  document.querySelectorAll('.tab').forEach(t => {
    const active = t.dataset.tab === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active);
  });
  document.getElementById('capturePage').classList.toggle('hidden', name !== 'capture');
  document.getElementById('historyPage').classList.toggle('hidden', name !== 'history');

  if (name === 'history') renderHistory();
}

// ===== Speech Recognition =====
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
      else                          interim += t;
    }
    if (final) currentText += final;
    transcriptText.textContent = currentText + interim;
  };

  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      showToast('Microphone access denied.');
      stopRecording();
    } else if (e.error === 'no-speech' && isRecording) {
      try { recognition.start(); } catch (_) {}
    }
  };

  recognition.onend = () => {
    if (isRecording) { try { recognition.start(); } catch (_) {} }
  };

  return true;
}

// ===== Timer =====
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

// ===== Recording =====
recordBtn.addEventListener('click', () => {
  isRecording ? stopRecording() : startRecording();
});

function startRecording() {
  currentText = '';
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
  classifyBar.classList.add('hidden');
  actionBar.classList.add('hidden');
  resetChipGroup(captureChips);
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  if (recognition) { try { recognition.stop(); } catch (_) {} }
  stopTimer();

  recordBtn.classList.remove('recording');
  recordLabel.textContent = 'Tap to Record';
  recordBtn.setAttribute('aria-label', 'Start recording');
  statusBar.classList.add('hidden');

  const text = currentText.trim();
  if (text) {
    transcriptText.textContent = text;
    classifyBar.classList.remove('hidden');
    actionBar.classList.remove('hidden');
  } else {
    transcriptEl.classList.add('hidden');
    showToast('No speech detected. Try again!');
  }
}

// ===== Save / Discard =====
saveBtn.addEventListener('click', () => {
  const text = currentText.trim() || transcriptText.textContent.trim();
  if (!text) return;
  const category = getSelectedChip(captureChips);
  saveIdeaWithLocation(text, category);
  resetRecorder();
});

discardBtn.addEventListener('click', () => {
  resetRecorder();
  showToast('Idea discarded.');
});

function resetRecorder() {
  currentText = '';
  transcriptText.textContent = '';
  transcriptEl.classList.add('hidden');
  classifyBar.classList.add('hidden');
  actionBar.classList.add('hidden');
  resetChipGroup(captureChips);
}

// ===== Geolocation =====
function saveIdeaWithLocation(text, category) {
  // Save immediately, then try to enrich with location
  const idea = createIdea(text, category, null);
  const ideas = loadIdeas();
  ideas.unshift(idea);
  persistIdeas(ideas);
  renderRecent();
  showToast('Idea saved!');

  if (!navigator.geolocation) return;

  const timeout = setTimeout(() => {}, GEO_TIMEOUT); // non-blocking sentinel

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      clearTimeout(timeout);
      const { latitude: lat, longitude: lng } = pos.coords;
      const stored = loadIdeas();
      const idx = stored.findIndex(i => i.id === idea.id);
      if (idx !== -1) {
        stored[idx].location = { lat, lng };
        persistIdeas(stored);
        renderRecent();
        if (activePage === 'history') renderHistory();
      }
    },
    () => { /* location denied or timed out — keep saved idea as-is */ },
    { timeout: GEO_TIMEOUT, maximumAge: 30000 }
  );
}

function createIdea(text, category, location) {
  return {
    id:        Date.now(),
    text:      text,
    category:  category || '',
    createdAt: new Date().toISOString(),
    location:  location || null
  };
}

// ===== Storage =====
function loadIdeas() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function persistIdeas(ideas) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas));
}

function deleteIdea(id) {
  persistIdeas(loadIdeas().filter(i => i.id !== id));
  renderRecent();
  renderHistory();
  showToast('Idea deleted.');
}

function updateIdea(id, text, category) {
  const ideas = loadIdeas();
  const idx = ideas.findIndex(i => i.id === id);
  if (idx !== -1) {
    ideas[idx].text     = text;
    ideas[idx].category = category;
    persistIdeas(ideas);
  }
  renderHistory();
  renderRecent();
  showToast('Idea updated.');
}

// ===== Chip Helpers =====
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

function resetChipGroup(container) {
  container.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.cat === '');
  });
}

function setChipGroup(container, value) {
  container.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('active', c.dataset.cat === value);
  });
}

// ===== Render: Recent (Capture Page) =====
function renderRecent() {
  const all    = loadIdeas();
  const recent = all.slice(0, RECENT_MAX);

  ideaCount.textContent = all.length;

  if (all.length === 0) {
    recentEmpty.classList.remove('hidden');
    recentList.innerHTML = '';
    return;
  }

  recentEmpty.classList.add('hidden');
  recentList.innerHTML = recent.map(idea => `
    <li class="idea-item" data-id="${idea.id}">
      <div class="idea-body">
        ${idea.category ? `<div style="margin-bottom:0.3rem">${badgeHTML(idea.category)}</div>` : ''}
        <p class="idea-text">${escapeHtml(idea.text)}</p>
        <div class="idea-meta">
          <time datetime="${idea.createdAt}">${formatDate(idea.createdAt)}</time>
          ${locationHTML(idea.location)}
        </div>
      </div>
      <div class="idea-actions">
        <button class="btn btn-icon copy-btn" title="Copy" aria-label="Copy idea">
          ${iconCopy()}
        </button>
      </div>
    </li>
  `).join('');

  recentList.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = Number(btn.closest('.idea-item').dataset.id);
      const idea = loadIdeas().find(i => i.id === id);
      if (idea) copyText(idea.text);
    });
  });
}

// ===== Render: History (History Page) =====
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
  historyList.innerHTML = filtered.map(idea => ideaCardHTML(idea)).join('');

  historyList.querySelectorAll('.idea-item').forEach(li => attachCardEvents(li));
}

function ideaCardHTML(idea) {
  return `
    <li class="idea-item" data-id="${idea.id}">
      <div class="idea-body">
        ${idea.category ? `<div style="margin-bottom:0.35rem">${badgeHTML(idea.category)}</div>` : ''}
        <p class="idea-text">${escapeHtml(idea.text)}</p>
        <div class="idea-meta">
          <time datetime="${idea.createdAt}">${formatDate(idea.createdAt)}</time>
          ${locationHTML(idea.location)}
        </div>
      </div>
      <div class="idea-actions">
        <button class="btn btn-icon edit-btn"        title="Edit"   aria-label="Edit idea">${iconEdit()}</button>
        <button class="btn btn-icon copy-btn"        title="Copy"   aria-label="Copy idea">${iconCopy()}</button>
        <button class="btn btn-icon danger delete-btn" title="Delete" aria-label="Delete idea">${iconTrash()}</button>
      </div>
    </li>
  `;
}

function attachCardEvents(li) {
  const id = Number(li.dataset.id);

  li.querySelector('.edit-btn')?.addEventListener('click', () => enterEditMode(id, li));
  li.querySelector('.copy-btn')?.addEventListener('click', () => {
    const idea = loadIdeas().find(i => i.id === id);
    if (idea) copyText(idea.text);
  });
  li.querySelector('.delete-btn')?.addEventListener('click', () => deleteIdea(id));
}

// ===== Edit Mode =====
function enterEditMode(id, li) {
  const idea = loadIdeas().find(i => i.id === id);
  if (!idea) return;

  // Chip HTML for the edit form — built inline so colours apply via CSS classes
  const chipHTML = ['', ...CATEGORIES].map(cat => {
    const cls   = cat ? `cat-${cat.toLowerCase()}` : '';
    const label = cat || 'None';
    const sel   = idea.category === cat ? ' active' : '';
    return `<button class="chip ${cls}${sel}" data-cat="${cat}">${label}</button>`;
  }).join('');

  li.classList.add('editing');
  li.innerHTML = `
    <div class="classify-bar" style="width:100%">
      <span class="classify-label">Category</span>
      <div class="chip-row edit-chips">${chipHTML}</div>
    </div>
    <textarea class="edit-textarea" rows="3">${escapeHtml(idea.text)}</textarea>
    ${idea.location ? `
      <div class="idea-meta">
        ${locationHTML(idea.location)}
        <span style="font-size:0.7rem;color:var(--text-muted)">(recorded at save time)</span>
      </div>` : ''}
    <div class="edit-actions">
      <button class="btn btn-sm btn-primary save-edit-btn">Save</button>
      <button class="btn btn-sm btn-ghost cancel-edit-btn">Cancel</button>
    </div>
  `;

  const editChips = li.querySelector('.edit-chips');
  initChipGroup(editChips);

  li.querySelector('.save-edit-btn').addEventListener('click', () => {
    const text = li.querySelector('.edit-textarea').value.trim();
    if (!text) { showToast('Idea cannot be empty.'); return; }
    const category = getSelectedChip(editChips);
    updateIdea(id, text, category);
  });

  li.querySelector('.cancel-edit-btn').addEventListener('click', () => {
    renderHistory();
  });
}

// ===== History Filters =====
function filterIdeas(ideas) {
  const search   = searchFilter.value.trim().toLowerCase();
  const category = getSelectedChip(filterChips);
  const from     = dateFrom.value ? new Date(dateFrom.value) : null;
  const to       = dateTo.value   ? new Date(dateTo.value + 'T23:59:59') : null;

  return ideas.filter(idea => {
    if (search && !idea.text.toLowerCase().includes(search)) return false;
    if (category && idea.category !== category) return false;
    const d = new Date(idea.createdAt);
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });
}

searchFilter.addEventListener('input', () => { if (activePage === 'history') renderHistory(); });
dateFrom.addEventListener('change',    () => { if (activePage === 'history') renderHistory(); });
dateTo.addEventListener('change',      () => { if (activePage === 'history') renderHistory(); });

clearFilters.addEventListener('click', () => {
  searchFilter.value = '';
  dateFrom.value     = '';
  dateTo.value       = '';
  resetChipGroup(filterChips);
  renderHistory();
});

// ===== Export CSV =====
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

// ===== Import CSV =====
importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    importCSV(ev.target.result);
    importFile.value = '';
  };
  reader.readAsText(file);
});

function importCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) { showToast('No data found in file.'); return; }

  const headers  = rows[0].map(h => h.toLowerCase().trim());
  const col      = (names) => names.map(n => headers.indexOf(n)).find(i => i !== -1) ?? -1;

  const textIdx  = col(['text']);
  const catIdx   = col(['category', 'classification']);
  const dateIdx  = col(['createdat', 'date', 'created_at']);
  const latIdx   = col(['lat', 'latitude']);
  const lngIdx   = col(['lng', 'lon', 'longitude']);

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
      location:  (!isNaN(lat) && !isNaN(lng)) ? { lat, lng } : null
    });
    count++;
  }

  existing.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  persistIdeas(existing);
  renderRecent();
  renderHistory();
  showToast(`Imported ${count} idea${count !== 1 ? 's' : ''}.`);
}

// Minimal RFC-4180 CSV parser
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
      if (ch === '"') { inQ = true; }
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

// ===== Clear All =====
clearAllBtn.addEventListener('click', () => {
  if (!loadIdeas().length) { showToast('No ideas to clear.'); return; }
  if (!confirm('Delete ALL saved ideas? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  renderRecent();
  renderHistory();
  showToast('All ideas cleared.');
});

// ===== Manual Input Modal (No-Speech Fallback) =====
saveManualBtn.addEventListener('click', () => {
  const text = manualInput.value.trim();
  if (!text) return;
  const category = getSelectedChip(modalChips);
  saveIdeaWithLocation(text, category);
  manualInput.value = '';
  resetChipGroup(modalChips);
  noSpeechModal.classList.add('hidden');
});

closeModalBtn.addEventListener('click', () => noSpeechModal.classList.add('hidden'));
noSpeechModal.addEventListener('click', (e) => {
  if (e.target === noSpeechModal) noSpeechModal.classList.add('hidden');
});

// ===== Copy to Clipboard =====
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

// ===== Toast =====
function showToast(msg, ms = 2500) {
  clearTimeout(toastTimeout);
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), ms);
}

// ===== HTML Helpers =====
function badgeHTML(category) {
  if (!category) return '';
  return `<span class="badge badge-${escapeHtml(category)}">${escapeHtml(category)}</span>`;
}

function locationHTML(loc) {
  if (!loc) return '';
  const { lat, lng } = loc;
  const url   = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=15`;
  const label = `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
  return `
    <a href="${url}" target="_blank" rel="noopener noreferrer" class="location-link" title="View on map: ${label}">
      <svg viewBox="0 0 24 24" fill="none" width="12" height="12">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor" opacity=".85"/>
        <circle cx="12" cy="9" r="2.5" fill="#fff"/>
      </svg>
      ${label}
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

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

function downloadFile(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

// ===== SVG Icon Helpers =====
function iconEdit() {
  return `<svg viewBox="0 0 24 24" fill="none" width="15" height="15">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

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

// ===== Init =====
initChipGroup(captureChips);
initChipGroup(modalChips);
initChipGroup(filterChips);

// Filter chips need to re-render history on change
filterChips.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (activePage === 'history') renderHistory();
  });
});

renderRecent();
