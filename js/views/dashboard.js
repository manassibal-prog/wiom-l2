import { CONFIG } from '../config.js';
import { getTickets, subscribeToUsers, getAdvisorActivity } from '../db.js';
import { statusBadge, showToast } from '../ui.js';

let allTickets       = [];
let allUsers         = [];
let currentCatFilter  = "";
let advisorActivity   = {};
let pivotL3Filter     = "";
let pivotL4Filter     = "";
let pivotStatusFilter = "";
let unsubUsers;

// ─── Scheduled Refresh ───────────────────────────────────────────────────────
// Fires at: 10:30 AM, 12:30 PM, 2:30 PM, 4:30 PM, 6:30 PM (30 min after ingestion)
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
  currentCatFilter  = "";
  advisorActivity   = {};
  pivotL3Filter     = "";
  pivotL4Filter     = "";
  pivotStatusFilter = "";
  container.innerHTML = buildShell();
  document.getElementById("dash-refresh-btn")?.addEventListener("click", () => fetchTickets(true));
  document.getElementById("dash-cat-filter")?.addEventListener("change", e => {
    currentCatFilter = e.target.value;
    renderBreakdowns();
  });
  fetchTickets();
  unsubUsers = subscribeToUsers(users => {
    allUsers = users;
    renderStats();
    renderPerformanceTable();
  });
  startScheduler();
  initPerformanceSection();
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
    renderPivotTables();
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
    renderPivotTables();
    renderPerformanceTable();
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
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <h3 style="margin:0" id="dash-cat-title">Tickets by Complaint Type</h3>
          <select class="filter-select" id="dash-cat-filter" style="font-size:12px;padding:3px 8px;min-width:160px">
            <option value="">All Categories (L3)</option>
          </select>
        </div>
        <div class="card-body" style="padding:0" id="dash-category-list"></div>
      </div>
    </div>

    <div id="dash-pivots"></div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <h3 style="margin:0">Advisor Performance</h3>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <input type="date" id="perf-date" class="filter-input" style="padding:4px 8px;font-size:12px;width:auto">
          <span style="font-size:12px;color:var(--text-muted)">up to</span>
          <input type="time" id="perf-time" class="filter-input" style="padding:4px 8px;font-size:12px;width:auto">
          <button class="btn btn-primary btn-sm" id="perf-apply">Apply</button>
          <span id="perf-status" style="font-size:11px;color:var(--text-muted)"></span>
        </div>
      </div>
      <div id="dash-perf-table" style="overflow-x:auto">
        <div style="padding:20px;color:var(--text-muted);font-size:13px;text-align:center">
          Select a date and click Apply to load advisor activity.
        </div>
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

  const catEl     = document.getElementById("dash-category-list");
  const catFilter = document.getElementById("dash-cat-filter");
  const catTitle  = document.getElementById("dash-cat-title");

  if (catEl) {
    // Keep dropdown in sync with current data
    if (catFilter) {
      const l3s = [...new Set(allTickets.map(t => t.dispL3).filter(Boolean))].sort();
      catFilter.innerHTML = `<option value="">All Categories (L3)</option>` +
        l3s.map(l3 => `<option value="${l3}" ${currentCatFilter === l3 ? "selected" : ""}>${l3}</option>`).join("");
    }

    let rows, base;
    if (currentCatFilter) {
      // Drilldown: show L4 for selected L3
      if (catTitle) catTitle.textContent = `${currentCatFilter} — Sub-types`;
      const subset = allTickets.filter(t => t.dispL3 === currentCatFilter);
      const counts = {};
      subset.forEach(t => { const c = t.dispL4 || "—"; counts[c] = (counts[c] || 0) + 1; });
      rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      base = subset.length || 1;
    } else {
      // Top level: show L3 totals
      if (catTitle) catTitle.textContent = "Tickets by Complaint Type";
      const counts = {};
      allTickets.forEach(t => { const c = t.dispL3 || "Unknown"; counts[c] = (counts[c] || 0) + 1; });
      rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      base = allTickets.length || 1;
    }

    catEl.innerHTML = rows.map(([label, count], i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 16px;${i % 2 === 0 ? "" : "background:var(--bg-elevated)"}">
        <div style="flex:1;font-size:13px">${label}</div>
        <div style="font-weight:600;font-size:13px;min-width:32px;text-align:right">${count}</div>
        <div style="width:80px;height:6px;background:var(--border);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${Math.round(count/base*100)}%;background:var(--accent);border-radius:4px"></div>
        </div>
      </div>`).join("");
  }
}

// ─── Pivot Tables ─────────────────────────────────────────────────────────────

function buildPivotHTML(title, tickets, rowFn) {
  const BUCKETS = CONFIG.AGING_BUCKETS;
  const pivot   = {};
  const bucketTotals = {};

  tickets.forEach(t => {
    const rowVal = rowFn(t) || "—";
    const bucket = t.agingBucket || "—";
    if (!pivot[rowVal]) pivot[rowVal] = {};
    pivot[rowVal][bucket] = (pivot[rowVal][bucket] || 0) + 1;
    bucketTotals[bucket] = (bucketTotals[bucket] || 0) + 1;
  });

  // Only show buckets that have at least 1 ticket
  const activeBuckets = BUCKETS.filter(b => bucketTotals[b] > 0);

  // Sort rows by grand total descending
  const rows = Object.entries(pivot).sort((a, b) => {
    const ta = Object.values(a[1]).reduce((s, v) => s + v, 0);
    const tb = Object.values(b[1]).reduce((s, v) => s + v, 0);
    return tb - ta;
  });

  const rowsHTML = rows.map(([rowVal, buckets]) => {
    const rowTotal = Object.values(buckets).reduce((s, v) => s + v, 0);
    return `<tr>
      <td style="font-size:12px;white-space:nowrap">${rowVal}</td>
      ${activeBuckets.map(b => `<td style="text-align:center;font-size:12px">${buckets[b] || ""}</td>`).join("")}
      <td style="text-align:center;font-size:12px;font-weight:600">${rowTotal}</td>
    </tr>`;
  }).join("");

  const footHTML = `
    <tr style="font-weight:700;border-top:2px solid var(--border);background:var(--bg-elevated)">
      <td style="font-size:12px">Grand Total</td>
      ${activeBuckets.map(b => `<td style="text-align:center;font-size:12px">${bucketTotals[b] || ""}</td>`).join("")}
      <td style="text-align:center;font-size:12px">${tickets.length}</td>
    </tr>`;

  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3>${title}</h3></div>
      <div style="overflow-x:auto">
        <table class="data-table" style="width:100%;font-size:12px">
          <thead>
            <tr>
              <th style="text-align:left;min-width:200px"> </th>
              ${activeBuckets.map(b => `<th style="text-align:center;white-space:nowrap">${b}</th>`).join("")}
              <th style="text-align:center;white-space:nowrap">Grand Total</th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
          <tfoot>${footHTML}</tfoot>
        </table>
      </div>
    </div>`;
}

function renderPivotTables() {
  const el = document.getElementById("dash-pivots");
  if (!el || !allTickets.length) return;

  const withL4 = allTickets.filter(t => t.dispL4);

  const uniqueL3 = [...new Set(allTickets.map(t => t.dispL3).filter(Boolean))].sort();
  const uniqueStatuses = [...new Set(allTickets.map(t => t.platformStatus).filter(Boolean))].sort();

  el.innerHTML =
    buildPivotHTML("Sub-type × Aging", withL4, t => t.dispL4) +
    `<div class="card" style="margin-bottom:16px">
      <div class="card-header" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0;flex:0 0 auto">Advisor × Aging</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-left:auto">
          <select class="form-control" id="pivot-l3" style="width:auto;min-width:150px;font-size:12px;padding:4px 8px">
            <option value="">All complaint types</option>
            ${uniqueL3.map(v => `<option value="${v}" ${pivotL3Filter === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
          <select class="form-control" id="pivot-l4" style="width:auto;min-width:150px;font-size:12px;padding:4px 8px">
            <option value="">All sub-types</option>
          </select>
          <select class="form-control" id="pivot-status" style="width:auto;min-width:150px;font-size:12px;padding:4px 8px">
            <option value="">All statuses</option>
            ${uniqueStatuses.map(v => `<option value="${v}" ${pivotStatusFilter === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="advisor-aging-body"></div>
    </div>` +
    buildPivotHTML("Platform Status × Aging", allTickets, t => t.platformStatus);

  _updatePivotL4Options();
  _renderAdvisorAgingTable();

  document.getElementById("pivot-l3")?.addEventListener("change", e => {
    pivotL3Filter = e.target.value;
    pivotL4Filter = "";
    _updatePivotL4Options();
    _renderAdvisorAgingTable();
  });
  document.getElementById("pivot-l4")?.addEventListener("change", e => {
    pivotL4Filter = e.target.value;
    _renderAdvisorAgingTable();
  });
  document.getElementById("pivot-status")?.addEventListener("change", e => {
    pivotStatusFilter = e.target.value;
    _renderAdvisorAgingTable();
  });
}

function _updatePivotL4Options() {
  const l4El = document.getElementById("pivot-l4");
  if (!l4El) return;
  const relevantL4 = [...new Set(
    allTickets
      .filter(t => (!pivotL3Filter || t.dispL3 === pivotL3Filter) && t.dispL4)
      .map(t => t.dispL4)
  )].sort();
  l4El.innerHTML = `<option value="">All sub-types</option>` +
    relevantL4.map(v => `<option value="${v}" ${pivotL4Filter === v ? "selected" : ""}>${v}</option>`).join("");
}

function _renderAdvisorAgingTable() {
  const el = document.getElementById("advisor-aging-body");
  if (!el) return;
  let tickets = allTickets.filter(t => t.assignedToName);
  if (pivotL3Filter)     tickets = tickets.filter(t => t.dispL3 === pivotL3Filter);
  if (pivotL4Filter)     tickets = tickets.filter(t => t.dispL4 === pivotL4Filter);
  if (pivotStatusFilter) tickets = tickets.filter(t => t.platformStatus === pivotStatusFilter);

  if (!tickets.length) {
    el.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">No tickets match the selected filters.</div>`;
    return;
  }

  const BUCKETS = CONFIG.AGING_BUCKETS;
  const pivot = {}, bucketTotals = {};
  tickets.forEach(t => {
    const rowVal = t.assignedToName || "—";
    const bucket = t.agingBucket || "—";
    if (!pivot[rowVal]) pivot[rowVal] = {};
    pivot[rowVal][bucket] = (pivot[rowVal][bucket] || 0) + 1;
    bucketTotals[bucket] = (bucketTotals[bucket] || 0) + 1;
  });

  const activeBuckets = BUCKETS.filter(b => bucketTotals[b] > 0);
  const rows = Object.entries(pivot).sort((a, b) => {
    const ta = Object.values(a[1]).reduce((s, v) => s + v, 0);
    const tb = Object.values(b[1]).reduce((s, v) => s + v, 0);
    return tb - ta;
  });

  const rowsHTML = rows.map(([rowVal, buckets]) => {
    const rowTotal = Object.values(buckets).reduce((s, v) => s + v, 0);
    return `<tr>
      <td style="font-size:12px;white-space:nowrap">${rowVal}</td>
      ${activeBuckets.map(b => `<td style="text-align:center;font-size:12px">${buckets[b] || ""}</td>`).join("")}
      <td style="text-align:center;font-size:12px;font-weight:600">${rowTotal}</td>
    </tr>`;
  }).join("");

  const footHTML = `
    <tr style="font-weight:700;border-top:2px solid var(--border);background:var(--bg-elevated)">
      <td style="font-size:12px">Grand Total</td>
      ${activeBuckets.map(b => `<td style="text-align:center;font-size:12px">${bucketTotals[b] || ""}</td>`).join("")}
      <td style="text-align:center;font-size:12px">${tickets.length}</td>
    </tr>`;

  el.innerHTML = `
    <div style="overflow-x:auto">
      <table class="data-table" style="width:100%;font-size:12px">
        <thead>
          <tr>
            <th style="text-align:left;min-width:200px"> </th>
            ${activeBuckets.map(b => `<th style="text-align:center;white-space:nowrap">${b}</th>`).join("")}
            <th style="text-align:center;white-space:nowrap">Grand Total</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
        <tfoot>${footHTML}</tfoot>
      </table>
    </div>`;
}

// ─── Advisor Performance ──────────────────────────────────────────────────────

function initPerformanceSection() {
  // Default: today in IST, up to current time
  const nowIST   = new Date(Date.now() + 5.5 * 3600000);
  const todayIST = nowIST.toISOString().slice(0, 10);
  const timeIST  = nowIST.toISOString().slice(11, 16);
  const dateEl = document.getElementById("perf-date");
  const timeEl = document.getElementById("perf-time");
  if (dateEl) dateEl.value = todayIST;
  if (timeEl) timeEl.value = timeIST;

  document.getElementById("perf-apply")?.addEventListener("click", fetchAdvisorActivity);
}

async function fetchAdvisorActivity() {
  const date   = document.getElementById("perf-date")?.value;
  const toTime = document.getElementById("perf-time")?.value;
  const status = document.getElementById("perf-status");
  const btn    = document.getElementById("perf-apply");
  if (!date) { showToast("Select a date first", "warning"); return; }
  if (btn)    { btn.disabled = true; btn.textContent = "Loading…"; }
  if (status) status.textContent = "";
  try {
    advisorActivity = await getAdvisorActivity(date, toTime);
    renderPerformanceTable();
    if (status) {
      const label = toTime ? `${date} up to ${toTime}` : date;
      status.textContent = `Showing: ${label}`;
    }
  } catch (e) {
    showToast("Error loading activity: " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Apply"; }
  }
}

function renderPerformanceTable() {
  const el = document.getElementById("dash-perf-table");
  if (!el) return;

  const advisors = allUsers.filter(u => u.role === "Advisor" && u.active);
  if (!advisors.length) {
    el.innerHTML = `<div style="padding:20px;color:var(--text-muted);font-size:13px;text-align:center">No advisor data yet.</div>`;
    return;
  }

  const RESOLVED = new Set([
    "Resolved - Refund Initiated","Resolved by PFT","Resolved - DNP 3",
    "Already completed","Already Resolved","Send to WIOM"
  ]);

  // Status → pill colour
  function pillStyle(st) {
    if (RESOLVED.has(st))          return "background:rgba(34,197,94,.12);color:#22c55e";
    if (st.startsWith("DNP"))      return "background:rgba(239,68,68,.12);color:#ef4444";
    if (st.startsWith("Follow"))   return "background:rgba(79,142,247,.12);color:#4f8ef7";
    if (st === "Pending")          return "background:rgba(245,158,11,.12);color:#f59e0b";
    return "background:rgba(100,116,139,.12);color:#94a3b8";
  }

  const rows = advisors.map(a => {
    const act      = advisorActivity[a.email] || { actions: 0, statusChanges: 0, remarks: 0, resolved: 0, statusMix: {} };
    const holding  = allTickets.filter(t => t.assignedTo === a.email && CONFIG.STATUSES.OPEN.includes(t.platformStatus)).length;
    const critical = allTickets.filter(t => t.assignedTo === a.email && CONFIG.STATUSES.OPEN.includes(t.platformStatus) && (t.agingBucket === "72-120 hrs" || t.agingBucket === ">120 hrs")).length;
    const topSt    = Object.entries(act.statusMix).sort((x, y) => y[1] - x[1]).slice(0, 3);
    return { a, act, holding, critical, topSt };
  }).sort((x, y) => y.act.actions - x.act.actions);

  const hasActivity = Object.keys(advisorActivity).length > 0;

  el.innerHTML = `
    <table class="data-table" style="width:100%;min-width:700px">
      <thead>
        <tr>
          <th>Advisor</th>
          <th>Status</th>
          <th style="text-align:center">Holding</th>
          ${hasActivity ? `
          <th style="text-align:center">Actions ↓</th>
          <th style="text-align:center" title="Status changes">S/C</th>
          <th style="text-align:center" title="Remarks added">Remarks</th>
          <th style="text-align:center">Resolved</th>
          <th>Status Mix</th>` : ""}
          <th style="text-align:center">Critical &gt;72h</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(({ a, act, holding, critical, topSt }) => {
          const dot   = a.currentStatus === "Logged In" ? "#22c55e" : a.currentStatus === "On Break" ? "#f59e0b" : "#475569";
          const stTxt = a.currentStatus || "Logged Out";

          const critCell = critical > 0
            ? `<span style="background:rgba(239,68,68,.15);color:#ef4444;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${critical}</span>`
            : `<span style="color:var(--text-muted)">—</span>`;

          const pills = topSt.map(([st, cnt]) =>
            `<span style="${pillStyle(st)};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:500;white-space:nowrap">${cnt} ${st.length > 18 ? st.slice(0,18)+"…" : st}</span>`
          ).join(" ");

          return `<tr>
            <td>
              <div style="font-weight:600;font-size:13px">${a.name}</div>
              <div style="font-size:10px;color:var(--text-muted)">${a.email}</div>
            </td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="width:8px;height:8px;border-radius:50%;background:${dot};flex-shrink:0;display:inline-block"></span>
                <span style="font-size:12px;color:${dot}">${stTxt}</span>
              </div>
            </td>
            <td style="text-align:center;font-size:14px;font-weight:600">${holding}</td>
            ${hasActivity ? `
            <td style="text-align:center;font-size:14px;font-weight:600;color:var(--accent)">${act.actions || "—"}</td>
            <td style="text-align:center;font-size:13px;color:var(--text-muted)">${act.statusChanges || "—"}</td>
            <td style="text-align:center;font-size:13px;color:var(--text-muted)">${act.remarks || "—"}</td>
            <td style="text-align:center">
              ${act.resolved > 0
                ? `<span style="background:rgba(34,197,94,.12);color:#22c55e;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600">${act.resolved}</span>`
                : `<span style="color:var(--text-muted)">0</span>`}
            </td>
            <td style="max-width:220px">
              <div style="display:flex;gap:4px;flex-wrap:wrap">${pills || '<span style="color:var(--text-muted);font-size:11px">—</span>'}</div>
            </td>` : ""}
            <td style="text-align:center">${critCell}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${hasActivity ? `<div style="padding:8px 14px;font-size:11px;color:var(--text-muted);border-top:1px solid var(--border)">
      Actions = status changes + remarks written by advisor during the selected period. Sorted by most active.
    </div>` : ""}
  `;
}

