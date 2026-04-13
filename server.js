require('dotenv').config()

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const session = require('express-session');

// Resolve the claude binary using the user's login shell so PATH from .zshrc/.zprofile is respected
const SHELL = process.env.SHELL || '/bin/bash';
let CLAUDE_BIN = process.env.CLAUDE_BIN || `${process.env.HOME}/.local/bin/claude`;
if (!process.env.CLAUDE_BIN) {
  try {
    CLAUDE_BIN = execSync(`${SHELL} -l -c 'which claude'`, { timeout: 5000 }).toString().trim();
    console.log(`[init] Resolved claude binary: ${CLAUDE_BIN}`);
  } catch (e) {
    console.warn(`[init] Could not resolve claude via login shell, using fallback: ${CLAUDE_BIN}`);
  }
} else {
  console.log(`[init] Using CLAUDE_BIN from env: ${CLAUDE_BIN}`);
}

const REQUIRE_AUTH = process.env.REQUIRE_AUTH !== 'false';

// Parse users from AUTH_USERS env var: "user1:pass1,user2:pass2"
const USERS = {};
(process.env.AUTH_USERS || '').split(',').forEach(entry => {
  const colonIdx = entry.trim().indexOf(':');
  if (colonIdx > 0) {
    const username = entry.trim().slice(0, colonIdx);
    const password = entry.trim().slice(colonIdx + 1);
    USERS[username] = password;
  }
});
if (REQUIRE_AUTH && Object.keys(USERS).length === 0) {
  console.warn('[auth] WARNING: No AUTH_USERS configured — all login attempts will fail.');
}
console.log(`[init] Authentication: ${REQUIRE_AUTH ? 'enabled' : 'disabled'}`);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 8080;
const sessions = {};
const BASE_DIR = process.env.BASE_DIR;

// Session middleware (shared so we can reuse it for WebSocket auth)
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'changeme-please',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
});

app.use(sessionMiddleware);
app.use(express.json());

function requireAuth(req, res, next) {
  if (!REQUIRE_AUTH) return next();
  if (req.session?.user) return next();
  if (req.headers['accept']?.includes('application/json') ||
      req.headers['content-type']?.includes('application/json')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login');
}

// ── Public routes ──────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const { username, password } = req.body;
  if (username && USERS[username] && USERS[username] === password) {
    req.session.user = username;
    return res.redirect('/');
  }
  res.redirect('/login?error=1');
});

app.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ── Protected routes ───────────────────────────────────────────────────────────

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.post('/sessions', (req, res) => {
  const id = Math.random().toString(36).slice(2, 9);
  const cwd = req.body?.cwd?.trim() || BASE_DIR;

  console.log(`[session] Creating session ${id} in ${cwd} using ${CLAUDE_BIN}`);

  const ptyProcess = pty.spawn(CLAUDE_BIN, ['--dangerously-skip-permissions'], {
    name: 'xterm-color',
    cols: 220,
    rows: 50,
    cwd,
    env: process.env
  });

  const outputBuffer = [];

  ptyProcess.onData((data) => {
    const session = sessions[id];
    if (!session) return;
    if (session.clients.length === 0) {
      outputBuffer.push(data);
    } else {
      session.clients.forEach(client => {
        if (client.readyState === client.OPEN) client.send(data);
      });
    }
    console.log(`[pty:${id}] output: ${data.slice(0, 60).replace(/\n/g, '↵')}`);
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[pty:${id}] process exited with code ${exitCode}`);
  });

  sessions[id] = { ptyProcess, clients: [], cwd, outputBuffer };
  console.log(`[session] Session ${id} ready`);
  res.json({ id, cwd });
});

// WebSocket — verify session before accepting
wss.on('connection', (ws, req) => {
  const fakeRes = { getHeader: () => {}, setHeader: () => {}, end: () => {} };
  sessionMiddleware(req, fakeRes, () => {
    if (REQUIRE_AUTH && !req.session?.user) {
      console.log('[ws] Rejected unauthenticated WebSocket connection');
      ws.close(1008, 'Unauthorized');
      return;
    }

    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    console.log(`[ws] Browser connected to session ${id}`);
    const session = sessions[id];

    if (!session) {
      console.log(`[ws] No session found for id ${id} - closing`);
      ws.close();
      return;
    }

    session.clients.push(ws);
    console.log(`[ws] Session ${id} now has ${session.clients.length} client(s)`);

    if (session.outputBuffer.length > 0) {
      console.log(`[ws] Flushing ${session.outputBuffer.length} buffered chunks to ${id}`);
      session.outputBuffer.forEach(chunk => ws.send(chunk));
      session.outputBuffer.length = 0;
    }

    ws.on('message', (data) => {
      const str = data.toString();
      try {
        const msg = JSON.parse(str);
        if (msg.type === 'resize') {
          console.log(`[pty:${id}] resizing...`);
          session.ptyProcess.resize(msg.cols, msg.rows);
          return;
        }
      } catch (e) {
        console.log(`[ws:${id}] Unknown JSON input.`);
      }
      session.ptyProcess.write(data.toString());
    });

    ws.on('close', () => {
      console.log(`[ws] Browser disconnected from session ${id}`);
      session.clients = session.clients.filter(c => c !== ws);
    });
  });
});

app.delete('/sessions/:id', (req, res) => {
  console.log(`[session] Killing session ${req.params.id}`);
  const session = sessions[req.params.id];
  if (session) {
    session.ptyProcess.kill();
    delete sessions[req.params.id];
    console.log(`[session] Session ${req.params.id} killed`);
  } else {
    console.log(`[session] Session ${req.params.id} not found`);
  }
  res.json({ ok: true });
});

app.post('/directories', (req, res) => {
  const { name } = req.body;
  console.log(`[dir] Request to create directory: ${name}`);

  if (!name || name.includes('/') || name.includes('..')) {
    return res.status(400).json({ error: 'Must provide a simple directory name with no slashes' });
  }

  const dirPath = path.join(BASE_DIR, name);

  try {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`[dir] Created directory at ${dirPath}`);
    res.json({ ok: true, path: dirPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/directories', (_req, res) => {
  try {
    const entries = fs.readdirSync(BASE_DIR, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .filter(e => !e.name.startsWith('.'))
      .map(e => e.name);
    console.log(`[dir] Listing directories in ${BASE_DIR}:`, dirs);
    res.json({ dirs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/directories/:name/exists', (req, res) => {
  const { name } = req.params;
  const dirPath = path.join(BASE_DIR, name);
  const exists = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  console.log(`[dir] Existence check for ${dirPath}: ${exists}`);
  res.json({ exists, path: dirPath });
});

server.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
});
