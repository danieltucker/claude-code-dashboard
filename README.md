# Claude Code Dashboard - Self-Hosted

I built this "dashboard" because I wanted to run multiple Claude Code sessions as if I was in my own terminal on my own machine. Though Anthropic has come out with some cool tools to bridge this gap, the one thing that it still lacks is the ability to use slash commands within Claude Code.

This fixes that.

This repo contains a few files that "emulate" terminals directly in the browser. This means Claude Code doesn't even know that its being accessed over the web. This allows you to use Claude Code from anywhere as if you were sitting at your machine.
Not only that, but you can spawn as many Claude Code sessions as you would like in existing directories, or create new directories and start fresh!
And maybe best of all -- this uses your existing Claude Code subscription! You do not have to use an API key (which runs higher costs) or create anything special, just run Claude.

## A Few Notes
A couple things to note about the way this is currently built:
- Each new session created runs `claude --dangerously-skip-permissions` immediately at the time of spawning the session
    - This is controlled in `server.js` on line 28. If you prefer to spawn Claude **with** permissions, just remove the skip permissions argument from the array.
- This does not provide direct terminal access at this time, it just spawns Claude to work within an existing directory or allows you to create a new one and then immediately spawn Claude Code.

## Security
**Do NOT** self-host this without a security layer in front. This will provide direct access to whatever directory you set as your `BASE_DIR` and should use some layer of protection. I have use a Cloudflare Tunnel with Zero Access which is easy enough to setup.

Enjoy!
pb-crackers