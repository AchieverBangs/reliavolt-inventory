// Commission is settled per "commission month", which runs from the 15th of one month
// to the 14th of the next — NOT the calendar month. A period is labelled by the month it
// starts in, so (2026, 9) means 15 Sep 2026 – 14 Oct 2026. commission_settlements.year/
// .month use that same label.
//
// Commission is only compiled from COMMISSION_START onward: any sale whose
// commission_date falls before it is ignored by every commission total.

const PERIOD_START_DAY = 15;
const COMMISSION_START = '2026-09-15';

// SQL expression shifting a timestamp so EXTRACT(YEAR/MONTH ...) on it yields the
// commission-period label, e.g. 14 Oct -> 30 Sep (period 9), 15 Oct -> 1 Oct (period 10).
function periodExpr(col) {
    return `(${col} - INTERVAL '${PERIOD_START_DAY - 1} days')`;
}

// SQL condition: the sale counts toward commission at all.
function startedExpr(col) {
    return `${col} >= DATE '${COMMISSION_START}'`;
}

// The commission period a JS Date falls in: { year, month } (month 1-12).
function periodOf(date) {
    let year  = date.getFullYear();
    let month = date.getMonth() + 1;
    if (date.getDate() < PERIOD_START_DAY) {
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
    return {
        start: `${year}-${pad(month)}-${PERIOD_START_DAY}`,
        end:   `${nextYear}-${pad(nextMonth)}-${PERIOD_START_DAY}`,
    };
}

module.exports = { PERIOD_START_DAY, COMMISSION_START, periodExpr, startedExpr, periodOf, periodRange };
