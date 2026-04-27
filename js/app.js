import { CONFIG } from './config.js';
import { onAuthReady, signOutUser } from './auth.js';
import { subscribeToUsers, createUser, updateUser, getRecentIngestionLogs, getSettings } from './db.js';
import { showToast, showLoading, hideLoading, showModal, closeModal, formatDate, presenceDot } from './ui.js';
import { mountTLDashboard, unmountTLDashboard } from './views/tl-dashboard.js';
import { mountAdvisorView, unmountAdvisorView } from './views/advisor.js';
import { mountManagerDashboard, unmountManagerDashboard } from './views/manager.js';
import { mountRosterView, unmountRosterView } from './views/roster.js';

let currentUser = null;
let activeView = null;
let allUsers = [];
let unsubUsers;

// ─── Boot ─────────────────────────────────────────────────────────────────────

showLoading("Checking authentication…");

onAuthReady((user, errorCode) => {
  hideLoading();
  if (!user) {
    if (errorCode === "no_user_doc") {
      window.location.href = "index.html?error=no_access";
    } else if (errorCode === "unauthorized_domain") {
      window.location.href = "index.html?error=domain";
    } else {
      window.location.href = "index.html";
    }
    return;
  }

  currentUser = user;
  bootApp();
});

// ─── App Boot ─────────────────────────────────────────────────────────────────

function bootApp() {
  renderSidebar();

  // Start user subscription for admin panel
  unsubUsers = subscribeToUsers(users => {
    allUsers = users;
    refreshNavBadges();
  });

  // Route to default view
  const defaultView = getDefaultView(currentUser.role);
  navigateTo(defaultView);
}

function getDefaultView(role) {
  if (role === "Advisor") return "my-tickets";
  return "tickets";
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function renderSidebar() {
  const brand = document.getElementById("sidebar-brand");
  if (brand) {
    brand.innerHTML = `
      <h1>WIOM L2</h1>
      <p>Escalation Platform</p>
    `;
  }

  const nav = document.getElementById("sidebar-nav");
  if (!nav) return;

  const isTL = currentUser.role === CONFIG.ROLES.TL;
  const isManager = currentUser.role === CONFIG.ROLES.MANAGER || currentUser.role === CONFIG.ROLES.SR_MANAGER;
  const isAdvisor = currentUser.role === CONFIG.ROLES.ADVISOR;
  const isSenior = isTL || isManager;

  let navItems = [];

  if (isAdvisor) {
    navItems = [
      { id: "my-tickets", icon: "🎫", label: "My Tickets" }
    ];
  } else if (isTL) {
    navItems = [
      { id: "tickets", icon: "📋", label: "All Tickets" },
      { id: "roster", icon: "📅", label: "Roster" },
      { id: "users", icon: "👥", label: "Users" },
      { id: "ingest-log", icon: "📥", label: "Ingestion Log" }
    ];
  } else if (isManager) {
    navItems = [
      { id: "tickets", icon: "📋", label: "All Tickets" },
      { id: "roster", icon: "📅", label: "Roster" }
    ];
  }

  nav.innerHTML = navItems.map(item => `
    <button class="nav-item" data-view="${item.id}" id="nav-${item.id}">
      <span class="nav-icon">${item.icon}</span>
      <span>${item.label}</span>
    </button>
  `).join("");

  nav.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => navigateTo(btn.dataset.view));
  });

  // User card
  const footer = document.getElementById("sidebar-footer");
  if (footer) {
    const initials = currentUser.name?.split(" ").map(n => n[0]).join("").slice(0, 2) || "?";
    footer.innerHTML = `
      <div class="user-card">
        <div class="user-avatar">${initials}</div>
        <div class="user-info">
          <div class="user-name">${currentUser.name}</div>
          <div class="user-role">${currentUser.role}</div>
        </div>
        <button class="btn-logout" id="logout-btn" title="Sign out">⏻</button>
      </div>
    `;
    document.getElementById("logout-btn")?.addEventListener("click", async () => {
      if (!confirm("Sign out?")) return;
      await signOutUser();
      window.location.href = "index.html";
    });
  }
}

function refreshNavBadges() {
  // Could add unassigned count badge on nav — currently just updates
}

// ─── Router ───────────────────────────────────────────────────────────────────

