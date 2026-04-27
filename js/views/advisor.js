import { CONFIG } from '../config.js';
import { subscribeToAdvisorTickets, updateUserPresence, getUser } from '../db.js';
import {
  showToast, statusBadge, agingBadge, formatDate, kaptureLink,
  filterTickets, renderPagination, showTicketDetail, showModal, closeModal
} from '../ui.js';

let allTickets = [];
let filtered = [];
let currentPage = 1;
const PAGE_SIZE = CONFIG.PAGE_SIZE;
let unsub;
let currentActor;
let userDoc;
let currentFilters = { search: "", status: "all", aging: "all" };

export async function mountAdvisorView(actor, container) {
  currentActor = actor;
  userDoc = await getUser(actor.email);

  container.innerHTML = buildShell();
  renderAttendanceBar();
  bindFilters();
  bindAttendanceButtons();

  unsub = subscribeToAdvisorTickets(actor.email, tickets => {
    allTickets = tickets;
    applyAndRender();
  });
}

export function unmountAdvisorView() {
  if (unsub) unsub();
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function buildShell() {
  return `
    <div class="attendance-bar" id="adv-attendance">
      <div class="attendance-status" id="adv-presence-label">
        <span class="presence-dot logged-out" id="adv-dot"></span>
        <span id="adv-status-text">Logged Out</span>
      </div>
      <div style="flex:1"></div>
      <span id="adv-break-info" class="text-muted text-sm" style="margin-right:8px"></span>
      <button class="btn btn-success btn-sm" id="btn-login" style="display:none">Log In</button>
      <button class="btn btn-secondary btn-sm" id="btn-break" style="display:none">Start Break</button>
      <button class="btn btn-secondary btn-sm" id="btn-resume" style="display:none">End Break</button>
      <button class="btn btn-danger btn-sm" id="btn-logout" style="display:none">Log Out</button>
    </div>
    <div class="stats-grid" id="adv-stats"></div>
    <div class="card">
      <div class="filter-bar">
        <input class="filter-input" id="adv-search" type="text" placeholder="Search ticket #, customer, phone…">
        <select class="filter-select" id="adv-fl-status">
          <option value="all">All Statuses</option>
          ${CONFIG.ALL_STATUSES.map(s => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <select class="filter-select" id="adv-fl-aging">
          <option value="all">All Aging</option>
          ${CONFIG.AGING_BUCKETS.map(b => `<option value="${b}">${b}</option>`).join("")}
        </select>
        <div class="filter-actions">
          <button class="btn btn-secondary btn-sm" id="adv-fl-clear">Clear</button>
        </div>
      </div>
      <div class="table-container" style="border-radius:0;border-left:none;border-right:none;border-bottom:none;box-shadow:none">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Customer</th>
              <th>Phone</th>
              <th>L3 / L4</th>
              <th>Zone</th>
              <th>Partner</th>
              <th>Aging</th>
              <th>Kapture Status</th>
              <th>Platform Status</th>
              <th>Assigned</th>
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

// ─── Attendance ───────────────────────────────────────────────────────────────

function renderAttendanceBar() {
  if (!userDoc) return;
  const status = userDoc.currentStatus || "Logged Out";
  const dot = document.getElementById("adv-dot");
  const label = document.getElementById("adv-status-text");
  const loginBtn = document.getElementById("btn-login");
  const breakBtn = document.getElementById("btn-break");
  const resumeBtn = document.getElementById("btn-resume");
  const logoutBtn = document.getElementById("btn-logout");
  const breakInfo = document.getElementById("adv-break-info");

  const dotClass = status === "Logged In" ? "logged-in" : status === "On Break" ? "on-break" : "logged-out";
  if (dot) { dot.className = `presence-dot ${dotClass}`; }
  if (label) label.textContent = status;

  if (loginBtn) loginBtn.style.display = status === "Logged Out" ? "" : "none";
  if (breakBtn) breakBtn.style.display = status === "Logged In" ? "" : "none";
  if (resumeBtn) resumeBtn.style.display = status === "On Break" ? "" : "none";
  if (logoutBtn) logoutBtn.style.display = status !== "Logged Out" ? "" : "none";

  const usedBreak = userDoc.todayBreakMinutes || 0;
  const remaining = CONFIG.BREAK_CAP_MINUTES - usedBreak;
  if (breakInfo) {
    breakInfo.textContent = status !== "Logged Out"
      ? `Break: ${usedBreak}m used / ${CONFIG.BREAK_CAP_MINUTES}m cap (${remaining}m left)`
      : "";
  }
}

function bindAttendanceButtons() {
  const handle = async (event) => {
    try {
      await updateUserPresence(currentActor.email, currentActor.name, event);
      userDoc = await getUser(currentActor.email);
      renderAttendanceBar();
      const eventLabels = { LOGIN: "Logged in", BREAK_START: "Break started", BREAK_END: "Break ended", LOGOUT: "Logged out" };
      showToast(eventLabels[event] || "Done", "success");
    } catch (e) {
      showToast("Error: " + e.message, "error");
    }
  };

  document.getElementById("btn-login")?.addEventListener("click", () => {
    if ((userDoc?.todayBreakMinutes || 0) >= CONFIG.BREAK_CAP_MINUTES) {
      showToast("Break cap reached. Coordinator will unlock.", "warning");
    }
    handle("LOGIN");
  });

  document.getElementById("btn-break")?.addEventListener("click", () => {
    const used = userDoc?.todayBreakMinutes || 0;
    if (used >= CONFIG.BREAK_CAP_MINUTES) {
      showToast("Break cap of 60 minutes reached", "warning"); return;
    }
    handle("BREAK_START");
  });

  document.getElementById("btn-resume")?.addEventListener("click", () => handle("BREAK_END"));

  document.getElementById("btn-logout")?.addEventListener("click", () => {
    if (!confirm("Are you sure you want to log out?")) return;
    handle("LOGOUT");
  });
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function bindFilters() {
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  document.getElementById("adv-search")?.addEventListener("input", debounce(e => { currentFilters.search = e.target.value; applyAndRender(); }, 250));
  document.getElementById("adv-fl-status")?.addEventListener("change", e => { currentFilters.status = e.target.value; applyAndRender(); });
  document.getElementById("adv-fl-aging")?.addEventListener("change", e => { currentFilters.aging = e.target.value; applyAndRender(); });
  document.getElementById("adv-fl-clear")?.addEventListener("click", () => {
    currentFilters = { search: "", status: "all", aging: "all" };
    document.getElementById("adv-search").value = "";
    document.getElementById("adv-fl-status").value = "all";
    document.getElementById("adv-fl-aging").value = "all";
    applyAndRender();
  });
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
  const el = document.getElementById("adv-stats");
  if (!el) return;
  const open = allTickets.filter(t => CONFIG.STATUSES.OPEN.includes(t.platformStatus)).length;
  const escalated = allTickets.filter(t => t.platformStatus === "Escalated").length;
  const critical = allTickets.filter(t => t.agingBucket === ">120 hrs").length;
  const resolved = allTickets.filter(t => t.platformStatus === "Resolved").length;

  el.innerHTML = `
    <div class="stat-card accent"><div class="stat-label">My Tickets (Open)</div><div class="stat-value">${open}</div></div>
    <div class="stat-card danger"><div class="stat-label">Escalated</div><div class="stat-value">${escalated}</div></div>
    <div class="stat-card warning"><div class="stat-label">>120h Aging</div><div class="stat-value">${critical}</div></div>
    <div class="stat-card success"><div class="stat-label">Resolved</div><div class="stat-value">${resolved}</div></div>
    <div class="stat-card"><div class="stat-label">Total Assigned</div><div class="stat-value">${allTickets.length}</div></div>
  `;
}

// ─── Table ────────────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById("adv-tbody");
  const pagInfo = document.getElementById("adv-pag-info");
  const pagBtns = document.getElementById("adv-pag-btns");
  if (!tbody) return;

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);

  if (pagInfo) pagInfo.textContent = total
    ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total}`
    : "No tickets";

  if (!page.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="12">No tickets match the current filters.</td></tr>`;
    if (pagBtns) pagBtns.innerHTML = "";
    return;
  }

  tbody.innerHTML = page.map(t => `
    <tr data-id="${t.ticketNo}">
      <td>${kaptureLink(t.ticketNo)}</td>
      <td class="td-wrap" title="${t.customerName || ""}">${t.customerName || "—"}</td>
      <td class="td-phone">${t.phone || "—"}</td>
      <td class="td-wrap" title="${t.dispL3 || ""} / ${t.dispL4 || ""}">${t.dispL3 || "—"}<br><span style="font-size:11px;color:var(--text-muted)">${t.dispL4 || ""}</span></td>
      <td>${t.zone || "—"}</td>
      <td class="td-wrap">${t.mappedPartner || "—"}</td>
      <td>${agingBadge(t.agingBucket, t.agingHours)}</td>
      <td><span style="font-size:12px">${t.kaptureStatus || "—"}</span></td>
      <td>${statusBadge(t.platformStatus)}</td>
      <td style="font-size:11px;color:var(--text-muted)">${formatDate(t.assignedDate)}</td>
      <td class="td-wrap" style="font-size:12px" title="${t.advisorRemarks || ""}">${t.advisorRemarks || '<span class="text-muted">—</span>'}</td>
      <td class="td-actions">
        <button class="btn btn-xs btn-primary view-btn" data-id="${t.ticketNo}">Update</button>
      </td>
    </tr>
  `).join("");

  tbody.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ticket = allTickets.find(t => t.ticketNo === btn.dataset.id);
      if (ticket) showTicketDetail(ticket, currentActor, () => {});
    });
  });

  renderPagination(pagBtns, currentPage, totalPages, p => {
    currentPage = p;
    renderTable();
  });
}
