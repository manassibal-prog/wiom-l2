import { CONFIG } from '../config.js';
import {
  subscribeToTickets, subscribeToUsers,
  assignTicket, bulkAssignTickets, getRoster
} from '../db.js';
import {
  showToast, showLoading, hideLoading, showModal, closeModal,
  showConfirm, statusBadge, agingBadge, formatDate, kaptureLink,
  filterTickets, renderPagination, showTicketDetail
} from '../ui.js';

let allTickets = [];
let allUsers = [];
let filtered = [];
let currentPage = 1;
const PAGE_SIZE = CONFIG.PAGE_SIZE;
let selectedTicketNos = new Set();
let sortCol = "agingHours";
let sortAsc = false;
let unsubTickets, unsubUsers;
let currentActor;
let currentFilters = {
  search: "", zone: "all", status: "all",
  advisor: "all", category: "all", aging: "all", reopenOnly: false
};

export function mountTLDashboard(actor, container) {
  currentActor = actor;
  container.innerHTML = buildShell();
  bindFilterEvents();
  bindBulkBar();
  unsubTickets = subscribeToTickets(tickets => {
    allTickets = tickets;
    applyFiltersAndRender();
  });
  unsubUsers = subscribeToUsers(users => {
    allUsers = users;
    populateAdvisorFilter();
    renderAdvisorStats();
  });
}

export function unmountTLDashboard() {
  if (unsubTickets) unsubTickets();
  if (unsubUsers) unsubUsers();
}

// ─── Shell HTML ──────────────────────────────────────────────────────────────

function buildShell() {
  return `
    <div class="stats-grid" id="tl-stats"></div>
    <div class="card mb-5">
      <div class="filter-bar" id="tl-filter-bar">
        <input class="filter-input" id="fl-search" type="text" placeholder="Search ticket #, customer, phone…">
        <select class="filter-select" id="fl-zone"><option value="all">All Zones</option></select>
        <select class="filter-select" id="fl-status">
          <option value="all">All Statuses</option>
          ${CONFIG.ALL_STATUSES.map(s => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <select class="filter-select" id="fl-advisor"><option value="all">All Advisors</option></select>
        <select class="filter-select" id="fl-category">
          <option value="all">All Categories</option>
          ${CONFIG.CATEGORY_GROUPS.map(c => `<option value="${c}">${c}</option>`).join("")}
        </select>
        <select class="filter-select" id="fl-aging">
          <option value="all">All Aging</option>
          ${CONFIG.AGING_BUCKETS.map(b => `<option value="${b}">${b}</option>`).join("")}
        </select>
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
          <input type="checkbox" id="fl-reopen"> Reopens only
        </label>
        <div class="filter-actions">
          <button class="btn btn-secondary btn-sm" id="fl-clear">Clear</button>
          <button class="btn btn-primary btn-sm" id="auto-assign-btn">⚡ Auto-Assign</button>
        </div>
      </div>
      <div class="bulk-bar" id="bulk-bar">
        <span class="bulk-count" id="bulk-count">0 selected</span>
        <button class="btn btn-primary btn-sm" id="bulk-assign-btn">Assign Selected</button>
        <button class="btn btn-secondary btn-sm" id="bulk-clear-btn">Clear Selection</button>
      </div>
      <div class="table-container" style="border-radius:0;border-left:none;border-right:none;border-bottom:none;box-shadow:none">
        <table class="data-table" id="tl-table">
          <thead>
            <tr>
              <th class="checkbox-col"><input type="checkbox" id="select-all"></th>
              <th>Ticket #</th>
              <th>Customer</th>
              <th>Phone</th>
              <th>L3</th>
              <th>Zone</th>
              <th>Partner</th>
              <th>Queue</th>
              <th class="sortable" data-col="agingHours">Aging ↕</th>
              <th>Platform Status</th>
              <th>Assigned To</th>
              <th>Last Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="tl-tbody"></tbody>
        </table>
      </div>
      <div class="pagination">
        <span class="pagination-info" id="tl-pag-info"></span>
        <div class="page-btns" id="tl-pag-btns"></div>
      </div>
    </div>
    <div class="card" id="advisor-stats-card" style="display:none">
      <div class="card-header"><h3>Advisor Overview</h3></div>
      <div class="card-body"><div class="advisor-grid" id="advisor-stats-grid"></div></div>
    </div>
  `;
}