function navigateTo(viewId) {
  // Unmount previous
  if (activeView) {
    if (activeView === "tickets" || activeView === "my-tickets-tl") unmountTLDashboard();
    if (activeView === "my-tickets") unmountAdvisorView();
    if (activeView === "tickets-mgr") unmountManagerDashboard();
    if (activeView === "roster" || activeView === "roster-ro") unmountRosterView();
  }

  activeView = viewId;

  // Update nav highlight
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });

  const content = document.getElementById("main-content");
  const title = document.getElementById("topbar-title");
  if (!content) return;

  const role = currentUser.role;

  switch (viewId) {
    case "tickets":
      if (title) title.textContent = "All Tickets";
      if (role === CONFIG.ROLES.TL) {
        activeView = "tickets";
        mountTLDashboard(currentUser, content);
      } else {
        activeView = "tickets-mgr";
        mountManagerDashboard(currentUser, content);
      }
      break;

    case "my-tickets":
      if (title) title.textContent = "My Tickets";
      mountAdvisorView(currentUser, content);
      break;

    case "roster":
      if (title) title.textContent = "Roster";
      mountRosterView(currentUser, content, role !== CONFIG.ROLES.TL && role !== CONFIG.ROLES.MANAGER && role !== CONFIG.ROLES.SR_MANAGER);
      break;

    case "users":
      if (title) title.textContent = "User Management";
      mountUsersView(content);
      break;

    case "ingest-log":
      if (title) title.textContent = "Ingestion Log";
      mountIngestionLog(content);
      break;

    default:
      content.innerHTML = `<p class="text-muted">View not found.</p>`;
  }
}

// ─── Users View (TL only) ─────────────────────────────────────────────────────

function mountUsersView(container) {
  let users = [];
  let unsub = subscribeToUsers(u => { users = u; renderUserTable(container, users); });
  container._unmount = () => unsub();

  const addBtn = document.createElement("button");
  // Rendered inside the view below
}

