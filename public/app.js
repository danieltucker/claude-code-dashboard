const sessions = {};
let activeSessionId = null;
let currentMode = 'existing'; // track which mode the user is in

const sessionList = document.getElementById('session-list');
const terminalsDiv = document.getElementById('terminals');
const newDirInput = document.getElementById('new-dir-input');
const dirSelect = document.getElementById('dir-select');
const createBtn = document.getElementById('create-session-btn');
const choiceBtns = document.querySelectorAll('.choice-btn');
const existingPanel = document.getElementById('existing-dir-panel');
const newPanel = document.getElementById('new-dir-panel');

// Load available directories on page load
async function loadDirectories() {
  console.log('[dirs] Fetching available directories');
  const res = await fetch('/directories');
  const { dirs } = await res.json();
  console.log('[dirs] Found:', dirs);

  dirSelect.innerHTML = dirs.length
    ? dirs.map(d => `<option value="${d}">${d}</option>`).join('')
    : '<option value="">No directories found</option>';
}

loadDirectories();

// Toggle between existing / new modes
choiceBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    currentMode = btn.dataset.mode;
    choiceBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (currentMode === 'existing') {
      existingPanel.style.display = 'block';
      newPanel.style.display = 'none';
    } else {
      existingPanel.style.display = 'none';
      newPanel.style.display = 'block';
    }
  });
});

createBtn.addEventListener('click', async () => {
  console.log('[create] Button clicked, mode:', currentMode);
  let cwd = null;

  if (currentMode === 'new') {
    const name = newDirInput.value.trim();

    if (!name) return alert('Please enter a folder name.');

    // Check if it already exists
    const checkRes = await fetch(`/directories/${name}/exists`);
    const { exists } = await checkRes.json();

    if (exists) {
      const useExisting = confirm(`"${name}" already exists. Open it anyway?`);
      if (!useExisting) return;
      cwd = `/home/phillip-dougherty/${name}`;
    } else {
      // Create it
      const res = await fetch('/directories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) return alert('Failed to create directory: ' + data.error);
      cwd = data.path;
      await loadDirectories(); // refresh the list
    }

  } else {
    // Existing mode
    const selected = dirSelect.value;
    if (!selected) return alert('Please select a directory.');

    // Verify it still exists (could have been deleted externally)
    const checkRes = await fetch(`/directories/${selected}/exists`);
    const { exists, path: dirPath } = await checkRes.json();

    if (!exists) {
      alert(`"${selected}" no longer exists on disk. Refreshing the list.`);
      await loadDirectories();
      return;
    }

    cwd = dirPath;
  }

  // Create the session
  console.log('[create] Spawning session in:', cwd);
  const res = await fetch('/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd })
  });
  const { id, cwd: resolvedCwd } = await res.json();
  console.log('[create] Session created:', { id, resolvedCwd });

  newDirInput.value = '';
  spawnTerminal(id, resolvedCwd);
});

function spawnTerminal(id, cwd) {
  console.log(`[terminal] Spawning terminal for session ${id} at ${cwd}`);

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'monospace',
    theme: {
      background: '#1a1a1a',
      foreground: '#e0e0e0',
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
    // fit AFTER ws is open so we can immediately send the correct size
    fitAddon.fit();

    // tell the PTY our actual dimensions
    ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
  };

  ws.onmessage = (e) => term.write(e.data);

  ws.onerror = (err) => console.error(`[ws] error for session ${id}:`, err);
  ws.onclose = () => console.log(`[ws] closed for session ${id}`);

  // when xterm.js resizes, sync the PTY
  term.onResize(({ cols, rows }) => {
    console.log(`[terminal] resize ${id}: ${cols}x${rows}`);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });

  term.onData(data => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  // store everything on the session — including fitAddon
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

  // use requestAnimationFrame so the DOM is visible before we measure it
  requestAnimationFrame(() => {
    sessions[id]?.fitAddon?.fit();
  });

  closeSidebarOnMobile();
}

async function killSession(id) {
  try {
    await fetch(`/sessions/${id}`, { method: 'DELETE' });
  } catch(err) {
    console.log(`[kill] Server-side session ${id} already gone.`)
  }
  sessions[id]?.ws.close();
  sessions[id]?.term.dispose();
  document.getElementById(`terminal-${id}`)?.remove();
  document.getElementById(`session-item-${id}`)?.remove();
  delete sessions[id];

  // Switch to another session if one exists
  const remaining = Object.keys(sessions);
  if (remaining.length) switchToSession(remaining[0]);
}

window.addEventListener('resize', () => {
  if (activeSessionId && sessions[activeSessionId]) {
    sessions[activeSessionId].fitAddon?.fit();
  }
});

// Mobile sidebar
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const hamburger = document.getElementById('hamburger');

hamburger?.addEventListener('click', () => {
  sidebar.classList.add('open');
  overlay.classList.add('visible');
});

overlay.addEventListener('click', () => {
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
});

// close sidebar when a session is selected on mobile
function closeSidebarOnMobile() {
  if (window.innerWidth <= 768) {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  }
}