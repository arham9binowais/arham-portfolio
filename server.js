const express = require('express');
const fs = require('fs');
const path = require('path');
// Project root
const ROOT = __dirname;
const crypto = require('crypto');
const dns = require('dns');
const { MongoClient } = require('mongodb');
const nodemailer = require('nodemailer');

// On Vercel the function is frozen as soon as the response is sent, so
// "fire-and-forget" work (emails, session sweep) would be cut off. waitUntil
// keeps the invocation alive until the promise settles. Locally it's a no-op.
let vercelWaitUntil = null;
try { vercelWaitUntil = require('@vercel/functions').waitUntil; } catch (e) { /* not installed / local */ }
function background(promise) {
  const p = Promise.resolve(promise).catch(e => console.error('Background task failed:', e.message));
  if (vercelWaitUntil) { try { vercelWaitUntil(p); } catch (e) {} }
  return p;
}

// Parse .env for local development. On Vercel there is no .env file (it's
// gitignored on purpose) — real values come from process.env, which is set
// via Project Settings > Environment Variables. process.env always wins if
// a variable is already defined there, matching standard dotenv behavior.
const dotenv = {};
try {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length) dotenv[k.trim()] = v.join('=').trim();
  });
} catch (e) { /* No .env found locally — fine, will rely on process.env */ }

function getEnv(key, fallback) {
  if (process.env[key] !== undefined && process.env[key] !== '') return process.env[key];
  if (dotenv[key] !== undefined && dotenv[key] !== '') return dotenv[key];
  return fallback;
}

const PORT = getEnv('PORT', 3000);
const ADMIN_EMAIL = getEnv('ADMIN_EMAIL', 'admin@test.com');
// No built-in fallback password in production: if ADMIN_PASSWORD isn't set on
// Vercel, admin login is simply disabled rather than defaulting to 'admin'.
const ADMIN_PASSWORD = getEnv('ADMIN_PASSWORD', process.env.VERCEL ? '' : 'admin');
// Gmail SMTP via an App Password (not your real Gmail password — generate one
// at https://myaccount.google.com/apppasswords, requires 2-Step Verification on).
const GMAIL_USER = getEnv('GMAIL_USER', '');
const GMAIL_APP_PASSWORD = getEnv('GMAIL_APP_PASSWORD', '');
const NOTIFY_FROM_EMAIL = getEnv('NOTIFY_FROM_EMAIL', GMAIL_USER);
// Where notification emails are delivered (defaults to ADMIN_EMAIL, then GMAIL_USER).
const NOTIFY_TO_EMAIL = getEnv('NOTIFY_TO_EMAIL', '') || ADMIN_EMAIL || GMAIL_USER;
const TIMEZONE = getEnv('TIMEZONE', 'Asia/Karachi');
const MONGODB_URI = getEnv('MONGODB_URI', '');
const MONGODB_DB = getEnv('MONGODB_DB', 'portfolio');
const MONGODB_COLLECTION = getEnv('MONGODB_COLLECTION', 'portfolios');
const MONGODB_SESSIONS_COLLECTION = getEnv('MONGODB_SESSIONS_COLLECTION', 'sessiondb');
const MONGODB_DNS_SERVERS = getEnv('MONGODB_DNS_SERVERS', '');
// Custom DNS is only for home networks that block SRV lookups; never on Vercel.
if (MONGODB_DNS_SERVERS && !process.env.VERCEL) dns.setServers(MONGODB_DNS_SERVERS.split(',').map(s => s.trim()).filter(Boolean));

