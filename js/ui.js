import { CONFIG } from './config.js';
import { getTicketAuditLog, updateTicketStatus, updateTicketRemarks } from './db.js';

// ─── Toast ───────────────────────────────────────────────────────────────────

export function showToast(message, type = "info", duration = 3500) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span><button onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ─── Loading ──────────────────────────────────────────────────────────────────

export function showLoading(text = "Loading…") {
  const el = document.getElementById("loading-overlay");
  if (el) {
    el.style.display = "flex";
    const t = document.getElementById("loading-text");
    if (t) t.textContent = text;
  }
}

export function hideLoading() {
  const el = document.getElementById("loading-overlay");
  if (el) el.style.display = "none";
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function showModal(title, bodyHTML, footerHTML = "", large = false) {
  const overlay = document.getElementById("modal-overlay");
  const modal = overlay.querySelector(".modal");
  if (large) modal.classList.add("modal-lg");
  else modal.classList.remove("modal-lg");
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHTML;
  document.getElementById("modal-footer").innerHTML = footerHTML;
  overlay.style.display = "flex";
}

export function closeModal() {
  document.getElementById("modal-overlay").style.display = "none";
}

// ─── Confirm ─────────────────────────────────────────────────────────────────

export function showConfirm(message, onConfirm, onCancel) {
  showModal(
    "Confirm",
    `<p style="margin:0;font-size:14px">${message}</p>`,
    `<button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
     <button class="btn btn-primary" id="confirm-ok">Confirm</button>`
  );
  document.getElementById("confirm-ok").onclick = () => { closeModal(); onConfirm(); };
  document.getElementById("confirm-cancel").onclick = () => { closeModal(); if (onCancel) onCancel(); };
}

// ─── Badges ───────────────────────────────────────────────────────────────────

const STATUS_BADGE = {
  // Open
  "New/Unassigned":                                    "badge-new",
  "Assigned":                                          "badge-assigned",
  "Pending":                                           "badge-pending",
  "DNP 1":                                             "badge-dnp1",
  "DNP 2":                                             "badge-dnp2",
  "Follow-up needed - confirmation pending from Cx":   "badge-followup",
  "Follow-up needed - Migration team working":         "badge-followup",
  "Follow-up needed - refund initiated":               "badge-followup",
  "Follow-up needed - Shared with Px":                 "badge-followup",
  "Follow-up needed - TAT provided to Cx":             "badge-followup",
  // Closed
  "Resolved - Refund Initiated":                       "badge-resolved",
  "Resolved by PFT":                                   "badge-resolved",
  "Resolved - DNP 3":                                  "badge-resolved",
  "Already completed":                                 "badge-resolved",
  "Already Resolved":                                  "badge-resolved",
  "Send to WIOM":                                      "badge-send-wiom"
};

const AGING_BADGE = {
  "0-12 hrs":   "badge-aging-0",
  "12-24 hrs":  "badge-aging-12",
  "24-36 hrs":  "badge-aging-24",
  "36-48 hrs":  "badge-aging-36",
  "48-72 hrs":  "badge-aging-48",
  "72-120 hrs": "badge-aging-72",
  ">120 hrs":   "badge-aging-120"
};

const ROSTER_BADGE = {
  P: "badge-roster-p", WO: "badge-roster-wo", L: "badge-roster-l",
  UP: "badge-roster-up", HD: "badge-roster-hd",
  Holiday: "badge-roster-holiday", WFH: "badge-roster-wfh"
};

export function statusBadge(status) {
  const cls = STATUS_BADGE[status] || "badge-new";
  return `<span class="badge ${cls}">${status || "—"}</span>`;
}

export function agingBadge(bucket, hours) {
  const cls = AGING_BADGE[bucket] || "badge-aging-critical";
  const label = hours != null ? `${Math.round(hours)}h` : (bucket || "—");
  return `<span class="badge ${cls}" title="${bucket || ""}">${label}</span>`;
}

export function rosterBadge(code) {
  if (!code) return `<span class="badge badge-new">—</span>`;
  const cls = ROSTER_BADGE[code] || "badge-new";
  return `<span class="badge ${cls}">${code}</span>`;
}

export function presenceDot(status) {
  const cls = status === "Logged In" ? "logged-in" : status === "On Break" ? "on-break" : "logged-out";
  return `<span class="presence-dot ${cls}"></span>`;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch { return iso; }
}

export function formatDateShort(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch { return iso; }
}

export function kaptureLink(ticketNo) {
  const url = CONFIG.KAPTURE_URL_PATTERN.replace(/{ticketNo}/g, ticketNo);
  return `<a href="${url}" target="_blank" class="ticket-link">${ticketNo}</a>`;
}

// ─── Filter tickets ───────────────────────────────────────────────────────────

export function filterTickets(tickets, filters) {
  return tickets.filter(t => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!t.ticketNo?.toLowerCase().includes(q) &&
          !t.customerName?.toLowerCase().includes(q) &&
          !t.phone?.includes(q)) return false;
    }
    if (filters.zone && filters.zone !== "all" && t.zone !== filters.zone) return false;
    if (filters.status && filters.status !== "all" && t.platformStatus !== filters.status) return false;
    if (filters.advisor && filters.advisor !== "all" && t.assignedTo !== filters.advisor) return false;
    if (filters.category && filters.category !== "all" && t.dispL3 !== filters.category) return false;
    if (filters.aging && filters.aging !== "all" && t.agingBucket !== filters.aging) return false;
    if (filters.reopenOnly && !t.reopenTag) return false;
    return true;
  });
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export function renderPagination(container, currentPage, totalPages, onPageChange) {
  if (!container) return;
  if (totalPages <= 1) { container.innerHTML = ""; return; }

  const btns = [];
  btns.push(`<button class="page-btn" ${currentPage === 1 ? "disabled" : ""} data-page="${currentPage - 1}">‹</button>`);

  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= currentPage - 2 && p <= currentPage + 2)) {
      btns.push(`<button class="page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`);
    } else if (p === currentPage - 3 || p === currentPage + 3) {
      btns.push(`<span class="page-ellipsis">…</span>`);
    }
  }
  btns.push(`<button class="page-btn" ${currentPage === totalPages ? "disabled" : ""} data-page="${currentPage + 1}">›</button>`);

  container.innerHTML = btns.join("");
  container.querySelectorAll(".page-btn:not([disabled])").forEach(btn => {
    btn.addEventListener("click", () => onPageChange(Number(btn.dataset.page)));
  });
}

