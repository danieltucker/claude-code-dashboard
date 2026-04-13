# Claude Code Dashboard - Self-Hosted

I built this "dashboard" because I wanted to run multiple Claude Code sessions as if I was in my own terminal on my own machine. Though Anthropic has come out with some cool tools to bridge this gap, the one thing that it still lacks is the ability to use slash commands within Claude Code.

This fixes that.

This repo contains a few files that "emulate" terminals directly in the browser. This means Claude Code doesn't even know that its being accessed over the web. This allows you to use Claude Code from anywhere as if you were sitting at your machine.
Not only that, but you can spawn as many Claude Code sessions as you would like in existing directories, or create new directories and start fresh!
And maybe best of all -- this uses your existing Claude Code subscription! You do not have to use an API key (which runs higher costs) or create anything special, just run Claude.

## Installation & Setup

### Running locally (no Docker)

**Prerequisites:** Node.js and Claude Code (`claude` CLI) must be installed and available in your PATH.

1. **Clone the repo and install dependencies:**
   ```bash
   git clone <repo-url>
   cd claude-code-dashboard
   npm install
   ```

2. **Configure your environment:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` — see [Environment Variables](#environment-variables) below.

3. **Start the server:**
   ```bash
   node server.js
   # or: npm start
   ```

4. **Open your browser** at [http://localhost:8080](http://localhost:8080)

---

### Running with Docker

Docker is the recommended way to run the dashboard. It sandboxes Claude Code so that `--dangerously-skip-permissions` cannot affect your host OS directly.

1. **Configure your environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `HOST_BASE_DIR` to the folder on your machine containing your projects, and fill in `AUTH_USERS` and `SESSION_SECRET`.

2. **Build and start:**
   ```bash
   docker compose up --build
   ```

3. **Open your browser** at [http://localhost:8080](http://localhost:8080)

Your projects directory is mounted into the container at `/workspace`. Your existing Claude Code credentials (`~/.claude`) are also mounted so the container can authenticate without any extra setup.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values. All variables are described below.

| Variable | Required | Description |
|---|---|---|
| `BASE_DIR` | Yes | The directory the server lists and creates projects in. When running locally, set this to your projects folder (e.g. `/Users/yourname/dev`). When running with Docker, set this to `/workspace`. |
| `HOST_BASE_DIR` | Docker only | The path on your **host machine** to mount into the container as `/workspace`. Example: `/Users/yourname/dev`. |
| `AUTH_USERS` | Yes | Comma-separated `username:password` pairs for login. Example: `alice:mypassword,bob:anotherpassword`. |
| `SESSION_SECRET` | Yes | A random string used to sign session cookies. Change this before deploying — any long random value works. |
| `CLAUDE_BIN` | No | Override the path to the `claude` binary. Auto-detected from your login shell if not set. Useful in custom environments where `claude` is not on `$PATH`. |

---

## A Few Notes

- A login page protects all routes. Users are defined via `AUTH_USERS` in `.env` — add as many `username:password` pairs as needed.
- Each new session runs `claude --dangerously-skip-permissions` immediately at spawn time. If you prefer to run Claude **with** permissions, remove `--dangerously-skip-permissions` from the args array in `server.js`.
- This does not provide direct terminal access — it only spawns Claude Code within a selected directory. You cannot run arbitrary shell commands.

## Security

**Do NOT** self-host this without a security layer in front. This will provide access to whatever directory you set as `BASE_DIR`. I use a Cloudflare Tunnel with Zero Trust Access, which is straightforward to set up.

Enjoy!
pb-crackers