// How long (minutes) with no heartbeat before we treat someone as "closed the
// browser". A random value in this range is picked per-session so mass
// logins/closes don't all expire in the same instant.
const OFFLINE_MIN_MINUTES = parseInt(getEnv('OFFLINE_MIN_MINUTES', '15'), 10);
const OFFLINE_MAX_MINUTES = parseInt(getEnv('OFFLINE_MAX_MINUTES', '30'), 10);
// How often (ms) the self-triggering sweep is allowed to actually run. It
// piggybacks on normal traffic instead of a cron job, since Vercel's Hobby
// plan cron only supports once-per-day schedules.
const SWEEP_INTERVAL_MS = parseInt(getEnv('SWEEP_INTERVAL_MS', '120000'), 10);
// Edits are batched: instead of one email per keystroke/save, changes are
// queued and a single summary email goes out this long after the FIRST
// unsent edit — unless the session logs out or is auto-detected offline
// first, in which case the batch is flushed immediately (see flushPendingEdit).
const PENDING_EDIT_DELAY_MS = parseInt(getEnv('PENDING_EDIT_DELAY_MS', '300000'), 10); // 5 minutes

// Reuse one client per serverless instance (module scope survives between
// warm invocations on Vercel). The promise is cached so concurrent requests
// share a single connect(), and it is cleared on failure so the next request
// can retry instead of being stuck with a dead connection.
const mongoClient = MONGODB_URI ? new MongoClient(MONGODB_URI, {
  maxPoolSize: 10,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 5000,
  maxIdleTimeMS: 60000
}) : null;

let connectPromise = null;
function ensureConnected() {
  if (!mongoClient) return Promise.reject(new Error('MONGODB_URI is not configured'));
  if (!connectPromise) {
    connectPromise = mongoClient.connect().catch(err => { connectPromise = null; throw err; });
  }
  return connectPromise;
}
function portfolioCollection() { return mongoClient.db(MONGODB_DB).collection(MONGODB_COLLECTION); }
function sessiondb() { return mongoClient.db(MONGODB_DB).collection(MONGODB_SESSIONS_COLLECTION); }

function genToken() { return crypto.randomBytes(32).toString('hex'); }
function randomOfflineThresholdMinutes() {
  const min = Math.min(OFFLINE_MIN_MINUTES, OFFLINE_MAX_MINUTES);
  const max = Math.max(OFFLINE_MIN_MINUTES, OFFLINE_MAX_MINUTES);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function readDB() {
  await ensureConnected();
  const document = await portfolioCollection().findOne({ _id: 'main' });
  if (!document) throw new Error('Portfolio document not found in MongoDB. Run "npm run seed" once to initialize it.');
  const { _id, ...portfolio } = document;
  return portfolio;
}

async function writeDB(data) {
  await ensureConnected();
  await portfolioCollection().replaceOne({ _id: 'main' }, { _id: 'main', ...data }, { upsert: true });
}

// =============================================
// SESSIONDB — the list of currently online users.
// One document per logged-in user (visitor or admin), keyed by their token.
// Removed the moment they explicitly log out, OR when the sweep decides
// they went silent for too long (browser closed without a clean logout).
// =============================================
async function createSession(token, data) {
  await ensureConnected();
  const now = Date.now();
  await sessiondb().insertOne({
    _id: token,
    lastSeen: now,
    offlineThresholdMinutes: randomOfflineThresholdMinutes(),
    ...data
  });
}
async function getSession(token) {
  await ensureConnected();
  return sessiondb().findOne({ _id: token });
}
async function touchSession(token) {
  await ensureConnected();
  const r = await sessiondb().findOneAndUpdate(
    { _id: token },
    { $set: { lastSeen: Date.now() } },
    { returnDocument: 'after' }
  );
  return r || null;
}
async function deleteSession(token) {
  await ensureConnected();
  await sessiondb().deleteOne({ _id: token });
}
async function listOnlineSessions() {
  await ensureConnected();
  const now = Date.now();
  return sessiondb()
    .find({ _id: { $ne: '__sweep_lock__' }, expires: { $gt: now } })
    .sort({ loginTime: -1 })
    .limit(200)
    .toArray();
}

// =============================================
// EMAIL NOTIFICATIONS (Nodemailer + Gmail App Password)
// =============================================
let mailTransporter = null;
function getMailTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
    });
  }
  return mailTransporter;
}

function formatTime(ts) {
  try { return new Date(ts).toLocaleString('en-US', { timeZone: TIMEZONE, dateStyle: 'medium', timeStyle: 'medium' }); }
  catch(e) { return new Date(ts).toISOString(); }
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!h && !m) parts.push(`${s}s`);
  else if (m) parts.push(`${s}s`);
  return parts.join(' ');
}