// ─── Filter & Sort ────────────────────────────────────────────────────────────

function bindFilterEvents() {
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  document.getElementById("fl-search").addEventListener("input", debounce(e => { currentFilters.search = e.target.value; applyFiltersAndRender(); }, 250));
  document.getElementById("fl-zone").addEventListener("change", e => { currentFilters.zone = e.target.value; applyFiltersAndRender(); });
  document.getElementById("fl-status").addEventListener("change", e => { currentFilters.status = e.target.value; applyFiltersAndRender(); });
  document.getElementById("fl-advisor").addEventListener("change", e => { currentFilters.advisor = e.target.value; applyFiltersAndRender(); });
  document.getElementById("fl-category").addEventListener("change", e => { currentFilters.category = e.target.value; applyFiltersAndRender(); });
  document.getElementById("fl-aging").addEventListener("change", e => { currentFilters.aging = e.target.value; applyFiltersAndRender(); });
  document.getElementById("fl-reopen").addEventListener("change", e => { currentFilters.reopenOnly = e.target.checked; applyFiltersAndRender(); });
  document.getElementById("fl-clear").addEventListener("click", clearFilters);
  document.getElementById("auto-assign-btn").addEventListener("click", openAutoAssignModal);

  document.getElementById("select-all").addEventListener("change", e => {
    const ids = getPageTicketNos();
    if (e.target.checked) ids.forEach(id => selectedTicketNos.add(id));
    else ids.forEach(id => selectedTicketNos.delete(id));
    updateBulkBar();
    document.querySelectorAll(".row-cb").forEach(cb => {
      if (ids.includes(cb.dataset.id)) cb.checked = e.target.checked;
    });
  });

  document.querySelectorAll(".data-table th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = false; }
      applyFiltersAndRender();
    });
  });
}

function clearFilters() {
  currentFilters = { search: "", zone: "all", status: "all", advisor: "all", category: "all", aging: "all", reopenOnly: false };
  document.getElementById("fl-search").value = "";
  ["fl-zone","fl-status","fl-advisor","fl-category","fl-aging"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "all";
  });
  document.getElementById("fl-reopen").checked = false;
  applyFiltersAndRender();
}

function populateAdvisorFilter() {
  const select = document.getElementById("fl-advisor");
  if (!select) return;
  const current = select.value;
  const advisors = allUsers.filter(u => u.role === "Advisor" && u.active);
  select.innerHTML = `<option value="all">All Advisors</option>` +
    advisors.map(a => `<option value="${a.email}" ${current === a.email ? "selected" : ""}>${a.name}</option>`).join("");

  const zones = [...new Set(allTickets.map(t => t.zone).filter(Boolean))].sort();
  const zoneSelect = document.getElementById("fl-zone");
  if (zoneSelect) {
    const cur = zoneSelect.value;
    zoneSelect.innerHTML = `<option value="all">All Zones</option>` +
      zones.map(z => `<option value="${z}" ${cur === z ? "selected" : ""}>${z}</option>`).join("");
  }
}

