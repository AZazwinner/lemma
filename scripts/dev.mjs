#!/usr/bin/env node
// Local development launcher. No dependencies; works on Windows, macOS and Linux.
//
//   npm run setup      one time (safe to re-run): Python venv + packages, SQLite schema, npm packages, .env files
//   npm run dev        starts the backend and the frontend together
//   npm run dev:web    frontend only, for using a shared backend (no Python needed)
//   npm run dev:api    backend only, for hosting a shared backend (no frontend, e.g. behind a Cloudflare Tunnel)
//   npm run reset-db   throws away the local SQLite database and makes a fresh one
//
// Flags (after `--`): --web-only (skip everything Python), --api-only (skip the frontend), --force (reinstall packages).

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src");
const appDir = path.join(root, "app");
const isWin = process.platform === "win32";
const venvDir = path.join(srcDir, "venv");
const venvPython = path.join(venvDir, isWin ? "Scripts" : "bin", isWin ? "python.exe" : "python");
const dbFile = path.join(srcDir, "mathboard.db");

const WEB_PORT = 12000;
const API_PORT = 12001;
const MIN_PYTHON = [3, 11];
const MIN_NODE = [20, 9];

const [command, ...flags] = process.argv.slice(2);
const webOnly = flags.includes("--web-only");
const apiOnly = flags.includes("--api-only");
const force = flags.includes("--force");

// ---------------------------------------------------------------------------------------------------------------
// small helpers

const say = (msg = "") => console.log(msg);
const step = (msg) => console.log(`==> ${msg}`);

