require('dotenv').config()

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({server});

const PORT = 8080;
const sessions = {};

const BASE_DIR = process.env.BASE_DIR;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/sessions', (req, res) => {
  const id = Math.random().toString(36).slice(2, 9);
  const cwd = req.body?.cwd?.trim() || BASE_DIR;

  console.log(`[session] Creating session ${id} in ${cwd}`);

  const ptyProcess = pty.spawn('claude', ['--dangerously-skip-permissions'], {
    name: 'xterm-color',
    cols: 220,
    rows: 50,
    cwd,
    env: process.env
  });

  const outputBuffer = [];

  ptyProcess.onData((data) => {
    const session = sessions[id];
    if (session.clients.length === 0){
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

wss.on('connection', (ws, req) => {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    console.log(`[ws] Browser connected to session ${id}`);
    const session = sessions[id];

    if (!session){
        console.log(`[ws] No session found for id ${id} - closing`);
        ws.close();
        return;
    }

    session.clients.push(ws);
    console.log(`[ws] Session ${id} now has ${session.clients.length} client(s)`);
    
    if (session.outputBuffer.length > 0) {
      console.log(`[ws] Flushing ${session.outputBuffer.length} buffered chunks to ${id}`);
      session.outputBuffer.forEach(chunk => ws.send(chunk));
      session.outputBuffer.length = 0; // clear the buffer
    }

    // browser -> PTY
    ws.on('message', (data) =>{
        const str = data.toString();
        try {
            const msg = JSON.parse(str);
            if(msg.type === 'resize') {
                console.log(`[pty:${id}] resizing...`);
                session.ptyProcess.resize(msg.cols, msg.rows);
                return;
            }
        } catch(e) {
            console.log(`[ws:${id}] Unknown JSON input.`)
        }
        session.ptyProcess.write(data.toString());
        
    });

    ws.on('close', () => {
        console.log(`[ws] Browsers disconnected from session ${id}`);
        session.clients = session.clients.filter(c => c !== ws);    
    });
});

app.delete('sessions/:id', (req, res) => {
    console.log(`[session] Killing session ${req.params.id}`);
    const session = sessions[req.params.id];
    if(session){
        session.ptyProcess.kill();
        delete sessions[req.params.id];
        console.log(`[session] Session ${req.params.id} killed`);
    } else {
        console.log(`[session] Session ${req.params.id} not found`);
    }
    res.json({ok:true});
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
    res.json({ ok: true, path: dirPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }

  console.log(`[dir] Created directory at ${dirPath}`);
});

app.get('/directories', (req, res) => {
  try {
    const entries = fs.readdirSync(BASE_DIR, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .filter(e => !e.name.startsWith("."))
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
    console.log(`Dasbboard running on http://localhost:${PORT}`);
})