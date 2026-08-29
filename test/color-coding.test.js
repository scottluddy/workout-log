"use strict";
// Tests for computeRepColor — the rep-cell green/yellow/red rule described
// in PROJECT_CONTEXT.md under "Cell colouring" and "Weight increase".
const test = require("node:test");
const assert = require("node:assert/strict");
const { computeRepColor, dateKey, keyToDate, addDays } = require("../logic.js");

const PROGRAM_ID = 1;
const DK = "2026-08-15";
const PREV_KEY = dateKey(addDays(keyToDate(DK), -7));
const RID = "r1";

function buildEntries({ curWeight, prevWeight, curReps, prevReps }) {
    const entries = {};
    if (curWeight !== undefined) entries[`wd|${PROGRAM_ID}|${DK}|${RID}`] = String(curWeight);
    if (prevWeight !== undefined) entries[`wd|${PROGRAM_ID}|${PREV_KEY}|${RID}`] = String(prevWeight);
    (curReps || []).forEach((r, i) => { if (r !== null) entries[`rd|${PROGRAM_ID}|${DK}|${RID}|${i}`] = String(r); });
    (prevReps || []).forEach((r, i) => { if (r !== null) entries[`rd|${PROGRAM_ID}|${PREV_KEY}|${RID}|${i}`] = String(r); });
    return entries;
}

const WEEKLY_PROGRAM = { id: PROGRAM_ID, kind: "weekly" };
const EX = { rid: RID, repRange: "6-8", sets: 3 };

test("same weight, reps increased at a set -> green", () => {
    const entries = buildEntries({ curWeight: 100, prevWeight: 100, curReps: [8, 7, 6], prevReps: [7, 7, 6] });
    assert.equal(computeRepColor(entries, WEEKLY_PROGRAM, DK, EX, 0), "green");
});

test("same weight, reps unchanged at a set -> yellow", () => {
    const entries = buildEntries({ curWeight: 100, prevWeight: 100, curReps: [8, 7, 6], prevReps: [7, 7, 6] });
    assert.equal(computeRepColor(entries, WEEKLY_PROGRAM, DK, EX, 1), "yellow");
});

test("same weight, reps decreased at a set -> red", () => {
    const entries = buildEntries({ curWeight: 100, prevWeight: 100, curReps: [8, 7, 5], prevReps: [7, 7, 6] });
    assert.equal(computeRepColor(entries, WEEKLY_PROGRAM, DK, EX, 2), "red");
});

test("weight increased, every set clears the rep-range floor -> only the final set greens", () => {
    const entries = buildEntries({ curWeight: 105, prevWeight: 100, curReps: [8, 7, 6], prevReps: [8, 8, 8] });
    assert.equal(computeRepColor(entries, WEEKLY_PROGRAM, DK, EX, 0), null);
    assert.equal(computeRepColor(entries, WEEKLY_PROGRAM, DK, EX, 1), null);
    assert.equal(computeRepColor(entries, WEEKLY_PROGRAM, DK, EX, 2), "green");
});

test("weight increased, not every set has cleared the floor yet -> no colour at all", () => {
    // Floor for "6-8" is 6; the last set is still below it.
    const entries = buildEntries({ curWeight: 105, prevWeight: 100, curReps: [8, 7, 5], prevReps: [8, 8, 8] });
    for (let si = 0; si < 3; si++) {
        assert.equal(computeRepColor(entries, WEEKLY_PROGRAM, DK, EX, si), null);
    }
});

test("weight decreased -> no comparison drawn, regardless of reps", () => {
    const entries = buildEntries({ curWeight: 95, prevWeight: 100, curReps: [9, 9, 9], prevReps: [6, 6, 6] });
    for (let si = 0; si < 3; si++) {
        assert.equal(computeRepColor(entries, WEEKLY_PROGRAM, DK, EX, si), null);
    }
});

test("missing previous weight -> null", () => {
    const entries = buildEntries({ curWeight: 100, curReps: [8, 7, 6] });
    assert.equal(computeRepColor(entries, WEEKLY_PROGRAM, DK, EX, 0), null);
});

test("no program or no exercise -> null", () => {
    const entries = buildEntries({ curWeight: 100, prevWeight: 100, curReps: [8], prevReps: [7] });
    assert.equal(computeRepColor(entries, null, DK, EX, 0), null);
    assert.equal(computeRepColor(entries, WEEKLY_PROGRAM, DK, null, 0), null);
});

test("custom (PPL-style) program compares against the previous SAME DAY TYPE, not 7 days back", () => {
    // This is the bug called out in PROJECT_CONTEXT.md: a rotating split can
    // repeat "Push" on a day that isn't exactly a week after the last Push.
    const program = { id: 2, kind: "custom" };
    const dk = "2026-08-15";
    const trueDayTypeMatch = "2026-08-13"; // 2 days earlier, same day type
    const sevenDaysBack = dateKey(addDays(keyToDate(dk), -7));
    const entries = {
        [`dt|2|${dk}`]: "push",
        [`dt|2|${trueDayTypeMatch}`]: "push",
        [`wd|2|${dk}|${RID}`]: "100",
        [`wd|2|${trueDayTypeMatch}|${RID}`]: "100",
        [`rd|2|${dk}|${RID}|0`]: "8",
        [`rd|2|${trueDayTypeMatch}|${RID}|0`]: "7",
        // A 7-day-back entry exists too, with different reps, to prove it's
        // NOT what gets compared against.
        [`wd|2|${sevenDaysBack}|${RID}`]: "100",
        [`rd|2|${sevenDaysBack}|${RID}|0`]: "1",
    };
    assert.equal(computeRepColor(entries, program, dk, EX, 0), "green");
});

test("custom program with no day type assigned yet -> no previous session, null", () => {
    const program = { id: 3, kind: "custom" };
    const entries = { [`wd|3|2026-08-15|${RID}`]: "100" };
    assert.equal(computeRepColor(entries, program, "2026-08-15", EX, 0), null);
});
