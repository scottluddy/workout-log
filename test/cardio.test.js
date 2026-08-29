"use strict";
// Tests for the Cardio duration multiplier and the escalating weekly
// target, per PROJECT_CONTEXT.md's "Cardio" section.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
    cardioMultiplier, cardioEffectiveMinutes, cardioWeekProgression, cardioWeekStartKey,
    dateKey, keyToDate, addDays, CARDIO_WEEK1_TARGET, CARDIO_WEEKLY_INCREMENT, CARDIO_TARGET_CAP,
} = require("../logic.js");

test("cardioMultiplier: below the 5:00 floor earns nothing", () => {
    assert.equal(cardioMultiplier(299), 0);
});

test("cardioMultiplier: duration bands, inclusive at the low edge of each band", () => {
    assert.equal(cardioMultiplier(300), 1.0);   // 5:00
    assert.equal(cardioMultiplier(599), 1.0);   // 9:59
    assert.equal(cardioMultiplier(600), 1.1);   // 10:00
    assert.equal(cardioMultiplier(899), 1.1);   // 14:59
    assert.equal(cardioMultiplier(900), 1.2);   // 15:00
    assert.equal(cardioMultiplier(1199), 1.2);  // 19:59
    assert.equal(cardioMultiplier(1200), 1.3);  // 20:00
    assert.equal(cardioMultiplier(1499), 1.3);  // 24:59
    assert.equal(cardioMultiplier(1500), 1.35); // 25:00
    assert.equal(cardioMultiplier(1799), 1.35); // 29:59
    assert.equal(cardioMultiplier(1800), 1.4);  // 30:00
    assert.equal(cardioMultiplier(3600), 1.4);  // 60:00, cap
});

test("cardioEffectiveMinutes applies the multiplier, and is 0 under the floor", () => {
    assert.equal(cardioEffectiveMinutes(299), 0);
    assert.equal(cardioEffectiveMinutes(600), 11); // 10 min * 1.1
    assert.equal(cardioEffectiveMinutes(1800), 42); // 30 min * 1.4
});

test("cardioWeekProgression: target climbs by 5 only on a week it's met, holds flat through gap weeks, unbroken week sequence", () => {
    const week0 = cardioWeekStartKey(keyToDate("2024-01-10"));
    const week1 = dateKey(addDays(keyToDate(week0), 7));
    const week2 = dateKey(addDays(keyToDate(week0), 14));
    const week3 = dateKey(addDays(keyToDate(week0), 21));
    const week4 = dateKey(addDays(keyToDate(week0), 28));

    const sessions = [
        { date: week0, durationSec: 3600 }, // 60 min * 1.4 = 84 eff, meets 45
        // week1, week2: no sessions at all (gap weeks) — the progression
        // still must walk through them rather than skipping to week3.
        { date: week3, durationSec: 3000 }, // 50 min * 1.4 = 70 eff, meets 50
    ];
    const byKey = Object.fromEntries(cardioWeekProgression(sessions).map((w) => [w.weekKey, w]));

    assert.equal(byKey[week0].target, CARDIO_WEEK1_TARGET);
    assert.equal(byKey[week0].met, true);

    assert.equal(byKey[week1].target, CARDIO_WEEK1_TARGET + CARDIO_WEEKLY_INCREMENT);
    assert.equal(byKey[week1].effective, 0);
    assert.equal(byKey[week1].met, false);

    // target holds flat through the second gap week too
    assert.equal(byKey[week2].target, CARDIO_WEEK1_TARGET + CARDIO_WEEKLY_INCREMENT);
    assert.equal(byKey[week2].met, false);

    assert.equal(byKey[week3].target, CARDIO_WEEK1_TARGET + CARDIO_WEEKLY_INCREMENT);
    assert.equal(byKey[week3].met, true);

    assert.equal(byKey[week4].target, CARDIO_WEEK1_TARGET + 2 * CARDIO_WEEKLY_INCREMENT);
});

test("cardioWeekProgression: target never exceeds the cap", () => {
    const week0 = cardioWeekStartKey(keyToDate("2024-01-10"));
    // Enough consecutive met weeks (with a huge effective total) to blow past
    // the cap if it weren't clamped: (110 - 45) / 5 = 13 increments to reach it.
    const sessions = [];
    for (let i = 0; i < 20; i++) {
        sessions.push({ date: dateKey(addDays(keyToDate(week0), i * 7)), durationSec: 7200 });
    }
    const weeks = cardioWeekProgression(sessions);
    const byKey = Object.fromEntries(weeks.map((w) => [w.weekKey, w]));
    const capWeek = dateKey(addDays(keyToDate(week0), 13 * 7));
    const lastFixtureWeek = dateKey(addDays(keyToDate(week0), 19 * 7));
    assert.equal(byKey[capWeek].target, CARDIO_TARGET_CAP);
    assert.equal(byKey[lastFixtureWeek].target, CARDIO_TARGET_CAP);
    weeks.forEach((w) => assert.ok(w.target <= CARDIO_TARGET_CAP));
});
