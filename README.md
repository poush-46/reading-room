# 📚 The Reading Room — Library Management System

A vintage card-catalogue take on the classic **Library Management System**. Manage books, borrowers and issue records — with a shelf of realistic hardcover books instead of a plain table.

Built with plain **HTML, CSS and JavaScript** — no frameworks, no build step, no backend. All data lives in `localStorage` on the device.

![stack](https://img.shields.io/badge/HTML-CSS-JS-1d3b2f?style=flat-square) ![no dependencies](https://img.shields.io/badge/dependencies-none-b98a3e?style=flat-square) ![license](https://img.shields.io/badge/license-MIT-5c5040?style=flat-square)

---

## ✨ Features

**Core**
- **Add books** — accession code, title, author, publication year, copies owned (with full validation and duplicate refusal)
- **Inventory ledger** — every title with on-shelf ratio bars, copies owned, and per-row **Issue / Return / Remove** actions
- **Search** — by code, title or author, live as you type, plus author chips to browse by writer
- **Issue a book** — prevents double-issuing the same title to the same borrower; logs issue date and a **14-day due date**
- **Return a book** — pick from the active-loans list or type the code; copies go straight back on the shelf
- **Books on loan** — due dates, days late, and **overdue tags**

**The Reading Room extras**
- **Realistic hardcover shelf** — each title is a book with a cloth/leather cover (8 generated bindings), page block, woven head and tail bands, and gold-foil lettering. Thickness = copies owned; height follows title length. Out-of-stock titles carry a red pin.
- **Borrower's slip** — click any spine to pull its card: status, borrowers, due dates, quicker return
- **3D cover preview** — the Add Book form binds a live hardcover as you type
- **Quick search palette** — `Ctrl/⌘ + K` (or `/`)
- **Export ledger** — download the whole library as JSON
- **Responsive everywhere** — iPhone SE → iPad Pro → desktop; the table becomes cards on phones, the shelf becomes a swipeable strip, inputs stay at 16 px so iOS never zooms

## 🚀 Run it

**Option A — just open it**
Double-click `index.html` (or `library/reading-room.html`). Everything is local; the single-file build also works offline with no assets folder.

**Option B — local server** (recommended; avoids any `file://` quirks)

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## 📁 Project structure

```
index.html                 # single-file build: all CSS, JS and cover art inlined
library/
  index.html               # 3-file version
  style.css                # all styles (print-inspired design system)
  script.js                # app logic: state, rendering, validation
  reading-room.html        # same as the root single-file build
  assets/covers/opt/*.webp # 8 cloth/leather binding textures
```

## 🗂️ Data model

```js
// localStorage["libraryBooks"]
{ "BK-101": { id, title, author, year, availableCopies, addedOn } }

// localStorage["libraryIssues"]
[{ bookId, studentId, returned, issuedOn, dueOn, returnedOn? }]
```

Eight sample books are seeded on first visit so the shelf isn't empty. Use **Close the library** in the footer to wipe it and start fresh.

## 🌐 Deploy on GitHub Pages

1. Push this repo to GitHub (see below).
2. **Settings → Pages → Build and deployment**
3. Source: **Deploy from a branch** → Branch: `main` → Folder: `/ (root)` → **Save**
4. Your site appears at `https://<username>.github.io/<repo>/`

Because it's a static site with no build step, Pages serves it as-is.

## 📄 License

MIT — use it, remix it, submit it.

---

<sub>Est. 1897 · The Reading Room · a card catalogue for books, borrowers & due dates</sub>
