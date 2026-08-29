"use strict";
// Tests for the Mobility module's fixed 20-day/40-slot window, per
// PROJECT_CONTEXT.md's "Mobility" section.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
    mobilitySessionCount, mobilityDayEntry, progMobilityStats,
    dateKey, keyToDate, addDays, MOBILITY_WINDOW_DAYS,
} = require("../logic.js");

const TODAY = "2026-08-29";

test("mobilityDayEntry reads a legacy bare array as an AM-only session", () => {
    const log = { "2026-08-01": ["squat_drill", "ytw_raises"] };
    assert.deepEqual(mobilityDayEntry(log, "2026-08-01"), { am: ["squat_drill", "ytw_raises"], pm: [] });
});

test("mobilitySessionCount is 0, 1 or 2 depending on which slots have entries", () => {
    assert.equal(mobilitySessionCount({}, "2026-08-01"), 0);
    assert.equal(mobilitySessionCount({ "2026-08-01": { am: ["squat_drill"], pm: [] } }, "2026-08-01"), 1);
    assert.equal(mobilitySessionCount({ "2026-08-01": { am: [], pm: ["ytw_raises"] } }, "2026-08-01"), 1);
    assert.equal(mobilitySessionCount({ "2026-08-01": { am: ["squat_drill"], pm: ["ytw_raises"] } }, "2026-08-01"), 2);
});

test("progMobilityStats: denominator is always 40 (20 days x 2 slots), regardless of history length", () => {
    const stats = progMobilityStats({}, TODAY);
    assert.equal(stats.window, MOBILITY_WINDOW_DAYS);
    assert.equal(stats.total, MOBILITY_WINDOW_DAYS * 2);
    assert.equal(stats.sessions, 0);
    assert.equal(stats.pctText, "0");
});

test("progMobilityStats: counts sessions across the window and formats a whole percent", () => {
    const log = {};
    // 3 full days (am+pm) + 2 am-only days = 8 sessions, all inside the window.
    [0, 1, 2].forEach((i) => { log[dateKey(addDays(keyToDate(TODAY), -i))] = { am: ["squat_drill"], pm: ["ytw_raises"] }; });
    [3, 4].forEach((i) => { log[dateKey(addDays(keyToDate(TODAY), -i))] = { am: ["squat_drill"], pm: [] }; });
    const stats = progMobilityStats(log, TODAY);
    assert.equal(stats.sessions, 8);
    assert.equal(stats.days, 5);
    assert.equal(stats.pct, 20); // 8/40
    assert.equal(stats.pctText, "20");
});

test("progMobilityStats: keeps one decimal for a half-percent result instead of rounding it away", () => {
    const log = {};
    // 6 full days (12 sessions) + 1 am-only day (1 session) = 13 sessions -> 32.5%.
    for (let i = 0; i < 6; i++) log[dateKey(addDays(keyToDate(TODAY), -i))] = { am: ["squat_drill"], pm: ["ytw_raises"] };
    log[dateKey(addDays(keyToDate(TODAY), -6))] = { am: ["squat_drill"], pm: [] };
    const stats = progMobilityStats(log, TODAY);
    assert.equal(stats.sessions, 13);
    assert.equal(stats.pct, 32.5);
    assert.equal(stats.pctText, "32.5");
});

test("progMobilityStats: a session exactly at the 20-day edge counts; one day further back does not", () => {
    const withinWindow = dateKey(addDays(keyToDate(TODAY), -(MOBILITY_WINDOW_DAYS - 1))); // 20th day back, i=19
    const outsideWindow = dateKey(addDays(keyToDate(TODAY), -MOBILITY_WINDOW_DAYS)); // 21st day back, i=20

    const inStats = progMobilityStats({ [withinWindow]: { am: ["squat_drill"], pm: [] } }, TODAY);
    assert.equal(inStats.sessions, 1);

    const outStats = progMobilityStats({ [outsideWindow]: { am: ["squat_drill"], pm: [] } }, TODAY);
    assert.equal(outStats.sessions, 0);
});
