"use strict";
// Tests for the Progress Tracker's eligibility/progress rules, per
// PROJECT_CONTEXT.md's "Excluded from all Progress Tracker maths" and
// "'Did this exercise progress?'" sections.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
    progExerciseCounts, progExerciseEligible, progExerciseProgressed, progDayRate,
    dateKey, keyToDate, addDays,
} = require("../logic.js");

const PROGRAM_ID = 1;
const DK = "2026-08-15";
const PREV_KEY = dateKey(addDays(keyToDate(DK), -7));
const WEEKLY_PROGRAM = { id: PROGRAM_ID, kind: "weekly" };

function setSets(entries, rid, dk, weight, reps) {
    if (weight !== undefined) entries[`wd|${PROGRAM_ID}|${dk}|${rid}`] = String(weight);
    reps.forEach((r, i) => { entries[`rd|${PROGRAM_ID}|${dk}|${rid}|${i}`] = String(r); });
}

test("progExerciseCounts excludes Abs and Calves, case-insensitively", () => {
    assert.equal(progExerciseCounts("Bench Press"), true);
    assert.equal(progExerciseCounts("Abs"), false);
    assert.equal(progExerciseCounts("ABS"), false);
    assert.equal(progExerciseCounts("Calves"), false);
    assert.equal(progExerciseCounts(""), false);
    assert.equal(progExerciseCounts(null), false);
});

test("progExerciseEligible requires a comparable previous session, weights both days, and something logged today", () => {
    const ex = { rid: "a1", name: "Bench Press", sets: 3 };
    const entries = {};
    setSets(entries, "a1", PREV_KEY, 100, [7, 7, 6]);
    setSets(entries, "a1", DK, 100, [8, 7, 6]);
    assert.equal(progExerciseEligible(entries, WEEKLY_PROGRAM, DK, ex), true);
});

test("progExerciseEligible is false for an excluded exercise", () => {
    const ex = { rid: "a1", name: "Abs", sets: 3 };
    const entries = {};
    setSets(entries, "a1", PREV_KEY, 100, [10, 10, 10]);
    setSets(entries, "a1", DK, 100, [12, 10, 10]);
    assert.equal(progExerciseEligible(entries, WEEKLY_PROGRAM, DK, ex), false);
});

test("progExerciseEligible is false with no logged sets today, even if weight is set", () => {
    const ex = { rid: "a1", name: "Bench Press", sets: 3 };
    const entries = {
        [`wd|${PROGRAM_ID}|${PREV_KEY}|a1`]: "100",
        [`wd|${PROGRAM_ID}|${DK}|a1`]: "100",
    };
    assert.equal(progExerciseEligible(entries, WEEKLY_PROGRAM, DK, ex), false);
});

test("progExerciseEligible is false with no previous session on record", () => {
    const ex = { rid: "a1", name: "Bench Press", sets: 3 };
    const entries = {};
    setSets(entries, "a1", DK, 100, [8, 7, 6]);
    assert.equal(progExerciseEligible(entries, WEEKLY_PROGRAM, DK, ex), false);
});

test("progExerciseProgressed: same weight, total reps increased -> true", () => {
    const ex = { rid: "a1", sets: 3 };
    const entries = {};
    setSets(entries, "a1", PREV_KEY, 100, [13, 13, 13]);
    setSets(entries, "a1", DK, 100, [14, 13, 13]);
    assert.equal(progExerciseProgressed(entries, WEEKLY_PROGRAM, DK, ex), true);
});

test("progExerciseProgressed: same weight, a rep moved rather than added -> false", () => {
    // The exact 13-13-13 -> 14-13-12 case called out in PROJECT_CONTEXT.md:
    // one cell would green, but total reps are unchanged, so this must not
    // count as progress.
    const ex = { rid: "a1", sets: 3 };
    const entries = {};
    setSets(entries, "a1", PREV_KEY, 100, [13, 13, 13]);
    setSets(entries, "a1", DK, 100, [14, 13, 12]);
    assert.equal(progExerciseProgressed(entries, WEEKLY_PROGRAM, DK, ex), false);
});

test("progExerciseProgressed: weight increased and every set cleared the floor -> true", () => {
    const ex = { rid: "a1", sets: 3, repRange: "6-8" };
    const entries = {};
    setSets(entries, "a1", PREV_KEY, 100, [8, 8, 8]);
    setSets(entries, "a1", DK, 105, [8, 7, 6]);
    assert.equal(progExerciseProgressed(entries, WEEKLY_PROGRAM, DK, ex), true);
});

test("progExerciseProgressed: weight increased but not every set cleared the floor -> false", () => {
    const ex = { rid: "a1", sets: 3, repRange: "6-8" };
    const entries = {};
    setSets(entries, "a1", PREV_KEY, 100, [8, 8, 8]);
    setSets(entries, "a1", DK, 105, [8, 7, 5]);
    assert.equal(progExerciseProgressed(entries, WEEKLY_PROGRAM, DK, ex), false);
});

test("progExerciseProgressed: weight decreased -> false regardless of reps", () => {
    const ex = { rid: "a1", sets: 3 };
    const entries = {};
    setSets(entries, "a1", PREV_KEY, 100, [6, 6, 6]);
    setSets(entries, "a1", DK, 95, [12, 12, 12]);
    assert.equal(progExerciseProgressed(entries, WEEKLY_PROGRAM, DK, ex), false);
});

test("progDayRate is pooled (progressed/eligible), and excludes Abs from both sides", () => {
    const dow = keyToDate(DK).getDay();
    const program = {
        id: PROGRAM_ID,
        kind: "weekly",
        days: [{
            dow,
            exercises: [
                { rid: "bench", name: "Bench Press", sets: 3, repRange: "6-8" },
                { rid: "squat", name: "Squat", sets: 3, repRange: "6-8" },
                { rid: "abs", name: "Abs", sets: 3, repRange: "10-15" },
            ],
        }],
    };
    const entries = {};
    // Bench: progressed (same weight, total reps up).
    setSets(entries, "bench", PREV_KEY, 100, [7, 7, 6]);
    setSets(entries, "bench", DK, 100, [8, 7, 6]);
    // Squat: eligible but not progressed (same weight, same total).
    setSets(entries, "squat", PREV_KEY, 150, [8, 8, 8]);
    setSets(entries, "squat", DK, 150, [8, 8, 8]);
    // Abs: logged, would read as progressed, but must be excluded entirely.
    setSets(entries, "abs", PREV_KEY, 0, [10, 10, 10]);
    setSets(entries, "abs", DK, 0, [15, 15, 15]);

    const rate = progDayRate(entries, program, keyToDate(DK));
    assert.deepEqual(rate, { progressed: 1, total: 2, pct: 50 });
});

test("progDayRate returns null (not 0%) when nothing qualifies", () => {
    const dow = keyToDate(DK).getDay();
    const program = { id: PROGRAM_ID, kind: "weekly", days: [{ dow, exercises: [] }] };
    assert.equal(progDayRate({}, program, keyToDate(DK)), null);
});
