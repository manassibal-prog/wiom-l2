import { CONFIG } from '../config.js';
import { subscribeToUsers, subscribeToRoster, updateRosterEntry } from '../db.js';
import { showToast, rosterBadge } from '../ui.js';

let allUsers = [];
let rosterData = {};
let currentDate = todayISO();
let weekDates = [];
let unsubUsers, unsubRoster;
let currentActor;
const canEdit = true; // TL and Manager can both edit

export function mountRosterView(actor, container, readOnly = false) {
  currentActor = actor;
  currentDate = todayISO();
  weekDates = getWeekDates(currentDate);

  container.innerHTML = buildShell(readOnly);
  bindNavigation(readOnly);

  unsubUsers = subscribeToUsers(users => {
    allUsers = users.filter(u => u.role === "Advisor" && u.active);
    renderRoster(readOnly);
  });

  subscribeWeek(readOnly);
}

export function unmountRosterView() {
  if (unsubUsers) unsubUsers();
  if (unsubRoster) unsubRoster();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getWeekDates(anchor) {
  const d = new Date(anchor);
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    return dd.toISOString().slice(0, 10);
  });
}

function formatColDate(iso) {
  const d = new Date(iso);
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return `${days[d.getDay()]}<br>${d.getDate()}/${d.getMonth() + 1}`;
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function buildShell(readOnly) {
  return `
    <div class="card mb-5">
      <div class="card-header">
        <button class="btn btn-secondary btn-sm" id="roster-prev">‹ Prev</button>
        <h3 id="roster-week-label" style="text-align:center;flex:1">Week</h3>
        <button class="btn btn-secondary btn-sm" id="roster-next">Next ›</button>
        <button class="btn btn-secondary btn-sm" id="roster-today" style="margin-left:8px">Today</button>
      </div>
      <div class="roster-grid card-body" style="padding:0;overflow-x:auto">
        <div id="roster-table-container"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Legend</h3></div>
      <div class="card-body" style="display:flex;flex-wrap:wrap;gap:10px">
        ${CONFIG.ROSTER_CODES.map(c => `${rosterBadge(c)} <span style="font-size:12px">${CONFIG.ROSTER_LABELS[c]}</span>`).join("")}
      </div>
    </div>
  `;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function bindNavigation(readOnly) {
  document.getElementById("roster-prev")?.addEventListener("click", () => {
    const d = new Date(weekDates[0]);
    d.setDate(d.getDate() - 7);
    weekDates = getWeekDates(d.toISOString().slice(0, 10));
    updateWeekLabel();
    subscribeWeek(readOnly);
  });
  document.getElementById("roster-next")?.addEventListener("click", () => {
    const d = new Date(weekDates[6]);
    d.setDate(d.getDate() + 7);
    weekDates = getWeekDates(d.toISOString().slice(0, 10));
    updateWeekLabel();
    subscribeWeek(readOnly);
  });
  document.getElementById("roster-today")?.addEventListener("click", () => {
    currentDate = todayISO();
    weekDates = getWeekDates(currentDate);
    updateWeekLabel();
    subscribeWeek(readOnly);
  });
  updateWeekLabel();
}

function updateWeekLabel() {
  const el = document.getElementById("roster-week-label");
  if (el) {
    const start = new Date(weekDates[0]).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    const end = new Date(weekDates[6]).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    el.textContent = `${start} – ${end}`;
  }
}

// ─── Data subscription ────────────────────────────────────────────────────────

function subscribeWeek(readOnly) {
  if (unsubRoster) unsubRoster();
  rosterData = {};
  let loaded = 0;

  // Subscribe to each day of the week
  const unsubs = weekDates.map(date => {
    return subscribeToRoster(date, data => {
      rosterData[date] = data.advisors || {};
      renderRoster(readOnly);
    });
  });

  // Combine all unsubs
  unsubRoster = () => unsubs.forEach(u => u());
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderRoster(readOnly) {
  const container = document.getElementById("roster-table-container");
  if (!container || !allUsers.length) return;

  const today = todayISO();

  const headers = weekDates.map(d => `<th class="${d === today ? "today-col" : ""}">${formatColDate(d)}</th>`).join("");

  const rows = allUsers.map(advisor => {
    const cells = weekDates.map(date => {
      const code = rosterData[date]?.[advisor.email] || "";
      const isTodayCol = date === today;
      const colorStyle = getRosterCellStyle(code);

      if (!readOnly) {
        return `<td class="${isTodayCol ? "today-col" : ""}" style="${colorStyle}">
          <select class="roster-select" data-date="${date}" data-email="${advisor.email}">
            <option value="">—</option>
            ${CONFIG.ROSTER_CODES.map(c => `<option value="${c}" ${code === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </td>`;
      } else {
        return `<td class="${isTodayCol ? "today-col" : ""}" style="${colorStyle};text-align:center">${rosterBadge(code)}</td>`;
      }
    }).join("");

    return `<tr>
      <td class="advisor-name">${advisor.name}
        <div style="font-size:10px;color:var(--text-muted)">${advisor.categoryGroup || ""}</div>
      </td>
      ${cells}
    </tr>`;
  }).join("");

  container.innerHTML = `
    <table class="roster-table">
      <thead><tr><th style="text-align:left;min-width:140px">Advisor</th>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  if (!readOnly) {
    container.querySelectorAll(".roster-select").forEach(sel => {
      sel.addEventListener("change", async e => {
        const { date, email } = e.target.dataset;
        const code = e.target.value;
        try {
          await updateRosterEntry(date, email, code);
          showToast(`Roster updated`, "success", 1500);
        } catch (err) {
          showToast("Error: " + err.message, "error");
        }
      });
    });
  }
}

function getRosterCellStyle(code) {
  const styles = {
    P: "background:#f0fdf4",
    WO: "background:#eff6ff",
    L: "background:#fefce8",
    UP: "background:#fef2f2",
    HD: "background:#f5f3ff",
    Holiday: "background:#fdf4ff",
    WFH: "background:#f0fdf4"
  };
  return styles[code] || "";
}