function fail(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

const parseVersion = (text) => text.trim().split(".").map((n) => parseInt(n, 10));
const atLeast = (have, need) => have[0] > need[0] || (have[0] === need[0] && (have[1] ?? 0) >= need[1]);
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const rel = (p) => path.relative(root, p) || ".";

/** Runs a program with its output shown. `shellLine` runs a whole command line through the shell (needed for npm on Windows). */
function run(file, args, options = {}) {
  return spawnSync(file, args, { stdio: "inherit", ...options });
}

function runShell(line, options = {}) {
  return spawnSync(line, { stdio: "inherit", shell: true, ...options });
}

/** Reads KEY=value from a .env file, ignoring comments. Returns undefined if unset or empty. */
function readEnvFile(file, key) {
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`));
    if (m) {
      const value = m[1].trim().replace(/^['"]|['"]$/g, "");
      return value || undefined;
    }
  }
  return undefined;
}

/** DATABASE_URL as the backend will see it (the shell wins over src/.env), or undefined for the default SQLite file. */
const configuredDatabaseUrl = () => process.env.DATABASE_URL || readEnvFile(path.join(srcDir, ".env"), "DATABASE_URL");

const redact = (url) => url.replace(/\/\/[^@/]*@/, "//***@");

function describeDatabase() {
  const url = configuredDatabaseUrl();
  return url ? `DATABASE_URL (${redact(url)})` : `SQLite file ${rel(dbFile)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// prerequisites

function checkNode() {
  const have = parseVersion(process.versions.node);
  if (!atLeast(have, MIN_NODE)) {
    fail(`Node ${MIN_NODE.join(".")} or newer is required, but this is Node ${process.versions.node}. Install a current LTS from https://nodejs.org`);
  }
}

function findPython() {
  const candidates = isWin ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  const seen = [];
  for (const [file, ...pre] of candidates) {
    const r = spawnSync(file, [...pre, "-c", "import sys; print('%d.%d' % sys.version_info[:2])"], { encoding: "utf8" });
    if (r.error || r.status !== 0) continue; // not installed, or the Microsoft Store placeholder that only opens the Store
    const version = parseVersion(r.stdout);
    seen.push(`${[file, ...pre].join(" ")} is Python ${r.stdout.trim()}`);
    if (atLeast(version, MIN_PYTHON)) return { file, pre, version: r.stdout.trim() };
  }
  const found = seen.length ? ` Found: ${seen.join("; ")}.` : "";
  fail(
    `Python ${MIN_PYTHON.join(".")} or newer was not found.${found}\n` +
      `Install it from https://www.python.org/downloads/ (on Windows, tick "Add python.exe to PATH"), then open a new terminal and run this again.\n` +
      `If you only want to use a shared backend, you do not need Python: run  npm run setup -- --web-only`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// setup

function ensureVenv() {
  if (fs.existsSync(venvPython)) {
    const ok = spawnSync(venvPython, ["-c", "pass"], { stdio: "ignore" }).status === 0;
    if (!ok) {
      fail(`${rel(venvDir)} exists but its Python does not run (it was probably copied from another machine). Delete the ${rel(venvDir)} folder and run this again.`);
    }
    return;
  }
  const py = findPython();
  step(`Creating the Python environment in ${rel(venvDir)} (Python ${py.version})`);
  const r = run(py.file, [...py.pre, "-m", "venv", venvDir], { cwd: srcDir });
  if (r.status !== 0) {
    fail(
      `Could not create the Python environment.\n` +
        `On Debian/Ubuntu you may need:  sudo apt install python3-venv\n` +
        `If ${rel(venvDir)} was left half-made, delete it and run this again.`,
    );
  }
}

function ensurePythonPackages() {
  const requirements = path.join(srcDir, "requirements.txt");
  const marker = path.join(venvDir, ".requirements.sha256");
  const wanted = sha256(requirements);
  if (!force && fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === wanted) {
    step("Python packages are up to date");
    return;
  }
  step("Installing Python packages (a minute or two the first time)");
  // -q: pip prints only warnings and errors, not a line per package.
  const r = run(venvPython, ["-m", "pip", "install", "-q", "--disable-pip-version-check", "--progress-bar", "off", "-r", requirements], { cwd: srcDir });
  if (r.status !== 0) fail("Installing the Python packages failed. The output above says why; fix it and run this again (it picks up where it left off).");
  fs.writeFileSync(marker, wanted + "\n");
}

function migrateDatabase() {
  step(`Preparing the database: ${describeDatabase()}`);
  const r = spawnSync(venvPython, ["-m", "alembic", "upgrade", "head"], { cwd: srcDir, encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write((r.stdout || "") + (r.stderr || ""));
    fail("Setting up the database failed (output above). If it is a local SQLite problem, `npm run reset-db` starts over.");
  }
}

function copyIfMissing(from, to) {
  if (fs.existsSync(to)) {
    step(`${rel(to)} already exists (left alone)`);
  } else {
    fs.copyFileSync(from, to);
    step(`Created ${rel(to)} from ${rel(from)}`);
  }
}

function ensureEnvFiles() {
  if (!webOnly) copyIfMissing(path.join(srcDir, ".env.example"), path.join(srcDir, ".env"));
  if (!apiOnly) copyIfMissing(path.join(appDir, ".env.example"), path.join(appDir, ".env.local"));
}

function ensureFrontendPackages() {
  const lock = path.join(appDir, "package-lock.json");
  const modules = path.join(appDir, "node_modules");
  const marker = path.join(modules, ".package-lock.sha256");
  const wanted = sha256(lock);
  if (!force && fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === wanted) {
    step("Frontend packages are up to date");
    return;
  }
  step("Installing frontend packages (a minute or two the first time)");
  // error level: skips npm's notices (like the install-script one), which teammates cannot act on; real errors still show.
  const r = runShell("npm ci --no-audit --no-fund --loglevel=error", { cwd: appDir });
  if (r.status !== 0) {
    fail("Installing the frontend packages failed (output above). If it mentions the lockfile being out of sync, try:  cd app && npm install");
  }
  fs.writeFileSync(marker, wanted + "\n");
}

/** Everything `start` needs, and everything `setup` does. Idempotent and quick when nothing changed. */
function prepare() {
  checkNode();
  if (!webOnly) {
    ensureVenv();
    ensurePythonPackages();
  }
  ensureEnvFiles();
  if (!webOnly) migrateDatabase();
  if (!apiOnly) ensureFrontendPackages();
}

function setup() {
  prepare();
  say();
  say("Setup complete. Start the app with:");
  say(webOnly ? "    npm run dev:web" : apiOnly ? "    npm run dev:api" : "    npm run dev");
  say();
}

// ---------------------------------------------------------------------------------------------------------------
// start

function isListening(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host });
      const done = (result) => {
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(700, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
  return Promise.all([tryHost("127.0.0.1"), tryHost("::1")]).then((r) => r.some(Boolean));
}

async function assertPortFree(port, what) {
  if (await isListening(port)) {
    const find = isWin ? `netstat -ano | findstr :${port}` : `lsof -i :${port}`;
    fail(
      `Port ${port} (${what}) is already in use. Is the app already running in another terminal? Stop that one first.\n` +
        `To see what is using the port:  ${find}`,
    );
  }
}

function pipeLines(stream, label) {
  let buffer = "";
  const flush = (line) => {
    if (line.trim()) console.log(`[${label}] ${line}`);
  };
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    lines.forEach(flush);
  });
  stream.on("end", () => flush(buffer));
}

function healthOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

const running = [];
let shuttingDown = false;

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (isWin) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM"); // the whole process group (npm -> next)
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  running.forEach(({ child }) => killTree(child));
  setTimeout(() => process.exit(code), 300);
}

function launch(label, file, args, options) {
  const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"], detached: !isWin, ...options });
  running.push({ label, child });
  pipeLines(child.stdout, label);
  pipeLines(child.stderr, label);
  child.on("error", (e) => {
    console.error(`[${label}] could not start: ${e.message}`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[dev] the ${label} process stopped (${signal ?? `exit code ${code}`}); stopping everything.`);
    shutdown(code || 1);
  });
}

function sharedBackendUrl() {
  return readEnvFile(path.join(appDir, ".env.local"), "NEXT_PUBLIC_API_URL");
}

async function start() {
  prepare();
  say();
  if (!apiOnly) await assertPortFree(WEB_PORT, "the website");
  if (!webOnly) await assertPortFree(API_PORT, "the API");

  const webUrl = `http://localhost:${WEB_PORT}`;
  const apiUrl = webOnly ? sharedBackendUrl() || `http://localhost:${API_PORT}` : `http://localhost:${API_PORT}`;

  if (!webOnly) {
    const env = { ...process.env, PORT: String(API_PORT), HOST: "127.0.0.1", PYTHONUNBUFFERED: "1" };
    // Everyone on one machine is one IP, so the default of 5 sign-ups per 15 minutes just gets in the way of local testing.
    // Hosting for others (dev:api) keeps the default; anything you set yourself (shell or src/.env) wins.
    if (!apiOnly && !process.env.SIGNUP_MAX_ATTEMPTS && !readEnvFile(path.join(srcDir, ".env"), "SIGNUP_MAX_ATTEMPTS")) {
      env.SIGNUP_MAX_ATTEMPTS = "50";
    }
    launch("api", venvPython, ["main.py"], { cwd: srcDir, env });
  } else {
    step(`Frontend only. It will talk to the shared backend at ${apiUrl}`);
    if (!(await healthOk(new URL("/health", apiUrl).href))) {
      say(`    WARNING: ${apiUrl}/health did not answer. Is NEXT_PUBLIC_API_URL in app/.env.local right, and is the backend up?`);
    }
  }
  if (!apiOnly) {
    launch("web", "npm run dev", undefined, { cwd: appDir, shell: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
  }

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(sig, () => shutdown(0));

  // Print the URLs once everything answers (the first page compile can take a few seconds).
  const started = Date.now();
  let announced = false;
  while (!shuttingDown && !announced && Date.now() - started < 180_000) {
    await new Promise((r) => setTimeout(r, 700));
    const webUp = apiOnly ? true : await isListening(WEB_PORT);
    const apiUp = webOnly ? true : await healthOk(`${apiUrl}/health`);
    if (webUp && apiUp) {
      announced = true;
      say();
      say("--------------------------------------------------------------");
      say("  Mathboard is running");
      if (!apiOnly) say(`    App       ${webUrl}`);
      say(`    API       ${apiUrl}${webOnly ? "   (shared backend)" : ""}`);
      if (!webOnly) say(`    Database  ${describeDatabase()}   (start over: npm run reset-db)`);
      say(apiOnly || webOnly ? "  Press Ctrl+C to stop." : "  Press Ctrl+C to stop both.");
      say("--------------------------------------------------------------");
      say();
    }
  }
  if (!announced && !shuttingDown) say("[dev] Still starting after 3 minutes. Check the output above for errors.");
}

// ---------------------------------------------------------------------------------------------------------------
// reset-db

async function resetDb() {
  const url = configuredDatabaseUrl();
  if (url) {
    fail(
      `reset-db only resets the local SQLite file, but DATABASE_URL is set (${redact(url)}).\n` +
        `Remove DATABASE_URL from your environment and src/.env to use the local file, or reset that database yourself.`,
    );
  }
  if (!fs.existsSync(venvPython)) fail("Nothing to reset yet: run  npm run setup  first.");
  if (await isListening(API_PORT)) fail(`The backend is running on port ${API_PORT}. Stop it (Ctrl+C in the terminal running npm run dev) and try again.`);

  step(`Deleting ${rel(dbFile)}`);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      fs.rmSync(dbFile + suffix, { force: true });
    } catch (e) {
      fail(`Could not delete ${rel(dbFile + suffix)} (${e.code ?? e.message}). Something still has it open; stop the app and try again.`);
    }
  }
  migrateDatabase();
  say();
  say("The database is empty again. A browser that was signed in to the old data will need to sign in again or sign up.");
  say();
}

// ---------------------------------------------------------------------------------------------------------------

switch (command) {
  case "setup":
    setup();
    break;
  case "start":
    await start();
    break;
  case "reset-db":
    await resetDb();
    break;
  default:
    say("Usage: node scripts/dev.mjs <setup|start|reset-db> [--web-only | --api-only] [--force]");
    process.exit(command ? 1 : 0);
}
