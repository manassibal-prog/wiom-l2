export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDRtG3giqbCFwYX0bD0bC1HSfRAEk-znyQ",
  authDomain: "wiom-l2-platform.firebaseapp.com",
  projectId: "wiom-l2-platform",
  storageBucket: "wiom-l2-platform.firebasestorage.app",
  messagingSenderId: "135966014874",
  appId: "1:135966014874:web:72445c322e3b150e3ace23"
};

export const CONFIG = {
  ALLOWED_DOMAIN: "wiom.in",
  DATABASE_ID: "pft-tickets",

  STATUSES: {
    OPEN: [
      "New/Unassigned",
      "Assigned",
      "Pending",
      "DNP 1",
      "DNP 2",
      "Follow-up needed - confirmation pending from Cx",
      "Follow-up needed - Migration team working",
      "Follow-up needed - refund initiated",
      "Follow-up needed - Shared with Px",
      "Follow-up needed - TAT provided to Cx"
    ],
    CLOSED: [
      "Resolved - Refund Initiated",
      "Resolved by PFT",
      "Resolved - DNP 3",
      "Already completed",
      "Already Resolved",
      "Send to WIOM"
    ]
  },

  get ALL_STATUSES() {
    return [...this.STATUSES.OPEN, ...this.STATUSES.CLOSED];
  },

  ROLES: {
    TL:         "TL",
    MANAGER:    "Manager",
    SR_MANAGER: "Senior Manager",
    ADVISOR:    "Advisor"
  },

  SENIOR_ROLES: ["TL", "Manager", "Senior Manager"],

  ROSTER_CODES:  ["P", "WFH", "WO", "L", "UP", "HD", "Holiday"],
  ROSTER_LABELS: {
    P:       "Present",
    WFH:     "Work From Home",
    WO:      "Week Off",
    L:       "Leave",
    UP:      "Unpaid Leave",
    HD:      "Half Day",
    Holiday: "Holiday"
  },
  // Advisor is available for assignment only on these codes
  AVAILABLE_CODES: ["P", "WFH"],

  AGING_BUCKETS: [
    "0-12 hrs", "12-24 hrs", "24-36 hrs",
    "36-48 hrs", "48-72 hrs", "72-120 hrs", ">120 hrs"
  ],

  CATEGORY_GROUPS: ["INTERNET", "OTHERS", "ALL"],

  BREAK_CAP_MINUTES: 60,
  PAGE_SIZE: 50,

  KAPTURE_URL_PATTERN:
    "https://wiomin.kapturecrm.com/nui/tickets/all/5/-1/0/detail/0/{ticketNo}?query={ticketNo}"
};