function renderUserTable(container, users) {
  const advisors = users.filter(u => u.role === "Advisor");
  const seniors = users.filter(u => u.role !== "Advisor");

  container.innerHTML = `
    <div class="flex items-center gap-2 mb-4">
      <h3 class="section-title" style="margin:0">Team Members</h3>
      <button class="btn btn-primary btn-sm ml-auto" id="add-user-btn">+ Add User</button>
    </div>
    <div class="table-container mb-5">
      <table class="data-table user-list-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Category</th>
            <th>Status</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td><strong>${u.name}</strong></td>
              <td style="font-size:12px;color:var(--text-muted)">${u.email}</td>
              <td><span class="badge badge-new">${u.role}</span></td>
              <td>${u.categoryGroup || "—"}</td>
              <td>${presenceDot(u.currentStatus)} ${u.currentStatus || "Logged Out"}</td>
              <td>${u.active ? '<span class="badge badge-resolved">Active</span>' : '<span class="badge badge-auto-closed">Inactive</span>'}</td>
              <td class="td-actions">
                <button class="btn btn-xs btn-secondary edit-user-btn" data-email="${u.email}">Edit</button>
                <button class="btn btn-xs ${u.active ? "btn-danger" : "btn-success"} toggle-user-btn" data-email="${u.email}" data-active="${u.active}">
                  ${u.active ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById("add-user-btn")?.addEventListener("click", () => openAddUserModal());

  container.querySelectorAll(".edit-user-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const user = users.find(u => u.email === btn.dataset.email);
      if (user) openEditUserModal(user);
    });
  });

  container.querySelectorAll(".toggle-user-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const isActive = btn.dataset.active === "true";
      if (!confirm(`${isActive ? "Deactivate" : "Activate"} this user?`)) return;
      try {
        await updateUser(btn.dataset.email, { active: !isActive });
        showToast("User updated", "success");
      } catch (e) {
        showToast("Error: " + e.message, "error");
      }
    });
  });
}

function openAddUserModal() {
  showModal(
    "Add User",
    `<div class="form-group"><label>Full Name</label><input class="form-control" id="nu-name" placeholder="Full name"></div>
     <div class="form-group"><label>Email (@wiom.in)</label><input class="form-control" id="nu-email" type="email" placeholder="email@wiom.in"></div>
     <div class="form-group"><label>Role</label>
       <select class="form-control" id="nu-role">
         ${Object.values(CONFIG.ROLES).map(r => `<option value="${r}">${r}</option>`).join("")}
       </select>
     </div>
     <div class="form-group"><label>Category Group</label>
       <select class="form-control" id="nu-cat">
         ${CONFIG.CATEGORY_GROUPS.map(c => `<option value="${c}">${c}</option>`).join("")}
       </select>
     </div>`,
    `<button class="btn btn-secondary" id="nu-cancel">Cancel</button>
     <button class="btn btn-primary" id="nu-save">Create</button>`
  );

  document.getElementById("nu-cancel").onclick = closeModal;
  document.getElementById("nu-save").onclick = async () => {
    const name = document.getElementById("nu-name").value.trim();
    const email = document.getElementById("nu-email").value.trim().toLowerCase();
    const role = document.getElementById("nu-role").value;
    const cat = document.getElementById("nu-cat").value;

    if (!name || !email) { showToast("Name and email are required", "warning"); return; }
    if (!email.endsWith(`@${CONFIG.ALLOWED_DOMAIN}`)) { showToast(`Email must be @${CONFIG.ALLOWED_DOMAIN}`, "warning"); return; }

    const btn = document.getElementById("nu-save");
    btn.disabled = true; btn.textContent = "Creating…";
    try {
      await createUser({ name, email, role, categoryGroup: cat });
      showToast("User created", "success");
      closeModal();
    } catch (e) {
      showToast("Error: " + e.message, "error");
      btn.disabled = false; btn.textContent = "Create";
    }
  };
}

function openEditUserModal(user) {
  showModal(
    `Edit: ${user.name}`,
    `<div class="form-group"><label>Full Name</label><input class="form-control" id="eu-name" value="${user.name}"></div>
     <div class="form-group"><label>Role</label>
       <select class="form-control" id="eu-role">
         ${Object.values(CONFIG.ROLES).map(r => `<option value="${r}" ${user.role === r ? "selected" : ""}>${r}</option>`).join("")}
       </select>
     </div>
     <div class="form-group"><label>Category Group</label>
       <select class="form-control" id="eu-cat">
         ${CONFIG.CATEGORY_GROUPS.map(c => `<option value="${c}" ${user.categoryGroup === c ? "selected" : ""}>${c}</option>`).join("")}
       </select>
     </div>`,
    `<button class="btn btn-secondary" id="eu-cancel">Cancel</button>
     <button class="btn btn-primary" id="eu-save">Save</button>`
  );

  document.getElementById("eu-cancel").onclick = closeModal;
  document.getElementById("eu-save").onclick = async () => {
    const name = document.getElementById("eu-name").value.trim();
    const role = document.getElementById("eu-role").value;
    const cat = document.getElementById("eu-cat").value;
    if (!name) { showToast("Name is required", "warning"); return; }
    const btn = document.getElementById("eu-save");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await updateUser(user.email, { name, role, categoryGroup: cat });
      showToast("User updated", "success");
      closeModal();
    } catch (e) {
      showToast("Error: " + e.message, "error");
      btn.disabled = false; btn.textContent = "Save";
    }
  };
}

// ─── Ingestion Log (TL only) ──────────────────────────────────────────────────

async function mountIngestionLog(container) {
  container.innerHTML = `<div class="text-muted" style="padding:20px">Loading…</div>`;
  try {
    const logs = await getRecentIngestionLogs(20);
    if (!logs.length) {
      container.innerHTML = `<p class="text-muted">No ingestion logs found.</p>`;
      return;
    }
    container.innerHTML = `
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Run Time</th>
              <th>Status</th>
              <th>Raw Rows</th>
              <th>After Filter</th>
              <th>New Added</th>
              <th>Refreshed</th>
              <th>Auto Closed</th>
              <th>Reopened</th>
              <th>Duration</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map(l => `
              <tr>
                <td style="font-size:12px">${formatDate(l.runTimestamp)}</td>
                <td><span class="badge ${l.status === "SUCCESS" ? "badge-resolved" : "badge-escalated"}">${l.status}</span></td>
                <td>${l.rawRows?.toLocaleString() || "—"}</td>
                <td>${l.afterFilter?.toLocaleString() || "—"}</td>
                <td><strong>${l.newAdded || 0}</strong></td>
                <td>${l.existingRefreshed || 0}</td>
                <td>${l.autoClosed || 0}</td>
                <td>${l.reopened || 0}</td>
                <td>${l.durationSec || "—"}s</td>
                <td style="font-size:11px;color:var(--text-muted)">${l.notes || "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<p class="text-muted">Error loading logs: ${e.message}</p>`;
  }
}

// ─── Modal close button ───────────────────────────────────────────────────────
document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
document.getElementById("modal-overlay")?.addEventListener("click", e => {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
});
