import { CONFIG } from '../config.js';
import {
  getTickets, subscribeToUsers,
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
let unsubUsers;
let currentActor;
let currentFilters = {
  search: "", zone: "all", status: "all",
  advisor: "all", l3: "all", l4: "all", aging: "all", reopenOnly: false
};

// ─── Scheduled Refresh ───────────────────────────────────────────────────────
// Refresh at: 9:55 AM, 12:00 PM, 3:00 PM, 6:00 PM
const REFRESH_TIMES = [
  { hh: 9,  mm: 55, label: "Before 10 AM" },
  { hh: 12, mm: 0,  label: "12 PM"        },
  { hh: 15, mm: 0,  label: "3 PM"         },
  { hh: 18, mm: 0,  label: "6 PM"         }
];
let schedulerInterval = null;
let firedToday = { date: "", keys: new Set() };

export function mountTLDashboard(actor, container) {
  currentActor = actor;
  currentFilters = { search: "", zone: "all", status: "all", advisor: "all", l3: "all", l4: "all", aging: "all", reopenOnly: false };
  selectedTicketNos = new Set();
  currentPage = 1;
  try {
    container.innerHTML = buildShell();
  } catch (e) {
    container.innerHTML = `<p style="padding:20px;color:var(--text-muted)">Error loading view: ${e.message}</p>`;
    return;
  }
  bindFilterEvents();
  bindBulkBar();
  fetchTickets();
  unsubUsers = subscribeToUsers(users => {
    allUsers = users;
    populateAdvisorFilter();
  });
  startScheduler();
}

export function unmountTLDashboard() {
  if (unsubUsers) unsubUsers();
  stopScheduler();
}

async function fetchTickets(isScheduled = false) {
  const btn = document.getElementById("tl-refresh-btn");
  const info = document.getElementById("tl-refresh-info");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Loading…"; }
  try {
    const tickets = await getTickets();
    allTickets = tickets.filter(t => t.dispL3 !== "Shifting Request");
    populateZoneFilter();
    applyFiltersAndRender();
    const now = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    if (info) info.textContent = `Last refreshed: ${now}`;
    if (isScheduled) showToast(`Auto-refreshed at ${now}`, "info", 3000);
  } catch (e) {
    showToast("Failed to load tickets: " + e.message, "error");
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
        fetchTickets(true);
        break;
      }
    }
  }, 30000); // check every 30 seconds
}

function stopScheduler() {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
}

// ─── Shell HTML ──────────────────────────────────────────────────────────────

function buildShell() {
  return `
    <div class="card mb-5">
      <div class="filter-bar" id="tl-filter-bar">
        <input class="filter-input" id="fl-search" type="text" placeholder="Search ticket #, customer, phone…">
        <select class="filter-select" id="fl-zone"><option value="all">All Zones</option></select>
        <select class="filter-select" id="fl-status">
          <option value="all">All Statuses</option>
          ${CONFIG.ALL_STATUSES.map(s => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <select class="filter-select" id="fl-advisor"><option value="all">All Advisors</option></select>
        <select class="filter-select" id="fl-l3">
          <option value="all">All Categories</option>
        </select>
        <select class="filter-select" id="fl-l4" disabled>
          <option value="all">All Sub-types</option>
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
          <button class="btn btn-secondary btn-sm" id="tl-refresh-btn">🔄 Refresh</button>
          <button class="btn btn-primary btn-sm" id="auto-assign-btn">⚡ Auto-Assign</button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);padding:4px 0" id="tl-refresh-info">Loading…</div>
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
              <th>Customer Name</th>
              <th>Phone</th>
              <th>Complaint Type</th>
              <th>Partner</th>
              <th>Queue</th>
              <th class="sortable" data-col="agingHours">Aging ↕</th>
              <th>Platform Status</th>
              <th>Assigned To</th>
              <th>Assigned On</th>
              <th>Reopen</th>
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
  `;
}

// ─── Filter & Sort ────────────────────────────────────────────────────────────

