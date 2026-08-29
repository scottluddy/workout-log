# Workout Log — Project Context

Orientation for picking this project up cold. `index.html` is the source of
truth; this file explains the reasoning that isn't obvious from reading it.

Last verified against the deployed file: ~300 KB, ~4,100 lines.

## What this is

A personal training tracker, deployed on GitHub Pages at
`scottluddy.github.io/workout-log/`. Compiled React (`React.createElement`,
no JSX), no build step, no package manager. React, Supabase and SheetJS load
from CDNs at runtime.

**Two files make up the app:** `index.html` holds the markup, styling, and
all React-rendering code (`App()` and friends); `logic.js` holds every pure
function and constant with no React/DOM dependency — date helpers, the
module-flag registry, and the progression/rate math for Personal Trainer,
Progress Tracker, Cardio and Mobility. `index.html` loads it with a plain
`<script src="logic.js">` before its own inline script, so everything in
`logic.js` is just an ordinary global to the rendering code, exactly as if
it were still inline. The split exists so `logic.js` can also be
`require()`d from Node for automated tests. Still no build step: both files
are served as-is.

Files in the repo: `index.html`, `logic.js`, `icon.png`, `test/`,
`Weekly_Program_Template.xlsx`, `Custom_Program_Template.xlsx`.

Babel-in-browser was deliberately removed early on: it was unreliable, and
when it failed it produced a blank page with no error. That's also why there
is a small diagnostic error banner wired up near the top of the file — if
nothing renders within 6 seconds it says so rather than showing nothing.

The Supabase URL and key in the file are a **public client key** protected by
row-level security. They belong in the file; they are not a leaked secret.

## Data model

Most logged data lives in one flat `entries` object, `key -> string value`:

| Key | Meaning |
|---|---|
| `wd\|<programId>\|<dateKey>\|<rid>` | weight for one exercise on one date |
| `rd\|<programId>\|<dateKey>\|<rid>\|<setIndex>` | reps for one set |
| `dt\|<programId>\|<dateKey>` | which day type a date is assigned (custom programs) |
| `fin\|<programId>\|<dateKey>` | JSON array of ad-hoc "finisher" exercises for that date |
| `w\|`, `r\|`, `d\|` with a week index | **legacy**, pre-calendar. Read only by the one-time migration, never written. |

`dateKey` is `YYYY-MM-DD`. `sw|...` (stopwatch) is localStorage-only, not synced.

**`rid` stability is load-bearing.** It identifies an exercise slot within a
program and must never change for an existing exercise, or years of logged
data silently reattach to the wrong lift. The program builder preserves
existing `rid`s on edit and only mints new ones for newly added rows.

Everything synced, in one Supabase row (`workout_logs`, `data` JSONB):

```
entries, programs, currentProgramId, deletedProgramIds, aiTargets,
cardioSessions, cardioDeletedSessionIds, cardioUnlockedWeekKeys,
cardioRevealedCount, programBlocks, deletedProgramBlockIds,
enabledModules, mobilityLog, mobilityModalities
```

Body Composition is the exception: it has its own two Supabase tables
(`body_comp_entries`, `body_comp_blocks`) created by a one-time SQL script.

## Sync

Local-first. Writes hit `localStorage` immediately, then a debounced push to
Supabase. Background pull every 15s while signed in, plus on tab visibility.

Merge rules, which differ by data type on purpose:

- **entries** — per-key dirty tracking. A key edited locally wins over an
  incoming pull until confirmed pushed; otherwise remote wins.
- **programs, cardio sessions, program blocks** — union by id, minus a
  **tombstone list** of deleted ids.
- **whole-value settings** (aiTargets, enabledModules) — last write wins,
  gated by a dirty flag.
- **mobilityLog** — merged per day, so a day logged on the phone and a
  different day logged on the laptop both survive.

**Why tombstones exist:** a pure union merge means deletions can never stick
— the device that didn't delete re-adds the item on next sync and pushes that
resurrection back. This was a real bug, hit twice (programs, then cardio
sessions). Any new list-shaped synced data needs the same treatment.

## Modules

Each is self-contained between `// ===== NAME (start/end) =====` comments and
gated by a build flag. **Two independent layers decide visibility:** the build
flag (hard kill switch, everyone) and the user's `enabledModules` choice via
⋯ → Modules. `moduleOn()` requires both.

| Flag | State | Notes |
|---|---|---|
| `PROGRAM_BLOCKS_ENABLED` | on | date ranges assigning a program to a stretch of calendar |
| `FEATURE_CARDIO` | on | stopwatch, effective minutes, escalating weekly target |
| `FEATURE_MOBILITY` | on | AM/PM sessions, fixed drill list |
| `BODY_COMP_ENABLED` | on | weekly weigh-ins, bulk/cut/maintenance blocks |
| `PROGRESS_TRACKER_ENABLED` | on | monthly heat map + per-exercise breakdown |
| `PERSONAL_TRAINER_ENABLED` | on | per-set rep targets inside a workout |
| `COLOR_CODE_ENABLED` | on | green/yellow/red rep cells |
| `MANUAL_PROGRAM_BUILDER_ENABLED` | on | in-app program builder |
| `ANALYSIS_EXPORT_ENABLED` | **off** | text export for outside AI analysis |
| `AI_TARGETS_ENABLED` | **off** | imports a weekly-targets JSON |

