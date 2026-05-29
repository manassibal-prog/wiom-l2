import { CONFIG } from '../config.js';
import { subscribeToAdvisorTickets, updateUserPresence, getUser } from '../db.js';
import {
  showToast, statusBadge, agingBadge, formatDate, formatDateShort, kaptureLink,
  filterTickets, renderPagination, showTicketDetail
} from '../ui.js';

// ─── Module state ─────────────────────────────────────────────────────────────
let allTickets   = [];
let filtered     = [];
let currentPage  = 1;
const PAGE_SIZE  = CONFIG.PAGE_SIZE;
let unsubTickets = null;
let currentActor = null;
let userDoc      = null;
let activeViewType = null; // "dashboard" | "tickets"

// ─── Filter state ─────────────────────────────────────────────────────────────
let currentFilters = {
  search: "", partners: [], statuses: [], l3s: [], l4s: [], agings: [], reopenOnly: false
};
let _docChangeHandler = null;
let _docClickHandler  = null;

const MS_LABELS = {
  partners: "All Partners",
  statuses: "All Statuses",
  l3s:      "All Categories",
  l4s:      "All Sub-types",
  agings:   "All Aging"
};

// ─── Sidebar Attendance (called once from app.js at boot) ─────────────────────

export async function initAdvisorSidebar(actor) {
  currentActor = actor;
  try {
    userDoc = await getUser(actor.email);
  } catch (e) {
    console.warn("Could not load user doc for attendance", e);
  }
  renderSidebarAttendance();
  _ensureSubscription(actor);
}

function _ensureSubscription(actor) {
  if (unsubTickets) return;
  unsubTickets = subscribeToAdvisorTickets(actor.email, tickets => {
    allTickets = tickets;
    if (activeViewType === "dashboard") renderDashboardContent();
    if (activeViewType === "tickets")   applyAndRender();
  });
}

function renderSidebarAttendance() {
  const el = document.getElementById("sidebar-attendance");
  if (!el) return;
  if (!userDoc) { el.innerHTML = ""; return; }

  const status    = userDoc.currentStatus || "Logged Out";
  const dotCls    = status === "Logged In" ? "logged-in" : status === "On Break" ? "on-break" : "logged-out";
  const usedBreak = userDoc.todayBreakMinutes || 0;
  const remaining = CONFIG.BREAK_CAP_MINUTES - usedBreak;

  el.innerHTML = `
    <div style="padding:10px 12px 8px;border-top:1px solid var(--border);margin-top:auto">
      <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">
        <span class="presence-dot ${dotCls}"></span>
        <span style="font-size:12px;font-weight:500;color:var(--text-primary)">${status}</span>
      </div>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px;min-height:13px">
        ${status !== "Logged Out" ? `Break: ${usedBreak}m / ${CONFIG.BREAK_CAP_MINUTES}m (${remaining}m left)` : ""}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        <button class="btn btn-success btn-sm" id="sb-btn-login"
          style="font-size:11px;padding:3px 10px;${status !== "Logged Out" ? "display:none" : ""}">Log In</button>
        <button class="btn btn-secondary btn-sm" id="sb-btn-break"
          style="font-size:11px;padding:3px 10px;${status !== "Logged In" ? "display:none" : ""}">Start Break</button>
        <button class="btn btn-secondary btn-sm" id="sb-btn-resume"
          style="font-size:11px;padding:3px 10px;${status !== "On Break" ? "display:none" : ""}">End Break</button>
        <button class="btn btn-danger btn-sm" id="sb-btn-logout"
          style="font-size:11px;padding:3px 10px;${status === "Logged Out" ? "display:none" : ""}">Log Out</button>
      </div>
    </div>
  `;

  document.getElementById("sb-btn-login")?.addEventListener("click", () => _attendanceHandle("LOGIN"));
  document.getElementById("sb-btn-break")?.addEventListener("click", () => {
    if ((userDoc?.todayBreakMinutes || 0) >= CONFIG.BREAK_CAP_MINUTES) {
      showToast("Break cap of 60 minutes reached", "warning"); return;
    }
    _attendanceHandle("BREAK_START");
  });
  document.getElementById("sb-btn-resume")?.addEventListener("click", () => _attendanceHandle("BREAK_END"));
  document.getElementById("sb-btn-logout")?.addEventListener("click", () => {
    if (!confirm("Are you sure you want to log out?")) return;
    _attendanceHandle("LOGOUT");
  });
}