function bindFilterEvents() {
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  document.getElementById("fl-search").addEventListener("input", debounce(e => { currentFilters.search = e.target.value; applyFiltersAndRender(); }, 250));
  document.getElementById("fl-zone").addEventListener("change", e => { currentFilters.zone = e.target.value; applyFiltersAndRender(); });
  document.getElementById("fl-status").addEventListener("change", e => { currentFilters.status = e.target.value; applyFiltersAndRender(); });
  document.getElementById("fl-advisor").addEventListener("change", e => { currentFilters.advisor = e.target.value; applyFiltersAndRender(); });
  document.getElementById("fl-l3").addEventListener("change", e => {
    currentFilters.l3 = e.target.value;
    currentFilters.l4 = "all";
    populateL4Filter(e.target.value);
    applyFiltersAndRender();
  });
  document.getElementById("fl-l4").addEventListener("change", e => { currentFilters.l4 = e.target.value; applyFiltersAndRender(); });
  document.getElementById("fl-aging").addEventListener("change", e => { currentFilters.aging = e.target.value; applyFiltersAndRender(); });
  document.getElementById("fl-reopen").addEventListener("change", e => { currentFilters.reopenOnly = e.target.checked; applyFiltersAndRender(); });
  document.getElementById("fl-clear").addEventListener("click", clearFilters);
  document.getElementById("tl-refresh-btn").addEventListener("click", () => fetchTickets(false));
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
  currentFilters = { search: "", zone: "all", status: "all", advisor: "all", l3: "all", l4: "all", aging: "all", reopenOnly: false };
  document.getElementById("fl-search").value = "";
  ["fl-zone","fl-status","fl-advisor","fl-l3","fl-aging"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "all";
  });
  populateL4Filter("all");
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
}

function populateZoneFilter() {
  const zones = [...new Set(allTickets.map(t => t.zone).filter(Boolean))].sort();
  const zoneSelect = document.getElementById("fl-zone");
  if (zoneSelect) {
    const cur = zoneSelect.value;
    zoneSelect.innerHTML = `<option value="all">All Zones</option>` +
      zones.map(z => `<option value="${z}" ${cur === z ? "selected" : ""}>${z}</option>`).join("");
  }

  // Also repopulate L3 from live ticket data
  const l3Select = document.getElementById("fl-l3");
  if (l3Select) {
    const cur = l3Select.value;
    const l3Values = [...new Set(allTickets.map(t => t.dispL3).filter(Boolean))].sort();
    l3Select.innerHTML = `<option value="all">All Categories</option>` +
      l3Values.map(v => `<option value="${v}" ${cur === v ? "selected" : ""}>${v}</option>`).join("");
    // If the previously selected L3 is still valid, keep L4 in sync
    if (cur !== "all" && l3Values.includes(cur)) {
      populateL4Filter(cur);
    } else {
      populateL4Filter("all");
    }
  }
}

function populateL4Filter(selectedL3) {
  const l4Select = document.getElementById("fl-l4");
  if (!l4Select) return;
  if (selectedL3 === "all") {
    l4Select.innerHTML = `<option value="all">All Sub-types</option>`;
    l4Select.disabled = true;
  } else {
    const subs = [...new Set(
      allTickets.filter(t => t.dispL3 === selectedL3).map(t => t.dispL4).filter(Boolean)
    )].sort();
    l4Select.innerHTML = `<option value="all">All Sub-types</option>` +
      subs.map(s => `<option value="${s}">${s}</option>`).join("");
    l4Select.disabled = subs.length === 0;
    l4Select.value = currentFilters.l4 || "all";
  }
}

