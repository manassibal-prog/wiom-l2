import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG, CONFIG } from './config.js';

// ─── Firebase Auth (kept for Google Sign-In only) ─────────────────
const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

// ─── API helper ───────────────────────────────────────────────────
// Uses text/plain body to avoid CORS preflight with Apps Script

// Read-only actions: deduplicate concurrent identical calls so they share one network request.
// This prevents Apps Script concurrent-execution limits from being hit when multiple
// subscriptions poll simultaneously (e.g. subscribeToUsers from app.js + tl-dashboard).
const _READ_ACTIONS = new Set([
  'getUser','getUsers','getTickets','getAdvisorTickets',
  'getAuditLog','getAdvisorActivity','getIngestionLogs','getRoster'
]);
// Write operations need more time — under concurrent load the lock can queue for ~20 s
// before the actual write runs, so 30 s cuts them off too early.
const _WRITE_TIMEOUT_MS = 60000;
const _READ_TIMEOUT_MS  = 30000;
const _inflight = {};

async function api(data) {
  const isRead = _READ_ACTIONS.has(data.action);
  const dedupeKey = isRead ? JSON.stringify(data) : null;
  if (dedupeKey && _inflight[dedupeKey]) return _inflight[dedupeKey];

  const controller  = new AbortController();
  const timeoutMs   = isRead ? _READ_TIMEOUT_MS : _WRITE_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Use GET so params survive any Apps Script CORS redirect.
  // POST→GET redirects drop the body (HTTP spec); GET redirects keep the URL.
  // Complex objects (arrays) are JSON-encoded as a single URL param.
  const urlParams = new URLSearchParams({ key: CONFIG.API_KEY });
  Object.entries(data).forEach(([k, v]) => {
    if (v !== null && v !== undefined) {
      urlParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  });
  const url = CONFIG.SHEET_API_URL + '?' + urlParams.toString();

  const promise = fetch(url, { method: 'GET', signal: controller.signal, cache: 'no-store' })
    .then(res => {
      if (!res.ok) throw new Error('API request failed (' + res.status + ')');
      return res.json();
    })
    .then(json => {
      if (json && json.error) throw new Error(json.error);
      return json;
    })
    .catch(e => {
      if (e.name === 'AbortError') throw new Error('Server busy — please wait a moment and try again.');
      throw e;
    })
    .finally(() => {
      clearTimeout(timer);
      if (dedupeKey) delete _inflight[dedupeKey];
    });

  if (dedupeKey) _inflight[dedupeKey] = promise;
  return promise;
}

// ─── Users ───────────────────────────────────────────────────────

export async function getUser(email) {
  return api({ action: 'getUser', email });
}

export async function createUser(data) {
  return api({ action: 'createUser', ...data });
}

export async function updateUser(email, updates) {
  return api({ action: 'updateUser', email, updates });
}

export function subscribeToUsers(callback) {
  api({ action: 'getUsers' }).then(callback).catch(console.error);
  const iv = setInterval(
    () => api({ action: 'getUsers' }).then(callback).catch(console.error),
    300000 // refresh user list every 5 minutes
  );
  return () => clearInterval(iv);
}

export async function updateUserPresence(email, name, event) {
  return api({ action: 'updateUserPresence', email, name, event });
}

// ─── Tickets ─────────────────────────────────────────────────────

// Google Sheets returns ticketNo as a number; coerce to string so
// data-id attribute comparisons (always strings) work correctly.
function _fixTicketNos(tickets) {
  return tickets.map(t => ({ ...t, ticketNo: String(t.ticketNo) }));
}

export async function getTickets() {
  return _fixTicketNos(await api({ action: 'getTickets' }));
}

export function subscribeToTickets(callback) {
  api({ action: 'getTickets' }).then(t => callback(_fixTicketNos(t))).catch(console.error);
  const iv = setInterval(
    () => api({ action: 'getTickets' }).then(t => callback(_fixTicketNos(t))).catch(console.error),
    300000 // refresh every 5 minutes
  );
  return () => clearInterval(iv);
}

export function subscribeToAdvisorTickets(email, callback) {
  api({ action: 'getAdvisorTickets', email }).then(t => callback(_fixTicketNos(t))).catch(console.error);
  const iv = setInterval(
    () => api({ action: 'getAdvisorTickets', email }).then(t => callback(_fixTicketNos(t))).catch(console.error),
    300000 // refresh every 5 minutes
  );
  return () => clearInterval(iv);
}

export async function assignTicket(ticketNo, advisorEmail, advisorName, actor) {
  return api({ action: 'assignTicket', ticketNo, advisorEmail, advisorName, actorEmail: actor.email });
}

export async function bulkAssignTickets(assignments, actor) {
  return api({ action: 'bulkAssignTickets', assignments, actorEmail: actor.email });
}

export async function updateTicketStatus(ticketNo, newStatus, newRemarks, actor, partnerFollowUpStatus) {
  return api({ action: 'updateTicketStatus', ticketNo, newStatus, newRemarks, partnerFollowUpStatus, actorEmail: actor.email });
}

export async function getAdvisorActivity(date, toTime) {
  return api({ action: 'getAdvisorActivity', date, toTime });
}

export async function addRemark(ticketNo, remark, actor) {
  return api({ action: 'addRemark', ticketNo, remark, actorEmail: actor.email });
}

export async function deassignTicket(ticketNo, actor) {
  return api({ action: 'deassignTicket', ticketNo, actorEmail: actor.email });
}

export async function bulkDeassignTickets(ticketNos, actor) {
  return api({ action: 'bulkDeassignTickets', ticketNos, actorEmail: actor.email });
}

// ─── Audit log ───────────────────────────────────────────────────

export async function getTicketAuditLog(ticketNo) {
  return api({ action: 'getAuditLog', ticketNo });
}

// ─── Roster ──────────────────────────────────────────────────────

export async function getRoster(date) {
  return api({ action: 'getRoster', date });
}

export async function updateRosterEntry(date, email, code) {
  return api({ action: 'updateRosterEntry', date, email, code });
}

export function subscribeToRoster(date, callback) {
  api({ action: 'getRoster', date }).then(callback).catch(console.error);
  const iv = setInterval(
    () => api({ action: 'getRoster', date }).then(callback).catch(console.error),
    300000 // roster rarely changes — refresh every 5 minutes
  );
  return () => clearInterval(iv);
}

// ─── Ingestion log ───────────────────────────────────────────────

export async function getRecentIngestionLogs(limit = 20) {
  const logs = await api({ action: 'getIngestionLogs' });
  return Array.isArray(logs) ? logs.slice(0, limit) : [];
}

// ─── Settings ────────────────────────────────────────────────────

export async function getSettings() {
  return {};
}

export async function updateSettings() {
  return { ok: true };
}
