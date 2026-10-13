// Commission is settled per "commission month". Up to 14 Sep 2026 that was the plain
// calendar month; from 15 Sep 2026 (CUTOVER) it runs from the 15th of one month to the
// 14th of the next. A period is labelled by the month it starts in, and the transition
// period (2026, 9) covers 1 Sep – 14 Oct 2026 so 1–14 Sep isn't orphaned:
//   (2026, 8)  = 1 Aug – 31 Aug 2026   (calendar month, unchanged)
//   (2026, 9)  = 1 Sep – 14 Oct 2026   (transition)
//   (2026, 10) = 15 Oct – 14 Nov 2026
// commission_settlements.year/.month use that same label.

const PERIOD_START_DAY = 15;
const CUTOVER = '2026-09-15';
const CUTOVER_YEAR = 2026, CUTOVER_MONTH = 9;

// SQL expression shifting a timestamp so EXTRACT(YEAR/MONTH ...) on it yields the
// commission-period label, e.g. 14 Oct -> 30 Sep (period 9), 15 Oct -> 1 Oct (period 10).
// Timestamps before the cutover are left as-is (calendar month).
function periodExpr(col) {
    return `(CASE WHEN ${col} < DATE '${CUTOVER}' THEN ${col} ELSE ${col} - INTERVAL '${PERIOD_START_DAY - 1} days' END)`;
}

// The commission period a JS Date falls in: { year, month } (month 1-12).
function periodOf(date) {
    let year  = date.getFullYear();
    let month = date.getMonth() + 1;
    const beforeCutover = year * 12 + month < CUTOVER_YEAR * 12 + CUTOVER_MONTH
        || (year === CUTOVER_YEAR && month === CUTOVER_MONTH && date.getDate() < PERIOD_START_DAY);
    if (!beforeCutover && date.getDate() < PERIOD_START_DAY) {
        month -= 1;
        if (month === 0) { month = 12; year -= 1; }
    }
    return { year, month };
}

// 'YYYY-MM-DD' bounds of a period: start inclusive, end exclusive.
function periodRange(year, month) {
    const pad = n => String(n).padStart(2, '0');
    const nextYear  = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const key = year * 12 + month, cut = CUTOVER_YEAR * 12 + CUTOVER_MONTH;
    const startDay = key <= cut ? 1 : PERIOD_START_DAY;
    const endDay   = key <  cut ? 1 : PERIOD_START_DAY;
    return {
        start: `${year}-${pad(month)}-${pad(startDay)}`,
        end:   `${nextYear}-${pad(nextMonth)}-${pad(endDay)}`,
    };
}

module.exports = { PERIOD_START_DAY, CUTOVER, periodExpr, periodOf, periodRange };