// Fire-and-forget: never blocks or fails the request that triggered it.
async function notify(subject, text) {
  const transporter = getMailTransporter();
  if (!transporter || !NOTIFY_TO_EMAIL) {
    console.log(`[notify] ${subject}\n${text}`);
    return;
  }
  try {
    await transporter.sendMail({ from: NOTIFY_FROM_EMAIL, to: NOTIFY_TO_EMAIL, subject, text });
  } catch(e) {
    console.error('Email notification failed:', e.message);
  }
}

function sendLogoutEmail(session, logoutTime, label) {
  const durationText = formatDuration(logoutTime - (session.loginTime || logoutTime));
  if (session.type === 'admin') {
    return notify(
      `🚪 Editor logout on your portfolio${label}`,
      `"${session.name}" (${session.email}) logged out of the editor at ${formatTime(logoutTime)}.\nThey were online for ${durationText}.`
    );
  } else {
    return notify(
      `👋 ${session.name} left your portfolio${label}`,
      `${session.name} left your portfolio.\nOpened: ${formatTime(session.loginTime || logoutTime)}\nClosed: ${formatTime(logoutTime)}\nTime spent on your portfolio: ${durationText}`
    );
  }
}

// Recursively diffs two values and returns a flat, readable list of changes.
function diffValues(oldVal, newVal, pathLabel, changes, depth) {
  if (changes.length >= 40 || depth > 6) return; // safety caps for huge edits
  const isObj = v => v !== null && typeof v === 'object';
  if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return;

  if (Array.isArray(oldVal) && Array.isArray(newVal)) {
    if (oldVal.length !== newVal.length) {
      changes.push(`${pathLabel}: list changed from ${oldVal.length} item(s) to ${newVal.length} item(s)`);
    }
    const max = Math.min(oldVal.length, newVal.length, 20);
    for (let i = 0; i < max; i++) diffValues(oldVal[i], newVal[i], `${pathLabel}[${i}]`, changes, depth + 1);
    return;
  }
  if (isObj(oldVal) && isObj(newVal) && !Array.isArray(oldVal) && !Array.isArray(newVal)) {
    const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
    keys.forEach(k => diffValues(oldVal[k], newVal[k], pathLabel ? `${pathLabel}.${k}` : k, changes, depth + 1));
    return;
  }
  const fmt = v => {
    if (v === undefined) return '(none)';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  };
  changes.push(`${pathLabel}: "${fmt(oldVal)}" → "${fmt(newVal)}"`);
}

// =============================================
// EDIT BATCHING
// Saves don't email immediately — they queue onto the session's pending
// batch. A save that produces no actual diff (e.g. a stray duplicate save
// request) is silently skipped, so it can never generate a
// "No visible field changes were detected" email on its own.
// The batch is flushed either by the 5-minute sweep, or instantly on
// logout / auto-detected-offline (flushPendingEdit is awaited there so
// the edit email is sent — and lands in the inbox — before the logout email).
// =============================================
async function queuePendingEdit(token, sectionLabel, before, after) {
  const changes = [];
  diffValues(before, after, '', changes, 0);
  if (!changes.length) return; // nothing actually changed — don't queue, don't email
  const now = Date.now();
  const stamped = [`[${formatTime(now)}] ${sectionLabel}:`, ...changes.map(c => '  ' + c)];
  await sessiondb().updateOne(
    { _id: token },
    {
      $min: { pendingEditSince: now }, // keeps the EARLIEST unsent-edit time
      $set: { pendingLastEditAt: now },
      $push: { pendingChangeLines: { $each: stamped, $slice: -100 } },
      $addToSet: { pendingSections: sectionLabel }
    }
  );
}

