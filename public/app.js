const sessions = {};

// ── Theme system ──────────────────────────────────────────────────────────────

const TERMINAL_THEMES = {
  nebula: {
    background: '#09090f', foreground: '#ddddf0', cursor: '#7c6af7',
    cursorAccent: '#09090f', selectionBackground: '#7c6af740',
    black: '#1e1e2a', red: '#f87171', green: '#34d399', yellow: '#fbbf24',
    blue: '#7c6af7', magenta: '#c084fc', cyan: '#22d3ee', white: '#ddddf0',
    brightBlack: '#55556a', brightRed: '#fca5a5', brightGreen: '#6ee7b7',
    brightYellow: '#fde68a', brightBlue: '#a78bfa', brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9', brightWhite: '#f5f5ff',
  },
  dark: {
    background: '#0a0a0a', foreground: '#e0e0e0', cursor: '#3b82f6',
    cursorAccent: '#0a0a0a', selectionBackground: '#3b82f640',
    black: '#1a1a1a', red: '#f87171', green: '#4ade80', yellow: '#facc15',
    blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e0e0e0',
    brightBlack: '#444', brightRed: '#fca5a5', brightGreen: '#86efac',
    brightYellow: '#fef08a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9', brightWhite: '#ffffff',
  },
  light: {
    background: '#fafafa', foreground: '#1a1a2e', cursor: '#6366f1',
    cursorAccent: '#fafafa', selectionBackground: '#6366f130',
    black: '#1a1a2e', red: '#dc2626', green: '#059669', yellow: '#d97706',
    blue: '#4f46e5', magenta: '#7c3aed', cyan: '#0891b2', white: '#6b7280',
    brightBlack: '#9ca3af', brightRed: '#ef4444', brightGreen: '#10b981',
    brightYellow: '#f59e0b', brightBlue: '#6366f1', brightMagenta: '#8b5cf6',
    brightCyan: '#06b6d4', brightWhite: '#1a1a2e',
  },
  ember: {
    background: '#0a0807', foreground: '#f5ede6', cursor: '#d4532a',
    cursorAccent: '#0a0807', selectionBackground: '#d4532a40',
    black: '#231b15', red: '#e05530', green: '#e8963a', yellow: '#f5c842',
    blue: '#d4532a', magenta: '#c87050', cyan: '#d4956a', white: '#f5ede6',
    brightBlack: '#605040', brightRed: '#f07050', brightGreen: '#f5b050',
    brightYellow: '#f5d870', brightBlue: '#e87050', brightMagenta: '#d49070',
    brightCyan: '#e8b090', brightWhite: '#fff8f0',
  },
  claude: {
    background: '#0e0b09', foreground: '#f0e4d8', cursor: '#d97559',
    cursorAccent: '#0e0b09', selectionBackground: '#d9755940',
    black: '#26201a', red: '#e07060', green: '#34d399', yellow: '#f5a623',
    blue: '#d97559', magenta: '#c084a0', cyan: '#7ec8c8', white: '#f0e4d8',
    brightBlack: '#5e4e40', brightRed: '#f0907a', brightGreen: '#6ee7b7',
    brightYellow: '#fbbf67', brightBlue: '#e8956e', brightMagenta: '#d4a0b8',
    brightCyan: '#a8d8d8', brightWhite: '#fdf5ee',
  },
};

function applyTheme(name) {
  if (!TERMINAL_THEMES[name]) name = 'nebula';
  document.documentElement.dataset.theme = name;
  localStorage.setItem('theme', name);

  // Update all live terminals
  Object.values(sessions).forEach(({ term }) => {
    term.options.theme = TERMINAL_THEMES[name];
  });

  // Reflect active state on theme buttons
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === name);
  });
}

function currentTheme() {
  return document.documentElement.dataset.theme || 'nebula';
}

// Apply saved theme on load (inline script in <head> handles the very first
// paint; this call syncs the button states once the DOM is ready)
applyTheme(localStorage.getItem('theme') || 'nebula');

// ── Config panel ──────────────────────────────────────────────────────────────

const configOverlay = document.getElementById('config-overlay');
const configBtn     = document.getElementById('config-btn');
const configClose   = document.getElementById('config-close');

configBtn.addEventListener('click', () => {
  configOverlay.hidden = false;
  // Sync active state in case theme changed externally
  applyTheme(currentTheme());
});

configClose.addEventListener('click', () => { configOverlay.hidden = true; });

configOverlay.addEventListener('click', (e) => {
  if (e.target === configOverlay) configOverlay.hidden = true;
});

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
});

// ── Session management ────────────────────────────────────────────────────────

let activeSessionId = null;
let currentMode = 'existing';

const sessionList  = document.getElementById('session-list');
const terminalsDiv = document.getElementById('terminals');
const newDirInput  = document.getElementById('new-dir-input');
const dirSelect    = document.getElementById('dir-select');
const createBtn    = document.getElementById('create-session-btn');
const cancelBtn    = document.getElementById('cancel-new-btn');
const newBtn       = document.getElementById('new-btn');
const dirChoice    = document.getElementById('dir-choice');
const newPanel     = document.getElementById('new-dir-panel');

function switchMode(mode) {
  currentMode = mode;
  if (mode === 'existing') {
    dirChoice.style.display  = 'flex';
    newPanel.style.display   = 'none';
    cancelBtn.style.display  = 'none';
    createBtn.textContent    = 'Start Session';
    createBtn.disabled       = dirSelect.value === '';
  } else {
    dirChoice.style.display  = 'none';
    newPanel.style.display   = 'block';
    cancelBtn.style.display  = 'block';
    createBtn.textContent    = 'Create Project';
    createBtn.disabled       = false;
    setTimeout(() => newDirInput.focus(), 0);
  }
}

