"use strict";
// ============================================================
// PURE APP LOGIC — no React, no DOM.
// ============================================================
// Everything in this file is plain data and pure(ish) functions: date
// helpers, the module-flag registry, and the progression/rate math for
// Personal Trainer, Progress Tracker, Cardio and Mobility. index.html loads
// this via <script src="logic.js"> before its own inline script, so
// everything here becomes an ordinary global the rendering code (App() and
// friends) can use directly, same as if it were still inline.
//
// The module.exports guard at the bottom makes the same file requirable
// from Node for the test suite (see test/), without changing anything
// about how the browser loads it.
// ============================================================
const ACCENT = "#FF5B35";
const TODAY_BLUE = "#3E7BFA";
// To disable rep color-coding, set this to false — or delete the whole
// block marked "COLOR CODING MODULE" below, plus its one call site inside
// the rep-cell renderer further down (search "computeRepColor("). Nothing
// else in the app depends on it.
const COLOR_CODE_ENABLED = true;
const LOCAL_KEY = "wsl_v3";
const BUILTIN_ID = 0; // Split 4.0's program id — matches the historical `0` already baked into existing entry keys. Never change this.
// To remove the "Add Manually" program builder, set this to false — or
// delete the whole block marked "MANUAL PROGRAM BUILDER" further down,
// plus the "Add Manually" button in the My Programs section. Programs you
// already built manually are stored as plain data (identical in shape to
// uploaded ones) and are completely unaffected either way.
const MANUAL_PROGRAM_BUILDER_ENABLED = true;
// ---- Your Supabase project (from the original app) ----
const SUPA_URL = "https://wbotaefcsxxlvbytmpxh.supabase.co";
const SUPA_KEY = "sb_publishable_e1TCH4HPHgxASiYOa6zmyg_X4LmufIJ";
const SPLITS = [
    {
        title: "Workout Split 4.0",
        short: "4.0",
        repeatFrequency: 7,
        days: [
            { day: "MONDAY", ex: ["Incline Press - 4 x 6-8", "Pull-ups - 2 x 6-8", "Lat Raise - 3 x 10-15", "Chest Fly - 3 x 10-15"] },
            { day: "TUESDAY", ex: ["Hack Squat - 3 x 6-8", "Leg Curl - 3 x 10-15", "OH Triceps Ext - 3 x 8-12", "EZ-Bar Curl - 3 x 8-12"] },
            { day: "WEDNESDAY", ex: ["Pull-ups - 4 x 6-8", "Incline Press - 3 x 6-8", "Lat Raise - 2 x 10-15", "T-Bar Row - 3 x 6-8"] },
            { day: "THURSDAY", ex: ["RDL - 3 x 7-10", "Leg Extension - 3 x 10-15", "Pushdown - 3 x 10-15", "Bayesian Curl - 3 x 10-15"] },
            { day: "FRIDAY", ex: ["Lat Raise - 4 x 10-15", "Pulldown - 3 x 7-10", "Incline Press - 2 x 6-8", "Rear Delt Fly - 3 x 12-16"] },
        ],
    },
];
const HEAD = 42, EX = 64;
// ============================================================
// BODY COMPOSITION MODULE (start) — safe to delete entirely: remove this
// block, the state/handlers/effects marked "BODY COMPOSITION" in App(),
// the card on the calendar page, and flip BODY_COMP_ENABLED to false.
// Unlike other modules, this one syncs through its own two Supabase
// tables (body_comp_entries, body_comp_blocks) rather than the shared
// entries blob — see PROJECT_CONTEXT.md for the SQL to create them.
const BODY_COMP_ENABLED = true;
const BC_ROW_H = 66;
const BC_START_DATE_KEY = "2026-04-06"; // fixed first Monday row, per spec
const BC_BLOCK_COLORS = {
    bulk: { bg: "#E3F5E7", border: "#2FAE66", chip: "#D8F0DE" },
    maintenance: { bg: "#FFF6D8", border: "#D8B84A", chip: "#FBEFC4" },
    cut: { bg: "#FDE7E5", border: "#D9645C", chip: "#F9D4D1" },
};
function bcMondaysInRange(startKey, endDate) {
    const rows = [];
    let d = keyToDate(startKey);
    while (d <= endDate) {
        rows.push(new Date(d));
        d = addDays(d, 7);
    }
    return rows;
}
function bcBlockForDate(blocks, dk) {
    return (blocks || []).find((b) => dk >= b.startDate && dk <= b.endDate) || null;
}
function bcTargetWeight(block, d) {
    if (!block)
        return null;
    const startingWeight = parseFloat(block.startingWeight);
    if (isNaN(startingWeight))
        return null;
    if (block.type === "maintenance")
        return startingWeight;
    const start = keyToDate(block.startDate);
    const weeksSince = Math.round((d - start) / (7 * 24 * 3600 * 1000));
    const rate = parseFloat(block.weeklyRate) || 0;
    const signedRate = block.type === "cut" ? -Math.abs(rate) : Math.abs(rate);
    return startingWeight + weeksSince * signedRate;
}
function bcRangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && bStart <= aEnd;
}
function bcFormatWeight(n) {
    if (n === null || n === undefined || isNaN(n))
        return "—";
    return (Math.round(n * 10) / 10).toString();
}
function bcSanitizeDecimal(val) {
    let v = val.replace(/[^0-9.\-]/g, "");
    const neg = v.startsWith("-");
    v = v.replace(/-/g, "");
    if (neg)
        v = "-" + v;
    const parts = v.split(".");
    if (parts.length > 2)
        v = parts[0] + "." + parts.slice(1).join("");
    return v;
}
// ============================================================
// BODY COMPOSITION MODULE (end)
// ============================================================
const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function colors(accent) {
    return {
        a: accent,
        line: "#ECE7DE",
        ink: "#26221D",
        muted: "#A79F93",
        headBg: "#F3EFE9",
        dayBg: `color-mix(in oklab, ${accent} 9%, #FDFBF9)`,
        dayInk: `color-mix(in oklab, ${accent} 74%, #2a1c14)`,
        disabled: "#F5F2EC",
    };
}
// Split 4.0's original row builder — kept exactly as-is so existing entry
// keys (rid values) never change.
function flatRows(splitIdx) {
    const rows = [];
    let rid = 0;
    SPLITS[splitIdx].days.forEach((d, di) => {
        d.ex.forEach((str) => {
            const idx = str.lastIndexOf(" - ");
            const base = idx >= 0 ? str.slice(0, idx) : str;
            const spec = idx >= 0 ? str.slice(idx + 3) : "";
            const sets = parseInt(spec, 10) || 3;
            rows.push({ t: "ex", base, spec, sets, rid, di });
            rid++;
        });
        const isMWF = d.day === "MONDAY" || d.day === "WEDNESDAY" || d.day === "FRIDAY";
        rows.push({ t: "ex", base: isMWF ? "Abs" : "Calves", spec: isMWF ? "3 x 10-15" : "3 x 12-20", sets: 3, rid: "e" + di, di });
    });
    return rows;
}
// ============================================================
// DATE HELPERS
// ============================================================
function pad2(n) { return String(n).padStart(2, "0"); }
function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function keyToDate(k) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }
function todayKey() { return dateKey(new Date()); }
function addDays(d, n) { const nd = new Date(d); nd.setDate(nd.getDate() + n); return nd; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function sameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth(); }
function sameDate(a, b) { return dateKey(a) === dateKey(b); }
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
function formatLongDate(d) {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return `${dayNames[d.getDay()]} \u00b7 ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
// ============================================================
// STOPWATCH (start) — purely local (not synced), tied to programId+date so
// leaving and returning to the same workout resumes correctly. Elapsed
// time is always computed from a real start timestamp rather than counted
// tick by tick, so it's accurate immediately upon returning from the
// background even though the display can't visibly animate while
// backgrounded (a hard iOS/web platform limitation, not fixable from a
// webpage). Safe to delete along with its state/effects in App() and the
// "STOPWATCH" section in the focused view.
function formatStopwatch(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}
// ============================================================
// STOPWATCH (end)
// ============================================================
// legacy MM/DD/YY parser, kept only for migrating old date-cell values
function parseMDY(str) {
    const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(str || "");
    if (!m)
        return null;
    const mm = parseInt(m[1], 10), dd = parseInt(m[2], 10), yy = parseInt(m[3], 10);
    const d = new Date(2000 + yy, mm - 1, dd);
    return isNaN(d.getTime()) ? null : d;
}
// ============================================================
// PROGRAM MODEL
// ============================================================
// Every program (built-in or uploaded) is normalized to:
//   weekly:  { id, name, kind: "weekly", days: [{dow0-6, exercises:[{rid,name,sets,repRange}]}] }
//   custom:  { id, name, kind: "custom", dayTypes: [{id,label,exercises:[{rid,name,sets,repRange}]}] }
// Split 4.0 was originally the app's one hardcoded program, and its id (0)
// is baked into every entry key logged before multi-program support existed.
// It is no longer offered to new users. Accounts that already hold data under
// program 0 get it migrated exactly once into their normal programs list (see
// the "PROGRAM 0 MIGRATION" effect in App()), after which it behaves like any
// other program — except it stays locked against editing, because its
// exercise rids are load-bearing for years of logged history.
function builtinProgram() {
    const flat = flatRows(0);
    const diToDow = [1, 2, 3, 4, 5]; // Split 4.0's di 0-4 (Mon-Fri) -> real weekday 1-5
    const days = DOW_NAMES.map((_, dow) => ({ dow, exercises: [] }));
    flat.forEach((r) => {
        const dow = diToDow[r.di];
        const repRange = r.spec.includes(" x ") ? r.spec.split(" x ")[1] : r.spec;
        days[dow].exercises.push({ rid: r.rid, name: r.base, sets: r.sets, repRange });
    });
    return { id: BUILTIN_ID, name: SPLITS[0].title, kind: "weekly", days, locked: true };
}
// Rendered only so UI reading activeProgram.name/.kind has something safe to
// show when nothing is scheduled or the user has no programs yet. It has no
// exercises, so every date reads as a rest day rather than crashing.
function emptyProgram() {
    return { id: null, name: "No Program", kind: "weekly", days: DOW_NAMES.map((_, dow) => ({ dow, exercises: [] })), placeholder: true };
}
// Strict lookup — returns null when the program genuinely isn't there. Used
// wherever "no program" must stay distinguishable from "some program".
function findProgramById(programs, id) {
    if (id === null || id === undefined)
        return null;
    return (programs || []).find((pp) => pp.id === id) || null;
}
function getActiveProgram(currentProgramId, programs) {
    return findProgramById(programs, currentProgramId) || emptyProgram();
}
// ============================================================
// PROGRAM BLOCKS MODULE (start) — safe to delete entirely: remove this
// block, the state/handlers/effects marked "PROGRAM BLOCKS" in App(), the
// blocks-management screen, the "Program Schedule" entry in My Programs,
// and revert the calendar cell loop / openWorkout / header title to use
// the single `activeProgram` (derived straight from currentProgramId)
// the way they did before this feature, then flip PROGRAM_BLOCKS_ENABLED
// to false. Mirrors the Body Composition Blocks pattern: date ranges,
// each assigned to one program instead of a bulk/cut/maintenance type.
// A block with endDate === null is "open-ended" — runs until the next
// Switch Program action closes it. Only one block is ever open-ended at
// a time; Master Calendar resolves, for any date, which program governs
// it by finding the covering block (gap = rest day, same semantics as
// Body Comp Block gaps).
const PROGRAM_BLOCKS_ENABLED = true;
function pbOverlaps(aStart, aEnd, bStart, bEnd) {
    const aE = aEnd || "9999-12-31";
    const bE = bEnd || "9999-12-31";
    return aStart <= bE && bStart <= aE;
}
function resolveProgramIdForDate(programBlocks, dk) {
    const block = (programBlocks || []).find((b) => dk >= b.startDate && (!b.endDate || dk <= b.endDate));
    return block ? block.programId : null;
}
function resolveProgramForDate(programBlocks, programs, d) {
    const pid = resolveProgramIdForDate(programBlocks, dateKey(d));
    if (pid === null)
        return null;
    // Strict: a block pointing at a program that no longer exists reads as a
    // gap, not as some other program.
    return findProgramById(programs, pid);
}
function pbProgramName(programs, pid) {
    const p = findProgramById(programs, pid);
    return p ? p.name : "(deleted program)";
}
// Soft background tints used to band the calendar by which program governs
// each date. Deliberately low-saturation so they sit behind the green
// "logged" ring, the blue today border and the red cardio underline without
// competing with any of them. Assigned by position in the programs list
// rather than by hashing the id — hashing produced frequent collisions,
// which would make two different programs share a band and defeat the point.
const PB_TINTS = ["#EDF3FA", "#F4EFF8", "#EDF6F0", "#FBF2EC", "#F7F1E8", "#F0F2F6"];
function pbTintForProgram(pid, programs) {
    if (pid === null || pid === undefined)
        return null;
    const idx = (programs || []).findIndex((p) => p.id === pid);
    if (idx < 0)
        return null;
    return PB_TINTS[idx % PB_TINTS.length];
}
// ============================================================
// PROGRAM BLOCKS MODULE (end)
// ============================================================
function exercisesForDate(program, entries, d) {
    if (program.kind === "weekly") {
        const day = program.days.find((x) => x.dow === d.getDay());
        return day ? day.exercises : [];
    }
    const dk = dateKey(d);
    const dtId = entries[`dt|${program.id}|${dk}`];
    if (!dtId)
        return null; // not yet assigned
    const dt = (program.dayTypes || []).find((x) => x.id === dtId);
    return dt ? dt.exercises : [];
}
// ============================================================
// FINISHER EXERCISES (start) — ad hoc extras added to one specific date,
// entirely separate from the program template. Safe to delete along with
// its state/handlers in App() and the "Finishers" UI block in the focused
// view — has no effect on Previous/Next Workout, which only ever looks at
// day-type/weekday matching, never at what finishers exist on a given day.
function getFinishers(entries, programId, dk) {
    const raw = entries[`fin|${programId}|${dk}`];
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (e) {
        return [];
    }
}
// ============================================================
// FINISHER EXERCISES (end)
// ============================================================
function dayHasReps(entries, program, d) {
    const exs = exercisesForDate(program, entries, d);
    const dk = dateKey(d);
    const templateHit = !!(exs && exs.length && exs.some((ex) => {
        for (let si = 0; si < ex.sets; si++) {
            if (entries[`rd|${program.id}|${dk}|${ex.rid}|${si}`])
                return true;
        }
        return false;
    }));
    if (templateHit)
        return true;
    const finishers = getFinishers(entries, program.id, dk);
    return finishers.some((f) => {
        for (let si = 0; si < 5; si++) {
            if (entries[`rd|${program.id}|${dk}|${f.id}|${si}`])
                return true;
        }
        return false;
    });
}
// ============================================================
// XLSX PROGRAM PARSING (start) — safe to delete along with the "Add
// Program" button and its file input if this feature is ever removed.
// ============================================================
function parseProgramWorkbook(workbook, programName) {
    const XLSXlib = window.XLSX;
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSXlib.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (!rows.length)
        throw new Error("That file looks empty.");
    const col0 = String(rows[0][0] || "").trim().toLowerCase();
    let kind;
    if (col0.indexOf("day of week") === 0)
        kind = "weekly";
    else if (col0.indexOf("day type") === 0)
        kind = "custom";
    else
        throw new Error('The first column header must be "Day of Week" or "Day Type".');
    const groups = [];
    let current = null;
    let rid = 0;
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const label = String(row[0] || "").trim();
        const exName = String(row[1] || "").trim();
        const sets = parseInt(row[2], 10);
        const reps = String(row[3] || "").trim();
        if (label) {
            current = { label, exercises: [] };
            groups.push(current);
        }
        if (!exName || !current)
            continue;
        current.exercises.push({ rid: rid++, name: exName, sets: isNaN(sets) ? 3 : sets, repRange: reps || "-" });
    }
    if (!groups.length)
        throw new Error("No rows found under any day label.");
    if (kind === "weekly") {
        const days = DOW_NAMES.map((name, dow) => {
            const g = groups.find((g) => g.label.toLowerCase() === name.toLowerCase());
            return { dow, exercises: g ? g.exercises : [] };
        });
        if (!days.some((d) => d.exercises.length))
            throw new Error("No exercises found for any day of the week.");
        return { id: "prog_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8), name: programName, kind: "weekly", days, createdAt: new Date().toISOString() };
    }
    const dayTypes = groups.filter((g) => g.exercises.length).map((g, i) => ({ id: "dt" + i, label: g.label, exercises: g.exercises }));
    if (!dayTypes.length)
        throw new Error("No exercises found for any day type.");
    return { id: "prog_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8), name: programName, kind: "custom", dayTypes, createdAt: new Date().toISOString() };
}
// ============================================================
// XLSX PROGRAM PARSING (end)
// ============================================================
// ============================================================
// LEGACY DATA MIGRATION (start) — safe to delete once you're confident
// everyone's data has migrated. Purely additive: it only ever adds new
// "wd|"/"rd|" (date-keyed) entries, never touches or removes the old
// "w|"/"r|"/"d|" (week-indexed) entries, so nothing can be lost by
// running this repeatedly.
// ============================================================
function migrateLegacyEntries(entries) {
    const next = Object.assign({}, entries);
    let migrated = 0;
    Object.keys(entries).forEach((k) => {
        const m = /^d\|(\d+)\|(\d+)\|(\d+)$/.exec(k);
        if (!m)
            return;
        const spIdx = parseInt(m[1], 10), wi = m[2], di = parseInt(m[3], 10);
        if (!SPLITS[spIdx])
            return;
        const parsed = parseMDY(entries[k]);
        if (!parsed)
            return;
        const dk = dateKey(parsed);
        flatRows(spIdx).filter((r) => r.di === di).forEach((r) => {
            const wOld = `w|${spIdx}|${wi}|${r.rid}`;
            const wNew = `wd|${spIdx}|${dk}|${r.rid}`;
            if (entries[wOld] !== undefined && next[wNew] === undefined) {
                next[wNew] = entries[wOld];
                migrated++;
            }
            for (let si = 0; si < r.sets; si++) {
                const rOld = `r|${spIdx}|${wi}|${r.rid}|${si}`;
                const rNew = `rd|${spIdx}|${dk}|${r.rid}|${si}`;
                if (entries[rOld] !== undefined && next[rNew] === undefined) {
                    next[rNew] = entries[rOld];
                    migrated++;
                }
            }
        });
    });
    return { next, migrated };
}
// ============================================================
// LEGACY DATA MIGRATION (end)
// ============================================================
// ============================================================
// COLOR CODING MODULE (start) — safe to delete this entire block
// ============================================================
// Rule: comparing a rep cell against the same set of the same exercise in
// the previous occurrence of this same workout. For weekly programs that's
// 7 calendar days earlier; for custom programs (e.g. Push/Pull/Legs) it's
// the previous date actually assigned the same day type, which may not be
// exactly a week back. Only fires if the weight that day matches this day's
// weight exactly.
//   reps went up   -> green
//   reps unchanged -> yellow
//   reps went down -> red
// When the weight INCREASED, the load is itself the progression, so a
// rep-for-rep comparison against a lighter session would be misleading.
// In that case exactly one cell turns green — the final set — and only once
// every set has cleared the rep-range floor. Weight decreases go uncolored.
const REP_COLOR_BG = { green: "#E3F5E7", yellow: "#FFF6D8", red: "#FDE7E5" };
// Finds the date of the previous occurrence of the same workout. For weekly
// programs that's simply 7 days earlier (Monday compares to last Monday).
// For custom programs (e.g. Push/Pull/Legs) the same day type can land on
// different weekdays week to week, so we walk back to the previous date
// actually assigned that day type — the same lookup Previous Workout uses.
// Returns null when there's no meaningful previous session to compare to.
function findPrevSessionKey(entries, program, dk) {
    if (!program)
        return null;
    if (program.kind === "weekly")
        return dateKey(addDays(keyToDate(dk), -7));
    const dtId = entries[`dt|${program.id}|${dk}`];
    if (!dtId)
        return null;
    return findAdjacentSameDayType(entries, program.id, dk, dtId, -1);
}
function computeRepColor(entries, program, dk, ex, si) {
    if (!COLOR_CODE_ENABLED)
        return null;
    if (!program || !ex)
        return null;
    const programId = program.id;
    const rid = ex.rid;
    const prevKey = findPrevSessionKey(entries, program, dk);
    if (!prevKey)
        return null;
    const wCur = entries[`wd|${programId}|${dk}|${rid}`];
    const wPrev = entries[`wd|${programId}|${prevKey}|${rid}`];
    if (!wCur || !wPrev)
        return null;
    const wCurNum = parseFloat(wCur), wPrevNum = parseFloat(wPrev);
    if (isNaN(wCurNum) || isNaN(wPrevNum))
        return null;
    // Weight went UP — the load itself is the progression, so a rep-by-rep
    // comparison against a lighter session isn't meaningful. Credit it once,
    // on the final set, and only once every set has cleared the rep-range
    // floor (i.e. the new weight was handled across the whole exercise, not
    // just held onto for a set or two).
    if (wCurNum > wPrevNum) {
        const range = ptParseRange(ex.repRange);
        if (!range)
            return null;
        const nSets = Math.max(1, ex.sets || 1);
        for (let i = 0; i < nSets; i++) {
            const rv = entries[`rd|${programId}|${dk}|${rid}|${i}`];
            const n = rv ? parseInt(rv, 10) : NaN;
            if (isNaN(n) || n < range.floor)
                return null; // not all sets cleared the floor (yet)
        }
        return si === nSets - 1 ? "green" : null;
    }
    // Weight went DOWN — no comparison worth drawing.
    if (wCurNum !== wPrevNum)
        return null;
    // Same weight — the original set-by-set comparison.
    const rCur = entries[`rd|${programId}|${dk}|${rid}|${si}`];
    const rPrev = entries[`rd|${programId}|${prevKey}|${rid}|${si}`];
    if (!rCur || !rPrev)
        return null;
    const rCurNum = parseInt(rCur, 10), rPrevNum = parseInt(rPrev, 10);
    if (isNaN(rCurNum) || isNaN(rPrevNum))
        return null;
    if (rCurNum > rPrevNum)
        return "green";
    if (rCurNum === rPrevNum)
        return "yellow";
    return "red";
}
// ============================================================
// COLOR CODING MODULE (end)
// ============================================================
// ============================================================
// PERSONAL TRAINER MODULE (start) — safe to delete entirely: remove this
// block, the "PERSONAL TRAINER" state/handlers in App(), the trainer popup
// and the Trainer button in the compact session row, then flip
// PERSONAL_TRAINER_ENABLED to false. Purely a read-only planner over data
// that already exists — no new storage, no sync, no network.
//
// The progression model, in the user's own terms:
//   * Never add more than 1 rep to a set, and always fill in order, so a
//     session's reps are monotonically non-increasing (7-7-6-6, never
//     7-6-7-6). That makes the state at a given weight a simple counter:
//     how many sets have been advanced above the base.
//         6-6-6-6 -> 7-6-6-6 -> 7-7-6-6 -> 7-7-7-6 -> 7-7-7-7 -> base++
//   * Exactly one set gets the rep each session (the first set sitting at
//     the base). Everything else holds. "Stimulate, don't annihilate."
//   * A brand new weight resets every set to the rep-range floor.
//   * When every set reaches the range ceiling, it's time to add weight.
// Because targets are always hit by construction, reps alone can't reveal
// whether a weight felt easy. The one honest signal is the user beating
// the prescription (adding to 2+ sets in a session) — ptRunningAhead()
// counts those, and the UI offers a faster ladder once it's a pattern
// rather than a one-off.
const PERSONAL_TRAINER_ENABLED = true;
const PT_PUSH_BG = "#E3F5E7", PT_PUSH_FG = "#1B7A46", PT_PUSH_BORDER = "#2FAE66";
const PT_HOLD_BG = "#FFF6D8", PT_HOLD_FG = "#8A6D1B", PT_HOLD_BORDER = "#E3CE84";
const PT_MANTRAS = {
    push: "Any Progress Every Exercise Wins the Workout.",
    hold: "Stimulate, Don't Annihilate.",
    form: "Stretch. Control. Squeeze.",
    newWeight: "Control the Weight, Control the Ego.",
    addWeight: "Weight is the Tool, Tension the Driver.",
    lastExercise: "Leave on a Quarter Tank.",
};
function ptParseRange(repRange) {
    if (!repRange)
        return null;
    const s = String(repRange);
    const m = s.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (m) {
        const floor = parseInt(m[1], 10), ceiling = parseInt(m[2], 10);
        if (isNaN(floor) || isNaN(ceiling))
            return null;
        return { floor: Math.min(floor, ceiling), ceiling: Math.max(floor, ceiling) };
    }
    const one = s.match(/(\d+)/);
    if (one) {
        const v = parseInt(one[1], 10);
        if (!isNaN(v))
            return { floor: v, ceiling: v };
    }
    return null;
}
function ptSessionReps(entries, programId, dk, rid, nSets) {
    const reps = [];
    for (let i = 0; i < nSets; i++) {
        const v = entries[`rd|${programId}|${dk}|${rid}|${i}`];
        const n = v ? parseInt(v, 10) : NaN;
        reps.push(isNaN(n) ? null : n);
    }
    return reps;
}
// Walks back through previous occurrences of this same workout (day-type
// aware, reusing findPrevSessionKey) collecting sessions that actually have
// data for this exercise. Newest first.
function ptPrevSessions(entries, program, dk, rid, nSets, want) {
    const out = [];
    let cursor = dk;
    for (let guard = 0; guard < 14 && out.length < (want || 6); guard++) {
        const prev = findPrevSessionKey(entries, program, cursor);
        if (!prev)
            break;
        cursor = prev;
        const wRaw = entries[`wd|${program.id}|${prev}|${rid}`];
        const w = wRaw ? parseFloat(wRaw) : NaN;
        const reps = ptSessionReps(entries, program.id, prev, rid, nSets);
        if (!isNaN(w) && reps.some((r) => r !== null))
            out.push({ dk: prev, weight: w, reps });
    }
    return out;
}
// How many times, across consecutive same-weight sessions, total reps rose
// by 2 or more — i.e. the user advanced more than the single prescribed set.
function ptRunningAhead(history, weight) {
    const same = history.filter((h) => h.weight === weight);
    const sum = (r) => r.filter((x) => x !== null).reduce((a, b) => a + b, 0);
    let count = 0;
    for (let i = 0; i < same.length - 1; i++) {
        if (sum(same[i].reps) - sum(same[i + 1].reps) >= 2)
            count++;
    }
    return count;
}
function ptComputePlan(entries, program, dk, ex) {
    const nSets = Math.max(1, ex.sets || 1);
    const range = ptParseRange(ex.repRange);
    const todayReps = ptSessionReps(entries, program.id, dk, ex.rid, nSets);
    const curRaw = entries[`wd|${program.id}|${dk}|${ex.rid}`];
    const curWeight = curRaw ? parseFloat(curRaw) : NaN;
    const base = { name: ex.name, rid: ex.rid, nSets, range, todayReps, repRange: ex.repRange };
    if (!range)
        return Object.assign({}, base, { kind: "norange" });
    const history = ptPrevSessions(entries, program, dk, ex.rid, nSets, 6);
    const prev = history[0] || null;
    if (!prev)
        return Object.assign({}, base, { kind: "first", targets: Array(nSets).fill(range.floor), pushIdx: -1 });
    // If today's weight hasn't been entered yet, plan as if the weight is
    // unchanged — that's the common case and the most useful default.
    const weightAssumed = isNaN(curWeight);
    const effWeight = weightAssumed ? prev.weight : curWeight;
    const shared = Object.assign({}, base, { prev, history, effWeight, weightAssumed });
    if (effWeight !== prev.weight) {
        return Object.assign({}, shared, { kind: "newweight", targets: Array(nSets).fill(range.floor), pushIdx: -1 });
    }
    const valid = prev.reps.filter((r) => r !== null);
    if (!valid.length)
        return Object.assign({}, shared, { kind: "first", targets: Array(nSets).fill(range.floor), pushIdx: -1 });
    const complete = prev.reps.every((r) => r !== null);
    if (complete && prev.reps.every((r) => r >= range.ceiling)) {
        return Object.assign({}, shared, { kind: "addweight", targets: Array(nSets).fill(range.floor), pushIdx: -1 });
    }
    const lo = Math.min.apply(null, valid);
    const targets = prev.reps.map((r) => (r === null ? lo : r));
    const pushIdx = targets.findIndex((r) => r === lo);
    if (pushIdx >= 0)
        targets[pushIdx] = Math.min(range.ceiling, lo + 1);
    return Object.assign({}, shared, {
        kind: "ladder",
        targets,
        pushIdx,
        aheadCount: ptRunningAhead(history, prev.weight),
    });
}
function ptMantraFor(plan, isLastExercise) {
    if (!plan)
        return PT_MANTRAS.form;
    if (isLastExercise)
        return PT_MANTRAS.lastExercise;
    if (plan.kind === "newweight")
        return PT_MANTRAS.newWeight;
    if (plan.kind === "addweight")
        return PT_MANTRAS.addWeight;
    if (plan.kind === "ladder") {
        const done = plan.todayReps.filter((r) => r !== null).length;
        // Once you're past the set that carries the rep, the job switches
        // from earning progress to not overspending it.
        if (plan.pushIdx >= 0 && done > plan.pushIdx)
            return PT_MANTRAS.hold;
        return PT_MANTRAS.push;
    }
    return PT_MANTRAS.form;
}
function ptHeadline(plan) {
    if (!plan)
        return "";
    switch (plan.kind) {
        case "norange": return "No rep range set for this exercise.";
        case "first": return `First time logged — aim for ${plan.range.floor} across all sets.`;
        case "newweight": return `New weight — reset to ${plan.range.floor}. The ladder restarts next session.`;
        case "addweight": return `Every set hit ${plan.range.ceiling}. Add weight and reset to ${plan.range.floor}.`;
        case "ladder": return `Set ${plan.pushIdx + 1} carries the rep. Everything else holds.`;
        default: return "";
    }
}
// ============================================================
// PERSONAL TRAINER MODULE (end)
// ============================================================
// ============================================================
// MOBILITY MODULE (start) — safe to delete entirely: remove this block, the
// "MOBILITY" state/handlers in App(), its dashboard button and screen, the
// mobility card in the Progress Tracker, drop the registry entry, then flip
// FEATURE_MOBILITY to false.
//
// Deliberately NOT built on the Cardio machinery. Cardio escalates a weekly
// volume target because more minutes is the goal; mobility is the opposite —
// what matters is touching it often, not doing more of it in one sitting. So
// this logs a simple set of modalities per day with no timer and no duration,
// and is measured by how many of the last 30 days had anything logged.
const FEATURE_MOBILITY = true;
const MOBILITY_BLUE = "#2B5FCC";
const MOBILITY_BLUE_SOFT = "#EAF0FC";
const MOBILITY_BLUE_MID = "#93AEE6"; // one session logged; solid blue means both
const MOBILITY_WINDOW_DAYS = 20; // fixed denominator, on purpose — see below
const MOBILITY_SLOTS = ["am", "pm"];
// Each day holds two independent sessions. 20 days x 2 slots = 40 slots, so a
// single session is worth exactly 2.5% and a full day 5% — which is why the
// window is 20 rather than 30.
// Fixed list, edited here in the source rather than in the app. Ids are what
// get written into mobilityLog, so they must stay stable — change a label
// freely, but changing an id orphans previously logged days. `info` is shown
// in the popup behind the ⓘ button; omit it where the drill needs no
// explanation.
const MOBILITY_MODALITIES = [
    { id: "squat_drill", label: "Squat Drill" },
    { id: "doorway_series", label: "Doorway Series",
      info: "Doorway pec stretch, then wall slides.\n\nPec stretch: forearm on the frame, elbow at shoulder height, step through and turn away. 30s each side.\n\nWall slides: back flat to the wall, elbows out at 90°, slide the arms up and down keeping the wrists and elbows in contact." },
    { id: "ytw_raises", label: "YTW Raises",
      info: "Bent at the hips or on an incline, arms straight, thumbs up.\n\nY — raise into a Y overhead (lower trap).\nT — arms straight out to the sides (mid trap, rear delt).\nW — elbows bent, squeeze the shoulder blades and rotate the hands back (external rotation).\n\n8–10 each." },
    { id: "ground_hip_flow", label: "Ground Hip Flow",
      info: "One trip to the floor, four positions.\n\nChild's pose — knees wide, sit back, reach forward.\nFrog — knees wide on hands and knees, rock the hips back (adductors).\n90/90 — one leg front at 90°, one out to the side, rotate the knees side to side.\nPigeon — front shin across, back leg straight, fold forward. Both sides." },
    { id: "standing_flow", label: "Standing Flow",
      info: "Mountain with the arms overhead, into chair.\n\nTwisted chair — elbow to the opposite knee, rotate through the mid-back.\nFigure-4 chair — cross the ankle over the opposite knee and sit back on one leg.\n\nBoth sides. Balance, hip and thoracic rotation." },
    { id: "wide_stance", label: "Wide Stance Routine",
      info: "Cossack squats, then a bodyweight sumo hinge.\n\nCossack — wide stance, shift the weight to one side and sit down, the other leg straight. Adductors under load.\n\nSumo hinge — wide stance, hinge at the hips with a flat back. Hamstrings and adductors." },
];
// Old builds let the list be user-built, so logged days may carry generated
// ids (mb_xxxx). This maps those onto the fixed ids by matching the label the
// user had saved, so nothing already logged is lost.
function mobilityNormalizeLabel(x) {
    return String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function mobilityMigrateLog(mobilityLog, oldModalities) {
    if (!Array.isArray(oldModalities) || !oldModalities.length)
        return null;
    const byNorm = {};
    MOBILITY_MODALITIES.forEach((m) => { byNorm[mobilityNormalizeLabel(m.label)] = m.id; });
    const remap = {};
    oldModalities.forEach((om) => {
        const target = byNorm[mobilityNormalizeLabel(om.label)];
        if (target && om.id !== target)
            remap[om.id] = target;
    });
    if (!Object.keys(remap).length)
        return null;
    const next = {};
    let touched = false;
    Object.keys(mobilityLog || {}).forEach((dk) => {
        const e = mobilityDayEntry(mobilityLog, dk);
        const conv = (arr) => arr.map((id) => { if (remap[id]) { touched = true; return remap[id]; } return id; });
        next[dk] = { am: conv(e.am), pm: conv(e.pm) };
    });
    return touched ? next : null;
}

// Stored shape is { dateKey: { am: [ids], pm: [ids] } }. Days written before
// AM/PM existed are a bare array; those are read as an AM session so nothing
// already logged is lost or silently reassigned.
function mobilityDayEntry(mobilityLog, dk) {
    const v = (mobilityLog || {})[dk];
    if (!v)
        return { am: [], pm: [] };
    if (Array.isArray(v))
        return { am: v.slice(), pm: [] };
    return { am: Array.isArray(v.am) ? v.am : [], pm: Array.isArray(v.pm) ? v.pm : [] };
}
function mobilitySlotList(mobilityLog, dk, slot) {
    const e = mobilityDayEntry(mobilityLog, dk);
    return slot === "pm" ? e.pm : e.am;
}
// Every modality logged that day, either slot. Used to enforce once-per-day.
function mobilityDayList(mobilityLog, dk) {
    const e = mobilityDayEntry(mobilityLog, dk);
    return e.am.concat(e.pm);
}
function mobilityHasAny(mobilityLog, dk) {
    const e = mobilityDayEntry(mobilityLog, dk);
    return e.am.length > 0 || e.pm.length > 0;
}
// 0, 1 or 2 — drives both the metric and the calendar's two shades.
function mobilitySessionCount(mobilityLog, dk) {
    const e = mobilityDayEntry(mobilityLog, dk);
    return (e.am.length > 0 ? 1 : 0) + (e.pm.length > 0 ? 1 : 0);
}
// Share of the last 20 days' worth of session slots that were filled. The
// denominator is always 40 — never "slots since you started" — so the figure
// begins at 0% and climbs as the habit builds.
function progMobilityStats(mobilityLog, todayKey) {
    if (!FEATURE_MOBILITY)
        return null;
    const end = keyToDate(todayKey);
    let sessions = 0, days = 0;
    for (let i = 0; i < MOBILITY_WINDOW_DAYS; i++) {
        const dk = dateKey(addDays(end, -i));
        const n = mobilitySessionCount(mobilityLog, dk);
        sessions += n;
        if (n > 0)
            days++;
    }
    const total = MOBILITY_WINDOW_DAYS * MOBILITY_SLOTS.length;
    const pct = (sessions / total) * 100;
    return {
        sessions, days, total, window: MOBILITY_WINDOW_DAYS, pct,
        // 2.5% per session means halves are real, so keep one decimal when
        // there is one rather than rounding 32.5 to 33.
        pctText: (Math.round(pct * 10) / 10).toString(),
    };
}
// ============================================================
// MOBILITY MODULE (end)
// ============================================================
// ============================================================
// PROGRESS TRACKER MODULE (start) — safe to delete entirely: remove this
// block, the "PROGRESS TRACKER" state in App(), its dashboard button and
// its screen, drop the registry entry, then flip PROGRESS_TRACKER_ENABLED
// to false. Read-only over existing data; no storage, no sync.
//
// Metric: of the exercises in a session where progress was actually
// possible, what share progressed? "Progressed" reuses computeRepColor
// exactly — any green cell counts — so the two views can never disagree,
// including the weight-increase case (load went up and every set cleared
// the rep-range floor, which greens the final set).
//
// Denominator rules, agreed with the user:
//   * finishers are excluded — they're ad hoc and not on a ladder. This
//     falls out for free, since exercisesForDate() returns only the
//     program's own exercises.
//   * an exercise with no comparable previous session is excluded rather
//     than counted as a miss; green is impossible there, so counting it
//     would make the first session of any new program score 0%.
//   * an exercise the user didn't log at all that day is excluded.
// A day where nothing qualifies returns null (no colour) rather than 0%,
// so "rest day" never looks like "total failure".
const PROGRESS_TRACKER_ENABLED = true;
// Some exercises aren't reliably countable — reps get estimated, partials
// creep in, and "did it progress?" becomes noise rather than signal. They're
// excluded from BOTH the monthly grade and the per-exercise table, on
// purpose: scoring them in one view and not the other would let the two
// disagree about the same session. Matched case-insensitively on the
// exercise name, so it catches them wherever they appear in a program.
const PROG_EXCLUDED_EXERCISES = ["abs", "calves"];
function progExerciseCounts(name) {
    const n = String(name || "").trim().toLowerCase();
    if (!n)
        return false;
    return PROG_EXCLUDED_EXERCISES.indexOf(n) < 0;
}
function progExerciseEligible(entries, program, dk, ex) {
    if (!progExerciseCounts(ex.name))
        return false;
    const prevKey = findPrevSessionKey(entries, program, dk);
    if (!prevKey)
        return false;
    const wCur = entries[`wd|${program.id}|${dk}|${ex.rid}`];
    const wPrev = entries[`wd|${program.id}|${prevKey}|${ex.rid}`];
    if (!wCur || !wPrev)
        return false;
    const nSets = Math.max(1, ex.sets || 1);
    for (let si = 0; si < nSets; si++) {
        if (entries[`rd|${program.id}|${dk}|${ex.rid}|${si}`])
            return true; // logged something today
    }
    return false;
}
// Whether this exercise counts as having progressed. NOTE this is a stricter
// question than "did any cell turn green", and deliberately so: at the same
// weight, 13-13-13 -> 14-13-12 lights one green cell but the total is
// unchanged — a rep was moved, not added. Judging on TOTAL reps catches that,
// where a per-cell check would score it as progress.
//
// Cell colouring is untouched by this; individual sets still turn green /
// yellow / red as they're entered.
function progExerciseProgressed(entries, program, dk, ex) {
    const nSets = Math.max(1, ex.sets || 1);
    const prevKey = findPrevSessionKey(entries, program, dk);
    if (!prevKey)
        return false;
    const wCurRaw = entries[`wd|${program.id}|${dk}|${ex.rid}`];
    const wPrevRaw = entries[`wd|${program.id}|${prevKey}|${ex.rid}`];
    if (!wCurRaw || !wPrevRaw)
        return false;
    const wCur = parseFloat(wCurRaw), wPrev = parseFloat(wPrevRaw);
    if (isNaN(wCur) || isNaN(wPrev))
        return false;
    // Weight went up: the load itself is the progression. computeRepColor
    // already encodes that rule (every set must clear the rep-range floor,
    // and then the final set greens), so defer to it rather than restate it.
    if (wCur > wPrev) {
        for (let si = 0; si < nSets; si++) {
            if (computeRepColor(entries, program, dk, ex, si) === "green")
                return true;
        }
        return false;
    }
    // Weight went down: not progress.
    if (wCur < wPrev)
        return false;
    // Same weight: total reps must have increased.
    let curTotal = 0, prevTotal = 0;
    for (let si = 0; si < nSets; si++) {
        const c = parseInt(entries[`rd|${program.id}|${dk}|${ex.rid}|${si}`], 10);
        const p = parseInt(entries[`rd|${program.id}|${prevKey}|${ex.rid}|${si}`], 10);
        if (!isNaN(c))
            curTotal += c;
        if (!isNaN(p))
            prevTotal += p;
    }
    return curTotal > prevTotal;
}
function progDayRate(entries, program, d) {
    if (!program)
        return null;
    const dk = dateKey(d);
    const exs = exercisesForDate(program, entries, d);
    if (!exs || !exs.length)
        return null;
    let total = 0, progressed = 0;
    exs.forEach((ex) => {
        if (!progExerciseEligible(entries, program, dk, ex))
            return;
        total++;
        if (progExerciseProgressed(entries, program, dk, ex))
            progressed++;
    });
    if (total === 0)
        return null;
    return { progressed, total, pct: Math.round((progressed / total) * 100) };
}
// Resolves which program governed that date first, so the rate stays correct
// across Program Block boundaries.
function progDayRateResolved(entries, programBlocks, programs, d) {
    const program = resolveProgramForDate(programBlocks, programs, d);
    if (!program)
        return null;
    return progDayRate(entries, program, d);
}
// Classifies a calendar square into the three things it can mean. The point
// of the distinction is that only "rated" days carry information: a rest day,
// a date with no program scheduled, and a day that hasn't happened yet are
// all equally irrelevant to how training is going, and should read as inert
// rather than as absence of progress.
//   rated — a session happened and produced a reading
//   open  — a workout was scheduled and the day has passed, but nothing
//           qualified (nothing logged, or only first-time exercises)
//   off   — future, rest day, or no program scheduled: doesn't apply
// Maps weekStartKey -> { target, effective, met } for the cardio weekly
// target. Calendar rows run Sunday-Saturday, which is exactly how cardio
// weeks are defined, so each row of the month grid IS one cardio week.
function progCardioWeekMap(cardioSessions) {
    const out = {};
    if (!FEATURE_CARDIO)
        return out;
    cardioWeekProgression(cardioSessions).forEach((w) => { out[w.weekKey] = w; });
    return out;
}
// Cardio weeks falling inside a block, and how many hit target. A week is
// counted by its Sunday start, so a block beginning mid-week doesn't claim a
// week that was mostly run under the previous block.
// Smallest sample the cardio percentage is allowed to be computed over. Below
// this, a single week swings the number too far to mean anything.
const PROG_CARDIO_MIN_WEEKS = 6;
function progCardioBlockStats(cardioSessions, startKey, endKey) {
    if (!FEATURE_CARDIO || !startKey || !endKey)
        return null;
    // cardioWeekProgression() deliberately emits an unbroken run of weeks from
    // the first-ever session through today, including weeks with no activity,
    // because the escalating target has to advance week by week. For this
    // card we only want weeks the block actually contains AND in which cardio
    // was logged — otherwise a block would be scored against dormant weeks it
    // had nothing to do with.
    const weekHasActivity = {};
    (cardioSessions || []).forEach((s) => {
        if (s && s.durationSec >= CARDIO_FLOOR_SEC)
            weekHasActivity[cardioWeekStartKey(keyToDate(s.date))] = true;
    });
    // Count a week if it OVERLAPS the block at all, not if its Sunday start
    // falls inside it. Blocks routinely begin mid-week (a Monday switch is the
    // normal case), and the strict-start rule silently dropped the whole first
    // week even when every session in it belonged to the new block.
    //
    // The week currently in progress is a special case: it hasn't failed, it
    // just isn't finished. Counting it as a miss would drag the percentage
    // down mid-week and then silently repair itself later. So an unfinished
    // week only counts once its target is already met — a hit is credited
    // immediately, a not-yet is simply not counted.
    const currentWeekKey = cardioWeekStartKey(new Date());
    const eligible = cardioWeekProgression(cardioSessions).filter((w) => {
        if (!weekHasActivity[w.weekKey])
            return false;
        if (w.weekKey === currentWeekKey && !w.met)
            return false;
        return true;
    });
    const weekEndOf = (w) => dateKey(addDays(keyToDate(w.weekKey), 6));
    const inBlock = eligible.filter((w) => weekEndOf(w) >= startKey && w.weekKey <= endKey);
    // A freshly-started block can hold one or two weeks, and a percentage over
    // that few is mostly noise — one missed week would read as a catastrophic
    // drop. Top the sample up to PROG_CARDIO_MIN_WEEKS using the most recent
    // weeks from before the block, and tell the UI how many were borrowed so
    // it can say so rather than quietly implying they're all this block's.
    let used = inBlock;
    let backfilled = 0;
    if (inBlock.length < PROG_CARDIO_MIN_WEEKS) {
        const earlier = eligible
            .filter((w) => weekEndOf(w) < startKey)
            .slice(-(PROG_CARDIO_MIN_WEEKS - inBlock.length));
        backfilled = earlier.length;
        used = earlier.concat(inBlock);
    }
    if (!used.length)
        return null;
    const hit = used.filter((w) => w.met).length;
    return {
        weeks: used.length,
        hit,
        pct: Math.round((hit / used.length) * 100),
        currentTarget: used[used.length - 1].target,
        inBlock: inBlock.length,
        backfilled,
    };
}
function progDayState(entries, programBlocks, programs, d, todayKey) {
    const dk = dateKey(d);
    if (dk > todayKey)
        return { kind: "off" };
    const program = resolveProgramForDate(programBlocks, programs, d);
    if (!program)
        return { kind: "off" };
    const exs = exercisesForDate(program, entries, d);
    if (!exs || !exs.length)
        return { kind: "off" };
    const rate = progDayRate(entries, program, d);
    if (!rate)
        return { kind: "open" };
    return { kind: "rated", rate };
}
// Bands are deliberately coarse. Under the one-rep-per-exercise rule a clean
// session scores 100%, so the flat top band is the expected state and the
// dips carry all the signal.
// A session counts as a "Plus Day" at or above this share of its exercises
// progressing. Deliberately demanding: under the one-rep-per-exercise rule a
// clean session is 100%, so 80% means at most one exercise stalled.
const PROG_PLUS_DAY_MIN = 80;
// Month grade is POOLED — total exercises progressed over total eligible —
// rather than an average of per-session percentages. The two are identical
// only when every session has the same number of eligible exercises, which
// isn't true here (day types differ in size, and first-time or unlogged
// exercises drop out of the denominator). Pooling weights every exercise
// equally, which matches "Any Progress Every Exercise Wins the Workout";
// averaging session rates would let a 2-exercise day count as heavily as a
// 5-exercise one.
const PROG_GRADES = [
    { min: 90, letter: "A" },
    { min: 80, letter: "B" },
    { min: 70, letter: "C" },
    { min: 60, letter: "D" },
    { min: 0, letter: "F" },
];
function progGradeFor(pct) {
    if (pct === null || pct === undefined)
        return null;
    return (PROG_GRADES.find((g) => pct >= g.min) || PROG_GRADES[PROG_GRADES.length - 1]).letter;
}
// Rolls a month's day-states into the three complementary readings:
// pooled grade (overall completeness), plus days (consistency), and clean
// sweeps (perfection). Returns null when no session in the month produced a
// reading, so an untrained month shows "—" rather than an F.
function progMonthSummary(states) {
    const rated = (states || []).filter((s) => s && s.kind === "rated").map((s) => s.rate);
    if (!rated.length)
        return null;
    const totalProgressed = rated.reduce((a, r) => a + r.progressed, 0);
    const totalEligible = rated.reduce((a, r) => a + r.total, 0);
    const pct = totalEligible ? Math.round((totalProgressed / totalEligible) * 100) : 0;
    return {
        sessions: rated.length,
        totalProgressed,
        totalEligible,
        pct,
        grade: progGradeFor(pct),
        plusDays: rated.filter((r) => r.pct >= PROG_PLUS_DAY_MIN).length,
        sweeps: rated.filter((r) => r.pct === 100).length,
    };
}
// Per-exercise view, scoped to a Program Block. Blocks are the natural unit
// here: within one the program is fixed, so an exercise is genuinely the same
// exercise throughout — which is exactly the comparability problem a rolling
// window couldn't solve.
const PROG_EX_BANDS = [
    { min: 80, bar: "#1F7A4D", ink: "#1F7A4D", label: "80%+" },
    { min: 60, bar: "#E8C877", ink: "#8A6D1B", label: "60–79%" },
    { min: 40, bar: "#E39A6B", ink: "#B85C22", label: "40–59%" },
    { min: 0, bar: "#D9645C", ink: "#C0392B", label: "under 40%" },
];
function progExBandFor(pct) {
    if (pct === null || pct === undefined)
        return null;
    return PROG_EX_BANDS.find((b) => pct >= b.min) || PROG_EX_BANDS[PROG_EX_BANDS.length - 1];
}
// Oldest first, so "Prev" walks back through training history in the order
// it actually happened.
function progSortedBlocks(programBlocks) {
    return (programBlocks || []).slice().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}
// The block covering today, else the most recent one — so the view opens on
// what you're currently running.
function progCurrentBlockIndex(sorted, todayKey) {
    const i = (sorted || []).findIndex((b) => todayKey >= b.startDate && (!b.endDate || todayKey <= b.endDate));
    if (i >= 0)
        return i;
    return sorted && sorted.length ? sorted.length - 1 : -1;
}
// An open-ended block is only scored up to today; there's nothing to count in
// the future, and running to a sentinel end date would just waste the loop.
function progBlockRange(block, todayKey) {
    if (!block)
        return null;
    const end = block.endDate && block.endDate < todayKey ? block.endDate : todayKey;
    if (end < block.startDate)
        return null;
    return { startKey: block.startDate, endKey: end };
}
function progExerciseBreakdownRange(entries, programBlocks, programs, startKey, endKey) {
    const byName = {};
    if (!startKey || !endKey || endKey < startKey)
        return [];
    let d = keyToDate(startKey);
    const end = keyToDate(endKey);
    let guard = 0;
    while (d <= end && guard < 3000) {
        guard++;
        const program = resolveProgramForDate(programBlocks, programs, d);
        if (program) {
            const dk = dateKey(d);
            const exs = exercisesForDate(program, entries, d);
            if (exs && exs.length) {
                exs.forEach((ex) => {
                    if (!progExerciseEligible(entries, program, dk, ex))
                        return;
                    const key = String(ex.name || "").trim();
                    if (!key)
                        return;
                    if (!byName[key])
                        byName[key] = { name: key, sessions: 0, progressed: 0 };
                    byName[key].sessions++;
                    if (progExerciseProgressed(entries, program, dk, ex))
                        byName[key].progressed++;
                });
            }
        }
        d = addDays(d, 1);
    }
    return Object.keys(byName).map((k) => {
        const r = byName[k];
        r.pct = r.sessions ? Math.round((r.progressed / r.sessions) * 100) : 0;
        return r;
    }).sort((a, b) => (b.pct - a.pct) || (b.sessions - a.sessions) || a.name.localeCompare(b.name));
}
const PROG_BANDS = [
    { min: 100, fill: "#1F7A4D", ink: "#FFFFFF", label: "100%" },
    { min: 80, fill: "#5FB985", ink: "#FFFFFF", label: "80–99%" },
    { min: 50, fill: "#E8C877", ink: "#5A4A15", label: "50–79%" },
    { min: 25, fill: "#E39A6B", ink: "#5A2F12", label: "25–49%" },
    { min: 0, fill: "#D9645C", ink: "#FFFFFF", label: "0–24%" },
];
function progBandFor(pct) {
    if (pct === null || pct === undefined)
        return null;
    return PROG_BANDS.find((b) => pct >= b.min) || PROG_BANDS[PROG_BANDS.length - 1];
}
// ============================================================
// PROGRESS TRACKER MODULE (end)
// ============================================================
function dimsFocused(availW) {
    const desktop = availW >= 640;
    let LEFT = Math.round(availW * (desktop ? 0.15 : 0.255));
    LEFT = Math.max(desktop ? 150 : 98, Math.min(desktop ? 210 : 142, LEFT));
    const PANEL = availW - LEFT;
    const R = Math.floor((PANEL * 0.66) / 5);
    const W = PANEL - 5 * R;
    return { LEFT, W, R, PANEL };
}
function buildMonthGrid(viewMonth) {
    const first = startOfMonth(viewMonth);
    const startDow = first.getDay();
    const gridStart = addDays(first, -startDow);
    const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
    const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
    const cells = [];
    for (let i = 0; i < totalCells; i++) {
        const d = addDays(gridStart, i);
        cells.push({ date: d, inMonth: sameMonth(d, viewMonth) });
    }
    return cells;
}
// Nearest earlier/later date (bounded search) with the same custom day-type
// assigned — used by Previous/Next Workout for custom-kind programs.
function findAdjacentSameDayType(entries, programId, fromKey, dtId, dir, maxDays) {
    let d = keyToDate(fromKey);
    for (let i = 0; i < (maxDays || 730); i++) {
        d = addDays(d, dir);
        const dk = dateKey(d);
        if (entries[`dt|${programId}|${dk}`] === dtId)
            return dk;
    }
    return null;
}
// ============================================================
// ANALYSIS EXPORT MODULE (start) — safe to delete entirely: remove this
// block, the state/handler/effect marked "ANALYSIS EXPORT" in App(), and
// the card + overlay in the render tree, and flip ANALYSIS_EXPORT_ENABLED
// to false. Purely a read-only formatter over data that already exists —
// no new storage, no sync, no network calls of its own.
const ANALYSIS_EXPORT_ENABLED = false; // hidden for now — the export/import plumbing stays intact and will likely be reused by the Personal Trainer module
const AX_EXPORT_WEEKS = 6; // how far back the export looks — adjust freely
function axResolveExerciseName(ridToName, entries, pid, dk, rid) {
    if (ridToName[rid])
        return ridToName[rid];
    if (String(rid).indexOf("f") === 0) {
        const list = getFinishers(entries, pid, dk);
        const f = list.find((x) => x.id === rid);
        if (f)
            return f.name + " (finisher)";
    }
    return `Exercise ${rid}`;
}
function buildAnalysisExport(activeProgram, entries) {
    const pid = activeProgram.id;
    const cutoffKey = dateKey(addDays(new Date(), -7 * AX_EXPORT_WEEKS));
    const ridToName = {};
    const ridToRepRange = {};
    if (activeProgram.kind === "weekly") {
        activeProgram.days.forEach((d) => d.exercises.forEach((ex) => { ridToName[ex.rid] = ex.name; ridToRepRange[ex.rid] = ex.repRange; }));
    }
    else {
        (activeProgram.dayTypes || []).forEach((dt) => dt.exercises.forEach((ex) => { ridToName[ex.rid] = ex.name; ridToRepRange[ex.rid] = ex.repRange; }));
    }
    const byExercise = {}; // resolved name -> [{date, weight, reps:[...]}]
    const wPrefix = `wd|${pid}|`;
    Object.keys(entries).forEach((k) => {
        if (k.indexOf(wPrefix) !== 0)
            return;
        const rest = k.slice(wPrefix.length);
        const parts = rest.split("|");
        if (parts.length !== 2)
            return;
        const dk = parts[0], rid = parts[1];
        if (dk < cutoffKey)
            return;
        const weight = entries[k];
        if (!weight)
            return;
        const reps = [];
        for (let si = 0; si < 5; si++) {
            const rv = entries[`rd|${pid}|${dk}|${rid}|${si}`];
            if (rv)
                reps.push(rv);
        }
        if (!reps.length)
            return;
        const name = axResolveExerciseName(ridToName, entries, pid, dk, rid);
        if (!byExercise[name])
            byExercise[name] = [];
        byExercise[name].push({ date: dk, weight, reps, rid });
    });
    const lines = [];
    lines.push(`This is my workout log data from the last ${AX_EXPORT_WEEKS} weeks, exported from my personal training app. Please analyze trends across it — progress, plateaus, consistency, anything worth flagging. Be direct and genuinely honest, not just encouraging — if something looks like it's stalled, regressing, or inconsistent, say so plainly rather than softening it. One important caveat: I sometimes change equipment or something about how an exercise is performed, which can cause a large jump or drop in logged weight that has nothing to do with actual strength change — treat unusually large jumps between sessions as a likely sign that something about the exercise changed, not as a real performance swing, unless the surrounding data suggests otherwise.`);
    lines.push("");
    lines.push("Then generate a weekly-targets.json file for my next week of training, following the Weekly Targets Template schema saved in this project (if you don't have that file, ask me for it rather than guessing the format). One entry per exercise I actually have programmed, target weight/reps per set, a tag of push/hold/focus/watch per set, and a short specific insight per exercise. If an exercise has a different number of sets on different days, give each variant its own entry with a day_tier label, matched by how many sets are in its array.");
    lines.push("");
    lines.push("WORKOUT LOG — ANALYSIS EXPORT");
    lines.push(`Generated: ${dateKey(new Date())}`);
    lines.push(`Window: last ${AX_EXPORT_WEEKS} weeks (since ${cutoffKey})`);
    lines.push(`Program: ${activeProgram.name} (${activeProgram.kind === "weekly" ? "Weekly" : "Custom"})`);
    lines.push("");
    const names = Object.keys(byExercise).sort();
    if (!names.length) {
        lines.push("No logged sets found for this program in this window.");
    }
    else {
        lines.push("=== EXERCISE HISTORY (weight lb x reps per set, oldest to newest) ===");
        lines.push("");
        names.forEach((name) => {
            const rows = byExercise[name].slice().sort((a, b) => a.date.localeCompare(b.date));
            const repRange = ridToRepRange[rows[0].rid];
            const header = (repRange && repRange !== "-") ? `## ${name} (rep range: ${repRange})` : `## ${name}`;
            lines.push(header);
            rows.forEach((r) => { lines.push(`${r.date}: ${r.weight} lb x [${r.reps.join(", ")}]`); });
            lines.push("");
        });
    }
    return lines.join("\n");
}
// ============================================================
// ANALYSIS EXPORT MODULE (end)
// ============================================================
// ============================================================
// AI WEEKLY TARGETS MODULE (start) — safe to delete entirely: remove this
// block, the state/handlers/effect marked "AI WEEKLY TARGETS" in App(),
// the import section inside the Analysis Export overlay, and the card
// deck at the bottom of the focused workout view, then flip
// AI_TARGETS_ENABLED to false. Syncs through the same workout_logs table
// as entries/programs (see stateRef.current, pullMerge, pushRemote) —
// whole-object, dirty-flag gated, same pattern used for programs.
const AI_TARGETS_ENABLED = false; // temporarily off while the design is being reworked — flip back to true to restore, nothing else needs to change
const AI_TAG_COLORS = {
    push: { bg: "#FFE8E1", fg: "#C4441F", label: "PUSH" },
    hold: { bg: "#E3EEFF", fg: "#2C5FCC", label: "HOLD" },
    focus: { bg: "#FBEFC4", fg: "#96721F", label: "FOCUS" },
    watch: { bg: "#FDE7E5", fg: "#C0392B", label: "WATCH" },
};
// Turns a target set + its previous-session rep count into a short
// descriptive phrase ("Push 11 → 12 reps", "Hold steady at 10 reps"),
// tailored per tag rather than just printing the raw numbers.
function aiSetPhrase(tag, prevReps, targetReps) {
    const hasPrev = prevReps !== undefined && prevReps !== null;
    if (tag === "push") {
        return hasPrev && prevReps !== targetReps ? `Push ${prevReps} → ${targetReps} reps` : `Push to ${targetReps} reps`;
    }
    if (tag === "hold") {
        return `Hold steady at ${targetReps} reps`;
    }
    if (tag === "focus") {
        return hasPrev ? `Focus on form, ${prevReps} → ${targetReps} reps` : `Focus on form at ${targetReps} reps`;
    }
    if (tag === "watch") {
        return `Watch — don't exceed ${targetReps} reps`;
    }
    return `${targetReps} reps`;
}
// Validates the imported JSON against the documented contract. Returns
// { ok:true, data } or { ok:false, error } — error names the specific
// missing/malformed field rather than a generic "invalid file".
function validateWeeklyTargets(obj) {
    if (!obj || typeof obj !== "object")
        return { ok: false, error: "Not a valid JSON object." };
    if (typeof obj.week_of !== "string" || !obj.week_of.trim())
        return { ok: false, error: 'Missing or invalid "week_of" (expected a date string).' };
    if (!Array.isArray(obj.exercises))
        return { ok: false, error: 'Missing or invalid "exercises" (expected an array).' };
    for (let i = 0; i < obj.exercises.length; i++) {
        const ex = obj.exercises[i];
        if (!ex || typeof ex !== "object")
            return { ok: false, error: `exercises[${i}] is not an object.` };
        if (typeof ex.name !== "string" || !ex.name.trim())
            return { ok: false, error: `exercises[${i}] is missing a valid "name".` };
        if (!Array.isArray(ex.sets) || !ex.sets.length)
            return { ok: false, error: `"${ex.name}" is missing a valid "sets" array.` };
        for (let j = 0; j < ex.sets.length; j++) {
            const s = ex.sets[j];
            if (!s || typeof s !== "object" || typeof s.target_reps !== "number") {
                return { ok: false, error: `"${ex.name}" set ${j + 1} is missing a valid "target_reps".` };
            }
            if (s.previous_reps !== undefined && s.previous_reps !== null && typeof s.previous_reps !== "number") {
                return { ok: false, error: `"${ex.name}" set ${j + 1} has an invalid "previous_reps" (expected a number).` };
            }
        }
    }
    return { ok: true, data: obj };
}
// Given the exercises actually programmed for a specific day (name + how
// many sets each has), returns the matching target entries in that same
// order. day_tier-tagged entries only match when their set count equals
// what's actually programmed that day — see the note in chat about why.
function getAiTargetsForDay(aiTargets, dayExercises) {
    if (!aiTargets || !Array.isArray(aiTargets.exercises) || !dayExercises || !dayExercises.length)
        return [];
    const out = [];
    dayExercises.forEach((dex) => {
        const candidates = aiTargets.exercises.filter((t) => t.name.trim().toLowerCase() === dex.name.trim().toLowerCase());
        if (!candidates.length)
            return;
        let match = null;
        if (candidates.length === 1 && !candidates[0].day_tier) {
            match = candidates[0];
        }
        else {
            match = candidates.find((t) => Array.isArray(t.sets) && t.sets.length === dex.sets) || null;
        }
        if (match)
            out.push(match);
    });
    return out;
}
// ============================================================
// AI WEEKLY TARGETS MODULE (end)
// ============================================================
const BASE_INPUT_STYLE = {
    width: "100%", height: "100%", border: "none", background: "transparent",
    textAlign: "center", fontSize: 16, fontWeight: 600, color: "#26221D",
    fontFamily: "inherit", fontVariantNumeric: "tabular-nums", padding: 0, margin: 0, outline: "none",
};
// ============================================================
// CARDIO MODULE (start) — safe to delete entirely: remove this block, the
// state/handlers/effects marked "CARDIO" in App(), the card on the
// calendar page, the red-underline check in the calendar cell renderer,
// and the page overlay, then flip FEATURE_CARDIO to false. Stored as new
// keys inside the same synced blob as everything else (cardioSessions,
// cardioUnlockedWeekKeys, cardioRevealedCount) — no new Supabase table.
const FEATURE_CARDIO = true;
const CARDIO_FLOOR_SEC = 300; // sessions under 5:00 earn zero credit
const CARDIO_WEEK1_TARGET = 45;
const CARDIO_WEEKLY_INCREMENT = 5;
const CARDIO_TARGET_CAP = 110;
const CARDIO_TOTAL_PROMPTS = 50;
function cardioWeekStartKey(d) {
    const dow = d.getDay();
    return dateKey(addDays(d, -dow));
}
function cardioMultiplier(durationSec) {
    if (durationSec < CARDIO_FLOOR_SEC)
        return 0;
    const min = durationSec / 60;
    if (min < 10)
        return 1.0;
    if (min < 15)
        return 1.1;
    if (min < 20)
        return 1.2;
    if (min < 25)
        return 1.3;
    if (min < 30)
        return 1.35;
    return 1.4;
}
function cardioEffectiveMinutes(durationSec) {
    const mult = cardioMultiplier(durationSec);
    return mult === 0 ? 0 : (durationSec / 60) * mult;
}
function cardioRawMinutes(durationSec) {
    return durationSec >= CARDIO_FLOOR_SEC ? durationSec / 60 : 0;
}
// Builds { weekKey -> {raw, effective} } across all logged sessions.
function cardioWeeklyTotals(sessions) {
    const byWeek = {};
    (sessions || []).forEach((s) => {
        const wk = cardioWeekStartKey(keyToDate(s.date));
        if (!byWeek[wk])
            byWeek[wk] = { raw: 0, effective: 0 };
        byWeek[wk].raw += cardioRawMinutes(s.durationSec);
        byWeek[wk].effective += cardioEffectiveMinutes(s.durationSec);
    });
    return byWeek;
}
// Walks every real calendar week from the first logged session through
// today, applying the progression rule in order. Returns an ordered array
// of { weekKey, target, effective, met }, so "current target" and "which
// weeks already earned an unlock" are always derived fresh from the raw
// session history rather than a separately-stored mutable value.
function cardioWeekProgression(sessions) {
    if (!sessions || !sessions.length)
        return [];
    const totals = cardioWeeklyTotals(sessions);
    const firstDate = sessions.map((s) => s.date).sort()[0];
    let cursor = keyToDate(cardioWeekStartKey(keyToDate(firstDate)));
    const todayWeekStart = keyToDate(cardioWeekStartKey(new Date()));
    const weeks = [];
    let target = CARDIO_WEEK1_TARGET;
    while (cursor <= todayWeekStart) {
        const wk = dateKey(cursor);
        const effective = (totals[wk] && totals[wk].effective) || 0;
        const met = effective >= target;
        weeks.push({ weekKey: wk, target, effective, met });
        target = met ? Math.min(CARDIO_TARGET_CAP, target + CARDIO_WEEKLY_INCREMENT) : target;
        cursor = addDays(cursor, 7);
    }
    return weeks;
}
function cardioFormatDuration(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${pad2(s)}`;
}
// ============================================================
// CARDIO MODULE (end)
// ============================================================
// Reusable "current / target" progress bar — approved design (big bold
// number + percentage, thin bold-filled bar underneath), used anywhere in
// the app that needs to show progress toward a target. Auto-switches to
// green once the target is met/exceeded, same "met = green" language used
// elsewhere (calendar, color-coding module), and caps the bar's visual
// fill at 100% even if the actual value goes higher, so it never overflows.
// ============================================================
// MODULE REGISTRY (start) — turns the app's optional features into
// user-selectable modules. Two independent layers decide whether a module
// shows up:
//   1. its build flag below (FEATURE_CARDIO etc.) — a hard kill switch that
//      removes it from the app entirely, for everyone; and
//   2. the user's own choice, stored in `enabledModules` and synced with
//      the rest of their data.
// A module renders only when both agree, which is what moduleOn() checks.
// Adding a future module means adding one entry here plus its own flag —
// the settings screen and the gating both pick it up automatically.
const MODULES = [
    { id: "cardio", label: "Cardio", blurb: "Stopwatch, weekly effective-minute targets, and calendar marks.", available: () => FEATURE_CARDIO },
    { id: "bodycomp", label: "Body Comp", blurb: "Weekly weigh-ins with bulk / cut / maintenance blocks.", available: () => BODY_COMP_ENABLED },
    { id: "trainer", label: "Personal Trainer", blurb: "Per-set rep targets and cues inside each workout.", available: () => PERSONAL_TRAINER_ENABLED },
    { id: "mobility", label: "Mobility", blurb: "Log daily mobility work and track how often you touch it.", available: () => FEATURE_MOBILITY },
    { id: "progress", label: "Progress Tracker", blurb: "Calendar heat map of how many exercises progressed each session.", available: () => PROGRESS_TRACKER_ENABLED },
    { id: "analysis", label: "Analyze with AI", blurb: "Export recent training history for outside analysis.", available: () => ANALYSIS_EXPORT_ENABLED },
];
function moduleAvailable(id) {
    const m = MODULES.find((x) => x.id === id);
    return !!m && !!m.available();
}
// Absent preferences means "not chosen yet" rather than "all off" — a user
// who has never opened the settings screen should still see the app fully
// assembled, so an unset list defaults to every available module.
function moduleOn(enabledModules, id) {
    if (!moduleAvailable(id))
        return false;
    if (!Array.isArray(enabledModules))
        return true;
    return enabledModules.indexOf(id) >= 0;
}
function defaultEnabledModules() {
    return MODULES.filter((m) => m.available()).map((m) => m.id);
}
// ============================================================
// MODULE REGISTRY (end)
// ============================================================

// ============================================================
// Node test-suite export. No-op in the browser (module is undefined there).
// ============================================================
if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        bcMondaysInRange, bcBlockForDate, bcTargetWeight, bcRangesOverlap, bcFormatWeight, bcSanitizeDecimal,
        colors, flatRows, pad2, dateKey, keyToDate, todayKey, addDays, startOfMonth, sameMonth, sameDate,
        formatLongDate, formatStopwatch, parseMDY, builtinProgram, emptyProgram, findProgramById, getActiveProgram,
        pbOverlaps, resolveProgramIdForDate, resolveProgramForDate, pbProgramName, pbTintForProgram,
        exercisesForDate, getFinishers, dayHasReps, parseProgramWorkbook, migrateLegacyEntries,
        findPrevSessionKey, computeRepColor,
        ptParseRange, ptSessionReps, ptPrevSessions, ptRunningAhead, ptComputePlan, ptMantraFor, ptHeadline,
        mobilityNormalizeLabel, mobilityMigrateLog, mobilityDayEntry, mobilitySlotList, mobilityDayList,
        mobilityHasAny, mobilitySessionCount, progMobilityStats,
        progExerciseCounts, progExerciseEligible, progExerciseProgressed, progDayRate, progDayRateResolved,
        progCardioWeekMap, progCardioBlockStats, progDayState, progGradeFor, progMonthSummary, progExBandFor,
        progSortedBlocks, progCurrentBlockIndex, progBlockRange, progExerciseBreakdownRange, progBandFor,
        dimsFocused, buildMonthGrid, findAdjacentSameDayType,
        axResolveExerciseName, buildAnalysisExport, aiSetPhrase, validateWeeklyTargets, getAiTargetsForDay,
        cardioWeekStartKey, cardioMultiplier, cardioEffectiveMinutes, cardioRawMinutes, cardioWeeklyTotals,
        cardioWeekProgression, cardioFormatDuration,
        moduleAvailable, moduleOn, defaultEnabledModules,
        // constants
        ACCENT, TODAY_BLUE, COLOR_CODE_ENABLED, LOCAL_KEY, BUILTIN_ID, MANUAL_PROGRAM_BUILDER_ENABLED,
        SUPA_URL, SUPA_KEY, SPLITS, HEAD, EX, BODY_COMP_ENABLED, BC_ROW_H, BC_START_DATE_KEY, BC_BLOCK_COLORS,
        DOW_NAMES, MONTH_NAMES, WEEKDAY_LETTERS, PROGRAM_BLOCKS_ENABLED, PB_TINTS, REP_COLOR_BG,
        PERSONAL_TRAINER_ENABLED, PT_PUSH_BG, PT_PUSH_FG, PT_PUSH_BORDER, PT_HOLD_BG, PT_HOLD_FG, PT_HOLD_BORDER,
        PT_MANTRAS, FEATURE_MOBILITY, MOBILITY_BLUE, MOBILITY_BLUE_SOFT, MOBILITY_BLUE_MID, MOBILITY_WINDOW_DAYS,
        MOBILITY_SLOTS, MOBILITY_MODALITIES, PROGRESS_TRACKER_ENABLED, PROG_EXCLUDED_EXERCISES,
        PROG_CARDIO_MIN_WEEKS, PROG_PLUS_DAY_MIN, PROG_GRADES, PROG_EX_BANDS, PROG_BANDS,
        ANALYSIS_EXPORT_ENABLED, AX_EXPORT_WEEKS, AI_TARGETS_ENABLED, AI_TAG_COLORS, BASE_INPUT_STYLE,
        FEATURE_CARDIO, CARDIO_FLOOR_SEC, CARDIO_WEEK1_TARGET, CARDIO_WEEKLY_INCREMENT, CARDIO_TARGET_CAP,
        CARDIO_TOTAL_PROMPTS, MODULES,
    };
}