function applyFiltersAndRender() {
  filtered = filterTickets(allTickets, currentFilters);
  filtered.sort((a, b) => {
    const va = a[sortCol] ?? 0, vb = b[sortCol] ?? 0;
    return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });
  currentPage = 1;
  renderStats();
  renderTable();
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function renderStats() {
  const el = document.getElementById("tl-stats");
  if (!el) return;
  const open = allTickets.filter(t => CONFIG.STATUSES.OPEN.includes(t.platformStatus));
  const unassigned = allTickets.filter(t => t.platformStatus === "New/Unassigned");
  const escalated = allTickets.filter(t => t.platformStatus === "Escalated");
  const critical = allTickets.filter(t => t.agingBucket === ">120 hrs");
  const online = allUsers.filter(u => u.currentStatus === "Logged In");

  el.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Active</div><div class="stat-value">${allTickets.length}</div></div>
    <div class="stat-card danger"><div class="stat-label">Unassigned</div><div class="stat-value">${unassigned.length}</div></div>
    <div class="stat-card accent"><div class="stat-label">In Open State</div><div class="stat-value">${open.length}</div></div>
    <div class="stat-card warning"><div class="stat-label">Escalated</div><div class="stat-value">${escalated.length}</div></div>
    <div class="stat-card danger"><div class="stat-label">>120h Aging</div><div class="stat-value">${critical.length}</div></div>
    <div class="stat-card success"><div class="stat-label">Advisors Online</div><div class="stat-value">${online.length}</div></div>
    <div class="stat-card"><div class="stat-label">Filtered</div><div class="stat-value">${filtered.length}</div></div>
  `;
}

function renderAdvisorStats() {
  const advisors = allUsers.filter(u => u.role === "Advisor" && u.active);
  if (!advisors.length) return;
  const card = document.getElementById("advisor-stats-card");
  const grid = document.getElementById("advisor-stats-grid");
  if (!card || !grid) return;
  card.style.display = "";
  grid.innerHTML = advisors.map(a => {
    const holding = allTickets.filter(t => t.assignedTo === a.email).length;
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
          <div class="advisor-stat"><div class="as-val">${a.currentStatus === "Logged In" ? "🟢" : a.currentStatus === "On Break" ? "🟡" : "⚫"}</div><div class="as-label">Status</div></div>
        </div>
      </div>`;
  }).join("");
}

// ─── Table ────────────────────────────────────────────────────────────────────

function getPageTicketNos() {
  const start = (currentPage - 1) * PAGE_SIZE;
  return filtered.slice(start, start + PAGE_SIZE).map(t => t.ticketNo);
}

function renderTable() {
  const tbody = document.getElementById("tl-tbody");
  const pagInfo = document.getElementById("tl-pag-info");
  const pagBtns = document.getElementById("tl-pag-btns");
  if (!tbody) return;

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);

  if (pagInfo) pagInfo.textContent = total
    ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`
    : "No tickets";

  if (!page.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="13">No tickets match the current filters.</td></tr>`;
    if (pagBtns) pagBtns.innerHTML = "";
    return;
  }

  tbody.innerHTML = page.map(t => {
    const isSel = selectedTicketNos.has(t.ticketNo);
    return `
    <tr class="${isSel ? "selected" : ""}" data-id="${t.ticketNo}">
      <td class="checkbox-col"><input type="checkbox" class="row-cb" data-id="${t.ticketNo}" ${isSel ? "checked" : ""}></td>
      <td>${kaptureLink(t.ticketNo)}</td>
      <td class="td-wrap" title="${t.customerName || ""}">${t.customerName || "—"}</td>
      <td class="td-phone">${t.phone || "—"}</td>
      <td class="td-wrap" title="${t.dispL3 || ""}">${t.dispL3 || "—"}</td>
      <td>${t.zone || "—"}</td>
      <td class="td-wrap" title="${t.mappedPartner || ""}">${t.mappedPartner || "—"}</td>
      <td>${t.currentQueue || "—"}</td>
      <td>${agingBadge(t.agingBucket, t.agingHours)}</td>
      <td>${statusBadge(t.platformStatus)}</td>
      <td class="td-wrap">${t.assignedToName || '<span class="text-muted">Unassigned</span>'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${formatDate(t.lastUpdateDate)}</td>
      <td class="td-actions">
        <button class="btn btn-xs btn-secondary view-btn" data-id="${t.ticketNo}">View</button>
        <button class="btn btn-xs btn-primary assign-btn" data-id="${t.ticketNo}">Assign</button>
      </td>
    </tr>`;
  }).join("");

  // Row events
  tbody.querySelectorAll(".row-cb").forEach(cb => {
    cb.addEventListener("change", e => {
      const id = e.target.dataset.id;
      if (e.target.checked) selectedTicketNos.add(id);
      else selectedTicketNos.delete(id);
      const row = tbody.querySelector(`tr[data-id="${id}"]`);
      if (row) row.classList.toggle("selected", e.target.checked);
      updateBulkBar();
    });
  });

  tbody.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ticket = allTickets.find(t => t.ticketNo === btn.dataset.id);
      if (ticket) showTicketDetail(ticket, currentActor, () => {});
    });
  });

  tbody.querySelectorAll(".assign-btn").forEach(btn => {
    btn.addEventListener("click", () => openAssignModal([btn.dataset.id]));
  });

  renderPagination(pagBtns, currentPage, totalPages, p => {
    currentPage = p;
    renderTable();
  });

  const selectAll = document.getElementById("select-all");
  if (selectAll) {
    const pageIds = getPageTicketNos();
    selectAll.checked = pageIds.length > 0 && pageIds.every(id => selectedTicketNos.has(id));
    selectAll.indeterminate = pageIds.some(id => selectedTicketNos.has(id)) && !selectAll.checked;
  }
}