async function _attendanceHandle(event) {
  const btns = ["sb-btn-login","sb-btn-break","sb-btn-resume","sb-btn-logout"];
  btns.forEach(id => { const b = document.getElementById(id); if (b) b.disabled = true; });
  try {
    await updateUserPresence(currentActor.email, currentActor.name, event);
    userDoc = await getUser(currentActor.email);
    renderSidebarAttendance();
    const labels = { LOGIN: "Logged in", BREAK_START: "Break started", BREAK_END: "Break ended", LOGOUT: "Logged out" };
    showToast(labels[event] || "Done", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
    btns.forEach(id => { const b = document.getElementById(id); if (b) b.disabled = false; });
  }
}

// ─── Dashboard View ───────────────────────────────────────────────────────────

export function mountAdvisorDashboard(actor, container) {
  currentActor = actor;
  activeViewType = "dashboard";
  _ensureSubscription(actor);
  container.innerHTML = _buildDashboardShell();
  renderDashboardContent();
}

function _buildDashboardShell() {
  return `
    <div class="stats-grid" id="adv-dash-stats"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
      <div class="card">
        <div style="padding:12px 16px 6px;font-size:13px;font-weight:600;color:var(--text-primary)">By Platform Status</div>
        <div id="adv-dash-status-bd"></div>
      </div>
      <div class="card">
        <div style="padding:12px 16px 6px;font-size:13px;font-weight:600;color:var(--text-primary)">By Aging Bucket</div>
        <div id="adv-dash-aging-bd"></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div style="padding:12px 16px 6px;font-size:13px;font-weight:600;color:var(--text-primary)">By Complaint Category (L3)</div>
      <div id="adv-dash-l3-bd"></div>
    </div>
  `;
}

function renderDashboardContent() {
  // Stat cards
  const statsEl = document.getElementById("adv-dash-stats");
  if (statsEl) {
    const open     = allTickets.filter(t => CONFIG.STATUSES.OPEN.includes(t.platformStatus)).length;
    const critical = allTickets.filter(t => t.agingBucket === ">120 hrs").length;
    const closed   = allTickets.filter(t => CONFIG.STATUSES.CLOSED.includes(t.platformStatus)).length;
    const reopens  = allTickets.filter(t => t.reopenTag).length;
    statsEl.innerHTML = `
      <div class="stat-card accent"><div class="stat-label">Open Tickets</div><div class="stat-value">${open}</div></div>
      <div class="stat-card warning"><div class="stat-label">&gt;120h Aging</div><div class="stat-value">${critical}</div></div>
      <div class="stat-card success"><div class="stat-label">Resolved</div><div class="stat-value">${closed}</div></div>
      <div class="stat-card danger"><div class="stat-label">Reopens</div><div class="stat-value">${reopens}</div></div>
      <div class="stat-card"><div class="stat-label">Total Assigned</div><div class="stat-value">${allTickets.length}</div></div>
    `;
  }

  // Status breakdown
  _renderBreakdown("adv-dash-status-bd",
    allTickets.reduce((acc, t) => { const k = t.platformStatus || "Unknown"; acc[k] = (acc[k]||0)+1; return acc; }, {}));

  // Aging breakdown (preserve bucket order)
  _renderBreakdown("adv-dash-aging-bd",
    allTickets.reduce((acc, t) => { if (t.agingBucket) acc[t.agingBucket] = (acc[t.agingBucket]||0)+1; return acc; }, {}),
    CONFIG.AGING_BUCKETS);

  // L3 breakdown
  _renderBreakdown("adv-dash-l3-bd",
    allTickets.reduce((acc, t) => { if (t.dispL3) acc[t.dispL3] = (acc[t.dispL3]||0)+1; return acc; }, {}));
}

function _renderBreakdown(elId, counts, orderedKeys = null) {
  const el = document.getElementById(elId);
  if (!el) return;
  const entries = orderedKeys
    ? orderedKeys.filter(k => counts[k]).map(k => [k, counts[k]])
    : Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    el.innerHTML = `<p style="padding:12px 16px;font-size:12px;color:var(--text-muted)">No data.</p>`;
    return;
  }
  el.innerHTML = entries.map(([label, count]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 16px;border-bottom:1px solid var(--border)">
      <span style="font-size:12px;color:var(--text-primary)">${label}</span>
      <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${count}</span>
    </div>`).join("");
}

// ─── Tickets View ─────────────────────────────────────────────────────────────

export function mountAdvisorView(actor, container) {
  currentActor = actor;
  activeViewType = "tickets";
  currentFilters = { search: "", partners: [], statuses: [], l3s: [], l4s: [], agings: [], reopenOnly: false };
  currentPage = 1;
  _ensureSubscription(actor);
  container.innerHTML = _buildTicketsShell();
  bindFilterEvents();
  populateTicketFilters();
  applyAndRender();
}

export function unmountAdvisorView() {
  activeViewType = null;
  if (_docChangeHandler) { document.removeEventListener("change", _docChangeHandler); _docChangeHandler = null; }
  if (_docClickHandler)  { document.removeEventListener("click",  _docClickHandler);  _docClickHandler  = null; }
  // Subscription intentionally kept alive for the full session
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function _buildMSHTML(id, optsHTML = "") {
  return `
    <div class="ms-wrap" id="ms-wrap-${id}">
      <button type="button" class="filter-select ms-btn" id="ms-btn-${id}">
        ${MS_LABELS[id]}<span style="opacity:.5;margin-left:5px;font-size:10px">▾</span>
      </button>
      <div class="ms-drop" id="ms-drop-${id}">
        <div class="ms-top">
          <button type="button" class="btn btn-xs btn-secondary ms-all-btn" data-group="${id}">All</button>
          <button type="button" class="btn btn-xs btn-secondary ms-clear-btn" data-group="${id}">Clear</button>
        </div>
        <div class="ms-opts" id="ms-opts-${id}">${optsHTML}</div>
      </div>
    </div>`;
}

function _buildTicketsShell() {
  const statusOpts = CONFIG.ALL_STATUSES.map(s =>
    `<label class="ms-opt-label"><input type="checkbox" class="ms-cb" data-group="statuses" value="${s}"><span>${s}</span></label>`
  ).join("");
  const agingOpts = CONFIG.AGING_BUCKETS.map(b =>
    `<label class="ms-opt-label"><input type="checkbox" class="ms-cb" data-group="agings" value="${b}"><span>${b}</span></label>`
  ).join("");

  return `
    <style>
      .ms-wrap{position:relative;display:inline-block}
      .ms-btn{cursor:pointer;text-align:left;white-space:nowrap;display:flex;align-items:center;justify-content:space-between;gap:4px;min-width:110px}
      .ms-drop{display:none;position:absolute;top:calc(100% + 4px);left:0;z-index:300;min-width:220px;max-width:320px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.45);overflow:hidden}
      .ms-drop.open{display:block}
      .ms-top{display:flex;gap:6px;padding:7px 10px;border-bottom:1px solid var(--border)}
      .ms-opts{max-height:230px;overflow-y:auto;padding:4px 0}
      .ms-opt-label{display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;white-space:nowrap}
      .ms-opt-label:hover{background:rgba(255,255,255,.06)}
      .ms-opt-label input[type=checkbox]{flex-shrink:0;accent-color:var(--accent,#4f8ef7)}
    </style>
    <div class="card">
      <div class="filter-bar" id="adv-filter-bar">
        <input class="filter-input" id="adv-search" type="text" placeholder="Search ticket #, customer, phone…">
        ${_buildMSHTML("partners")}
        ${_buildMSHTML("statuses", statusOpts)}
        ${_buildMSHTML("l3s")}
        ${_buildMSHTML("l4s")}
        ${_buildMSHTML("agings", agingOpts)}
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
          <input type="checkbox" id="adv-fl-reopen"> Reopens only
        </label>
        <div class="filter-actions">
          <button class="btn btn-secondary btn-sm" id="adv-fl-clear">Clear</button>
        </div>
      </div>
      <div class="table-container" style="border-radius:0;border-left:none;border-right:none;border-bottom:none;box-shadow:none">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Customer Name</th>
              <th>Phone</th>
              <th>Complaint Type</th>
              <th>Partner</th>
              <th>Aging</th>
              <th>Kapture Status</th>
              <th>Platform Status</th>
              <th>Created</th>
              <th>Assigned On</th>
              <th>Reopen</th>
              <th>Remarks</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="adv-tbody"></tbody>
        </table>
      </div>
      <div class="pagination">
        <span class="pagination-info" id="adv-pag-info"></span>
        <div class="page-btns" id="adv-pag-btns"></div>
      </div>
    </div>
  `;
}

// ─── Multi-Select Helpers ─────────────────────────────────────────────────────

function getMultiSelectValues(groupId) {
  return [...document.querySelectorAll(`#ms-opts-${groupId} .ms-cb:checked`)].map(cb => cb.value);
}

function setMultiSelectLabel(groupId) {
  const btn = document.getElementById(`ms-btn-${groupId}`);
  if (!btn) return;
  const vals  = getMultiSelectValues(groupId);
  const def   = MS_LABELS[groupId] || "All";
  const arrow = `<span style="opacity:.5;margin-left:5px;font-size:10px">▾</span>`;
  if (vals.length === 0) btn.innerHTML = `${def}${arrow}`;
  else if (vals.length === 1) {
    const short = vals[0].length > 22 ? vals[0].slice(0, 22) + "…" : vals[0];
    btn.innerHTML = `${short}${arrow}`;
  } else btn.innerHTML = `${vals.length} selected${arrow}`;
}

function populateOpts(groupId, values) {
  const el = document.getElementById(`ms-opts-${groupId}`);
  if (!el) return;
  const current = getMultiSelectValues(groupId);
  el.innerHTML = values.map(v => {
    const chk = current.includes(v) ? "checked" : "";
    return `<label class="ms-opt-label"><input type="checkbox" class="ms-cb" data-group="${groupId}" value="${v}" ${chk}><span>${v}</span></label>`;
  }).join("");
}

function populateTicketFilters() {
  const partners = [...new Set(allTickets.map(t => t.mappedPartner).filter(Boolean))].sort();
  populateOpts("partners", partners);
  setMultiSelectLabel("partners");

  const l3s = [...new Set(allTickets.map(t => t.dispL3).filter(Boolean))].sort();
  populateOpts("l3s", l3s);
  setMultiSelectLabel("l3s");

  populateL4Filter(getMultiSelectValues("l3s"));
}

function populateL4Filter(selectedL3s) {
  const source = selectedL3s?.length ? allTickets.filter(t => selectedL3s.includes(t.dispL3)) : allTickets;
  const l4s    = [...new Set(source.map(t => t.dispL4).filter(Boolean))].sort();
  const prevL4 = getMultiSelectValues("l4s").filter(v => l4s.includes(v));
  const el = document.getElementById("ms-opts-l4s");
  if (!el) return;
  el.innerHTML = l4s.map(v => {
    const chk = prevL4.includes(v) ? "checked" : "";
    return `<label class="ms-opt-label"><input type="checkbox" class="ms-cb" data-group="l4s" value="${v}" ${chk}><span>${v}</span></label>`;
  }).join("");
  setMultiSelectLabel("l4s");
}

// ─── Filter Events ────────────────────────────────────────────────────────────

function bindFilterEvents() {
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  document.getElementById("adv-search")?.addEventListener("input", debounce(e => {
    currentFilters.search = e.target.value;
    applyAndRender();
  }, 250));

  document.getElementById("adv-fl-reopen")?.addEventListener("change", e => {
    currentFilters.reopenOnly = e.target.checked;
    applyAndRender();
  });

  document.getElementById("adv-fl-clear")?.addEventListener("click", clearFilters);

  // Document-level change handler for checkboxes (cannot be blocked by stopPropagation)
  _docChangeHandler = e => {
    if (!e.target.classList.contains("ms-cb")) return;
    if (!document.getElementById("adv-filter-bar")?.contains(e.target)) return;
    const group = e.target.dataset.group;
    setMultiSelectLabel(group);
    if (group === "l3s") populateL4Filter(getMultiSelectValues("l3s"));
    applyAndRender();
  };
  document.addEventListener("change", _docChangeHandler);

  // Filter bar click: open/close dropdowns + All/Clear buttons
  document.getElementById("adv-filter-bar")?.addEventListener("click", e => {
    const msBtn = e.target.closest(".ms-btn");
    if (msBtn) {
      e.stopPropagation();
      const id = msBtn.id.replace("ms-btn-", "");
      document.querySelectorAll(".ms-drop.open").forEach(d => { if (d.id !== `ms-drop-${id}`) d.classList.remove("open"); });
      document.getElementById(`ms-drop-${id}`)?.classList.toggle("open");
      return;
    }
    if (e.target.closest(".ms-drop")) e.stopPropagation();

    const allBtn = e.target.closest(".ms-all-btn");
    if (allBtn) {
      const group = allBtn.dataset.group;
      document.querySelectorAll(`#ms-opts-${group} .ms-cb`).forEach(cb => cb.checked = true);
      setMultiSelectLabel(group);
      if (group === "l3s") populateL4Filter(getMultiSelectValues("l3s"));
      applyAndRender();
    }

    const clearBtn = e.target.closest(".ms-clear-btn");
    if (clearBtn) {
      const group = clearBtn.dataset.group;
      document.querySelectorAll(`#ms-opts-${group} .ms-cb`).forEach(cb => cb.checked = false);
      setMultiSelectLabel(group);
      if (group === "l3s") {
        document.querySelectorAll("#ms-opts-l4s .ms-cb").forEach(cb => cb.checked = false);
        setMultiSelectLabel("l4s");
        populateL4Filter([]);
      }
      applyAndRender();
    }
  });

  // Close all dropdowns when clicking outside
  _docClickHandler = () => document.querySelectorAll(".ms-drop.open").forEach(d => d.classList.remove("open"));
  document.addEventListener("click", _docClickHandler);
}

function clearFilters() {
  currentFilters = { search: "", partners: [], statuses: [], l3s: [], l4s: [], agings: [], reopenOnly: false };
  const searchEl = document.getElementById("adv-search");
  if (searchEl) searchEl.value = "";
  Object.keys(MS_LABELS).forEach(group => {
    document.querySelectorAll(`#ms-opts-${group} .ms-cb`).forEach(cb => cb.checked = false);
    setMultiSelectLabel(group);
  });
  const reopenEl = document.getElementById("adv-fl-reopen");
  if (reopenEl) reopenEl.checked = false;
  applyAndRender();
}

function applyAndRender() {
  currentFilters.partners = getMultiSelectValues("partners");
  currentFilters.statuses = getMultiSelectValues("statuses");
  currentFilters.l3s      = getMultiSelectValues("l3s");
  currentFilters.l4s      = getMultiSelectValues("l4s");
  currentFilters.agings   = getMultiSelectValues("agings");
  filtered = filterTickets(allTickets, currentFilters);
  filtered.sort((a, b) => (b.agingHours || 0) - (a.agingHours || 0));
  currentPage = 1;
  renderTable();
}

// ─── Table ────────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody   = document.getElementById("adv-tbody");
  const pagInfo = document.getElementById("adv-pag-info");
  const pagBtns = document.getElementById("adv-pag-btns");
  if (!tbody) return;

  const total      = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start      = (currentPage - 1) * PAGE_SIZE;
  const page       = filtered.slice(start, start + PAGE_SIZE);

  if (pagInfo) pagInfo.textContent = total
    ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`
    : "No tickets";

  if (!page.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="13">No tickets found.</td></tr>`;
    if (pagBtns) pagBtns.innerHTML = "";
    return;
  }

  tbody.innerHTML = page.map(t => `
    <tr data-id="${t.ticketNo}">
      <td>${kaptureLink(t.ticketNo)}</td>
      <td class="td-wrap" title="${t.customerName || ""}">${t.customerName || "—"}</td>
      <td class="td-phone">${t.phone || "—"}</td>
      <td class="td-wrap" title="${[t.dispL3, t.dispL4].filter(Boolean).join(" > ")}">${t.dispL3 || "—"}${t.dispL4 ? ` <span style="color:var(--text-muted)">›</span> ${t.dispL4}` : ""}</td>
      <td class="td-wrap">${t.mappedPartner || "—"}</td>
      <td>${agingBadge(t.agingBucket, t.agingHours)}</td>
      <td><span style="font-size:12px">${t.kaptureStatus || "—"}</span></td>
      <td>${statusBadge(t.platformStatus)}</td>
      <td style="font-size:11px;color:var(--text-muted)">${formatDateShort(t.firstSeenDate)}</td>
      <td style="font-size:11px;color:var(--text-muted)">${t.assignedDate ? formatDate(t.assignedDate) : "—"}</td>
      <td>${t.reopenTag ? '<span class="badge badge-escalated">⚠ Reopen</span>' : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="td-wrap" style="font-size:12px" title="${t.advisorRemarks || ""}">${t.advisorRemarks || '<span class="text-muted">—</span>'}</td>
      <td class="td-actions">
        <button class="btn btn-xs btn-primary view-btn" data-id="${t.ticketNo}">Update</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ticket = allTickets.find(t => t.ticketNo === btn.dataset.id);
      if (ticket) showTicketDetail(ticket, currentActor, () => { populateTicketFilters(); applyAndRender(); });
    });
  });

  renderPagination(pagBtns, currentPage, totalPages, p => { currentPage = p; renderTable(); });
}
