# Mathboard

A collaborative LaTeX editor that renders as you type. Write math like it's a document.

- Real-time collaborative editing, with live cursors
- LaTeX rendered live, inline and block
- Slash commands, formatting toolbar, templates, export to PDF, Markdown, HTML or text
- Sharing with read/write permissions, version history, trash

**Stack:** Next.js (`app/`), FastAPI (`src/`), Yjs via pycrdt for conflict-free editing, PostgreSQL with Alembic migrations.

## Run it

You need Docker. From a fresh clone:

```
docker compose up --build
```

Open <http://localhost:12000>. The API is on <http://localhost:12001>. Postgres and migrations are handled for you,
and the dev defaults (database password, `SECRET_KEY`) are for local use only.

### Working on the frontend with hot reload

Run the backend in Docker and the frontend directly:

```
docker compose up --build backend
cd app && cp .env.example .env.local && npm ci && npm run dev
```

### Working on the backend without Docker

You need Python 3.14 (what the Docker image and CI use) and a database. SQLite is fine for solo work; use Postgres to match everyone else.

```
cd src
python -m venv venv && source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                    # set SECRET_KEY, and DATABASE_URL=sqlite:///./mathboard.db for SQLite
alembic upgrade head                                    # the app does not create tables itself
python main.py
```

## Tests

```
cd src && pip install -r requirements-dev.txt && pytest     # SQLite by default, no services needed
cd app && npm test                                          # unit tests
cd app && npm run test:e2e                                  # Playwright; starts the frontend itself, the backend must already be running
```

Every e2e test signs up a new user, and the backend allows 5 sign-ups per IP per 15 minutes, so the full suite (16 sign-ups)
cannot pass against one backend process. Restart the backend between spec files, or run one file at a time:
`npx playwright test e2e/editor.spec.ts`.

## Configuration

Everything has a working default for local development. Copy the relevant `.env.example` and uncomment what you change:

| File | For | Variables |
|---|---|---|
| [`.env.example`](.env.example) | `docker compose` | `POSTGRES_PASSWORD`, `SECRET_KEY`, `CORS_ORIGINS`, `APP_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_APP_URL`, `WS_ACCEPT_LOGIN_TOKEN`, `FORWARDED_ALLOW_IPS` |
| [`src/.env.example`](src/.env.example) | backend run directly | `SECRET_KEY` (required), `DATABASE_URL` (required), `PORT`, `APP_URL`, `CORS_ORIGINS`, `WS_ACCEPT_LOGIN_TOKEN`, `FORWARDED_ALLOW_IPS`, optional `SMTP_*` for password-reset email |
| [`app/.env.example`](app/.env.example) | frontend run directly | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_APP_URL` |

The three `NEXT_PUBLIC_*` values are baked into the frontend at build time: rebuild (or redeploy) after changing them.
Never commit a real `.env`.

## Running the backend behind a Cloudflare Tunnel

For a shared or demo instance: the backend runs on one machine, a Cloudflare Tunnel (`cloudflared`) exposes it at
`https://api.example.com`, and the frontend is served from somewhere else, such as `https://my-app.vercel.app` or
`http://localhost:12000`. This section does not create or change the tunnel. It only needs the backend listening on
a port.

**Point the tunnel at the backend's port.** The ingress target is `http://localhost:12001`, or whatever `PORT` is
set to. WebSockets pass through a tunnel without extra settings. The tunnel terminates HTTPS, so the backend itself
stays plain HTTP.

**Backend settings** (in `src/.env`, or the root `.env` for Docker):

```
SECRET_KEY=<openssl rand -hex 32>          # never the default on a public instance
CORS_ORIGINS=https://my-app.vercel.app     # the FRONTEND's origin, exactly: scheme + host (+ port), no trailing slash
APP_URL=https://my-app.vercel.app          # the frontend again; used in password-reset links
WS_ACCEPT_LOGIN_TOKEN=0                    # WebSockets accept only short-lived tickets
FORWARDED_ALLOW_IPS=*                      # Docker only, see below
```

**Frontend settings** (Vercel project settings, or `app/.env.local`; redeploy after changing):

```
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com   # wss, not ws: an https page cannot open an insecure socket
NEXT_PUBLIC_APP_URL=https://my-app.vercel.app
```

Several people can use a frontend at `http://localhost:12000` against the same tunnelled backend, because that origin
is always allowed. A frontend on any other local port (say `http://localhost:3000`) has to be added to
`CORS_ORIGINS`: `CORS_ORIGINS=https://my-app.vercel.app,http://localhost:3000`.

**Real client IPs.** Sign-up is limited to 5 per IP per 15 minutes, and repeated failed sign-ins lock that IP and
username out for 15 minutes. The backend reads the visitor's IP from the `X-Forwarded-For` header that Cloudflare
sets, but only from peers it trusts, and by default that is `127.0.0.1`.

- Backend run directly on the same machine as `cloudflared` (`python main.py`): nothing to do.
- Backend in Docker: its connections arrive from Docker's gateway, not `127.0.0.1`, so every visitor would look like one
  machine and the sixth sign-up in 15 minutes would be refused for everyone. Set `FORWARDED_ALLOW_IPS=*`, and only
  do that if nothing but the tunnel can reach port 12001 (otherwise anyone who can reach it can forge their IP).

**Check it from outside.** Run these from another network (a phone hotspot is fine), not from the host itself.

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
| "Too many signup attempts" after a few sign-ups | the backend sees one IP for everybody; see Real client IPs above |
| Cloudflare 502 / 1033, or check 3 returns 404 | `cloudflared` is not running, or its ingress points at the wrong port |

Login tokens are sent in an `Authorization` header and the WebSocket uses a one-minute ticket, so no cookies are
shared between the frontend and the backend and there are no `SameSite` or `Secure` settings to configure.