// ─── Bulk Bar ─────────────────────────────────────────────────────────────────

function updateBulkBar() {
  const bar = document.getElementById("bulk-bar");
  const count = document.getElementById("bulk-count");
  if (!bar) return;
  if (selectedTicketNos.size > 0) {
    bar.classList.add("visible");
    if (count) count.textContent = `${selectedTicketNos.size} selected`;
  } else {
    bar.classList.remove("visible");
  }
}

function bindBulkBar() {
  setTimeout(() => {
    const assignBtn = document.getElementById("bulk-assign-btn");
    const clearBtn = document.getElementById("bulk-clear-btn");
    if (assignBtn) assignBtn.addEventListener("click", () => openAssignModal([...selectedTicketNos]));
    if (clearBtn) clearBtn.addEventListener("click", () => {
      selectedTicketNos.clear();
      updateBulkBar();
      renderTable();
    });
  }, 100);
}

// ─── Assign Modal ─────────────────────────────────────────────────────────────

function openAssignModal(ticketNos) {
  if (!ticketNos.length) { showToast("No tickets selected", "warning"); return; }

  const advisors = allUsers
    .filter(u => u.role === "Advisor" && u.active)
    .sort((a, b) => {
      const ha = allTickets.filter(t => t.assignedTo === a.email).length;
      const hb = allTickets.filter(t => t.assignedTo === b.email).length;
      return ha - hb;
    });

  const isBulk = ticketNos.length > 1;
  const body = `
    <p class="text-muted text-sm mb-4">${isBulk ? `Assigning <strong>${ticketNos.length}</strong> tickets.` : `Assigning ticket <strong>${ticketNos[0]}</strong>.`}</p>
    ${isBulk ? `
      <div class="form-group">
        <label>Distribute across</label>
        <div id="advisor-multiselect" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
          ${advisors.map(a => {
            const h = allTickets.filter(t => t.assignedTo === a.email).length;
            return `<label style="display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer">
              <input type="checkbox" class="adv-cb" value="${a.email}" data-name="${a.name}">
              ${a.name} <span class="badge badge-new" style="font-size:10px">${h} holding</span>
            </label>`;
          }).join("")}
        </div>
      </div>` : `
      <div class="form-group">
        <label>Assign To</label>
        <select class="form-control" id="single-advisor-select">
          <option value="">— Select Advisor —</option>
          ${advisors.map(a => {
            const h = allTickets.filter(t => t.assignedTo === a.email).length;
            return `<option value="${a.email}" data-name="${a.name}">${a.name} (${h} holding)</option>`;
          }).join("")}
        </select>
      </div>`}
  `;

  showModal(
    isBulk ? "Bulk Assign" : "Assign Ticket",
    body,
    `<button class="btn btn-secondary" id="assign-cancel">Cancel</button>
     <button class="btn btn-primary" id="assign-confirm">Assign</button>`
  );

  document.getElementById("assign-cancel").onclick = closeModal;
  document.getElementById("assign-confirm").onclick = async () => {
    try {
      const confirmBtn = document.getElementById("assign-confirm");
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Assigning…";

      if (isBulk) {
        const selected = [...document.querySelectorAll(".adv-cb:checked")];
        if (!selected.length) { showToast("Select at least one advisor", "warning"); confirmBtn.disabled = false; confirmBtn.textContent = "Assign"; return; }

        // Round-robin
        const assignments = ticketNos.map((tn, i) => {
          const adv = selected[i % selected.length];
          return { ticketNo: tn, advisorEmail: adv.value, advisorName: adv.dataset.name };
        });
        await bulkAssignTickets(assignments, currentActor);
        showToast(`${ticketNos.length} tickets assigned`, "success");
        selectedTicketNos.clear();
        updateBulkBar();
      } else {
        const sel = document.getElementById("single-advisor-select");
        if (!sel?.value) { showToast("Select an advisor", "warning"); confirmBtn.disabled = false; confirmBtn.textContent = "Assign"; return; }
        const opt = sel.options[sel.selectedIndex];
        await assignTicket(ticketNos[0], sel.value, opt.dataset.name, currentActor);
        showToast("Ticket assigned", "success");
      }
      closeModal();
    } catch (e) {
      showToast("Error: " + e.message, "error");
      const btn = document.getElementById("assign-confirm");
      if (btn) { btn.disabled = false; btn.textContent = "Assign"; }
    }
  };
}

