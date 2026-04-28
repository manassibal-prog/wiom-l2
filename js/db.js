import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore, collection, doc, onSnapshot, getDocs,
  setDoc, updateDoc, addDoc, query, where, orderBy,
  limit, getDoc, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_CONFIG } from './config.js';

const app = initializeApp(FIREBASE_CONFIG);
export const db = getFirestore(app, 'pft-tickets');
export const auth = getAuth(app);

function nowISO() {
  return new Date().toISOString();
}

// ─── Audit Log ─────────────────────────────────────────────────────────────

export async function addAuditLog({ actorEmail, actorRole, action, ticketNo, fieldChanged, oldValue, newValue, notes = "" }) {
  await addDoc(collection(db, "auditLog"), {
    timestamp: nowISO(),
    actorEmail,
    actorRole,
    action,
    ticketNo: ticketNo || null,
    fieldChanged: fieldChanged || null,
    oldValue: oldValue !== undefined ? String(oldValue) : null,
    newValue: newValue !== undefined ? String(newValue) : null,
    notes
  });
}

// ─── Attendance Log ─────────────────────────────────────────────────────────

export async function addAttendanceLog({ email, name, event, notes = "" }) {
  await addDoc(collection(db, "attendanceLog"), {
    timestamp: nowISO(),
    email,
    name,
    event,
    notes
  });
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export function subscribeToTickets(callback) {
  const q = query(collection(db, "tickets"), where("isArchived", "==", false));
  return onSnapshot(q, snapshot => {
    const tickets = [];
    snapshot.forEach(d => tickets.push({ id: d.id, ...d.data() }));
    callback(tickets);
  });
}

export function subscribeToAdvisorTickets(email, callback) {
  const q = query(
    collection(db, "tickets"),
    where("assignedTo", "==", email),
    where("isArchived", "==", false)
  );
  return onSnapshot(q, snapshot => {
    const tickets = [];
    snapshot.forEach(d => tickets.push({ id: d.id, ...d.data() }));
    callback(tickets);
  });
}

export async function getTicket(ticketNo) {
  const d = await getDoc(doc(db, "tickets", ticketNo));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

export async function assignTicket(ticketNo, advisorEmail, advisorName, actor) {
  const ticketRef = doc(db, "tickets", ticketNo);
  const snap = await getDoc(ticketRef);
  const oldAssignee = snap.data()?.assignedTo || "Unassigned";

  await updateDoc(ticketRef, {
    assignedTo: advisorEmail,
    assignedToName: advisorName,
    assignedDate: nowISO(),
    lastUpdateDate: nowISO(),
    platformStatus: "Assigned"
  });

  await addAuditLog({
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "MANUAL_ASSIGN",
    ticketNo,
    fieldChanged: "assignedTo",
    oldValue: oldAssignee,
    newValue: advisorEmail
  });
}

export async function bulkAssignTickets(assignments, actor) {
  // assignments: [{ ticketNo, advisorEmail, advisorName }]
  const BATCH_SIZE = 400;
  const now = nowISO();

  for (let i = 0; i < assignments.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = assignments.slice(i, i + BATCH_SIZE);
    for (const { ticketNo, advisorEmail, advisorName } of chunk) {
      batch.update(doc(db, "tickets", ticketNo), {
        assignedTo: advisorEmail,
        assignedToName: advisorName,
        assignedDate: now,
        lastUpdateDate: now,
        platformStatus: "Assigned"
      });
    }
    await batch.commit();
  }

  // Audit — batched into groups so we don't overwhelm addDoc
  const auditBatch = writeBatch(db);
  for (const { ticketNo, advisorEmail } of assignments) {
    const ref = doc(collection(db, "auditLog"));
    auditBatch.set(ref, {
      timestamp: now,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "BULK_ASSIGN",
      ticketNo,
      fieldChanged: "assignedTo",
      oldValue: "Unassigned",
      newValue: advisorEmail,
      notes: ""
    });
    if (assignments.indexOf({ ticketNo, advisorEmail }) % 400 === 399) {
      await auditBatch.commit();
    }
  }
  await auditBatch.commit().catch(() => {});
}

export async function updateTicketStatus(ticketNo, status, remarks, actor) {
  const ticketRef = doc(db, "tickets", ticketNo);
  const snap = await getDoc(ticketRef);
  const oldStatus = snap.data()?.platformStatus;

  await updateDoc(ticketRef, {
    platformStatus: status,
    advisorRemarks: remarks,
    lastUpdateDate: nowISO()
  });

  await addAuditLog({
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "STATUS_CHANGE",
    ticketNo,
    fieldChanged: "platformStatus",
    oldValue: oldStatus,
    newValue: status
  });
}

export async function updateTicketRemarks(ticketNo, remarks, actor) {
  await updateDoc(doc(db, "tickets", ticketNo), {
    advisorRemarks: remarks,
    lastUpdateDate: nowISO()
  });

  await addAuditLog({
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "REMARK_UPDATE",
    ticketNo,
    fieldChanged: "advisorRemarks",
    oldValue: null,
    newValue: remarks
  });
}

export async function getTicketAuditLog(ticketNo) {
  const q = query(
    collection(db, "auditLog"),
    where("ticketNo", "==", ticketNo),
    orderBy("timestamp", "desc"),
    limit(30)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

// ─── Users ──────────────────────────────────────────────────────────────────

export function subscribeToUsers(callback) {
  return onSnapshot(collection(db, "users"), snapshot => {
    const users = [];
    snapshot.forEach(d => users.push({ id: d.id, ...d.data() }));
    callback(users);
  });
}

export async function getUser(email) {
  const d = await getDoc(doc(db, "users", email));
  return d.exists() ? { id: d.id, ...d.data() } : null;
}

export async function createUser(userData) {
  const now = nowISO();
  await setDoc(doc(db, "users", userData.email), {
    ...userData,
    addedDate: now,
    currentStatus: "Logged Out",
    currentStatusSince: now,
    todayLoginMinutes: 0,
    todayBreakMinutes: 0,
    todayAssignedCount: 0,
    todayResolvedCount: 0,
    currentlyHolding: 0,
    active: true
  });
}

export async function updateUser(email, data) {
  await updateDoc(doc(db, "users", email), data);
}

export async function updateUserPresence(email, name, event) {
  const userRef = doc(db, "users", email);
  const snap = await getDoc(userRef);
  const user = snap.data() || {};
  const now = new Date();
  const iso = now.toISOString();

  const statusMap = {
    LOGIN: "Logged In",
    BREAK_START: "On Break",
    BREAK_END: "Logged In",
    LOGOUT: "Logged Out"
  };

  const updates = {
    currentStatus: statusMap[event],
    currentStatusSince: iso
  };

  if (user.currentStatusSince) {
    const since = new Date(user.currentStatusSince);
    const elapsedMin = Math.round((now - since) / 60000);

    if (event === "LOGOUT" && user.currentStatus === "Logged In") {
      updates.todayLoginMinutes = (user.todayLoginMinutes || 0) + elapsedMin;
    }
    if (event === "BREAK_END" && user.currentStatus === "On Break") {
      updates.todayBreakMinutes = (user.todayBreakMinutes || 0) + elapsedMin;
    }
  }

  await updateDoc(userRef, updates);
  await addAttendanceLog({ email, name, event });
}

// ─── Roster ─────────────────────────────────────────────────────────────────

export function subscribeToRoster(date, callback) {
  return onSnapshot(doc(db, "roster", date), snap => {
    callback(snap.exists() ? snap.data() : { date, advisors: {} });
  });
}

export async function getRoster(date) {
  const d = await getDoc(doc(db, "roster", date));
  return d.exists() ? d.data() : { date, advisors: {} };
}

export async function updateRosterEntry(date, email, code) {
  const rosterRef = doc(db, "roster", date);
  await setDoc(rosterRef, { date, advisors: { [email]: code } }, { merge: true });
}

// ─── Ingestion Log ───────────────────────────────────────────────────────────

export async function getRecentIngestionLogs(limitCount = 10) {
  const q = query(
    collection(db, "ingestionLog"),
    orderBy("runTimestamp", "desc"),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data());
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSettings() {
  const d = await getDoc(doc(db, "settings", "global"));
  return d.exists() ? d.data() : {};
}

export async function updateSettings(data) {
  const ref = doc(db, "settings", "global");
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, data);
  } else {
    await setDoc(ref, data);
  }
}

// ─── Archive ─────────────────────────────────────────────────────────────────

export function subscribeToArchive(callback) {
  const q = query(
    collection(db, "archive"),
    orderBy("archivedDate", "desc"),
    limit(500)
  );
  return onSnapshot(q, snapshot => {
    const tickets = [];
    snapshot.forEach(d => tickets.push({ id: d.id, ...d.data() }));
    callback(tickets);
  });
}
