'use strict';

// ===== Constants =====
const STORAGE_KEY = 'ideasnap_ideas';

// ===== DOM References =====
const recordBtn       = document.getElementById('recordBtn');
const recordLabel     = recordBtn.querySelector('.record-label');
const statusBar       = document.getElementById('statusBar');
const statusText      = document.getElementById('statusText');
const timerEl         = document.getElementById('timer');
const transcriptEl    = document.getElementById('transcript');
const transcriptText  = document.getElementById('transcriptText');
const actionBar       = document.getElementById('actionBar');
const saveBtn         = document.getElementById('saveBtn');
const discardBtn      = document.getElementById('discardBtn');
const ideasList       = document.getElementById('ideasList');
const emptyState      = document.getElementById('emptyState');
const ideaCount       = document.getElementById('ideaCount');
const exportBtn       = document.getElementById('exportBtn');
const clearAllBtn     = document.getElementById('clearAllBtn');
const toast           = document.getElementById('toast');
const noSpeechModal   = document.getElementById('noSpeechModal');
const manualInput     = document.getElementById('manualInput');
const saveManualBtn   = document.getElementById('saveManualBtn');
const closeModalBtn   = document.getElementById('closeModalBtn');

// ===== State =====
let recognition   = null;
let isRecording   = false;
let timerInterval = null;
let seconds       = 0;
let currentText   = '';
let toastTimeout  = null;

// ===== Speech Recognition Setup =====
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function initSpeechRecognition() {
  if (!SpeechRecognition) return false;

  recognition = new SpeechRecognition();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = navigator.language || 'en-US';

  recognition.onresult = (event) => {
    let final    = '';
    let interim  = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += transcript + ' ';
      } else {
        interim += transcript;
      }
    }

    if (final) currentText += final;
    transcriptText.textContent = currentText + interim;
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed') {
      showToast('Microphone access denied. Please allow microphone access.');
      stopRecording();
    } else if (event.error === 'no-speech') {
      // Restart automatically on no-speech to keep session alive
      if (isRecording) recognition.start();
    }
  };

  recognition.onend = () => {
    // Auto-restart if still in recording mode (browser stops after silence)
    if (isRecording) {
      try { recognition.start(); } catch (_) { /* already started */ }
    }
  };

  return true;
}

// ===== Timer =====
function startTimer() {
  seconds = 0;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    seconds++;
    updateTimerDisplay();
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function updateTimerDisplay() {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

// ===== Recording Controls =====
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
  statusText.textContent = 'Listening…';
  transcriptEl.classList.remove('hidden');
  actionBar.classList.add('hidden');
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  if (recognition) {
    try { recognition.stop(); } catch (_) { /* ignore */ }
  }
  stopTimer();

  recordBtn.classList.remove('recording');
  recordLabel.textContent = 'Tap to Record';
  recordBtn.setAttribute('aria-label', 'Start recording');

  statusBar.classList.add('hidden');

  const text = currentText.trim();
  if (text) {
    transcriptText.textContent = text;
    actionBar.classList.remove('hidden');
  } else {
    transcriptEl.classList.add('hidden');
    showToast('No speech detected. Try again!');
  }
}

// ===== Record Button Handler =====
recordBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

// ===== Save / Discard =====
saveBtn.addEventListener('click', () => {
  const text = currentText.trim() || transcriptText.textContent.trim();
  if (!text) return;
  saveIdea(text);
  resetRecorder();
  showToast('Idea saved!');
});

discardBtn.addEventListener('click', () => {
  resetRecorder();
  showToast('Idea discarded.');
});

function resetRecorder() {
  currentText = '';
  transcriptText.textContent = '';
  transcriptEl.classList.add('hidden');
  actionBar.classList.add('hidden');
}

// ===== Storage =====
function loadIdeas() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function persistIdeas(ideas) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas));
}

function saveIdea(text) {
  const ideas = loadIdeas();
  const idea = {
    id:        Date.now(),
    text:      text,
    createdAt: new Date().toISOString()
  };
  ideas.unshift(idea);
  persistIdeas(ideas);
  renderIdeas();
}

function deleteIdea(id) {
  const ideas = loadIdeas().filter(i => i.id !== id);
  persistIdeas(ideas);
  renderIdeas();
  showToast('Idea deleted.');
}

function copyIdea(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
  } else {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied!');
  }
}

// ===== Render Ideas =====
function renderIdeas() {
  const ideas = loadIdeas();
  ideaCount.textContent = ideas.length;

  if (ideas.length === 0) {
    emptyState.classList.remove('hidden');
    ideasList.innerHTML = '';
    return;
  }

  emptyState.classList.add('hidden');
  ideasList.innerHTML = ideas.map(idea => `
    <li class="idea-item" data-id="${idea.id}">
      <div class="idea-body">
        <p class="idea-text">${escapeHtml(idea.text)}</p>
        <time class="idea-meta" datetime="${idea.createdAt}">${formatDate(idea.createdAt)}</time>
      </div>
      <div class="idea-actions">
        <button class="btn btn-icon copy-btn" title="Copy" aria-label="Copy idea">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/>
          </svg>
        </button>
        <button class="btn btn-icon danger delete-btn" title="Delete" aria-label="Delete idea">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M10 11v6m4-6v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2"/>
          </svg>
        </button>
      </div>
    </li>
  `).join('');

  // Delegate events
  ideasList.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.closest('.idea-item').dataset.id);
      const idea = loadIdeas().find(i => i.id === id);
      if (idea) copyIdea(idea.text);
    });
  });

  ideasList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.closest('.idea-item').dataset.id);
      deleteIdea(id);
    });
  });
}

// ===== Export =====
exportBtn.addEventListener('click', () => {
  const ideas = loadIdeas();
  if (!ideas.length) { showToast('No ideas to export.'); return; }

  const content = ideas
    .map((idea, i) => `${i + 1}. [${formatDate(idea.createdAt)}]\n${idea.text}`)
    .join('\n\n');

  const blob = new Blob([content], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `ideas-${formatFilename(new Date())}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Ideas exported!');
});

// ===== Clear All =====
clearAllBtn.addEventListener('click', () => {
  if (!loadIdeas().length) { showToast('No ideas to clear.'); return; }
  if (!confirm('Delete all saved ideas? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  renderIdeas();
  showToast('All ideas cleared.');
});

// ===== Manual Input (No-Speech Fallback) =====
saveManualBtn.addEventListener('click', () => {
  const text = manualInput.value.trim();
  if (!text) return;
  saveIdea(text);
  manualInput.value = '';
  noSpeechModal.classList.add('hidden');
  showToast('Idea saved!');
});

closeModalBtn.addEventListener('click', () => {
  noSpeechModal.classList.add('hidden');
});

noSpeechModal.addEventListener('click', (e) => {
  if (e.target === noSpeechModal) noSpeechModal.classList.add('hidden');
});

// ===== Toast =====
function showToast(message, duration = 2500) {
  clearTimeout(toastTimeout);
  toast.textContent = message;
  toast.classList.remove('hidden');
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), duration);
}

// ===== Helpers =====
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month:  'short',
    day:    'numeric',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit'
  });
}

function formatFilename(date) {
  return date.toISOString().slice(0, 10);
}

// ===== Init =====
renderIdeas();
