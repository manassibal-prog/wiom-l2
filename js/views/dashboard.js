import { CONFIG } from '../config.js';
import { getTickets, subscribeToUsers } from '../db.js';

let allTickets = [];
let allUsers   = [];
let unsubUsers;

// ─── Scheduled Refresh ───────────────────────────────────────────────────────
// Fires at: 9:55 AM, 12:00 PM, 3:00 PM, 6:00 PM
const REFRESH_TIMES = [
  { hh: 10, mm: 30 },
  { hh: 12, mm: 30 },
  { hh: 14, mm: 30 },
  { hh: 16, mm: 30 },
  { hh: 18, mm: 30 }
];
let schedulerInterval = null;
let firedToday = { date: "", keys: new Set() };
let lastRefreshed = null;

export function mountDashboardView(actor, container) {
  container.innerHTML = buildShell();
  document.getElementById("dash-refresh-btn")?.addEventListener("click", () => fetchTickets(true));
  fetchTickets();
  unsubUsers = subscribeToUsers(users => {
    allUsers = users;
    renderStats();
    renderAdvisorGrid();
  });
  startScheduler();
}

export function unmountDashboardView() {
  if (unsubUsers) unsubUsers();
  stopScheduler();
}

async function fetchTickets(force = false) {
  const btn  = document.getElementById("dash-refresh-btn");
  const info = document.getElementById("dash-refresh-info");

  // Use cached data if we have it and this isn't a forced refresh
  if (!force && allTickets.length > 0) {
    renderStats();
    renderBreakdowns();
    renderAdvisorGrid();
    if (info && lastRefreshed) {
      const t = lastRefreshed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      info.textContent = `Last refreshed: ${t} (cached)`;
    }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = "⏳ Loading…"; }
  try {
    const tickets = await getTickets();
    allTickets = tickets.filter(t => t.dispL3 !== "Shifting Request");
    lastRefreshed = new Date();
    renderStats();
    renderBreakdowns();
    renderAdvisorGrid();
    const t = lastRefreshed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    if (info) info.textContent = `Last refreshed: ${t}`;
  } catch (e) {
    if (info) info.textContent = "Error loading data";
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🔄 Refresh"; }
  }
}

function startScheduler() {
  stopScheduler();
  schedulerInterval = setInterval(() => {
    const now = new Date();
    const todayStr = now.toDateString();
    if (firedToday.date !== todayStr) firedToday = { date: todayStr, keys: new Set() };
    const h = now.getHours(), m = now.getMinutes();
    for (const t of REFRESH_TIMES) {
      const key = `${t.hh}:${t.mm}`;
      if (h === t.hh && m === t.mm && !firedToday.keys.has(key)) {
        firedToday.keys.add(key);
        fetchTickets(true); // force = true for scheduled refresh
        break;
      }
    }
  }, 30000); // check every 30 seconds
}

function stopScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function buildShell() {
  return `
    <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:12px">
      <span style="font-size:12px;color:var(--text-muted)" id="dash-refresh-info">Loading…</span>
      <button class="btn btn-secondary btn-sm" id="dash-refresh-btn">🔄 Refresh</button>
    </div>

    <div class="stats-grid" id="dash-stats"></div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="card">
        <div class="card-header"><h3>Tickets by Status</h3></div>
        <div class="card-body" style="padding:0" id="dash-status-list"></div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Tickets by Complaint Type</h3></div>
        <div class="card-body" style="padding:0" id="dash-category-list"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><h3>Advisor Overview</h3></div>
      <div class="card-body">
        <div class="advisor-grid" id="dash-advisor-grid"></div>
      </div>
    </div>
  `;
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function renderStats() {
  const el = document.getElementById("dash-stats");
  if (!el) return;
  const open       = allTickets.filter(t => CONFIG.STATUSES.OPEN.includes(t.platformStatus));
  const unassigned = allTickets.filter(t => t.platformStatus === "New/Unassigned");
  const critical   = allTickets.filter(t => t.agingBucket === ">120 hrs");
  const reopen     = allTickets.filter(t => t.reopenTag);
  const online     = allUsers.filter(u => u.currentStatus === "Logged In");
  const onBreak    = allUsers.filter(u => u.role === "Advisor" && u.currentStatus === "On Break");

  el.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Active</div><div class="stat-value">${allTickets.length}</div></div>
    <div class="stat-card danger"><div class="stat-label">Unassigned</div><div class="stat-value">${unassigned.length}</div></div>
    <div class="stat-card accent"><div class="stat-label">In Open State</div><div class="stat-value">${open.length}</div></div>
    <div class="stat-card danger"><div class="stat-label">&gt;120h Aging</div><div class="stat-value">${critical.length}</div></div>
    <div class="stat-card warning"><div class="stat-label">Reopen Tickets</div><div class="stat-value">${reopen.length}</div></div>
    <div class="stat-card success"><div class="stat-label">Advisors Online</div><div class="stat-value">${online.length}</div></div>
    <div class="stat-card"><div class="stat-label">On Break</div><div class="stat-value">${onBreak.length}</div></div>
  `;
}

// ─── Breakdowns ───────────────────────────────────────────────────────────────

function renderBreakdowns() {
  const statusEl = document.getElementById("dash-status-list");
  if (statusEl) {
    const counts = {};
    allTickets.forEach(t => { counts[t.platformStatus || "Unknown"] = (counts[t.platformStatus || "Unknown"] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total  = allTickets.length || 1;
    statusEl.innerHTML = sorted.map(([status, count], i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 16px;${i % 2 === 0 ? "" : "background:var(--bg-elevated)"}">
        <div style="flex:1;font-size:13px">${status}</div>
        <div style="font-weight:600;font-size:13px;min-width:32px;text-align:right">${count}</div>
        <div style="width:80px;height:6px;background:var(--border);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${Math.round(count/total*100)}%;background:var(--accent);border-radius:4px"></div>
        </div>
      </div>`).join("");
  }

  const catEl = document.getElementById("dash-category-list");
  if (catEl) {
    const counts = {};
    allTickets.forEach(t => { const c = t.dispL3 || "Unknown"; counts[c] = (counts[c] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const total  = allTickets.length || 1;
    catEl.innerHTML = sorted.map(([cat, count], i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 16px;${i % 2 === 0 ? "" : "background:var(--bg-elevated)"}">
        <div style="flex:1;font-size:13px">${cat}</div>
        <div style="font-weight:600;font-size:13px;min-width:32px;text-align:right">${count}</div>
        <div style="width:80px;height:6px;background:var(--border);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${Math.round(count/total*100)}%;background:var(--accent);border-radius:4px"></div>
        </div>
      </div>`).join("");
  }
}

// ─── Advisor Grid ─────────────────────────────────────────────────────────────

function renderAdvisorGrid() {
  const advisors = allUsers.filter(u => u.role === "Advisor" && u.active);
  const grid = document.getElementById("dash-advisor-grid");
  if (!grid || !advisors.length) return;

  grid.innerHTML = advisors.map(a => {
    const holding    = allTickets.filter(t => t.assignedTo === a.email && CONFIG.STATUSES.OPEN.includes(t.platformStatus)).length;
    const presenceCls = a.currentStatus === "Logged In" ? "logged-in" : a.currentStatus === "On Break" ? "on-break" : "logged-out";
    return `
      <div class="advisor-card">
        <div class="advisor-card-name" style="display:flex;align-items:center;gap:6px">
          <span class="presence-dot ${presenceCls}"></span>${a.name}
        </div>
        <div class="advisor-card-stats">
          <div class="advisor-stat"><div class="as-val">${holding}</div><div class="as-label">Holding</div></div>
          <div class="advisor-stat"><div class="as-val">${a.todayResolvedCount || 0}</div><div class="as-label">Resolved</div></div>
          <div class="advisor-stat"><div class="as-val">${a.todayAssignedCount || 0}</div><div class="as-label">Assigned</div></div>
          <div class="advisor-stat">
            <div class="as-val">${a.currentStatus === "Logged In" ? "🟢" : a.currentStatus === "On Break" ? "🟡" : "⚫"}</div>
            <div class="as-label">Status</div>
          </div>
        </div>
      </div>`;
  }).join("");
}
