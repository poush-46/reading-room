"use strict";

/* ==========================================================================
   THE READING ROOM · Library Management System
   All data is kept in localStorage on this device.
   ========================================================================== */

const LOAN_DAYS = 14;
const STORE_BOOKS = "libraryBooks";
const STORE_ISSUES = "libraryIssues";
const STORE_SEEDED = "readingRoomSeeded";

/* ---------- data ---------- */
let books = JSON.parse(localStorage.getItem(STORE_BOOKS) || "{}");
let issueRecords = JSON.parse(localStorage.getItem(STORE_ISSUES) || "[]");

let selectedBookId = null;
let currentSection = "dashboard";

const $ = (id) => document.getElementById(id);

/* ---------- helpers ---------- */
function saveData() {
  localStorage.setItem(STORE_BOOKS, JSON.stringify(books));
  localStorage.setItem(STORE_ISSUES, JSON.stringify(issueRecords));
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
   NAVIGATION
   ========================================================================== */
const SECTION_LABELS = {
  dashboard: "Dashboard", addBook: "Add Book", books: "Inventory",
  search: "Search", issue: "Issue", return: "Return", issued: "On Loan"
};

function showSection(sectionId) {
  currentSection = sectionId;
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
      selectedBookId = spine.dataset.book;
      shelf.querySelectorAll(".spine").forEach((s) => s.classList.remove("selected"));
      spine.classList.add("selected");
      renderSlip();
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
  const date = addDaysISO(LOAN_DAYS);
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

  const dueOn = addDaysISO(LOAN_DAYS);
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

  showMessage(`Issued to ${studentId}. ${prettyDate(dueOn)} is the due date.`);
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

  record.returned = true;
  record.returnedOn = todayISO();
  book.availableCopies++;

  saveData();
  this.reset();
  displayAllBooks();
  displayIssuedBooks();
  updateDashboard();
  renderShelf();
  renderSlip();
  refreshDatalists();
  renderLoanFinder();

  showMessage(`“${book.title}” returned. ${book.availableCopies} on shelf now.`);
});

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
  showMessage(`Card pulled for ${book.id}.`);
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
    books,
    issueRecords
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
  selectedBookId = null;
  localStorage.removeItem(STORE_BOOKS);
  localStorage.removeItem(STORE_ISSUES);
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
}

seedSampleLibrary();
refreshAll();
setInterval(updateClock, 60000);

// seed the due slip with a preview
renderDuePreview();