async function flushPendingEdit(session, { clearFields = true, note = '' } = {}) {
  if (!session || !session.pendingEditSince) return false;
  const sections = (session.pendingSections || []).join(', ') || 'Unknown';
  const body = (session.pendingChangeLines || []).join('\n') || 'No visible field changes were detected.';
  await notify(
    `✏️ Your portfolio was edited${note}`,
    `"${session.name}" (${session.email}) edited your portfolio.\n` +
    `Editing started: ${formatTime(session.pendingEditSince)}\n` +
    `Last change: ${formatTime(session.pendingLastEditAt || session.pendingEditSince)}\n` +
    `Section(s): ${sections}\n\nWhat changed:\n${body}`
  );
  if (clearFields) {
    await sessiondb().updateOne(
      { _id: session._id },
      { $unset: { pendingEditSince: '', pendingChangeLines: '', pendingSections: '', pendingLastEditAt: '' } }
    );
  }
  return true;
}

// =============================================
// OFFLINE SWEEP
// Self-throttling: piggybacks on incoming requests instead of a cron job
// (Vercel Hobby cron only supports once-per-day schedules, too coarse here).
// A lock document in sessiondb ensures it actually runs at most once per
// SWEEP_INTERVAL_MS, even under concurrent serverless invocations.
// =============================================
async function tryAcquireSweepLock() {
  const now = Date.now();
  const prev = await sessiondb().findOneAndUpdate(
    { _id: '__sweep_lock__' },
    { $set: { nextRunAt: now + SWEEP_INTERVAL_MS } },
    { upsert: true, returnDocument: 'before' }
  );
  if (!prev) return true; // lock document didn't exist yet — we created it, we run
  return (prev.nextRunAt || 0) <= now;
}

async function sweepSessions() {
  const now = Date.now();
  const candidates = await sessiondb()
    .find({ _id: { $ne: '__sweep_lock__' } })
    .limit(100)
    .toArray();

  for (const session of candidates) {
    const thresholdMinutes = session.offlineThresholdMinutes || OFFLINE_MIN_MINUTES;
    const thresholdMs = thresholdMinutes * 60000;
    const lastActivity = session.lastSeen || session.loginTime || now;
    const isStale = now - lastActivity >= thresholdMs;

    if (isStale) {
      // Flush any unsent edits FIRST — awaited, so that email is sent (and
      // arrives) before the "went offline" email that follows.
      if (session.pendingEditSince) {
        await flushPendingEdit(session, { clearFields: false, note: ' (before going offline)' });
      }

      // Per spec: online duration is measured from login to (now - x), i.e.
      // the moment we assume they actually walked away / closed the tab.
      const assumedOfflineAt = now - thresholdMs;
      const durationMs = assumedOfflineAt - (session.loginTime || assumedOfflineAt);

      if (session.type === 'admin') {
        await notify(
          `💤 "${session.name}" went offline (auto-detected)`,
          `"${session.name}" (${session.email}) stopped responding — the browser was likely closed without clicking Logout.\n` +
          `Logged in: ${formatTime(session.loginTime)}\n` +
          `Last activity seen: ${formatTime(lastActivity)}\n` +
          `Assumed offline at: ${formatTime(assumedOfflineAt)} (${thresholdMinutes} min after last activity)\n` +
          `Time online: ${formatDuration(durationMs)}`
        );
      } else {
        await notify(
          `💤 ${session.name} went offline (auto-detected)`,
          `${session.name} stopped responding on your portfolio — the browser was likely closed.\n` +
          `Opened: ${formatTime(session.loginTime)}\n` +
          `Last activity seen: ${formatTime(lastActivity)}\n` +
          `Assumed closed at: ${formatTime(assumedOfflineAt)} (${thresholdMinutes} min after last activity)\n` +
          `Time online: ${formatDuration(durationMs)}`
        );
      }

      await sessiondb().deleteOne({ _id: session._id });
      continue;
    }

    // Still online — but if their edit batch has been waiting 5+ minutes, send it now.
    if (session.pendingEditSince && now - session.pendingEditSince >= PENDING_EDIT_DELAY_MS) {
      await flushPendingEdit(session, { clearFields: true });
    }
  }
}