async function loadDirectories(selectName = null) {
  console.log('[dirs] Fetching available directories');
  const res = await fetch('/directories');
  const { dirs } = await res.json();
  console.log('[dirs] Found:', dirs);

  if (dirs.length === 0) {
    dirSelect.innerHTML = '<option value="">No projects yet</option>';
    createBtn.disabled  = true;
  } else {
    dirSelect.innerHTML = dirs.map(d => `<option value="${d}">${d}</option>`).join('');
    if (selectName) dirSelect.value = selectName;
    createBtn.disabled = false;
  }

  if (selectName && currentMode === 'new') switchMode('existing');
}

loadDirectories();

newBtn.addEventListener('click', () => switchMode('new'));

cancelBtn.addEventListener('click', () => {
  newDirInput.value = '';
  switchMode('existing');
});

dirSelect.addEventListener('change', () => {
  createBtn.disabled = dirSelect.value === '';
});

createBtn.addEventListener('click', async () => {
  console.log('[create] Button clicked, mode:', currentMode);
  let cwd = null;

  if (currentMode === 'new') {
    const name = newDirInput.value.trim();
    if (!name) return alert('Please enter a project name.');

    const checkRes = await fetch(`/directories/${encodeURIComponent(name)}/exists`);
    const { exists, path: dirPath } = await checkRes.json();

    if (exists) {
      const useExisting = confirm(`"${name}" already exists. Open it anyway?`);
      if (!useExisting) return;
      cwd = dirPath;
    } else {
      const res = await fetch('/directories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) return alert('Failed to create project: ' + data.error);
      cwd = data.path;
    }
    newDirInput.value = '';
    await loadDirectories(name);

  } else {
    const selected = dirSelect.value;
    if (!selected) return;

    const checkRes = await fetch(`/directories/${encodeURIComponent(selected)}/exists`);
    const { exists, path: dirPath } = await checkRes.json();

    if (!exists) {
      alert(`"${selected}" no longer exists on disk. Refreshing the list.`);
      await loadDirectories();
      return;
    }
    cwd = dirPath;
  }

  console.log('[create] Spawning session in:', cwd);
  const res = await fetch('/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd })
  });

  if (res.status === 401) {
    location.href = '/login';
    return;
  }

  const { id, cwd: resolvedCwd } = await res.json();
  console.log('[create] Session created:', { id, resolvedCwd });
  spawnTerminal(id, resolvedCwd);
});

function spawnTerminal(id, cwd) {
  console.log(`[terminal] Spawning terminal for session ${id} at ${cwd}`);

  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 13,
    fontFamily: "'Cascadia Code', 'Fira Code', ui-monospace, monospace",
    fontWeight: '400',
    lineHeight: 1.5,
    theme: TERMINAL_THEMES[currentTheme()],
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const wrapper = document.createElement('div');
  wrapper.classList.add('terminal-wrapper');
  wrapper.id = `terminal-${id}`;
  terminalsDiv.appendChild(wrapper);

  term.open(wrapper);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}?id=${id}`);

  ws.onopen = () => {
    console.log(`[ws] WebSocket open for session ${id}`);
    fitAddon.fit();
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };

  ws.onmessage = (e) => term.write(e.data);
  ws.onerror   = (err) => console.error(`[ws] error for session ${id}:`, err);
  ws.onclose   = () => console.log(`[ws] closed for session ${id}`);

  term.onResize(({ cols, rows }) => {
    console.log(`[terminal] resize ${id}: ${cols}x${rows}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  term.onData(data => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  sessions[id] = { term, ws, cwd, fitAddon };

  addSessionToSidebar(id, cwd);
  switchToSession(id);
}

function addSessionToSidebar(id, cwd) {
  const item = document.createElement('div');
  item.classList.add('session-item');
  item.id = `session-item-${id}`;
  item.innerHTML = `
    <span class="session-label">${cwd.split('/').pop()}</span>
    <span class="kill-btn" data-id="${id}">✕</span>
  `;

  item.addEventListener('click', (e) => {
    if (e.target.classList.contains('kill-btn')) {
      killSession(id);
    } else {
      switchToSession(id);
    }
  });

  sessionList.appendChild(item);
}

function switchToSession(id) {
  document.querySelectorAll('.terminal-wrapper').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));

  document.getElementById(`terminal-${id}`)?.classList.add('active');
  document.getElementById(`session-item-${id}`)?.classList.add('active');

  activeSessionId = id;

  requestAnimationFrame(() => {
    sessions[id]?.fitAddon?.fit();
  });

  closeSidebarOnMobile();
}

async function killSession(id) {
  try {
    await fetch(`/sessions/${id}`, { method: 'DELETE' });
  } catch (err) {
    console.log(`[kill] Server-side session ${id} already gone.`);
  }
  sessions[id]?.ws.close();
  sessions[id]?.term.dispose();
  document.getElementById(`terminal-${id}`)?.remove();
  document.getElementById(`session-item-${id}`)?.remove();
  delete sessions[id];

  const remaining = Object.keys(sessions);
  if (remaining.length) switchToSession(remaining[0]);
}

window.addEventListener('resize', () => {
  if (activeSessionId && sessions[activeSessionId]) {
    sessions[activeSessionId].fitAddon?.fit();
  }
});

// ── Mobile sidebar ────────────────────────────────────────────────────────────

const sidebar   = document.getElementById('sidebar');
const overlay   = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');

hamburger?.addEventListener('click', () => {
  sidebar.classList.add('open');
  overlay.classList.add('visible');
});

overlay.addEventListener('click', () => {
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
});

function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  }
}
