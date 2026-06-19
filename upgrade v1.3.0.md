# DayLens v1.3.0 — Day Log & Summary Fidelity Upgrade

This release targets one thing: making the Day Log and Day Summary reflect what you
*actually* did, instead of collapsing your day into a few generic lines. No redesign —
the UI is unchanged. The work is in how raw activity becomes a time log.

## What was losing detail (diagnosis)

Your raw capture is good. A new database row is written every time the window title
changes (`main.js`, the `tick()` loop), so a switch from a Cephas file to a 3Cs proposal
in the same editor was always recorded as two distinct rows. The detail existed — three
later stages threw it away:

1. **Whole-day app collapse.** The summary aggregated per *app*, keeping only the last
   window title, so every coding session became one "VS Code" line.
2. **Category-only merging.** All "Deep Work" merged into a single "Software development"
   row — two different projects became one line.
3. **Short-activity sweep.** Anything under 10 min after merging was dumped into one
   undifferentiated "Other / miscellaneous" bucket (mislabelled "<15 min"). Meaningful
   short tasks disappeared.
4. **Blurry AI input.** The AI was handed the already-merged, truncated data, so even a
   strong model was reconstructing the day from a lossy summary.

## What changed

### 1. Project detection (new)
A new `detectProject()` in `main.js` extracts a project name from the signals already in
your data, in priority order:
- **Your own rules** (Settings → Projects): keyword → project, matched against title, URL,
  and app name. This is how a `localhost:3000` or `usecephas` becomes "Cephas".
- **GitHub repo slug** from the URL or tab title (`alagemoo/cephas` → "Cephas").
- **Editor workspace folder** parsed from VS Code / Cursor / Sublime titles
  (`followUp.ts — cephas — Visual Studio Code` → "Cephas"). JetBrains project-first titles
  handled too.
- **Deploy domains** (`<project>.vercel.app` / `.netlify.app`).

If no signal is found, the activity stays project-less and behaves exactly as before —
generic browsing and email are *not* forced into a project. Web pages participate only
when they carry a real signal.

### 2. Time blocks split by project, not just category
`get-daily-summary-data` now computes a project per activity and breaks time-blocks on a
project change. Back-to-back coding on Cephas and 3Cs no longer merges into one line —
each becomes its own attributable row ("Software development — Cephas",
"Software development — 3Cs Aquarah"). Same-project work across the day still merges, so
the row count stays sane.

### 3. Short activities no longer vanish (your main concern)
- Generic blocks still need 5 min to earn their own row, but **project-tagged work earns a
  row at just 2 min** — a quick fix on a real project keeps its identity.
- Sub-threshold time now **rolls up by category** ("Short communication activities — 7m")
  instead of one undifferentiated "miscellaneous" lump. Nothing meaningful disappears, and
  the total always reconciles with tracked time.

### 4. AI gets richer, project-aware input (still optional)
When an AI provider is on, the prompt now includes detected projects, more titles per
block (8 vs 5) at full length, and an instruction to name projects and never merge two
into one line. **Everything works fully without AI** — local inference does the project
parsing and rollup on its own; AI only sharpens wording.

### 5. Surfaced in the no-AI view
The summary header shows a project count, and the local Day Overview names your top
projects with time split — so the fidelity is visible even with AI off.

## Files changed
- `src/main.js` — `detectProject()` / `getProjectRules()` / `capWords()`; project-aware
  block builder; `get-project-rules` / `set-project-rules` IPC.
- `src/renderer/index.html` — project-aware grouping & labels; adaptive thresholds;
  per-category short-activity rollup; project-aware AI prompt; Projects settings UI; header
  + narrative project surfacing.
- `src/preload.js` — exposes `getProjectRules` / `setProjectRules`.
- `package.json` — version → 1.3.0.

## Suggested project rules to start with
Settings → Projects → Add project:

| Project       | Keywords                                                    |
|---------------|-------------------------------------------------------------|
| Cephas        | `cephas, usecephas, kingdom-intelligence, localhost:3000`   |
| 3Cs Aquarah   | `3cs, aquarah, adcompliance`                                |
| Maono Labs    | `maono`                                                     |
| Omugwo        | `omugwo, omugwoapp`                                         |
| DayLens       | `daylens, valiontech`                                       |

Editor-folder and GitHub detection work without any rules; add rules only for projects
DayLens can't infer on its own (e.g. a localhost port or a client name that never appears
in a folder path).

## Note on capture accuracy
No capture changes were needed — title-level granularity already exists in the database.
If a specific past day looks wrong, it's worth checking the **Day Log** view (which shows
raw, uncollapsed rows) against the summary to see where a gap or mis-category originates.

## 6. Live "Now tracking" counter — cumulative session (new)
Previously the live counter showed only the *current focus stretch*, so it reset to zero
every time you refocused a window or returned to a tab. It now shows the **cumulative
active time today** for that tab (browser) or app (native) as the primary number — it
resumes across visits instead of restarting.

Important: the cumulative figure is **active time only**, computed as the sum of that
tab/app's recorded intervals today plus the current live stretch. Time spent away (on
other apps, idle, asleep) is excluded — the database still stores each focus interval
separately, which is what keeps idle/sleep capping accurate. This was deliberately a
*display* change, not a data-model change.

The widget now shows three things:
- **Primary (large):** cumulative active time today on this tab/app — no longer resets.
- **Secondary:** "X this visit" — the genuinely-live current stretch.
- **Project line:** when the activity belongs to a detected project, "📂 Cephas · 2h 14m
  today" — cumulative active time on that project across every app today.

Backend: `get-current-activity` now returns `todayMsPrior`, `project`, `projectMsPrior`,
and `isBrowser` alongside the activity. The per-tab/app sum is one indexed query; the
project sum scans today's foreground rows once per 5-second poll (cheap). The 1-second
on-screen ticker interpolates locally with no extra queries.