"use strict";

/* ==========================================================================
   THE READING ROOM · Library Management System
   All data is kept in localStorage on this device.
   ========================================================================== */

const LOAN_DAYS = 14;
const STORE_BOOKS = "libraryBooks";
const STORE_ISSUES = "libraryIssues";
const STORE_SEEDED = "readingRoomSeeded";
const STORE_FINES = "readingRoomFines";
const STORE_QUEUE = "readingRoomQueue";
const STORE_RATE = "readingRoomFineRate";
const STORE_THEME = "readingRoomTheme";

/* ---------- data ---------- */
let books = JSON.parse(localStorage.getItem(STORE_BOOKS) || "{}");
let issueRecords = JSON.parse(localStorage.getItem(STORE_ISSUES) || "[]");
let fines = JSON.parse(localStorage.getItem(STORE_FINES) || "[]");   // settled accounts
let queue = JSON.parse(localStorage.getItem(STORE_QUEUE) || "[]");   // reservations
let fineRate = Number(localStorage.getItem(STORE_RATE) || 2);        // ₹ per day, per copy

let selectedBookId = null;
let currentSection = "dashboard";

const $ = (id) => document.getElementById(id);

/* ---------- helpers ---------- */
function saveData() {
  localStorage.setItem(STORE_BOOKS, JSON.stringify(books));
  localStorage.setItem(STORE_ISSUES, JSON.stringify(issueRecords));
  localStorage.setItem(STORE_FINES, JSON.stringify(fines));
  localStorage.setItem(STORE_QUEUE, JSON.stringify(queue));
  localStorage.setItem(STORE_RATE, String(fineRate));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function readText(value) { return String(value || "").trim(); }

function showMessage(message, isError = false) {
  const el = $("message");
  if (!message) { el.classList.remove("show"); return; }
  if (isError) Sound.error();
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.remove("show");
  void el.offsetWidth; // restart transition
  el.classList.add("show");
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(() => el.classList.remove("show"), 3800);
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function addDaysISO(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function prettyDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00");
  const b = new Date(isoB + "T00:00:00");
  return Math.round((a - b) / 86400000);
}

function activeLoansFor(bookId) {
  return issueRecords.filter((r) => r.bookId === bookId && !r.returned);
}

function ownedCopies(book) {
  return book.availableCopies + activeLoansFor(book.id).length;
}

function loansOfStudent(studentId) {
  return issueRecords.filter(
    (r) => r.studentId.toLowerCase() === studentId.toLowerCase() && !r.returned
  );
}

function isOverdue(record) { return record.dueOn ? record.dueOn < todayISO() : false; }

function daysLate(record) {
  if (!record.dueOn) return 0;
  return Math.max(0, daysBetween(todayISO(), record.dueOn));
}

function fineFor(record) {
  return daysLate(record) * fineRate;
}

function settledFor(studentId) {
  return fines.filter((f) => f.studentId === studentId).reduce((t, f) => t + f.amount, 0);
}

/** one account per borrower: every overdue copy they hold, added up */
function openAccounts() {
  const map = new Map();
  issueRecords.filter((r) => !r.returned && isOverdue(r)).forEach((r) => {
    const book = books[r.bookId];
    const key = r.studentId;
    if (!map.has(key)) map.set(key, { studentId: key, amount: 0, days: 0, items: [] });
    const acct = map.get(key);
    const amount = fineFor(r);
    acct.amount += amount;
    acct.days = Math.max(acct.days, daysLate(r));
    acct.items.push({ bookId: r.bookId, title: book ? book.title : r.bookId, days: daysLate(r), amount });
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function totalOutstanding() {
  return openAccounts().reduce((t, a) => t + a.amount, 0);
}

/* ---------- reservation queue ---------- */
function queueFor(bookId) {
  return queue.filter((q) => q.bookId === bookId)
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

function queueElsewhere(studentId) {
  return queue.filter((q) => q.studentId.toLowerCase() === studentId.toLowerCase());
}

function addToQueue(bookId, studentId) {
  if (!books[bookId] || !studentId) return { ok: false, msg: "Pick a book and a borrower." };
  if (!bookId) return { ok: false, msg: "Pick a book first." };
  if (queueFor(bookId).some((q) => q.studentId.toLowerCase() === studentId.toLowerCase())) {
    return { ok: false, msg: `${studentId} is already waiting for that copy.` };
  }
  if (queueElsewhere(studentId).length >= 3) {
    return { ok: false, msg: `${studentId} already has three reservations — collect one first.` };
  }
  queue.push({ bookId, studentId, addedAt: new Date().toISOString() });
  saveData();
  updateDashboard();
  return { ok: true, msg: `${studentId} queued for ${bookId}.` };
}

function removeFromQueue(bookId, studentId) {
  queue = queue.filter((q) => !(q.bookId === bookId && q.studentId === studentId));
  saveData();
  updateDashboard();
}

/** the first person in line gets first refusal on a returned copy */
function claimNextInQueue(bookId) {
  const next = queueFor(bookId)[0];
  if (!next) return null;
  removeFromQueue(bookId, next.studentId);
  return next;
}

/* Eight case-binding styles. Each is a generated cloth/leather texture that is
   tinted per book, so the shelf looks like a real collection rather than a
   colour swatch grid. */
const BINDINGS = [
  { key: "oxblood",  c1: "#7a3128", c2: "#431612", foil: "#e9c987", tx: "#f6e3b6" },
  { key: "forest",   c1: "#3d5a45", c2: "#1e3327", foil: "#cfe0a6", tx: "#eef3d8" },
  { key: "navy",     c1: "#2c4468", c2: "#16253f", foil: "#e6c17e", tx: "#f2e2bd" },
  { key: "tan",      c1: "#b0824a", c2: "#7d5528", foil: "#5b3c1a", tx: "#3a2811" },
  { key: "plum",     c1: "#5b3d63", c2: "#33203a", foil: "#e6b7a3", tx: "#f4e2dd" },
  { key: "rust",     c1: "#8a4a2b", c2: "#562a16", foil: "#f0d19a", tx: "#f8e7c8" },
  { key: "teal",     c1: "#2f5152", c2: "#182f31", foil: "#e3eee8", tx: "#eef5ef" },
  { key: "charcoal", c1: "#3b3a37", c2: "#211f1d", foil: "#d9b06a", tx: "#efe3c6" }
];

function bindingFor(id) {
  // FNV-1a spreads short codes like BK-101…BK-109 evenly across the eight bindings
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return BINDINGS[hash % BINDINGS.length];
}

/* Cover art: the single-file build injects COVER_ART as data URIs; the plain
   three-file version reads the same textures from ./assets/covers/opt/. */
const COVER_ART = null; // replaced by build.js when bundling
const ASSET_BASE = (() => {
  const tag = Array.from(document.scripts).find((s) => s.src && /script\.js/.test(s.src));
  if (!tag) return "";
  const url = new URL(tag.src);
  return url.href.slice(0, url.href.lastIndexOf("/") + 1);
})();

const coverArt = (key) =>
  COVER_ART
    ? `url("${COVER_ART[key] || COVER_ART.forest}")`
    : `url("${ASSET_BASE}assets/covers/opt/${key}.webp")`;


/* ==========================================================================
   SOUND · every noise is synthesised with WebAudio, so there are no audio
   files to download and nothing to 404 in the single-file build.
   ========================================================================== */
const Sound = (() => {
  const KEY = "readingRoomSound";
  let enabled = localStorage.getItem(KEY) !== "off";
  let ctx = null;
  let noiseBuf = null;

  function context() {
    if (!enabled) return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!ctx) {
      ctx = new Ctx();
      const len = Math.floor(ctx.sampleRate * 0.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  const env = (gain, t0, attack, peak, decay) => {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  };

  function noise({ dur = 0.2, type = "bandpass", freq = 1800, q = 0.9, peak = 0.2, delay = 0 }) {
    const c = context(); if (!c) return;
    const t0 = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = noiseBuf;
    const filter = c.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const gain = c.createGain(); env(gain, t0, 0.012, peak, dur);
    src.connect(filter); filter.connect(gain); gain.connect(c.destination);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  function tone({ freq = 440, dur = 0.12, type = "sine", peak = 0.08, delay = 0, glideTo = null }) {
    const c = context(); if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    const gain = c.createGain(); env(gain, t0, 0.01, peak, dur);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  return {
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      localStorage.setItem(KEY, enabled ? "on" : "off");
      if (enabled) this.tick();
      return enabled;
    },
    /** revive audio on the first real gesture (browsers block it otherwise) */
    wake() { context(); },
    tick() { noise({ dur: 0.035, freq: 3400, q: 2.4, peak: 0.07 }); },
    page() {          // a page turning: two soft paper swishes
      noise({ dur: 0.16, type: "highpass", freq: 2200, peak: 0.13 });
      noise({ dur: 0.2, freq: 1200, q: 1.2, peak: 0.1, delay: 0.09 });
    },
    open() {          // a hardcover swinging open: creak + settle
      noise({ dur: 0.3, freq: 620, q: 1.6, peak: 0.16 });
      tone({ freq: 150, glideTo: 96, dur: 0.26, peak: 0.07 });
      noise({ dur: 0.14, freq: 2000, peak: 0.1, delay: 0.17 });
    },
    close() {
      noise({ dur: 0.18, freq: 900, q: 1.4, peak: 0.13 });
      tone({ freq: 110, glideTo: 70, dur: 0.18, peak: 0.06, delay: 0.03 });
    },
    stamp() {         // the ledger stamp: a thud + a little click
      tone({ freq: 90, glideTo: 42, dur: 0.16, type: "triangle", peak: 0.3 });
      noise({ dur: 0.09, freq: 420, type: "lowpass", peak: 0.24 });
      tone({ freq: 1200, dur: 0.05, type: "square", peak: 0.03, delay: 0.02 });
    },
    error() {
      tone({ freq: 300, glideTo: 190, dur: 0.2, type: "triangle", peak: 0.11 });
    },
    slip() {          // card pulled from the drawer
      noise({ dur: 0.13, type: "highpass", freq: 2600, peak: 0.1 });
    },
    whoosh() {        // a book sliding back onto the shelf
      noise({ dur: 0.26, freq: 700, q: 0.7, peak: 0.12 });
      tone({ freq: 70, dur: 0.18, peak: 0.1, delay: 0.06 });
    }
  };
})();

/* wire the toggle in the masthead */
function syncSoundButton() {
  const btn = $("soundBtn");
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(Sound.enabled));
  btn.setAttribute("aria-label", Sound.enabled ? "Mute interface sounds" : "Turn interface sound on");
  btn.title = Sound.enabled ? "Mute interface sounds" : "Turn interface sound on";
  $("soundLabel").textContent = Sound.enabled ? "Sound on" : "Muted";
}

/* ==========================================================================
   NAVIGATION
   ========================================================================== */
const SECTION_LABELS = {
  dashboard: "Dashboard", addBook: "Add Book", books: "Inventory",
  search: "Search", issue: "Issue", return: "Return", issued: "On Loan",
  ledgerdesk: "Ledger"
};

function showSection(sectionId) {
  const changed = sectionId !== currentSection;
  currentSection = sectionId;
  if (changed) Sound.slip();
  document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
  const target = $(sectionId);
  if (target) target.classList.add("active");

  document.querySelectorAll(".tab").forEach((tab) => {
    const on = tab.dataset.section === sectionId;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-current", String(on));
  });

  $("contentsCurrent").textContent = SECTION_LABELS[sectionId] || sectionId;

  // the tab strip scrolls sideways on small screens — keep the active tab in view
  // by scrolling the strip itself, never the page
  const strip = document.querySelector(".tabs-inner");
  const activeTab = document.querySelector(`.tab[data-section="${sectionId}"]`);
  if (strip && activeTab) {
    const target = activeTab.offsetLeft - (strip.clientWidth - activeTab.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }
  showMessage("");

  if (sectionId === "books") displayAllBooks();
  if (sectionId === "issued") displayIssuedBooks();
  if (sectionId === "ledgerdesk") renderLedgerDesk();
  if (sectionId === "dashboard") { updateDashboard(); renderShelf(); renderSlip(); }
  if (sectionId === "return") renderLoanFinder();
  if (sectionId === "search") renderAuthorChips();
  if (sectionId === "issue") renderDuePreview();

  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) window.scrollTo(0, 0);
  else window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showSection(tab.dataset.section));
});

/* ==========================================================================
   DASHBOARD · STATS
   ========================================================================== */
const lastStats = { totalTitles: null, availableCopies: null, activeIssues: null, returnedCount: null };

function setStat(id, value) {
  const el = $(id);
  if (lastStats[id] !== null && lastStats[id] !== value) {
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }
  lastStats[id] = value;
  el.textContent = String(value);
}

function updateDashboard() {
  const list = Object.values(books);
  const active = issueRecords.filter((r) => !r.returned).length;
  const returned = issueRecords.filter((r) => r.returned).length;

  setStat("totalTitles", list.length);
  setStat("availableCopies", list.reduce((t, b) => t + b.availableCopies, 0));
  setStat("activeIssues", active);
  setStat("returnedCount", returned);

  $("loanCount").textContent = String(active);

  /* money + reservations */
  const owed = totalOutstanding();
  const accounts = openAccounts();
  $("finesOwed").textContent = "₹" + owed;
  $("finesFoot").textContent = owed
    ? `${accounts.length} account${accounts.length === 1 ? "" : "s"} · ₹${fineRate}/day`
    : "nothing overdue";
  $("waitingCount").textContent = String(queue.length);
  const badge = $("fineCount");
  badge.textContent = String(accounts.length);
  badge.dataset.zero = String(accounts.length === 0);
}

/* ==========================================================================
   DASHBOARD · SHELF
   ========================================================================== */
function renderShelf() {
  const shelf = $("shelf");
  const list = Object.values(books);

  if (list.length === 0) {
    shelf.innerHTML = `
      <div class="shelf-empty">
        <p>The shelf is bare.</p>
        <p>Add your first book and it will appear here, spine and all.</p>
        <button class="btn-primary shelf-empty-btn" type="button" id="shelfEmptyBtn">Catalogue the first book</button>
      </div>`;
    $("shelfEmptyBtn").addEventListener("click", () => showSection("addBook"));
    return;
  }

  // tallest titles first for a natural skyline
  const sorted = [...list].sort((a, b) => b.title.length - a.title.length);

  shelf.innerHTML = sorted.map((book, i) => {
    const binding = bindingFor(book.id);
    const titleLen = Math.max(4, book.title.length);
    const height = Math.round(Math.min(292, 202 + titleLen * 3.6));
    const width = Math.max(42, Math.min(70, 42 + ownedCopies(book) * 4));
    const depth = 18 + Math.min(16, ownedCopies(book) * 3);
    // shrink the foil type just enough that most titles fit without clipping
    const fontSize = Math.max(10, Math.min(13.5, (height - 104) / (titleLen * 0.62)));
    const out = book.availableCopies === 0;
    return `
      <button class="spine ${out ? "spine-out" : ""} ${selectedBookId === book.id ? "selected" : ""}"
        type="button" data-book="${escapeHTML(book.id)}" data-binding="${binding.key}"
        title="${escapeHTML(book.title)} — ${escapeHTML(book.author)}"
        aria-label="${escapeHTML(book.title)} by ${escapeHTML(book.author)}"
        style="--h:${height}px; --w:${width}px; --d:${depth}px; --fs:${fontSize.toFixed(1)}px; --c1:${binding.c1}; --c2:${binding.c2}; --foil:${binding.foil}; --tx:${binding.tx}; animation-delay:${Math.min(i * 35, 420)}ms">
        <span class="spine-pages" aria-hidden="true"></span>
        <span class="spine-board">
          <span class="spine-band top" aria-hidden="true"></span>
          <span class="spine-text">
            <span class="spine-rule a" aria-hidden="true"></span>
            <span class="spine-title">${escapeHTML(book.title)}</span>
            <span class="spine-author">${escapeHTML(book.author)}</span>
            <span class="spine-rule b" aria-hidden="true"></span>
          </span>
          <span class="spine-band bottom" aria-hidden="true"></span>
        </span>
        ${out ? '<span class="spine-flag" aria-hidden="true"></span>' : ""}
      </button>`;
  }).join("") + `
      <button class="shelf-placard" type="button" id="shelfPlacard">
        <span class="placard-plus" aria-hidden="true">+</span>
        <span class="placard-text">Shelve another title</span>
      </button>`;

  // point every cloth cover at its generated texture
  shelf.querySelectorAll(".spine").forEach((spine) => {
    const board = spine.querySelector(".spine-board");
    if (board) {
      board.style.backgroundImage =
        `linear-gradient(90deg, rgba(255,255,255,.16), transparent 16%, transparent 82%, rgba(0,0,0,.30)),` +
        ` linear-gradient(168deg, var(--c1), var(--c2) 72%),` +
        ` ${coverArt(spine.dataset.binding)}`;
    }
  });

  $("shelfPlacard").addEventListener("click", () => {
    showSection("addBook");
    setTimeout(() => $("bookId").focus(), 250);
  });

  shelf.querySelectorAll(".spine").forEach((spine) => {
    spine.addEventListener("click", () => {
      Sound.tick();
      flySpineToReader(spine.dataset.book);
      // let the book lift, then swing open
      setTimeout(() => openBook(spine.dataset.book), 300);
    });
  });
}

function renderSlip() {
  const book = selectedBookId ? books[selectedBookId] : null;
  $("slipEmpty").hidden = Boolean(book);
  $("slipBody").hidden = !book;
  if (!book) return;

  const loans = activeLoansFor(book.id);
  const binding = bindingFor(book.id);

  $("slipCode").textContent = book.id;
  $("slipCode").style.background = binding.c2;
  $("slipCode").style.color = binding.tx;
  $("slipTitle").textContent = book.title;
  $("slipAuthor").textContent = book.author;
  $("slipYear").textContent = book.year;
  $("slipCopies").textContent = `${book.availableCopies} of ${ownedCopies(book)}`;
  const status = $("slipStatus");
  status.textContent = book.availableCopies > 0 ? "On shelf" : "All copies out";
  status.className = book.availableCopies > 0 ? "is-ok" : "is-out";

  const list = $("slipLoans");
  if (loans.length === 0) {
    list.innerHTML = '<li><span>No copies currently out.</span><span></span></li>';
  } else {
    list.innerHTML = loans.map((r) => {
      const late = isOverdue(r);
      return `<li class="${late ? "is-overdue" : ""}">
        <span>${escapeHTML(r.studentId)}</span>
        <span>${late ? "overdue" : "due " + prettyDate(r.dueOn)}</span>
      </li>`;
    }).join("");
  }

  const btn = $("slipReturn");
  btn.disabled = loans.length === 0;
  btn.textContent = loans.length === 0 ? "No copies out to return" : "Log a return";
  btn.onclick = () => {
    if (loans.length === 0) return;
    showSection("return");
    $("returnBookId").value = book.id;
    $("returnStudentId").value = loans[0].studentId;
    $("returnStudentId").focus();
  };
}


/* ==========================================================================
   THE READER · click a spine and the book lifts off the shelf, then opens
   ========================================================================== */
const BLURBS = {
  forest:   "A well-travelled copy — the spine has softened with use.",
  oxblood:  "Bound in oxblood cloth with a gold rule; still tight in the hinge.",
  navy:     "Full navy leather, gilt corners. Handle with a clean conscience.",
  tan:      "Natural buckram, the colour of strong tea.",
  plum:     "Aubergine cloth with rose-gold tooling.",
  rust:     "Sienna cloth, faintly sunned along the top board.",
  teal:     "Sea-green cloth; the foil has worn pale at the head.",
  charcoal: "Charcoal boards with a blind rule. Quiet and serious."
};

let readerOpenFor = null;
let restoreFocusTo = null;

function flySpineToReader(bookId) {
  // find the spine without relying on CSS.escape (not in older browsers / jsdom)
  const spine = Array.from(document.querySelectorAll(".spine"))
    .find((el) => el.dataset.book === bookId);
  if (!spine) return;
  spine.classList.add("is-flying");
  // a short arc: the book lifts, drifts toward the centre of the panel
  const reader = $("reader");
  const from = spine.getBoundingClientRect();
  const to = reader.getBoundingClientRect();
  const dx = (to.left + to.width / 2) - (from.left + from.width / 2);
  const dy = (to.top + to.height / 2) - (from.top + from.height / 2);
  spine.animate(
    [
      { transform: "translate(0,0) rotate(0deg)", offset: 0 },
      { transform: `translate(${dx * 0.6}px, ${dy * 0.42 - 24}px) rotate(-6deg)`, offset: 0.6 },
      { transform: `translate(${dx}px, ${dy * 0.8}px) rotate(-2deg) scale(.9)`, offset: 1 }
    ],
    { duration: 340, easing: "cubic-bezier(.3,.8,.3,1)", fill: "forwards" }
  );
}

function openBook(bookId) {
  const book = books[bookId];
  if (!book) return;
  selectedBookId = bookId;

  const binding = bindingFor(book.id);
  const reader = $("reader");
  const rig = $("openbook");
  restoreFocusTo = document.activeElement;

  if (readerOpenFor) Sound.close();
  reader.hidden = false;
  readerOpenFor = bookId;
  document.body.classList.add("reader-open");
  Sound.wake();
  Sound.open();

  rig.style.setProperty("--ob-c1", binding.c1);
  rig.style.setProperty("--ob-c2", binding.c2);
  rig.style.setProperty("--ob-foil", binding.foil);
  rig.querySelector(".ob-spine-text").textContent = book.id;

  const loans = activeLoansFor(book.id);
  const owns = ownedCopies(book);
  $("obTitle").textContent = book.title;
  $("obAuthor").textContent = book.author;
  $("obCode").textContent = book.id;
  $("obYear").textContent = book.year;
  $("obCopies").textContent = `${book.availableCopies} of ${owns} on shelf`;
  const status = $("obStatus");
  status.textContent = book.availableCopies > 0 ? "On shelf" : "All copies out";
  status.className = book.availableCopies > 0 ? "is-ok" : "is-out";
  $("obBlurb").textContent = BLURBS[binding.key] || "";
  rig.querySelectorAll("[data-folio]").forEach((el) => {
    el.textContent = "No. " + book.id.replace(/[^0-9]/g, "").padStart(3, "0");
  });

  const stamp = $("obStamp");
  stamp.textContent = book.availableCopies > 0 ? "ON SHELF" : "ALL OUT";
  stamp.classList.toggle("is-out", book.availableCopies === 0);

  const list = $("obLoans");
  if (loans.length === 0) {
    list.innerHTML = '<li><span>Nothing out at the moment.</span><span></span></li>';
  } else {
    list.innerHTML = loans.map((r) => {
      const late = isOverdue(r);
      return `<li class="${late ? "late" : ""}">
        <span><b>${escapeHTML(r.studentId)}</b></span>
        <span>${late ? "overdue " + Math.abs(daysBetween(r.dueOn, todayISO())) + "d" : "due " + prettyDate(r.dueOn)}</span>
        <span>issued ${r.issuedOn ? prettyDate(r.issuedOn) : "—"}</span>
        <span>${late ? "collect now" : "on time"}</span>
      </li>`;
    }).join("");
  }

  $("obNote").textContent = loans.length
    ? "A copy is held for each borrower until it comes back."
    : (book.availableCopies === 0 ? "Every copy is on loan — check the waiting shelf." : "Ready to borrow from the desk.");

  const actions = $("obActions");
  const waitingForThis = queueFor(book.id).length;
  actions.innerHTML = `
    <button class="ob-btn solid" type="button" data-act="issue" ${book.availableCopies === 0 ? "disabled" : ""}>Issue a copy</button>
    <button class="ob-btn" type="button" data-act="return" ${loans.length ? "" : "disabled"}>Log a return</button>
    <button class="ob-btn" type="button" data-act="reserve">${waitingForThis ? `Queue (${waitingForThis})` : "Reserve"}</button>
    <button class="ob-btn" type="button" data-act="search">Find in index</button>`;
  actions.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      if (act === "issue") {
        closeBook(true);
        showSection("issue");
        $("issueBookId").value = book.id;
        $("issueBookId").dispatchEvent(new Event("input"));
        $("issueStudentId").focus();
      }
      if (act === "return") {
        closeBook(true);
        showSection("return");
        $("returnBookId").value = book.id;
        $("returnStudentId").value = loans[0].studentId;
      }
      if (act === "reserve") {
        closeBook(true);
        showSection("ledgerdesk");
        const sel = document.getElementById("queueBook");
        if (sel) sel.value = book.id;
        const who = document.getElementById("queueWho");
        if (who) who.focus();
      }
      if (act === "search") {
        closeBook(true);
        showSection("search");
        $("searchQuery").value = book.title;
        runSearch(book.title);
      }
    });
  });

  renderSlip();
  document.querySelectorAll(".spine").forEach((sp) => sp.classList.toggle("selected", sp.dataset.book === bookId));
  setTimeout(() => rig.querySelector(".reader-close").focus(), 120);
}

function closeBook(silent = false) {
  const reader = $("reader");
  if (reader.hidden) return;
  reader.hidden = true;
  document.body.classList.remove("reader-open");
  document.querySelectorAll(".spine.is-flying").forEach((sp) => sp.classList.remove("is-flying"));
  if (typeof Element.prototype.getAnimations === "function") {
    document.querySelectorAll(".spine").forEach((sp) => {
      sp.getAnimations().forEach((a) => a.cancel());
    });
  }
  if (!silent) Sound.close();
  readerOpenFor = null;
  if (restoreFocusTo && restoreFocusTo.focus) restoreFocusTo.focus();
}

$("reader").addEventListener("click", (e) => {
  if (e.target.closest("[data-close-reader]")) closeBook();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && readerOpenFor) { closeBook(); }
});

/* A fixed overlay re-centres itself, so never close on resize — mobile
   browsers fire resize when the address bar collapses. */

/* ==========================================================================
   ADD BOOK
   ========================================================================== */
function updateCoverPreview() {
  const id = readText($("bookId").value).toUpperCase();
  const title = readText($("title").value);
  const author = readText($("author").value);
  const year = readText($("year").value);
  const copies = readText($("copies").value);
  const binding = bindingFor(id || "BK-000");

  const book = $("pvBook");
  book.dataset.binding = binding.key;
  book.querySelector(".hb-grain").style.setProperty(
    "--grain-url", coverArt(binding.key)
  );

  $("pvTitle").textContent = title || "Your title appears here";
  $("pvAuthor").textContent = author || "Author's name";
  $("pvCode").textContent = id || "BK-000";
  $("pvYear").textContent = year || "Year";
  $("pvCopies").textContent = `${copies === "" ? "0" : copies} ${Number(copies) === 1 ? "copy" : "copies"}`;
  $("pvToday").textContent = "ACC. " + prettyDate(todayISO()).toUpperCase();
  $("pvStamp").classList.toggle("inked", Boolean(title && author));
}

["bookId", "title", "author", "year", "copies"].forEach((id) => {
  $(id).addEventListener("input", updateCoverPreview);
});

$("addBookForm").addEventListener("submit", function (event) {
  event.preventDefault();

  const id = readText($("bookId").value).toUpperCase();
  const title = readText($("title").value);
  const author = readText($("author").value);
  const year = Number($("year").value);
  const copies = Number($("copies").value);
  const fields = ["bookId", "title", "author", "year", "copies"];
  fields.forEach((f) => $(f).classList.remove("invalid"));

  const flag = (field) => { $(field).classList.add("invalid"); $(field).focus(); };

  if (!id || !title || !author) {
    flag(!id ? "bookId" : !title ? "title" : "author");
    showMessage("All fields are required.", true);
    return;
  }
  if (Object.hasOwn(books, id)) {
    flag("bookId");
    showMessage("That accession code is already in the ledger.", true);
    return;
  }
  if (!Number.isInteger(year) || year < 1 || year > 2026) {
    flag("year");
    showMessage("Enter a valid publication year (1–2026).", true);
    return;
  }
  if (!Number.isInteger(copies) || copies < 0 || copies > 10000) {
    flag("copies");
    showMessage("Copies must be a whole number between 0 and 10,000.", true);
    return;
  }

  books[id] = {
    id, title, author, year,
    availableCopies: copies,
    addedOn: todayISO()
  };

  saveData();
  this.reset();
  updateCoverPreview();
  displayAllBooks();
  updateDashboard();
  renderShelf();
  refreshDatalists();
  selectedBookId = id;
  renderSlip();

  Sound.stamp();
  showMessage(`“${title}” stamped into the ledger as ${id}.`);
});

/* ==========================================================================
   INVENTORY
   ========================================================================== */
function displayAllBooks() {
  const tbody = $("bookTable");
  const entries = Object.values(books);
  const empty = $("booksEmpty");

  $("invSummary").textContent = entries.length
    ? `${entries.length} title${entries.length === 1 ? "" : "s"} · ${entries.reduce((t, b) => t + ownedCopies(b), 0)} copies owned`
    : "Nothing catalogued yet.";

  if (entries.length === 0) {
    tbody.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = entries.map((book) => {
    const owns = ownedCopies(book);
    const pct = owns === 0 ? 0 : Math.round((book.availableCopies / owns) * 100);
    const loans = activeLoansFor(book.id);
    const canReturn = loans.length > 0;
    return `
      <tr>
        <td class="td-code"><span class="cell-code">${escapeHTML(book.id)}</span></td>
        <td class="td-title cell-title">${escapeHTML(book.title)}</td>
        <td class="td-author cell-author">${escapeHTML(book.author)}</td>
        <td class="td-year cell-year" data-label="Year">${book.year}</td>
        <td class="td-copies" data-label="On shelf">
          <span class="copies">
            <span class="copies-bar ${book.availableCopies === 0 ? "is-out" : ""}"><i style="width:${pct}%"></i></span>
            <span class="copies-num">${book.availableCopies}</span>
          </span>
        </td>
        <td class="td-owned cell-year" data-label="Owned">${owns}</td>
        <td class="td-actions">
          <span class="row-actions">
            <button class="mini-btn" data-action="issue" data-book="${escapeHTML(book.id)}"
              ${book.availableCopies === 0 ? "disabled" : ""}>Issue</button>
            <button class="mini-btn" data-action="return" data-book="${escapeHTML(book.id)}"
              ${canReturn ? "" : "disabled"}>Return</button>
            <button class="mini-btn danger" data-action="remove" data-book="${escapeHTML(book.id)}"
              ${loans.length === 0 ? "" : "disabled"} title="${loans.length ? "Copies are still out on loan" : "Remove this title"}">Remove</button>
          </span>
        </td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleRowAction(btn.dataset.action, btn.dataset.book));
  });
}

function handleRowAction(action, bookId) {
  const book = books[bookId];
  if (!book) return;

  if (action === "issue") {
    showSection("issue");
    $("issueBookId").value = book.id;
    $("issueBookId").dispatchEvent(new Event("input"));
    $("issueStudentId").focus();
    return;
  }
  if (action === "return") {
    const loans = activeLoansFor(book.id);
    if (!loans.length) return;
    showSection("return");
    $("returnBookId").value = book.id;
    $("returnStudentId").value = loans[0].studentId;
    return;
  }
  if (action === "remove") {
    if (activeLoansFor(book.id).length) {
      showMessage("Copies are still out on loan — collect them first.", true);
      return;
    }
    if (!confirm(`Remove “${book.title}” (${book.id}) from the catalogue?`)) return;
    delete books[book.id];
    if (selectedBookId === book.id) selectedBookId = null;
    saveData();
    displayAllBooks();
    updateDashboard();
    renderShelf();
    renderSlip();
    refreshDatalists();
    showMessage(`“${book.title}” removed from the catalogue.`);
  }
}

/* ==========================================================================
   SEARCH
   ========================================================================== */
function runSearch(rawQuery) {
  const query = readText(rawQuery).toLowerCase();
  const container = $("searchResults");

  if (!query) {
    container.innerHTML = '<p class="ledger-empty">Enter a code or title to search.</p>';
    return;
  }

  const results = Object.values(books).filter((b) =>
    b.id.toLowerCase() === query ||
    b.title.toLowerCase().includes(query) ||
    b.author.toLowerCase().includes(query)
  );

  if (results.length === 0) {
    container.innerHTML = `<p class="ledger-empty">No book matches “${escapeHTML(readText(rawQuery))}”.</p>`;
    return;
  }

  container.innerHTML = `
    <table class="ledger-table">
      <thead>
        <tr><th>Code</th><th>Title</th><th>Author</th><th>Year</th><th>On shelf</th><th class="th-actions">Actions</th></tr>
      </thead>
      <tbody>
        ${results.map((book) => `
          <tr>
            <td class="td-code"><span class="cell-code">${escapeHTML(book.id)}</span></td>
            <td class="td-title cell-title">${escapeHTML(book.title)}</td>
            <td class="td-author cell-author">${escapeHTML(book.author)}</td>
            <td class="td-year cell-year" data-label="Year">${book.year}</td>
            <td class="td-copies cell-year" data-label="On shelf">${book.availableCopies}</td>
            <td class="td-actions">
              <span class="row-actions">
                <button class="mini-btn" data-action="issue" data-book="${escapeHTML(book.id)}" ${book.availableCopies === 0 ? "disabled" : ""}>Issue</button>
                <button class="mini-btn" data-action="return" data-book="${escapeHTML(book.id)}" ${activeLoansFor(book.id).length ? "" : "disabled"}>Return</button>
              </span>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  container.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleRowAction(btn.dataset.action, btn.dataset.book));
  });
}

$("searchBtn").addEventListener("click", () => runSearch($("searchQuery").value));
$("searchQuery").addEventListener("input", () => {
  if ($("searchQuery").value.trim()) runSearch($("searchQuery").value);
  else $("searchResults").innerHTML = "";
});
$("searchQuery").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runSearch($("searchQuery").value); }
});

function renderAuthorChips() {
  const row = $("authorChips");
  const authors = [...new Set(Object.values(books).map((b) => b.author))].sort();
  if (authors.length === 0) {
    row.innerHTML = '<span class="muted">No authors catalogued yet.</span>';
    return;
  }
  row.innerHTML = authors.map((a) =>
    `<button class="chip" type="button" data-author="${escapeHTML(a)}">${escapeHTML(a)}</button>`
  ).join("");

  row.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      row.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
      chip.classList.add("on");
      $("searchQuery").value = chip.dataset.author;
      runSearch(chip.dataset.author);
    });
  });
}

/* ==========================================================================
   ISSUE
   ========================================================================== */
function renderDuePreview() {
  const book = books[readText($("issueBookId").value).toUpperCase()];
  const date = addDaysISO(loanDays || LOAN_DAYS);
  $("dueDate").textContent = prettyDate(date).toUpperCase();

  if (book) {
    $("dueLine").textContent = `${book.title} — ${book.availableCopies} of ${ownedCopies(book)} copies on shelf.`;
  } else {
    $("dueLine").textContent = "Pick a book to preview the slip.";
  }
}

function echoIssueBook() {
  const raw = readText($("issueBookId").value).toUpperCase();
  const echo = $("issueBookEcho");
  echo.className = "field-echo";
  if (!raw) { echo.textContent = "No code typed yet."; return; }
  const book = books[raw];
  if (!book) { echo.textContent = `No book with code ${raw}.`; echo.classList.add("bad"); return; }
  echo.textContent = `“${book.title}” · ${book.availableCopies} available`;
  echo.classList.add(book.availableCopies > 0 ? "good" : "bad");
  renderDuePreview();
}

function echoIssueStudent() {
  const raw = readText($("issueStudentId").value);
  const echo = $("issueStudentEcho");
  echo.className = "field-echo";
  if (!raw) { echo.textContent = "Any unique ID — e.g. S-1042."; return; }
  const loans = loansOfStudent(raw).length;
  echo.textContent = loans ? `${loans} book${loans === 1 ? "" : "s"} currently out to ${raw}.` : `New borrower ${raw}.`;
  echo.classList.add("good");
}

let loanDays = 14;
$("daysRow").querySelectorAll(".day-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    loanDays = Number(chip.dataset.days);
    $("daysRow").querySelectorAll(".day-chip").forEach((c) => c.classList.toggle("on", c === chip));
    Sound.tick();
    renderDuePreview();
  });
});

$("issueBookId").addEventListener("input", echoIssueBook);
$("issueStudentId").addEventListener("input", echoIssueStudent);

$("issueForm").addEventListener("submit", function (event) {
  event.preventDefault();

  const bookId = readText($("issueBookId").value).toUpperCase();
  const studentId = readText($("issueStudentId").value);
  const book = books[bookId];

  if (!book) {
    $("issueBookId").classList.add("invalid");
    $("issueBookId").focus();
    showMessage("No book matches that accession code.", true);
    return;
  }
  if (!studentId) {
    $("issueStudentId").classList.add("invalid");
    $("issueStudentId").focus();
    showMessage("A borrower ID is required.", true);
    return;
  }
  if (book.availableCopies <= 0) {
    showMessage("Every copy of that title is already out.", true);
    return;
  }
  const already = issueRecords.some((r) =>
    r.bookId === bookId &&
    r.studentId.toLowerCase() === studentId.toLowerCase() &&
    !r.returned
  );
  if (already) {
    showMessage("That borrower already has this title out.", true);
    return;
  }

  // honour the waiting list: only the reader at the head of the queue may take it
  const line = queueFor(bookId);
  if (line.length && line[0].studentId.toLowerCase() !== studentId.toLowerCase()) {
    Sound.error();
    showMessage(`That copy is held for ${line[0].studentId}, first in the queue. Collect it under their ID, or remove them from the list.`, true);
    return;
  }

  if (queueElsewhere(studentId).some((q) => q.bookId === bookId)) {
    removeFromQueue(bookId, studentId);
  }

  const dueOn = addDaysISO(loanDays || LOAN_DAYS);
  issueRecords.push({
    bookId,
    studentId,
    returned: false,
    issuedOn: todayISO(),
    dueOn
  });
  book.availableCopies--;

  saveData();
  this.reset();
  echoIssueBook();
  echoIssueStudent();
  renderDuePreview();
  displayAllBooks();
  displayIssuedBooks();
  updateDashboard();
  renderShelf();
  renderSlip();
  refreshDatalists();
  renderLoanFinder();

  Sound.stamp();
  const stillWaiting = queueFor(bookId).length;
  showMessage(`Issued to ${studentId}. ${prettyDate(dueOn)} is the due date.${stillWaiting ? ` ${stillWaiting} still waiting.` : ""}`);
});

/* ==========================================================================
   RETURN
   ========================================================================== */
function renderLoanFinder() {
  const row = $("loanChips");
  const active = issueRecords.filter((r) => !r.returned);

  if (active.length === 0) {
    row.innerHTML = '<span class="muted">No active loans — nothing to collect.</span>';
    return;
  }

  row.innerHTML = active.map((r, i) => {
    const book = books[r.bookId];
    const late = isOverdue(r);
    const label = book ? book.title : r.bookId;
    return `<button class="loan-chip ${late ? "late" : ""}" type="button" data-i="${i}">
      <b>${escapeHTML(r.bookId)}</b> ${escapeHTML(label)} <span>· ${escapeHTML(r.studentId)}</span>
    </button>`;
  }).join("");

  row.querySelectorAll(".loan-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const r = active[Number(chip.dataset.i)];
      $("returnBookId").value = r.bookId;
      $("returnStudentId").value = r.studentId;
      $("returnStudentId").focus();
    });
  });
}

$("returnForm").addEventListener("submit", function (event) {
  event.preventDefault();

  const bookId = readText($("returnBookId").value).toUpperCase();
  const studentId = readText($("returnStudentId").value);

  const record = issueRecords.find((item) =>
    item.bookId === bookId &&
    item.studentId.toLowerCase() === studentId.toLowerCase() &&
    !item.returned
  );

  if (!record) {
    showMessage("No active loan matches that code and borrower.", true);
    return;
  }
  const book = books[bookId];
  if (!book) {
    showMessage("That book is missing from the catalogue.", true);
    return;
  }

  const late = isOverdue(record);
  const owed = late ? fineFor(record) : 0;

  record.returned = true;
  record.returnedOn = todayISO();
  book.availableCopies++;

  const nextInLine = claimNextInQueue(bookId);

  saveData();
  this.reset();
  displayAllBooks();
  displayIssuedBooks();
  updateDashboard();
  renderShelf();
  renderSlip();
  refreshDatalists();
  renderLoanFinder();

  Sound.stamp();
  if (nextInLine) {
    Sound.slip();
    showMessage(`“${book.title}” returned — held for ${nextInLine.studentId}, first in the queue.${owed ? ` ₹${owed} fine still owing.` : ""}`);
  } else if (owed) {
    Sound.stamp();
    showMessage(`“${book.title}” returned · ₹${owed} fine now owing (${daysLate(record)} days late).`);
  } else {
    Sound.stamp();
    showMessage(`“${book.title}” returned. ${book.availableCopies} on shelf now.`);
  }
});


/* ==========================================================================
   THE LEDGER DESK · render fines + the waiting list
   ========================================================================== */
function renderLedgerDesk() {
  const outstanding = totalOutstanding();
  const waiting = new Set(queue.map((q) => q.bookId + "|" + q.studentId.toLowerCase())).size;

  $("ledgerNote").textContent = outstanding
    ? `₹${outstanding} outstanding across ${openAccounts().length} account${openAccounts().length === 1 ? "" : "s"} · ${waiting} reservation${waiting === 1 ? "" : "s"} queued`
    : `Nothing owed · ${waiting} reservation${waiting === 1 ? "" : "s"} queued`;

  /* ---- fines ---- */
  const accounts = openAccounts();
  const list = $("fineList");
  $("fineEmpty").hidden = accounts.length > 0;

  list.innerHTML = accounts.map((acct) => {
    const items = acct.items
      .map((i) => `<b>${escapeHTML(i.title)}</b> ${i.days}d late · ₹${i.amount}`)
      .join(" &nbsp;·&nbsp; ");
    const settled = settledFor(acct.studentId);
    return `
      <article class="fine-card">
        <span class="fine-who">${escapeHTML(acct.studentId)}</span>
        <span></span>
        <span class="fine-amount">₹${acct.amount}<small>owing</small></span>
        <p class="fine-detail">${items}${settled ? ` &nbsp;·&nbsp; ₹${settled} settled before` : ""}</p>
        <div class="fine-actions">
          <button class="mini-btn settle" type="button" data-settle="${escapeHTML(acct.studentId)}">Settle ₹${acct.amount}</button>
          <button class="mini-btn" type="button" data-wave="${escapeHTML(acct.studentId)}">Waive as a kindness</button>
        </div>
      </article>`;
  }).join("");

  list.querySelectorAll("[data-settle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.settle;
      const acct = openAccounts().find((a) => a.studentId === id);
      if (!acct) return;
      fines.push({
        studentId: id,
        amount: acct.amount,
        settledOn: todayISO(),
        items: acct.items
      });
      // a settled account stops accruing: the overdue copies are cleared by
      // resetting their due date to today (the copy is still out, but paid up)
      issueRecords.forEach((r) => {
        if (!r.returned && r.studentId === id && isOverdue(r)) r.renewedOn = todayISO(), r.dueOn = todayISO();
      });
      saveData();
      Sound.stamp();
      refreshAll();
      renderLedgerDesk();
      showMessage(`${id} settled ₹${acct.amount}. Receipt logged in the ledger.`);
    });
  });

  list.querySelectorAll("[data-wave]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.wave;
      const acct = openAccounts().find((a) => a.studentId === id);
      if (!acct) return;
      if (!confirm(`Waive ₹${acct.amount} for ${id}? This is recorded in the ledger.`)) return;
      fines.push({ studentId: id, amount: 0, waived: acct.amount, settledOn: todayISO(), items: acct.items });
      issueRecords.forEach((r) => {
        if (!r.returned && r.studentId === id && isOverdue(r)) { r.renewedOn = todayISO(); r.dueOn = todayISO(); }
      });
      saveData();
      Sound.tick();
      refreshAll();
      renderLedgerDesk();
      showMessage(`₹${acct.amount} waived for ${id}. A generous library.`);
    });
  });

  /* ---- waiting list ---- */
  const qList = $("queueList");
  const grouped = new Map();
  queue.forEach((q) => {
    if (!grouped.has(q.bookId)) grouped.set(q.bookId, []);
    grouped.get(q.bookId).push(q);
  });
  $("queueEmpty").hidden = grouped.size > 0;

  qList.innerHTML = [...grouped.entries()].map(([bookId, entries]) => {
    const book = books[bookId];
    const people = entries
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
      .map((q, i) => `
        <div class="queue-person ${i === 0 ? "next" : ""}">
          <span class="q-pos">${i + 1}</span>
          <span class="q-who">${escapeHTML(q.studentId)}</span>
          <button class="q-drop" type="button" data-drop-book="${escapeHTML(bookId)}" data-drop-who="${escapeHTML(q.studentId)}" aria-label="Remove ${escapeHTML(q.studentId)} from the queue">×</button>
          <span class="q-since">queued ${prettyDate(q.addedAt.slice(0, 10))}</span>
        </div>
        ${i === 0 ? `<p class="q-claim">First refusal on the next copy returned.</p>` : ""}`)
      .join("");
    return `
      <div class="queue-book">
        <div class="queue-title">
          <h4>${escapeHTML(book ? book.title : bookId)}</h4>
          <span class="q-code">${escapeHTML(bookId)}</span>
        </div>
        <div class="queue-people">${people}</div>
      </div>`;
  }).join("");

  qList.querySelectorAll("[data-drop-book]").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeFromQueue(btn.dataset.dropBook, btn.dataset.dropWho);
      Sound.tick();
      refreshAll();
      renderLedgerDesk();
      showMessage(`${btn.dataset.dropWho} removed from the queue.`);
    });
  });

  /* ---- add-to-queue form ---- */
  const bookOpts = Object.values(books)
    .map((b) => `<option value="${escapeHTML(b.id)}">${escapeHTML(b.title)} — ${escapeHTML(b.id)}${b.availableCopies === 0 ? " (all out)" : ""}</option>`)
    .join("");
  qList.insertAdjacentHTML("beforeend", `
    <form class="queue-add" id="queueForm" novalidate>
      <select id="queueBook" aria-label="Book to reserve">${bookOpts || '<option value="">No books yet</option>'}</select>
      <input id="queueWho" placeholder="Borrower ID" aria-label="Borrower ID" autocomplete="off">
      <button type="submit">Reserve</button>
    </form>
    <p class="q-breadcrumb">Reservations are held in this browser — the first in line is offered the copy on return.</p>`);

  $("queueForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const res = addToQueue($("queueBook").value, readText($("queueWho").value));
    if (!res.ok) { Sound.error(); showMessage(res.msg, true); return; }
    Sound.tick();
    refreshAll();
    renderLedgerDesk();
    showMessage(res.msg);
  });
}

/* ==========================================================================
   ON LOAN BOARD
   ========================================================================== */
function displayIssuedBooks() {
  const board = $("issuedBoard");
  const empty = $("issuedEmpty");
  const active = issueRecords.filter((r) => !r.returned);
  const late = active.filter(isOverdue).length;

  $("loanSummary").textContent = active.length
    ? `${active.length} loan${active.length === 1 ? "" : "s"} out · ${late} overdue`
    : "No loans out.";

  if (active.length === 0) {
    board.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  board.innerHTML = active.map((r, i) => {
    const book = books[r.bookId];
    const overdue = isOverdue(r);
    const title = book ? book.title : "Unknown title";
    const author = book ? book.author : r.bookId;
    const due = r.dueOn ? prettyDate(r.dueOn) : "—";
    const days = r.dueOn ? daysBetween(r.dueOn, todayISO()) : null;

    const binding = bindingFor(r.bookId);
    return `
      <article class="loan-card ${overdue ? "overdue" : ""}" style="animation-delay:${Math.min(i * 40, 400)}ms">
        <div class="loan-main">
          <span class="mini-book" aria-hidden="true"
            style="--c1:${binding.c1}; --c2:${binding.c2}; --foil:${binding.foil}">
            <span class="mb-pages"></span>
            <span class="mb-cover" data-binding="${binding.key}"></span>
          </span>
          <div class="loan-text">
            <div class="loan-top">
              <span class="loan-code">${escapeHTML(r.bookId)}</span>
              <span class="tag ${overdue ? "late" : "ok"}">${overdue ? "Overdue" : "On loan"}</span>
            </div>
            <h3 class="loan-title">${escapeHTML(title)}</h3>
            <p class="loan-author">${escapeHTML(author)}</p>
          </div>
        </div>
        <dl class="loan-meta">
          <div><dt>Borrower</dt><dd>${escapeHTML(r.studentId)}</dd></div>
          <div><dt>Issued</dt><dd>${r.issuedOn ? prettyDate(r.issuedOn) : "—"}</dd></div>
          <div><dt>Due</dt><dd class="${overdue ? "over" : ""}">${due}${overdue && days !== null ? ` · ${Math.abs(days)}d late` : ""}</dd></div>
          ${overdue ? `<div><dt>Fine</dt><dd class="over">₹${fineFor(r)} <span style="font-weight:400;font-size:10.5px">(${daysLate(r)}d × ₹${fineRate})</span></dd></div>` : ""}
        </dl>
        <div class="loan-actions">
          <button class="mini-btn" type="button" data-return-book="${escapeHTML(r.bookId)}" data-return-student="${escapeHTML(r.studentId)}">Return</button>
          <button class="mini-btn" type="button" data-open-book="${escapeHTML(r.bookId)}">Open card</button>
        </div>
      </article>`;
  }).join("");

  board.querySelectorAll(".mb-cover").forEach((cover) => {
    cover.style.backgroundImage =
      `${coverArt(cover.dataset.binding)}, linear-gradient(160deg, var(--c1), var(--c2))`;
  });

  board.querySelectorAll("[data-return-book]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showSection("return");
      $("returnBookId").value = btn.dataset.returnBook;
      $("returnStudentId").value = btn.dataset.returnStudent;
      $("returnStudentId").focus();
    });
  });
  board.querySelectorAll("[data-open-book]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedBookId = btn.dataset.openBook;
      showSection("dashboard");
      renderShelf();
      renderSlip();
      openBook(btn.dataset.openBook);
    });
  });
}

/* ==========================================================================
   DATALISTS
   ========================================================================== */
function refreshDatalists() {
  $("bookCodes").innerHTML = Object.values(books)
    .map((b) => `<option value="${escapeHTML(b.id)}"></option>`)
    .join("");

  const students = [...new Set(
    issueRecords.filter((r) => !r.returned).map((r) => r.studentId)
  )];
  $("studentIds").innerHTML = students
    .map((s) => `<option value="${escapeHTML(s)}"></option>`)
    .join("");
}

/* ==========================================================================
   QUICK SEARCH PALETTE
   ========================================================================== */
const palette = $("palette");
const paletteQuery = $("paletteQuery");
const paletteList = $("paletteList");
let paletteIndex = 0;
let paletteResults = [];

function openPalette() {
  palette.hidden = false;
  paletteQuery.value = "";
  paletteIndex = 0;
  renderPalette("");
  setTimeout(() => paletteQuery.focus(), 30);
}

function closePalette() {
  palette.hidden = true;
}

function renderPalette(query) {
  const q = query.trim().toLowerCase();
  paletteResults = Object.values(books)
    .filter((b) => !q || b.id.toLowerCase().includes(q) ||
      b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
    .slice(0, 24);

  if (paletteResults.length === 0) {
    paletteList.innerHTML = `<li class="palette-none">${Object.keys(books).length ? "Nothing matches that." : "The catalogue is empty."}</li>`;
    return;
  }

  paletteList.innerHTML = paletteResults.map((b, i) => `
    <li class="palette-item ${i === paletteIndex ? "on" : ""}" data-i="${i}">
      <span class="pi-code">${escapeHTML(b.id)}</span>
      <span class="pi-main">
        <span class="pi-title">${escapeHTML(b.title)}</span>
        <span class="pi-sub">${escapeHTML(b.author)} · ${b.year}</span>
      </span>
      <span class="pi-copies ${b.availableCopies === 0 ? "none" : ""}">${b.availableCopies === 0 ? "all out" : b.availableCopies + " on shelf"}</span>
    </li>`).join("");

  paletteList.querySelectorAll(".palette-item").forEach((item) => {
    item.addEventListener("click", () => openBookFromPalette(Number(item.dataset.i)));
  });
}

function openBookFromPalette(index) {
  const book = paletteResults[index];
  if (!book) return;
  selectedBookId = book.id;
  closePalette();
  showSection("dashboard");
  renderShelf();
  renderSlip();
  openBook(book.id);
}

$("paletteBtn").addEventListener("click", openPalette);
palette.querySelectorAll("[data-close-palette]").forEach((el) => el.addEventListener("click", closePalette));

paletteQuery.addEventListener("input", () => {
  paletteIndex = 0;
  renderPalette(paletteQuery.value);
});

paletteQuery.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closePalette(); return; }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    paletteIndex = Math.min(paletteIndex + 1, paletteResults.length - 1);
    renderPalette(paletteQuery.value);
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    paletteIndex = Math.max(paletteIndex - 1, 0);
    renderPalette(paletteQuery.value);
  }
  if (e.key === "Enter") { e.preventDefault(); openBookFromPalette(paletteIndex); }
});

document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    palette.hidden ? openPalette() : closePalette();
    return;
  }
  if (e.key === "Escape" && !palette.hidden) { closePalette(); return; }
  if (e.key === "/" && !typing && palette.hidden) {
    e.preventDefault();
    openPalette();
  }
});


/* ==========================================================================
   LAMPS · after-hours theme
   ========================================================================== */
function applyTheme(theme, announce = false) {
  const night = theme === "night";
  document.documentElement.setAttribute("data-theme", night ? "night" : "day");
  localStorage.setItem(STORE_THEME, night ? "night" : "day");
  const btn = $("themeBtn");
  if (btn) {
    btn.setAttribute("aria-pressed", String(night));
    btn.setAttribute("aria-label", night ? "Switch to daytime lighting" : "Switch to after-hours lighting");
    btn.title = night ? "Bring the daylight back" : "Dim the lamps";
    $("themeLabel").textContent = night ? "Lamps down" : "Lamps up";
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", night ? "#171510" : "#1d3b2f");
  if (announce) showMessage(night ? "The lamps are down. After-hours mode." : "Daylight restored.");
}

function initTheme() {
  const saved = localStorage.getItem(STORE_THEME);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "night" : "day"));
  $("themeBtn").addEventListener("click", () => {
    const night = document.documentElement.getAttribute("data-theme") === "night";
    Sound.tick();
    applyTheme(night ? "day" : "night", true);
  });
}

/* ==========================================================================
   SOUND TOGGLE + first-gesture wake
   ========================================================================== */
syncSoundButton();
document.addEventListener("DOMContentLoaded", () => {});

$("fineRate").addEventListener("change", () => {
  const v = Math.max(0, Math.min(100, Number($("fineRate").value) || 0));
  fineRate = v;
  $("fineRate").value = v;
  saveData();
  Sound.tick();
  refreshAll();
  renderLedgerDesk();
  showMessage(`Fines are now ₹${v} per day, per copy.`);
});

$("soundBtn").addEventListener("click", () => {
  const on = Sound.toggle();
  syncSoundButton();
  if (on) Sound.tick();
  showMessage(on ? "Interface sound on." : "Interface sound muted.");
});

["pointerdown", "keydown"].forEach((evt) => {
  window.addEventListener(evt, () => Sound.wake(), { once: true });
});

/* ==========================================================================
   CLOCK
   ========================================================================== */
function updateClock() {
  const now = new Date();
  $("clockDay").textContent = now.toLocaleDateString(undefined, { weekday: "long" });
  $("clockDate").textContent = now.toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
}

/* ==========================================================================
   FOOTER ACTIONS
   ========================================================================== */
$("exportBtn").addEventListener("click", () => {
  const payload = {
    library: "The Reading Room",
    exportedAt: new Date().toISOString(),
    fineRate,
    books,
    issueRecords,
    fines,
    queue
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reading-room-ledger-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showMessage("Ledger exported as JSON.");
});

$("resetBtn").addEventListener("click", () => {
  if (!confirm("Close the library? This erases every book and loan stored in this browser.")) return;
  books = {};
  issueRecords = [];
  fines = [];
  queue = [];
  selectedBookId = null;
  localStorage.removeItem(STORE_BOOKS);
  localStorage.removeItem(STORE_ISSUES);
  localStorage.removeItem(STORE_FINES);
  localStorage.removeItem(STORE_QUEUE);
  localStorage.setItem(STORE_SEEDED, "1");
  saveData();
  refreshAll();
  showMessage("The library is closed. Start a new collection whenever you're ready.");
});

/* ==========================================================================
   SAMPLE SHELF (first visit only)
   ========================================================================== */
function seedSampleLibrary() {
  if (localStorage.getItem(STORE_SEEDED)) return;
  localStorage.setItem(STORE_SEEDED, "1");

  if (Object.keys(books).length > 0) return;

  const samples = [
    { id: "BK-101", title: "The Night Circus", author: "Erin Morgenstern", year: 2011, availableCopies: 3 },
    { id: "BK-102", title: "Things Fall Apart", author: "Chinua Achebe", year: 1958, availableCopies: 2 },
    { id: "BK-103", title: "The God of Small Things", author: "Arundhati Roy", year: 1997, availableCopies: 0 },
    { id: "BK-104", title: "Invisible Cities", author: "Italo Calvino", year: 1972, availableCopies: 1 },
    { id: "BK-105", title: "Beloved", author: "Toni Morrison", year: 1987, availableCopies: 2 },
    { id: "BK-106", title: "The Shadow Lines", author: "Amitav Ghosh", year: 1988, availableCopies: 1 },
    { id: "BK-107", title: "Piranesi", author: "Susanna Clarke", year: 2020, availableCopies: 2 },
    { id: "BK-108", title: "Midnight's Children", author: "Salman Rushdie", year: 1981, availableCopies: 0 },
    { id: "BK-109", title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", year: 1969, availableCopies: 3 }
  ];
  samples.forEach((b) => { books[b.id] = b; });

  // two live loans, one of them overdue for demonstration
  const overdueDate = addDaysISO(-4);
  const soonDate = addDaysISO(9);
  issueRecords.push(
    { bookId: "BK-103", studentId: "S-1042", returned: false, issuedOn: addDaysISO(-18), dueOn: overdueDate },
    { bookId: "BK-108", studentId: "S-2077", returned: false, issuedOn: addDaysISO(-5), dueOn: soonDate }
  );

  saveData();
}

/* ==========================================================================
   BOOT
   ========================================================================== */
function refreshAll() {
  displayAllBooks();
  displayIssuedBooks();
  updateDashboard();
  renderShelf();
  renderSlip();
  refreshDatalists();
  renderLoanFinder();
  renderDuePreview();
  renderAuthorChips();
  updateCoverPreview();
  updateClock();
  if (currentSection === "ledgerdesk") renderLedgerDesk();
}

seedSampleLibrary();
$("fineRate").value = fineRate;
initTheme();
refreshAll();
setInterval(updateClock, 60000);

// seed the due slip with a preview
renderDuePreview();
