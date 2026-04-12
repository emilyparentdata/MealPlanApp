// === In-page countdown timers for recipe directions ===

const TIME_RE = /\b(?:for\s+)?(\d+)\s*(?:[-–]\s*(\d+)\s*)?(minutes?|mins?|hours?|hrs?|seconds?|secs?)\b/gi;

let timers = [];
let tickInterval = null;
let audioCtx = null;
let widgetEl = null;
let bodyEl = null;

// --- Public API ---

export function linkifyTimeReferences(html) {
  return html.replace(TIME_RE, (match, num1, num2, unit) => {
    const val = num2 ? parseInt(num2, 10) : parseInt(num1, 10);
    const seconds = toSeconds(val, unit);
    return `<span class="timer-link" data-seconds="${seconds}" tabindex="0" role="button" title="Tap to start a ${formatTime(seconds)} timer">${match}</span>`;
  });
}

export function initTimerWidget() {
  if (widgetEl) return;

  widgetEl = document.createElement('div');
  widgetEl.id = 'timer-widget';
  widgetEl.className = 'timer-widget hidden';
  widgetEl.innerHTML = `
    <div class="timer-widget-header">
      <span class="timer-widget-title">Timers</span>
      <button class="timer-widget-collapse" title="Minimize">&#8211;</button>
    </div>
    <div class="timer-widget-body"></div>
  `;
  document.body.appendChild(widgetEl);
  bodyEl = widgetEl.querySelector('.timer-widget-body');

  // Collapse/expand toggle
  const collapseBtn = widgetEl.querySelector('.timer-widget-collapse');
  collapseBtn.addEventListener('click', () => {
    const collapsed = bodyEl.classList.toggle('hidden');
    collapseBtn.textContent = collapsed ? '+' : '\u2013';
    collapseBtn.title = collapsed ? 'Expand' : 'Minimize';
  });

  // Delegated click handler for timer links anywhere on the page
  document.body.addEventListener('click', (e) => {
    const link = e.target.closest('.timer-link');
    if (!link) return;
    const seconds = parseInt(link.dataset.seconds, 10);
    if (!seconds || seconds <= 0) return;
    const label = link.textContent.trim();
    startTimer(label, seconds);
  });

  // Delegated handler for cancel buttons inside widget
  widgetEl.addEventListener('click', (e) => {
    const cancelBtn = e.target.closest('.timer-cancel');
    if (!cancelBtn) return;
    const entry = cancelBtn.closest('.timer-entry');
    if (!entry) return;
    removeTimer(entry.dataset.timerId);
  });
}

// --- Timer lifecycle ---

function startTimer(label, totalSeconds) {
  const id = 't' + Date.now() + Math.random().toString(36).slice(2, 6);
  const timer = { id, label, totalSeconds, remainingSeconds: totalSeconds, done: false };
  timers.push(timer);

  const entry = document.createElement('div');
  entry.className = 'timer-entry';
  entry.dataset.timerId = id;
  entry.innerHTML = `
    <span class="timer-label">${escHtml(label)}</span>
    <span class="timer-countdown">${formatTime(totalSeconds)}</span>
    <button class="timer-cancel" title="Cancel">&times;</button>
  `;
  bodyEl.appendChild(entry);
  widgetEl.classList.remove('hidden');
  bodyEl.classList.remove('hidden');
  widgetEl.querySelector('.timer-widget-collapse').textContent = '\u2013';

  if (!tickInterval) {
    tickInterval = setInterval(tick, 1000);
  }

  // Ensure AudioContext is created from a user gesture
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
}

function removeTimer(id) {
  timers = timers.filter(t => t.id !== id);
  const entry = bodyEl.querySelector(`[data-timer-id="${id}"]`);
  if (entry) entry.remove();

  if (timers.length === 0) {
    widgetEl.classList.add('hidden');
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }
}

function tick() {
  for (const timer of timers) {
    if (timer.done) continue;
    timer.remainingSeconds--;

    const entry = bodyEl.querySelector(`[data-timer-id="${timer.id}"]`);
    if (!entry) continue;

    if (timer.remainingSeconds <= 0) {
      timer.done = true;
      entry.classList.add('done');
      entry.querySelector('.timer-countdown').textContent = 'Done!';
      playBeep();
      vibrate();
      // Auto-dismiss after 30 seconds
      setTimeout(() => removeTimer(timer.id), 30000);
    } else {
      entry.querySelector('.timer-countdown').textContent = formatTime(timer.remainingSeconds);
    }
  }
}

// --- Audio & haptics ---

function playBeep() {
  if (!audioCtx) return;
  try {
    // Resume context if suspended (mobile requirement)
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // Play 3 short beeps
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 880;
      osc.type = 'square';
      gain.gain.value = 0.2;
      const start = audioCtx.currentTime + i * 0.3;
      osc.start(start);
      osc.stop(start + 0.15);
    }
  } catch (_) {}
}

function vibrate() {
  try {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
  } catch (_) {}
}

// --- Helpers ---

function toSeconds(val, unit) {
  const u = unit.toLowerCase();
  if (u.startsWith('h')) return val * 3600;
  if (u.startsWith('s')) return val;
  return val * 60; // minutes
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