// Fire-and-forget, throttled. Safe to call on every request.
function maybeSweepSessions() {
  if (!mongoClient) return;
  background(
    ensureConnected()
      .then(() => tryAcquireSweepLock())
      .then(acquired => { if (acquired) return sweepSessions(); })
  );
}

// =============================================
// EXPRESS APP
// Same endpoints and logic as before, written as Express routes.
// Vercel runs this file directly: it exports the app instead of listening
// (listening only happens when you run `npm start` locally).
// =============================================
const app = express();
app.disable('x-powered-by');

// CORS + no-cache for the API (same headers as before)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Read every body as text, then parse it leniently as JSON (invalid or empty
// body => null). sendBeacon can send odd content types, so we don't filter.
app.use(express.text({ type: () => true, limit: '4mb' }));
app.use((req, res, next) => {
  let json = null;
  if (typeof req.body === 'string' && req.body.length) {
    try { json = JSON.parse(req.body); } catch (e) {}
  } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
    json = req.body;
  }
  req.json = json;
  next();
});

// Piggyback the offline sweep on ordinary API traffic. Throttled internally,
// never awaited, so it never slows the actual response.
app.use('/api', (req, res, next) => { maybeSweepSessions(); next(); });

// Catches errors from async routes and returns them as JSON.
const wrap = fn => (req, res) =>
  Promise.resolve(fn(req, res)).catch(e => {
    console.error('Request failed:', e.message);
    if (!res.headersSent) jsonRes(res, { error: 'Database or server error', message: e.message }, 500);
  });

