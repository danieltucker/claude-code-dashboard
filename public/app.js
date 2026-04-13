const sessions = {};
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
    dirSelect.innerHTML  = '<option value="">No projects yet</option>';
    createBtn.disabled   = true;
  } else {
    dirSelect.innerHTML = dirs.map(d => `<option value="${d}">${d}</option>`).join('');
    if (selectName) dirSelect.value = selectName;
    createBtn.disabled = false;
  }

  // If we were in "new" mode and a project was just created, return to existing
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
    theme: {
      background:   '#09090f',
      foreground:   '#ddddf0',
      cursor:       '#7c6af7',
      cursorAccent: '#09090f',
      selectionBackground: '#7c6af740',
      black:        '#1e1e2a',
      red:          '#f87171',
      green:        '#34d399',
      yellow:       '#fbbf24',
      blue:         '#7c6af7',
      magenta:      '#c084fc',
      cyan:         '#22d3ee',
      white:        '#ddddf0',
      brightBlack:  '#55556a',
      brightRed:    '#fca5a5',
      brightGreen:  '#6ee7b7',
      brightYellow: '#fde68a',
      brightBlue:   '#a78bfa',
      brightMagenta:'#d8b4fe',
      brightCyan:   '#67e8f9',
      brightWhite:  '#f5f5ff',
    }
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

// Mobile sidebar
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