function applyFiltersAndRender() {
  filtered = filterTickets(allTickets, currentFilters);
  filtered.sort((a, b) => {
    const va = a[sortCol] ?? 0, vb = b[sortCol] ?? 0;
    return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });
  currentPage = 1;
  renderTable();
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
    tbody.innerHTML = `<tr class="empty-row"><td colspan="14">No tickets match the current filters.</td></tr>`;
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
      <td class="td-wrap" title="${[t.dispL3, t.dispL4].filter(Boolean).join(" > ")}">${t.dispL3 || "—"}${t.dispL4 ? ` <span style="color:var(--text-muted)">›</span> ${t.dispL4}` : ""}</td>
      <td class="td-wrap" title="${t.mappedPartner || ""}">${t.mappedPartner || "—"}</td>
      <td>${t.currentQueue || "—"}</td>
      <td>${agingBadge(t.agingBucket, t.agingHours)}</td>
      <td>${statusBadge(t.platformStatus)}</td>
      <td class="td-wrap">${t.assignedToName || '<span class="text-muted">Unassigned</span>'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${t.assignedDate ? formatDate(t.assignedDate) : "—"}</td>
      <td>${t.reopenTag ? '<span class="badge badge-escalated">⚠ Reopen</span>' : '<span style="color:var(--text-muted)">—</span>'}</td>
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

  // All available advisors today (P or WFH), sorted by least loaded
  const allAvailable = allUsers
    .filter(u => u.role === "Advisor" && u.active && CONFIG.AVAILABLE_CODES.includes(rosterEntries[u.email]))
    .sort((a, b) => {
      const ha = allTickets.filter(t => t.assignedTo === a.email).length;
      const hb = allTickets.filter(t => t.assignedTo === b.email).length;
      return ha - hb;
    });

  if (!allAvailable.length) {
    showModal("Auto-Assign",
      `<p style="font-size:14px">No advisors are marked <strong>P</strong> or <strong>WFH</strong> in today's roster.<br><br>Please update the Roster first, then try again.</p>`,
      `<button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">OK</button>`
    );
    return;
  }

  // ── Specialty routing ─────────────────────────────────────────────────────
  const KRITI   = "kriti.tiwari@wiom.in";
  const SHIVANI = "shivani.sharma@wiom.in";
  const POONAM  = "poonam.singh@wiom.in";

  const isAvail = email => allAvailable.some(a => a.email === email);
  const getAdv  = email => allAvailable.find(a => a.email === email);

  // Partner Misbehavior: Kriti primary, Shivani+Poonam fallback
  const pmPool = isAvail(KRITI)
    ? [getAdv(KRITI)].filter(Boolean)
    : allAvailable.filter(a => [SHIVANI, POONAM].includes(a.email));

  // Others: Shivani primary, Kriti+Poonam fallback
  const othersPool = isAvail(SHIVANI)
    ? [getAdv(SHIVANI)].filter(Boolean)
    : allAvailable.filter(a => [KRITI, POONAM].includes(a.email));

  // Regular pool: advisors not committed to specialty duties today
  const specialtyEmails = new Set([...pmPool, ...othersPool].map(a => a.email));
  const regularPool = allAvailable.filter(a => !specialtyEmails.has(a.email));
  const effectiveRegularPool = regularPool.length ? regularPool : allAvailable;

  // ── Ticket groups ─────────────────────────────────────────────────────────
  const pmTickets      = unassigned.filter(t => t.dispL3 === "Partner Misbehavior");
  const othersTickets  = unassigned.filter(t => t.dispL3 === "Others");
  const regularTickets = unassigned.filter(t => t.dispL3 !== "Partner Misbehavior" && t.dispL3 !== "Others");

  // ── Build assignments ─────────────────────────────────────────────────────
  const assignments = [];
  const distribute = (tickets, pool) => {
    const effectivePool = pool.length ? pool : allAvailable;
    tickets.forEach((t, i) => {
      const adv = effectivePool[i % effectivePool.length];
      assignments.push({ ticketNo: t.ticketNo, advisorEmail: adv.email, advisorName: adv.name });
    });
  };
  distribute(pmTickets, pmPool);
  distribute(othersTickets, othersPool);
  distribute(regularTickets, effectiveRegularPool);

  // ── Preview modal ─────────────────────────────────────────────────────────
  const poolLine = (tickets, pool, label) => {
    if (!tickets.length) return "";
    const eff = pool.length ? pool : allAvailable;
    return `<div style="padding:7px 0;border-bottom:1px solid var(--border);font-size:13px">
      <strong>${label}</strong> <span style="color:var(--text-muted)">(${tickets.length} tickets)</span>
      → <span style="color:var(--accent)">${eff.map(a => a.name).join(", ")}</span>
    </div>`;
  };

  const body = `
    <p style="font-size:14px;margin-bottom:12px">
      <strong>${unassigned.length}</strong> unassigned tickets will be assigned with specialty routing:
    </p>
    <div style="border:1px solid var(--border);border-radius:8px;padding:0 12px;margin-bottom:14px">
      ${poolLine(pmTickets, pmPool, "Partner Misbehavior")}
      ${poolLine(othersTickets, othersPool, "Others")}
      ${poolLine(regularTickets, effectiveRegularPool, "All other tickets")}
    </div>
    <div style="font-size:12px;color:var(--text-muted)">
      ${allAvailable.map(a => {
        const count = assignments.filter(x => x.advisorEmail === a.email).length;
        const h = allTickets.filter(t => t.assignedTo === a.email).length;
        return `<div style="padding:2px 0">${a.name}: +${count} new (${h} currently holding)</div>`;
      }).join("")}
    </div>`;

  showModal("⚡ Auto-Assign",  body,
    `<button class="btn btn-secondary" id="aa-cancel">Cancel</button>
     <button class="btn btn-primary" id="aa-confirm">Confirm & Assign</button>`, true);

  document.getElementById("aa-cancel").onclick = closeModal;
  document.getElementById("aa-confirm").onclick = async () => {
    const btn = document.getElementById("aa-confirm");
    btn.disabled = true; btn.textContent = "Assigning…";
    try {
      showLoading(`Assigning ${unassigned.length} tickets…`);
      await bulkAssignTickets(assignments, currentActor);
      hideLoading();
      showToast(`${unassigned.length} tickets assigned`, "success");
      closeModal();
    } catch (e) {
      hideLoading();
      showToast("Error: " + e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Confirm & Assign"; }
    }
  };
}