The two disabled ones are paused, not abandoned — code intact.

## The rules that carry the philosophy

The owner trains for slow, constant progress: *"stimulate, don't annihilate,"
"leave on a quarter tank," "any progress every exercise wins the workout."*
Several rules encode that and should not be "simplified" without discussion.

**Progression ladder (Personal Trainer).** Never more than +1 rep per session,
always filling the lowest set first, so a session's reps are monotonically
non-increasing: `6-6-6-6 → 7-6-6-6 → 7-7-6-6 → 7-7-7-6 → 7-7-7-7`, then the
base rises. Exactly one set is prescribed the rep. New weight resets every set
to the rep-range floor.

**Cell colouring** compares a set against the *same set* in the previous
occurrence of that workout, and only when the weight is identical. For custom
(PPL-style) programs "previous occurrence" means the previous date with the
same day type — not 7 days ago. That was a real bug; a fixed 7-day lookback
silently produced no colours at all on a rotating split.

**Weight increase** is itself progress: if the load went up and every set
cleared the rep-range floor, the final set greens.

**"Did this exercise progress?"** is deliberately stricter than "did any cell
turn green." At the same weight it requires **total reps to increase**.
`13-13-13 → 14-13-12` lights a green cell but the total is unchanged — a rep
was moved, not added — and must not count.

**Excluded from all Progress Tracker maths:** Abs and Calves (rep counts
aren't reliable), finishers, first-time exercises, unlogged exercises. The
exclusion applies to *both* the monthly grade and the per-exercise table; if
it applied to only one they'd disagree about the same session.

**Monthly grade is pooled** — total exercises progressed ÷ total eligible —
not an average of per-session percentages. Sessions differ in size, and
averaging would let a 2-exercise day weigh as much as a 5-exercise one.

**Cardio:** sessions under 5:00 earn nothing; longer sessions get a duration
multiplier (1.0 → 1.4); the weekly target starts at 45 effective minutes and
climbs by 5 each week it's met, capped at 110. A week counts toward a Program
Block if it *overlaps* the block, not if its Sunday start falls inside it —
blocks usually start mid-week. An in-progress week only counts once met, so
an unfinished week never reads as a miss. Minimum 6-week sample, backfilled
from earlier weeks when a block is young.

**Mobility:** two sessions per day (AM/PM), each modality once per day,
measured over a fixed 20-day window = 40 slots, so one session is 2.5%. The
denominator is fixed on purpose — it starts at 0% and climbs.

## Migrations (all additive, all idempotent)

- **Legacy entries** — old week-indexed keys → date-keyed, on first load.
- **Program 0** — Split 4.0 used to be hardcoded, with `programId` 0 baked
  into years of keys. It's now promoted *in place* into the normal programs
  list, keeping id 0, so no key is ever rewritten. Guarded so a new user with
  no `|0|` data gets an empty programs list, and so a deleted Split 4.0 is
  not resurrected.
- **Program blocks** — creates an initial open-ended block covering existing
  history so it isn't all read as "no program scheduled."
- **Mobility ids** — an earlier build let the drill list be user-built with
  generated ids; those are remapped onto the fixed ids by label match.

## Tests

`test/` holds Node's built-in test runner (`node:test` + `node:assert`) —
zero dependencies, zero build step. Run with `npm test` or `node --test`.

Covers the rules from "The rules that carry the philosophy" above, directly
against `logic.js`: rep-cell colouring (including the custom-program
same-day-type lookup, not a fixed 7-day one), Progress Tracker eligibility
and the "moved not added" total-reps rule, the Cardio weekly target's
ratchet-and-cap, and Mobility's fixed 20-day/40-slot window (including its
exact edge and the half-percent rounding). Each of those was checked by
temporarily breaking the corresponding rule in `logic.js` and confirming the
matching test — and only that test — fails, then reverting.

Not covered: anything that's genuinely rendering (JSX-shaped output,
`App()`'s state/effects), and Supabase sync, which needs a live backend to
exercise meaningfully.

## Constraints worth knowing

- Split 4.0's `programId` must stay `0`.
- GitHub Pages needs the file named `index.html` at the repo root.
- Non-Safari iOS browsers can't execute JS from a `file://` URL — test over
  `http://` (`python3 -m http.server`) or the deployed site.
- Home Screen web apps cache aggressively; ⋯ → Reload App navigates with a
  cache-busting query string, which is the reliable fix. The `Cache-Control`
  meta tags are a nudge, not a guarantee.
- CSS caution: an `inset` box-shadow on a calendar row is invisible, because
  the full-bleed day cells paint over it. Use a positioned overlay element.

## Working style the owner expects

- Mock up anything with visual implications before building it.
- Say plainly when a request conflicts with something already there, or when
  a stated goal and the proposed mechanism don't line up.
- Verify rather than assert. Bugs in this codebase have repeatedly been found
  by reproducing them, not by reasoning about them.
- When a test fails, establish whether the *code* or the *test* is wrong
  before changing either. Several "failures" here were stale assertions.
