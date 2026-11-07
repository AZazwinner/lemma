# Mathboard

A collaborative LaTeX editor that renders as you type. Write math like it's a document.

- Real-time collaborative editing, with live cursors
- LaTeX rendered live, inline and block
- Slash commands, formatting toolbar, templates, export to PDF, Markdown, HTML or text
- Sharing with read/write permissions, version history, trash

**Stack:** Next.js (`app/`), FastAPI (`src/`), Yjs via pycrdt for conflict-free editing, SQLite locally (PostgreSQL in Docker
or on a server), Alembic migrations.

## Quick start (no Docker)

**You need:** Git, Python 3.11 or newer, and Node 20.9 or newer. That is all: no Docker and no database server.
It was developed and tested on Windows with Python 3.14 and Node 24; the commands are the same in PowerShell, cmd,
macOS and Linux.

```
git clone https://github.com/AZazwinner/mathlatex.git
cd mathlatex
npm run setup
npm run dev
```

Then open **<http://localhost:12000>**, create an account and make a document. Press `Ctrl+C` to stop everything.

`npm run setup` takes a few minutes the first time. It:

- creates a Python environment in `src/venv` and installs `src/requirements.txt`;
- installs the frontend packages in `app/`;
- creates `src/.env` and `app/.env.local` from the `.env.example` files, only if they do not exist yet;
- creates the SQLite database `src/mathboard.db`.

It is safe to re-run and skips whatever is already done. `npm run dev` does the same checks first, so after a `git pull`
that changes packages or the database schema, just run `npm run dev` again.

There is nothing to configure. The database is the file `src/mathboard.db`, and the secret key that signs logins is made
for you on first run and kept in `src/.dev_secret_key`; both are gitignored. The dev backend listens on `127.0.0.1` only,
so it is not reachable from the network. `npm run dev` also raises the sign-up limit to 50 per IP (the backend's own default is
5 per 15 minutes) so testing with several accounts is not throttled; set `SIGNUP_MAX_ATTEMPTS` in `src/.env` to change it.

### Start over with an empty database

Stop the app, then:

```
npm run reset-db
```

This deletes every local account and document and creates a fresh database.

### Other commands

