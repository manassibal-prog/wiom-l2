import { CONFIG } from '../config.js';
import { subscribeToTickets, subscribeToUsers } from '../db.js';

let allTickets = [];
let allUsers   = [];
let unsubTickets, unsubUsers;

export function mountDashboardView(actor, container) {
  container.innerHTML = buildShell();
  unsubTickets = subscribeToTickets(tickets => {
    allTickets = tickets.filter(t => t.dispL3 !== "Shifting Request");
    renderStats();
    renderBreakdowns();
    renderAdvisorGrid();
  });
  unsubUsers = subscribeToUsers(users => {
    allUsers = users;
    renderStats();
    renderAdvisorGrid();
  });
}

export function unmountDashboardView() {
  if (unsubTickets) unsubTickets();
  if (unsubUsers)   unsubUsers();
}

function buildShell() {
  return `
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
