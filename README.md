# Lemma

A collaborative LaTeX editor that renders as you type. Write math like it's a document.

- Real-time collaborative editing with live cursors
- LaTeX rendered live, inline and block
- Slash commands, export to PDF, Markdown, HTML or text
- Sharing with read/write permissions, version history, trash
- Optional AI helper (Sidekick)

**Stack:** Next.js (`app/`), FastAPI (`src/`), Yjs via pycrdt, SQLite locally (PostgreSQL on a server).

## Run it

You need Git, Python 3.11+ and Node 20.9+.

```
git clone https://github.com/AZazwinner/mathlatex.git
cd mathlatex
npm run setup
npm run dev
```

Open <http://localhost:12000>, create an account and make a document. `Ctrl+C` stops everything.

`npm run setup` installs the Python and frontend packages, creates the `.env` files and the local SQLite database. It is
safe to re-run, and `npm run dev` repeats the same checks, so after a `git pull` just run `npm run dev` again.

| Command | What it does |
|---|---|
| `npm run dev:web` | frontend only, against a backend someone else hosts |
| `npm run dev:api` | backend only |
| `npm run reset-db` | delete all local accounts and documents |
| `npm run setup -- --force` | reinstall packages |

## Tests

```
cd src && venv/bin/pip install -r requirements-dev.txt && venv/bin/pytest   # backend (Windows: venv\Scripts\...)
cd app && npm test                                                          # frontend unit tests
cd app && npm run test:e2e                                                  # Playwright; the backend must be running
```

## Configuration

Everything works out of the box for local development. To change something, edit `src/.env` (backend) or
`app/.env.local` (frontend); [`src/.env.example`](src/.env.example) and [`app/.env.example`](app/.env.example) list every
variable. Restart after changing them. Never commit a real `.env`.

## Sidekick

An optional AI helper that explains, fixes, continues or rewrites a selection, and turns a photo into LaTeX. Nothing it
suggests enters the document until you accept it. Without an API key it runs in mock mode, which makes no API calls.
To use a real model, set `OPENROUTER_API_KEY` (or `GEMINI_API_KEY` with `SIDEKICK_PROVIDER=gemini`) in `src/.env`; see
[`src/.env.example`](src/.env.example) for the rest.

## Hosting the backend

To share one backend between several people, run `npm run dev:api` on the host and expose port `12001` (a Cloudflare Tunnel
works). In the host's `src/.env`, set `CORS_ORIGINS` and `APP_URL` to the frontend's origin and `WS_ACCEPT_LOGIN_TOKEN=0`.
Everyone else sets `NEXT_PUBLIC_API_URL` (`https://…`) and `NEXT_PUBLIC_WS_URL` (`wss://…`) in `app/.env.local`, then runs
`npm run dev:web`.