// Diagnostic endpoint: shows which settings exist (never their values) and
// whether MongoDB accepts the connection. Safe to delete once all works.
app.get('/api/health', wrap(async (req, res) => {
  const out = { node: process.version, env: {} };
  ['MONGODB_URI', 'MONGODB_DB', 'MONGODB_COLLECTION', 'MONGODB_SESSIONS_COLLECTION',
   'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'NOTIFY_TO_EMAIL']
    .forEach(k => { out.env[k] = !!getEnv(k, ''); });
  try {
    await ensureConnected();
    await mongoClient.db('admin').command({ ping: 1 });
    out.mongo = 'connected';
  } catch (e) { out.mongo = 'FAILED: ' + e.message; }
  jsonRes(res, out);
}));

// Auth: visitor — opens the public portfolio
app.post('/api/auth/visitor', wrap(async (req, res) => {
  const body = req.json;
  const name = (body && body.name) || 'Visitor';
  const token = genToken();
  const loginTime = Date.now();
  await createSession(token, { type: 'visitor', name, loginTime, expires: loginTime + 86400000 });
  background(notify(
    `👀 ${name} opened your portfolio`,
    `${name} opened your portfolio at ${formatTime(loginTime)}.`
  ));
  return jsonRes(res, { token, name, type: 'visitor' });
}));

// Auth: admin — logs into the editor
app.post('/api/auth/admin', wrap(async (req, res) => {
  const body = req.json;
  if (body && ADMIN_PASSWORD && body.email === ADMIN_EMAIL && body.password === ADMIN_PASSWORD) {
    const token = genToken();
    const name = body.name || 'Admin';
    const loginTime = Date.now();
    await createSession(token, { type: 'admin', name, email: body.email, loginTime, expires: loginTime + 86400000 });
    background(notify(
      `🔑 Editor login on your portfolio`,
      `"${name}" (${body.email}) logged in to edit your portfolio at ${formatTime(loginTime)}.`
    ));
    return jsonRes(res, { token, name, type: 'admin' });
  }
  return jsonRes(res, { error: 'Invalid credentials' }, 401);
}));

// Auth: validate
app.get('/api/auth/validate', wrap(async (req, res) => {
  const token = getToken(req);
  if (token) {
    const s = await getSession(token);
    if (s && s.expires > Date.now()) return jsonRes(res, s);
    if (s) await deleteSession(token);
  }
  return jsonRes(res, { error: 'Invalid session' }, 401);
}));

// Heartbeat — called periodically by an open tab to prove it's still open.
app.post('/api/heartbeat', wrap(async (req, res) => {
  const body = req.json;
  const token = getToken(req) || (body && body.token);
  if (!token) return jsonRes(res, { error: 'No token' }, 400);
  const s = await touchSession(token);
  if (!s || s.expires <= Date.now()) return jsonRes(res, { error: 'Invalid session' }, 401);
  return jsonRes(res, { ok: true });
}));

// Who's online right now (admin only) — the live view of sessiondb.
app.get('/api/online', wrap(async (req, res) => {
  const admin = await getAdminSession(req);
  if (!admin) return jsonRes(res, { error: 'Unauthorized' }, 403);
  const sessions = await listOnlineSessions();
  return jsonRes(res, sessions.map(s => ({
    type: s.type, name: s.name, email: s.email || null,
    loginTime: s.loginTime, lastSeen: s.lastSeen
  })));
}));

// Auth: logout — covers the admin "Logout" button, the visitor "Exit"
// button, AND the best-effort sendBeacon fired when a tab is closed.
// sendBeacon can't set an Authorization header, so token may arrive in body.
app.post('/api/auth/logout', wrap(async (req, res) => {
  const body = req.json;
  const token = getToken(req) || (body && body.token);
  if (token) {
    const s = await getSession(token);
    if (s) {
      if (s.pendingEditSince) await flushPendingEdit(s, { clearFields: false, note: ' (before logout)' });
      await sendLogoutEmail(s, Date.now(), '');
    }
    await deleteSession(token);
  }
  return jsonRes(res, { ok: true });
}));

// API: get portfolio
app.get('/api/portfolio', wrap(async (req, res) => {
  return jsonRes(res, await readDB());
}));

// API: update entire portfolio (admin only)
app.put('/api/portfolio', wrap(async (req, res) => {
  const body = req.json;
  const session = await getAdminSession(req);
  if (!session) return jsonRes(res, { error: 'Unauthorized' }, 403);
  if (!body) return jsonRes(res, { error: 'No body' }, 400);
  const before = await readDB().catch(() => null);
  await writeDB(body);
  if (before) await queuePendingEdit(session._id, 'Full portfolio', before, body);
  return jsonRes(res, { ok: true });
}));

// API: update section
app.put('/api/portfolio/:section', wrap(async (req, res) => {
  const body = req.json;
  const session = await getAdminSession(req);
  if (!session) return jsonRes(res, { error: 'Unauthorized' }, 403);
  const section = req.params.section;
  if (body === null || body === undefined) return jsonRes(res, { error: 'No body' }, 400);
  const db = await readDB();
  const before = section === 'customSections' ? db.customSections : db[section];
  if (section === 'customSections') {
    db.customSections = body;
  } else if (db[section] !== undefined) {
    db[section] = body;
  } else {
    return jsonRes(res, { error: 'Section not found' }, 404);
  }
  await writeDB(db);
  await queuePendingEdit(session._id, section, before, body);
  return jsonRes(res, { ok: true });
}));

// Unknown API route
app.use('/api', (req, res) => jsonRes(res, { error: 'Not Found' }, 404));

// Pages. On Vercel everything in /public is served by the CDN automatically;
// these two routes only add the short URLs. express.static is for local runs.
app.get('/', (req, res) => res.redirect('/landing.html'));
app.get('/editor', (req, res) => res.redirect('/editor.html'));
if (!process.env.VERCEL) app.use(express.static(path.join(ROOT, 'public')));

// Returns the session if it's a valid, non-expired admin session, else null.
async function getAdminSession(req) {
  const token = getToken(req);
  if (!token) return null;
  const s = await getSession(token);
  if (!s) return null;
  if (s.type !== 'admin' || s.expires <= Date.now()) return null;
  return s;
}

function getToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function jsonRes(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Local run only (npm start). On Vercel the app is exported below instead.
if (require.main === module) {
  ensureConnected()
    .then(() => app.listen(PORT, () => console.log(`Portfolio CMS running on http://localhost:${PORT}`)))
    .catch(e => { console.error('Could not connect to MongoDB:', e.message); process.exit(1); });
}

module.exports = app;