// ─── Ticket Detail Modal ──────────────────────────────────────────────────────

export async function showTicketDetail(ticket, actor, onUpdated) {
  const isAdvisor = actor.role === "Advisor";
  const canChangeStatus = !isAdvisor || ticket.assignedTo === actor.email;
  const availableStatuses = isAdvisor ? CONFIG.ALL_STATUSES.filter(s => s !== "New/Unassigned") : CONFIG.ALL_STATUSES;

  const body = `
    <div class="ticket-field-grid">
      <div class="ticket-field"><div class="tf-label">Ticket #</div><div class="tf-value">${kaptureLink(ticket.ticketNo)}</div></div>
      <div class="ticket-field"><div class="tf-label">Customer</div><div class="tf-value">${ticket.customerName || "—"}</div></div>
      <div class="ticket-field"><div class="tf-label">Phone</div><div class="tf-value">${ticket.phone || "—"}</div></div>
      <div class="ticket-field"><div class="tf-label">Zone</div><div class="tf-value">${ticket.zone || "—"}</div></div>
      <div class="ticket-field"><div class="tf-label">L3 Disposition</div><div class="tf-value">${ticket.dispL3 || "—"}</div></div>
      <div class="ticket-field"><div class="tf-label">L4 Disposition</div><div class="tf-value">${ticket.dispL4 || "—"}</div></div>
      <div class="ticket-field"><div class="tf-label">Partner</div><div class="tf-value">${ticket.mappedPartner || "—"}</div></div>
      <div class="ticket-field"><div class="tf-label">Current Queue</div><div class="tf-value">${ticket.currentQueue || "—"}</div></div>
      <div class="ticket-field"><div class="tf-label">Kapture Status</div><div class="tf-value">${ticket.kaptureStatus || "—"} / ${ticket.kaptureSubStatus || "—"}</div></div>
      <div class="ticket-field"><div class="tf-label">Aging</div><div class="tf-value">${agingBadge(ticket.agingBucket, ticket.agingHours)}</div></div>
      <div class="ticket-field"><div class="tf-label">Platform Status</div><div class="tf-value">${statusBadge(ticket.platformStatus)}</div></div>
      <div class="ticket-field"><div class="tf-label">Assigned To</div><div class="tf-value">${ticket.assignedToName || "Unassigned"}</div></div>
      <div class="ticket-field"><div class="tf-label">First Seen</div><div class="tf-value">${formatDate(ticket.firstSeenDate)}</div></div>
      <div class="ticket-field"><div class="tf-label">Last Ingested</div><div class="tf-value">${formatDate(ticket.lastIngestedDate)}</div></div>
      ${ticket.reopenTag ? '<div class="ticket-field" style="grid-column:1/-1"><div class="tf-value"><span class="badge badge-escalated">⚠ Reopen</span></div></div>' : ""}
    </div>
    <hr class="divider">
    ${canChangeStatus ? `
      <div class="form-group">
        <label>Platform Status</label>
        <select class="form-control" id="td-status">
          ${availableStatuses.map(s => `<option value="${s}" ${ticket.platformStatus === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>` : ""}
    <div class="form-group">
      <label>Remarks</label>
      <textarea class="form-control" id="td-remarks" placeholder="Add remarks…" ${!canChangeStatus ? "readonly" : ""}>${ticket.advisorRemarks || ""}</textarea>
    </div>
    <hr class="divider">
    <div class="section-title" style="font-size:13px;margin-bottom:8px">Audit Trail</div>
    <ul class="audit-list" id="td-audit"><li style="color:var(--text-muted);font-size:12px">Loading…</li></ul>
  `;

  const footer = canChangeStatus
    ? `<button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Close</button>
       <button class="btn btn-primary" id="td-save">Save Changes</button>`
    : `<button class="btn btn-secondary" onclick="document.getElementById('modal-overlay').style.display='none'">Close</button>`;

  showModal(`Ticket ${ticket.ticketNo}`, body, footer, true);

  // Load audit trail
  getTicketAuditLog(ticket.ticketNo).then(logs => {
    const auditEl = document.getElementById("td-audit");
    if (!auditEl) return;
    if (!logs.length) { auditEl.innerHTML = `<li style="color:var(--text-muted);font-size:12px">No audit history.</li>`; return; }
    auditEl.innerHTML = logs.map(l => `
      <li class="audit-item">
        <span class="audit-time">${formatDate(l.timestamp)}</span>
        <span class="audit-action">${l.action}</span>
        <span style="color:var(--text-muted)">${l.actorEmail}</span>
        ${l.oldValue ? `<span style="color:var(--text-muted);margin-left:4px">${l.oldValue} → ${l.newValue}</span>` : ""}
      </li>`).join("");
  });

  if (canChangeStatus) {
    const saveBtn = document.getElementById("td-save");
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const newStatus = document.getElementById("td-status")?.value;
        const newRemarks = document.getElementById("td-remarks")?.value || "";
        try {
          saveBtn.disabled = true;
          saveBtn.textContent = "Saving…";
          await updateTicketStatus(ticket.ticketNo, newStatus, newRemarks, actor);
          showToast("Ticket updated", "success");
          closeModal();
          if (onUpdated) onUpdated();
        } catch (e) {
          showToast("Error: " + e.message, "error");
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Changes";
        }
      };
    }
  }
}