// ─── Auto-Assign Modal ────────────────────────────────────────────────────────

async function openAutoAssignModal() {
  const unassigned = allTickets.filter(t => t.platformStatus === "New/Unassigned");
  if (!unassigned.length) { showToast("No unassigned tickets to assign", "info"); return; }

  showLoading("Checking today's roster…");
  let roster;
  try {
    const today = new Date().toISOString().slice(0, 10);
    roster = await getRoster(today);
  } finally {
    hideLoading();
  }

  const rosterEntries = roster?.advisors || {};

  // Only advisors marked P or WFH today, sorted by least tickets held
  const available = allUsers
    .filter(u => u.role === "Advisor" && u.active && CONFIG.AVAILABLE_CODES.includes(rosterEntries[u.email]))
    .sort((a, b) => {
      const ha = allTickets.filter(t => t.assignedTo === a.email).length;
      const hb = allTickets.filter(t => t.assignedTo === b.email).length;
      return ha - hb;
    });

  if (!available.length) {
    showModal(
      "Auto-Assign",
      `<p style="font-size:14px">No advisors are marked <strong>P</strong> or <strong>WFH</strong> in today's roster.<br><br>
       Please update the Roster first, then try again.</p>`,
      `<button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">OK</button>`
    );
    return;
  }

  const perAdvisor = Math.ceil(unassigned.length / available.length);
  const body = `
    <p style="font-size:14px;margin-bottom:14px">
      <strong>${unassigned.length}</strong> unassigned tickets will be distributed across
      <strong>${available.length}</strong> available advisors (~${perAdvisor} each), least-loaded first.
    </p>
    <div style="font-size:13px;border:1px solid var(--border);border-radius:8px;overflow:hidden">
      ${available.map((a, i) => {
        const h = allTickets.filter(t => t.assignedTo === a.email).length;
        const roster = rosterEntries[a.email];
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;${i % 2 === 0 ? "" : "background:var(--bg-elevated)"}">
          <span>${a.name}</span>
          <span style="display:flex;gap:8px;align-items:center">
            <span class="badge badge-assigned">${roster}</span>
            <span style="color:var(--text-muted);font-size:12px">${h} holding</span>
          </span>
        </div>`;
      }).join("")}
    </div>
  `;

  showModal(
    "⚡ Auto-Assign Unassigned Tickets",
    body,
    `<button class="btn btn-secondary" id="aa-cancel">Cancel</button>
     <button class="btn btn-primary" id="aa-confirm">Confirm & Assign</button>`,
    true
  );

  document.getElementById("aa-cancel").onclick = closeModal;
  document.getElementById("aa-confirm").onclick = async () => {
    const btn = document.getElementById("aa-confirm");
    btn.disabled = true;
    btn.textContent = "Assigning…";
    try {
      // Round-robin across sorted advisors
      const assignments = unassigned.map((t, i) => {
        const adv = available[i % available.length];
        return { ticketNo: t.ticketNo, advisorEmail: adv.email, advisorName: adv.name };
      });
      showLoading(`Assigning ${unassigned.length} tickets…`);
      await bulkAssignTickets(assignments, currentActor);
      hideLoading();
      showToast(`${unassigned.length} tickets assigned to ${available.length} advisors`, "success");
      closeModal();
    } catch (e) {
      hideLoading();
      showToast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Confirm & Assign"; }
    }
  };
}
