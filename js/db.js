import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG, CONFIG } from './config.js';

// ─── Firebase Auth (kept for Google Sign-In only) ─────────────────
const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

// ─── API helper ───────────────────────────────────────────────────
// Uses text/plain body to avoid CORS preflight with Apps Script

async function api(data) {
  const body = JSON.stringify({ key: CONFIG.API_KEY, ...data });
  const res  = await fetch(CONFIG.SHEET_API_URL, { method: 'POST', body });
  if (!res.ok) throw new Error('API request failed (' + res.status + ')');
  const json = await res.json();
  if (json && json.error) throw new Error(json.error);
  return json;
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
    120000 // refresh user list every 2 minutes
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
    60000
  );
  return () => clearInterval(iv);
}

export function subscribeToAdvisorTickets(email, callback) {
  api({ action: 'getAdvisorTickets', email }).then(t => callback(_fixTicketNos(t))).catch(console.error);
  const iv = setInterval(
    () => api({ action: 'getAdvisorTickets', email }).then(t => callback(_fixTicketNos(t))).catch(console.error),
    60000
  );
  return () => clearInterval(iv);
}

export async function assignTicket(ticketNo, advisorEmail, advisorName, actor) {
  return api({ action: 'assignTicket', ticketNo, advisorEmail, advisorName, actorEmail: actor.email });
}

export async function bulkAssignTickets(assignments, actor) {
  return api({ action: 'bulkAssignTickets', assignments, actorEmail: actor.email });
}

export async function updateTicketStatus(ticketNo, newStatus, newRemarks, actor) {
  return api({ action: 'updateTicketStatus', ticketNo, newStatus, newRemarks, actorEmail: actor.email });
}

export async function updateTicketRemarks(ticketNo, remarks, actor) {
  return api({ action: 'updateTicketStatus', ticketNo, newRemarks: remarks, actorEmail: actor.email });
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