| Command | What it does |
|---|---|
| `npm run dev:web` | frontend only, to use a [shared backend](#use-a-shared-backend) (needs no Python) |
| `npm run dev:api` | backend only, to [host a shared backend](#running-the-backend-behind-a-cloudflare-tunnel) |
| `npm run setup -- --force` | reinstall the Python and frontend packages |

### If something goes wrong

| You see | Do this |
|---|---|
| `Python 3.11 or newer was not found` | install Python from <https://www.python.org/downloads/> (on Windows tick "Add python.exe to PATH"), then open a **new** terminal |
| `Port 12000 ... is already in use` (or 12001) | the app is already running in another terminal; stop it |
| `src/venv ... does not run` | delete the `src/venv` folder and run `npm run setup` again |
| `Could not create the Python environment` on Debian/Ubuntu | `sudo apt install python3-venv` |
| `Installing the frontend packages failed` | `cd app && npm install`, then `npm run dev` |

## Use a shared backend

To test multiplayer together without everyone running a backend, one teammate hosts it (see
[Running the backend behind a Cloudflare Tunnel](#running-the-backend-behind-a-cloudflare-tunnel)) and the others point their
frontend at it.

1. Get the backend's URL from the team, for example `https://api.example.com`.
2. In `app/.env.local` (made by `npm run setup`) set both lines. Use `wss://` when the URL is `https://`:

   ```
   NEXT_PUBLIC_API_URL=https://api.example.com
   NEXT_PUBLIC_WS_URL=wss://api.example.com
   ```

3. Run `npm run setup -- --web-only` once (skips Python), then `npm run dev:web`. It prints a warning if the backend does not
   answer.
4. Sign up in the app. Accounts and documents live on the host's machine, not yours. Sign in as different users in two
   browsers, share a document, and edit it together.

Things to know:

- Restart `npm run dev:web` after editing `app/.env.local`; the values are read at startup.
- Keep the frontend on `http://localhost:12000`, because the backend always allows that address. Any other address (another
  port, a Vercel URL) has to be added to the host's `CORS_ORIGINS`.
- To go back to your own backend, restore the two `localhost` lines (`http://localhost:12001` and `ws://localhost:12001`) and
  run `npm run dev`. A login from the other backend is not valid on this one, so sign in again if the app bounces you.

## Tests

```
# backend. One-time: add the test tools to the environment `npm run setup` made.
cd src
venv/bin/pip install -r requirements-dev.txt && venv/bin/pytest            # macOS / Linux
venv\Scripts\pip install -r requirements-dev.txt; venv\Scripts\pytest      # Windows PowerShell

# frontend
cd app && npm test                  # unit tests
cd app && npm run test:e2e          # Playwright; starts the frontend itself, the backend must already be running
```

Backend tests use a temporary SQLite file and need no services. For e2e, start the app with `npm run dev` (the suite signs up
16 users, which the raised sign-up limit allows). The forgot-password test also needs `ALLOW_DEV_RESET_LINK=1` in `src/.env`,
which shows the reset link on the page instead of emailing it; remove it afterwards and never set it on a shared backend.

## Configuration

Everything has a working default for local development; you only need these to change something. Copy the relevant
`.env.example` and uncomment what you change. Never commit a real `.env`.

| File | For | Variables |
|---|---|---|
| [`src/.env.example`](src/.env.example) | the backend (`npm run dev`) | all optional: `SECRET_KEY`, `DATABASE_URL`, `PORT`, `HOST`, `APP_URL`, `CORS_ORIGINS`, `WS_ACCEPT_LOGIN_TOKEN`, `FORWARDED_ALLOW_IPS`, `SIGNUP_MAX_ATTEMPTS`, `SMTP_*` for password-reset email |
| [`app/.env.example`](app/.env.example) | the frontend | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_APP_URL` |
| [`.env.example`](.env.example) | `docker compose` | `POSTGRES_PASSWORD`, `SECRET_KEY`, `CORS_ORIGINS`, `APP_URL`, the three `NEXT_PUBLIC_*`, `WS_ACCEPT_LOGIN_TOKEN`, `FORWARDED_ALLOW_IPS`, `SIGNUP_MAX_ATTEMPTS` |

The three `NEXT_PUBLIC_*` values are baked into the frontend when it starts or is built: restart (or rebuild) after changing
them.

## Running the backend behind a Cloudflare Tunnel

For a shared or demo instance: the backend runs on one machine, a Cloudflare Tunnel (`cloudflared`) exposes it at
`https://api.example.com`, and the frontend is served from somewhere else, such as `https://my-app.vercel.app` or
`http://localhost:12000`. This section does not create or change the tunnel. It only needs the backend listening on
a port.

**Host the backend.** On the machine that runs it, run `npm run setup -- --api-only` once, then `npm run dev:api`. That starts
only the backend, on `127.0.0.1:12001`, which is what `cloudflared` connects to. Put the settings below in `src/.env` first.
Teammates then follow [Use a shared backend](#use-a-shared-backend).

**Point the tunnel at the backend's port.** The ingress target is `http://localhost:12001`, or whatever `PORT` is
set to. WebSockets pass through a tunnel without extra settings. The tunnel terminates HTTPS, so the backend itself
stays plain HTTP.

**Backend settings** (in `src/.env`, or the root `.env` for Docker):

```
SECRET_KEY=<openssl rand -hex 32>          # optional outside Docker (a random key is made and kept in src/.dev_secret_key); in Docker, never the default
CORS_ORIGINS=https://my-app.vercel.app     # the FRONTEND's origin, exactly: scheme + host (+ port), no trailing slash
APP_URL=https://my-app.vercel.app          # the frontend again; used in password-reset links
WS_ACCEPT_LOGIN_TOKEN=0                    # WebSockets accept only short-lived tickets
FORWARDED_ALLOW_IPS=*                      # Docker only, see below
SIGNUP_MAX_ATTEMPTS=50                     # optional: sign-ups per IP per 15 min (default 5)
```

**Frontend settings** (Vercel project settings, or `app/.env.local`; redeploy after changing):

```
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com   # wss, not ws: an https page cannot open an insecure socket
NEXT_PUBLIC_APP_URL=https://my-app.vercel.app
```

Teammates running their own frontend at `http://localhost:12000` against the tunnelled backend need no extra setting, because
that origin is always allowed. A frontend on any other local port (say `http://localhost:3000`) has to be added to
`CORS_ORIGINS`: `CORS_ORIGINS=https://my-app.vercel.app,http://localhost:3000`.

**Real client IPs.** Sign-up is limited to 5 per IP per 15 minutes (raise it with `SIGNUP_MAX_ATTEMPTS`, for example
for a demo), and repeated failed sign-ins lock that IP and username out for 15 minutes. The backend reads the visitor's IP from the `X-Forwarded-For` header that Cloudflare
sets, but only from peers it trusts, and by default that is `127.0.0.1`.

- Backend run directly on the same machine as `cloudflared` (`npm run dev:api`): nothing to do.
- Backend in Docker: its connections arrive from Docker's gateway, not `127.0.0.1`, so every visitor would look like one
  machine and the sixth sign-up in 15 minutes would be refused for everyone. Set `FORWARDED_ALLOW_IPS=*`. That is safe
  with the supplied `docker-compose.yml`, which publishes the port on `127.0.0.1` only; if you open the port up, don't
  use `*`, because anyone who can reach it could forge their IP.

**Check it from outside.** Run these from another network (a phone hotspot is fine), not from the host itself. They are
written for a bash-style shell: Git Bash (installed with Git for Windows), macOS or Linux. In PowerShell, write `curl.exe`
instead of `curl`, and run check 4 in Git Bash.

```
# 1. HTTP. Expect {"status":"ok"}
curl https://api.example.com/health

# 2. CORS, as the browser would ask. Expect 200 and: access-control-allow-origin: https://my-app.vercel.app
curl -i -X OPTIONS https://api.example.com/signin \
  -H "Origin: https://my-app.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"

# 3. The WebSocket route is reachable. Expect "403 Forbidden" (no credentials sent).
#    404, 502 or a Cloudflare error page means the tunnel is not reaching the backend.
curl -i -m 5 https://api.example.com/ws/docs/1 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="
```

```
# 4. A real WebSocket session: signs in, opens a new document called "tunnel check" (delete it afterwards),
#    and waits for the server to send its contents. Needs Node 22+ and an existing account.
#    Expect: WebSocket works
export API=https://api.example.com CHECK_USER=<username> CHECK_PASS=<password>
node -e '
const api = process.env.API, h = { "Content-Type": "application/json" };
const post = async (p, b, t) => (await fetch(api + p, { method: "POST", headers: { ...h, ...(t && { Authorization: "Bearer " + t }) }, body: JSON.stringify(b) })).json();
(async () => {
  const { token } = await post("/signin", { username: process.env.CHECK_USER, password: process.env.CHECK_PASS });
  if (!token) { console.log("sign-in failed: check CHECK_USER / CHECK_PASS"); process.exitCode = 1; return; }
  const { ticket } = await post("/ws-ticket", {}, token);
  const { doc_id } = await post("/docs/new", { title: "tunnel check" }, token);
  const ws = new WebSocket(api.replace(/^http/, "ws") + "/ws/docs/" + doc_id + "?token=" + ticket);
  const giveUp = setTimeout(() => { console.log("WebSocket timed out"); process.exitCode = 1; ws.close(); }, 8000);
  ws.onmessage = () => { console.log("WebSocket works"); clearTimeout(giveUp); ws.close(); };
  ws.onerror = () => { console.log("WebSocket failed"); clearTimeout(giveUp); process.exitCode = 1; };
})().catch((e) => { console.log("request failed:", (e.cause && e.cause.code) || e.message); process.exitCode = 1; });'
```

If something is off:

| Symptom | Likely cause |
|---|---|
| CORS error in the browser console | `CORS_ORIGINS` is missing the frontend's exact origin |
| Editor loads but never connects, or a mixed-content error | `NEXT_PUBLIC_WS_URL` is `ws://` on an https page, or the `NEXT_PUBLIC_*` values were wrong when the frontend was built (production builds also lock the browser to those hosts with a Content-Security-Policy) |
| "Too many signup attempts" after a few sign-ups | the backend sees one IP for everybody (see Real client IPs above), or a room of people share one IP and need a higher `SIGNUP_MAX_ATTEMPTS` |
| Cloudflare 502 / 1033, or check 3 returns 404 | `cloudflared` is not running, or its ingress points at the wrong port |

Login tokens are sent in an `Authorization` header and the WebSocket uses a one-minute ticket, so no cookies are
shared between the frontend and the backend and there are no `SameSite` or `Secure` settings to configure.

## Docker (optional)

If you would rather run everything in containers, with PostgreSQL instead of SQLite:

```
docker compose up --build
```

Open <http://localhost:12000>; the API is on <http://localhost:12001>. Postgres and migrations are handled for you, and the
dev defaults (database password, `SECRET_KEY`) are for local use only. Both ports are published on `127.0.0.1` only, so
other devices on your network cannot reach them (use the Cloudflare Tunnel above to share an instance). To change settings,
copy the root `.env.example` to `.env`.
