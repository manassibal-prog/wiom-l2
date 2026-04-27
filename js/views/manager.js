import { CONFIG } from '../config.js';
import { subscribeToTickets, subscribeToUsers, assignTicket } from '../db.js';
import {
  showToast, statusBadge, agingBadge, formatDate, kaptureLink,
  filterTickets, renderPagination, showTicketDetail,
  showModal, closeModal, presenceDot
} from '../ui.js';

let allTickets = [];
let allUsers = [];
let filtered = [];
let currentPage = 1;
const PAGE_SIZE = CONFIG.PAGE_SIZE;
let unsubTickets, unsubUsers;
let currentActor;
let currentFilters = { search: "", zone: "all", status: "all", advisor: "all", category: "all", aging: "all" };

export function mountManagerDashboard(actor, container) {
  currentActor = actor;
  container.innerHTML = buildShell();
  bindFilters();

  unsubTickets = subscribeToTickets(tickets => {
    allTickets = tickets;
    applyAndRender();
  });
  unsubUsers = subscribeToUsers(users => {
    allUsers = users;
    populateAdvisorFilter();
    renderAdvisorPanel();
  });
}

export function unmountManagerDashboard() {
  if (unsubTickets) unsubTickets();
  if (unsubUsers) unsubUsers();
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function buildShell() {
  return `
    <div class="stats-grid" id="mgr-stats"></div>
    <div class="card mb-5">
      <div class="filter-bar">
        <input class="filter-input" id="mgr-search" type="text" placeholder="Search ticket #, customer, phone…">
        <select class="filter-select" id="mgr-fl-zone"><option value="all">All Zones</option></select>
        <select class="filter-select" id="mgr-fl-status">
          <option value="all">All Statuses</option>
          ${CONFIG.ALL_STATUSES.map(s => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <select class="filter-select" id="mgr-fl-advisor"><option value="all">All Advisors</option></select>
        <select class="filter-select" id="mgr-fl-category">
          <option value="all">All Categories</option>
          ${CONFIG.CATEGORY_GROUPS.map(c => `<option value="${c}">${c}</option>`).join("")}
        </select>
        <select class="filter-select" id="mgr-fl-aging">
          <option value="all">All Aging</option>
          ${CONFIG.AGING_BUCKETS.map(b => `<option value="${b}">${b}</option>`).join("")}
        </select>
        <div class="filter-actions">
          <button class="btn btn-secondary btn-sm" id="mgr-fl-clear">Clear</button>
        </div>
      </div>
      <div class="table-container" style="border-radius:0;border-left:none;border-right:none;border-bottom:none;box-shadow:none">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Customer</th>
              <th>Phone</th>
              <th>L3</th>
              <th>Zone</th>
              <th>Partner</th>
              <th>Queue</th>
              <th>Aging</th>
              <th>Platform Status</th>
              <th>Assigned To</th>
              <th>Last Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="mgr-tbody"></tbody>
        </table>
      </div>
      <div class="pagination">
        <span class="pagination-info" id="mgr-pag-info"></span>
        <div class="page-btns" id="mgr-pag-btns"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Advisor Performance</h3></div>
      <div class="card-body">
        <div class="advisor-grid" id="mgr-advisor-grid"></div>
      </div>
    </div>
  `;
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function bindFilters() {
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  document.getElementById("mgr-search")?.addEventListener("input", debounce(e => { currentFilters.search = e.target.value; applyAndRender(); }, 250));
  document.getElementById("mgr-fl-zone")?.addEventListener("change", e => { currentFilters.zone = e.target.value; applyAndRender(); });
  document.getElementById("mgr-fl-status")?.addEventListener("change", e => { currentFilters.status = e.target.value; applyAndRender(); });
  document.getElementById("mgr-fl-advisor")?.addEventListener("change", e => { currentFilters.advisor = e.target.value; applyAndRender(); });
  document.getElementById("mgr-fl-category")?.addEventListener("change", e => { currentFilters.category = e.target.value; applyAndRender(); });
  document.getElementById("mgr-fl-aging")?.addEventListener("change", e => { currentFilters.aging = e.target.value; applyAndRender(); });
  document.getElementById("mgr-fl-clear")?.addEventListener("click", () => {
    currentFilters = { search: "", zone: "all", status: "all", advisor: "all", category: "all", aging: "all" };
    ["mgr-search","mgr-fl-zone","mgr-fl-status","mgr-fl-advisor","mgr-fl-category","mgr-fl-aging"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = el.tagName === "INPUT" ? "" : "all";
    });
    applyAndRender();
  });
}

function populateAdvisorFilter() {
  const sel = document.getElementById("mgr-fl-advisor");
  if (!sel) return;
  const cur = sel.value;
  const advisors = allUsers.filter(u => u.role === "Advisor" && u.active);
  sel.innerHTML = `<option value="all">All Advisors</option>` +
    advisors.map(a => `<option value="${a.email}" ${cur === a.email ? "selected" : ""}>${a.name}</option>`).join("");

  const zones = [...new Set(allTickets.map(t => t.zone).filter(Boolean))].sort();
  const zSel = document.getElementById("mgr-fl-zone");
  if (zSel) {
    const zCur = zSel.value;
    zSel.innerHTML = `<option value="all">All Zones</option>` +
      zones.map(z => `<option value="${z}" ${zCur === z ? "selected" : ""}>${z}</option>`).join("");
  }
}

function applyAndRender() {
  filtered = filterTickets(allTickets, currentFilters);
  filtered.sort((a, b) => (b.agingHours || 0) - (a.agingHours || 0));
  currentPage = 1;
  renderStats();
  renderTable();
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function renderStats() {
  const el = document.getElementById("mgr-stats");
  if (!el) return;
  const unassigned = allTickets.filter(t => t.platformStatus === "New/Unassigned").length;
  const open = allTickets.filter(t => CONFIG.STATUSES.OPEN.includes(t.platformStatus)).length;
  const escalated = allTickets.filter(t => t.platformStatus === "Escalated").length;
  const critical = allTickets.filter(t => t.agingBucket === ">120 hrs").length;
  const online = allUsers.filter(u => u.currentStatus === "Logged In" && u.role === "Advisor").length;
  const advisorCount = allUsers.filter(u => u.role === "Advisor" && u.active).length;

  el.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Active</div><div class="stat-value">${allTickets.length}</div></div>
    <div class="stat-card danger"><div class="stat-label">Unassigned</div><div class="stat-value">${unassigned}</div></div>
    <div class="stat-card accent"><div class="stat-label">Open</div><div class="stat-value">${open}</div></div>
    <div class="stat-card warning"><div class="stat-label">Escalated</div><div class="stat-value">${escalated}</div></div>
    <div class="stat-card danger"><div class="stat-label">>120h Aging</div><div class="stat-value">${critical}</div></div>
    <div class="stat-card success"><div class="stat-label">Advisors Online</div><div class="stat-value">${online} / ${advisorCount}</div></div>
  `;
}

// ─── Table ────────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById("mgr-tbody");
  const pagInfo = document.getElementById("mgr-pag-info");
  const pagBtns = document.getElementById("mgr-pag-btns");
  if (!tbody) return;

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);

  if (pagInfo) pagInfo.textContent = total
    ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`
    : "No tickets";

  if (!page.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12">No tickets found.</td></tr>`;
    if (pagBtns) pagBtns.innerHTML = "";
    return;
  }

  tbody.innerHTML = page.map(t => `
    <tr data-id="${t.ticketNo}">
      <td>${kaptureLink(t.ticketNo)}</td>
      <td class="td-wrap" title="${t.customerName || ""}">${t.customerName || "—"}</td>
      <td class="td-phone">${t.phone || "—"}</td>
      <td class="td-wrap" title="${t.dispL3 || ""}">${t.dispL3 || "—"}</td>
      <td>${t.zone || "—"}</td>
      <td class="td-wrap">${t.mappedPartner || "—"}</td>
      <td>${t.currentQueue || "—"}</td>
      <td>${agingBadge(t.agingBucket, t.agingHours)}</td>
      <td>${statusBadge(t.platformStatus)}</td>
      <td class="td-wrap">${t.assignedToName || '<span class="text-muted">Unassigned</span>'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${formatDate(t.lastUpdateDate)}</td>
      <td class="td-actions">
        <button class="btn btn-xs btn-secondary view-btn" data-id="${t.ticketNo}">View</button>
        <button class="btn btn-xs btn-primary mgr-assign-btn" data-id="${t.ticketNo}">Assign</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ticket = allTickets.find(t => t.ticketNo === btn.dataset.id);
      if (ticket) showTicketDetail(ticket, currentActor, () => {});
    });
  });

  tbody.querySelectorAll(".mgr-assign-btn").forEach(btn => {
    btn.addEventListener("click", () => openAssignModal(btn.dataset.id));
  });

  renderPagination(pagBtns, currentPage, totalPages, p => { currentPage = p; renderTable(); });
}

// ─── Assign ───────────────────────────────────────────────────────────────────

function openAssignModal(ticketNo) {
  const advisors = allUsers.filter(u => u.role === "Advisor" && u.active)
    .sort((a, b) => {
      const ha = allTickets.filter(t => t.assignedTo === a.email).length;
      const hb = allTickets.filter(t => t.assignedTo === b.email).length;
      return ha - hb;
    });

  showModal(
    `Assign Ticket ${ticketNo}`,
    `<div class="form-group">
      <label>Assign To</label>
      <select class="form-control" id="mgr-advisor-sel">
        <option value="">— Select Advisor —</option>
        ${advisors.map(a => {
          const h = allTickets.filter(t => t.assignedTo === a.email).length;
          return `<option value="${a.email}" data-name="${a.name}">${a.name} (${h} holding)</option>`;
        }).join("")}
      </select>
    </div>`,
    `<button class="btn btn-secondary" id="mgr-assign-cancel">Cancel</button>
     <button class="btn btn-primary" id="mgr-assign-ok">Assign</button>`
  );

  document.getElementById("mgr-assign-cancel").onclick = closeModal;
  document.getElementById("mgr-assign-ok").onclick = async () => {
    const sel = document.getElementById("mgr-advisor-sel");
    if (!sel?.value) { showToast("Select an advisor", "warning"); return; }
    const opt = sel.options[sel.selectedIndex];
    const btn = document.getElementById("mgr-assign-ok");
    btn.disabled = true; btn.textContent = "Assigning…";
    try {
      await assignTicket(ticketNo, sel.value, opt.dataset.name, currentActor);
      showToast("Ticket assigned", "success");
      closeModal();
    } catch (e) {
      showToast("Error: " + e.message, "error");
      btn.disabled = false; btn.textContent = "Assign";
    }
  };
}

// ─── Advisor Panel ────────────────────────────────────────────────────────────

function renderAdvisorPanel() {
  const grid = document.getElementById("mgr-advisor-grid");
  if (!grid) return;
  const advisors = allUsers.filter(u => u.role === "Advisor" && u.active);
  if (!advisors.length) { grid.innerHTML = `<p class="text-muted">No advisors found.</p>`; return; }

  grid.innerHTML = advisors.map(a => {
    const holding = allTickets.filter(t => t.assignedTo === a.email).length;
    const critical = allTickets.filter(t => t.assignedTo === a.email && t.agingBucket === ">120 hrs").length;
    const statusDot = presenceDot(a.currentStatus);
    return `
      <div class="advisor-card">
        <div class="advisor-card-name">${statusDot}${a.name}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${a.currentStatus || "Logged Out"}</div>
        <div class="advisor-card-stats">
          <div class="advisor-stat"><div class="as-val">${holding}</div><div class="as-label">Holding</div></div>
          <div class="advisor-stat"><div class="as-val" style="color:var(--danger)">${critical}</div><div class="as-label">>120h</div></div>
          <div class="advisor-stat"><div class="as-val">${a.todayResolvedCount || 0}</div><div class="as-label">Resolved</div></div>
          <div class="advisor-stat"><div class="as-val">${a.todayLoginMinutes || 0}m</div><div class="as-label">Login Time</div></div>
        </div>
      </div>`;
  }).join("");
}
