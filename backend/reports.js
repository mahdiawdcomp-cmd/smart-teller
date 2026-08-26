/**
 * Period reporting.
 *
 * The old profit endpoint only ever answered one question — total earnings since
 * the first day the office opened — which cannot tell you whether this month is
 * better or worse than the last one. Everything here is scoped to a date range.
 */

const store = require('./store');

/** Resolves a named preset into an ISO { from, to } pair. */
function resolveRange({ preset, from, to }) {
  const now = new Date();

  const startOfDay = (d) => {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const endOfDay = (d) => {
    const copy = new Date(d);
    copy.setHours(23, 59, 59, 999);
    return copy;
  };

  switch (preset) {
    case 'today':
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString(), label: 'اليوم' };

    case 'week': {
      const start = startOfDay(now);
      start.setDate(start.getDate() - 6);
      return { from: start.toISOString(), to: endOfDay(now).toISOString(), label: 'آخر 7 أيام' };
    }

    case 'month': {
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      return { from: start.toISOString(), to: endOfDay(now).toISOString(), label: 'الشهر الحالي' };
    }

    case 'prev_month': {
      const start = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const end = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      return { from: start.toISOString(), to: end.toISOString(), label: 'الشهر السابق' };
    }

    case 'year': {
      const start = startOfDay(new Date(now.getFullYear(), 0, 1));
      return { from: start.toISOString(), to: endOfDay(now).toISOString(), label: 'السنة الحالية' };
    }

    case 'all':
      return { from: null, to: null, label: 'كامل المدة' };

    default: {
      // Custom range. A missing side stays open-ended.
      const fromIso = from ? startOfDay(new Date(from)).toISOString() : null;
      const toIso = to ? endOfDay(new Date(to)).toISOString() : null;
      return { from: fromIso, to: toIso, label: 'فترة مخصصة' };
    }
  }
}

/** Groups totals by calendar day so the frontend can draw a trend. */
function buildDailySeries(transactions, expenses) {
  const days = new Map();

  const bucket = (isoDate) => {
    const key = isoDate.slice(0, 10);
    if (!days.has(key)) {
      days.set(key, { date: key, deposits: 0, withdrawals: 0, commission: 0, expenses: 0 });
    }
    return days.get(key);
  };

  for (const tx of transactions) {
    const day = bucket(tx.date);
    if (tx.type === 'deposit') {
      day.deposits += Number(tx.amount) || 0;
    } else {
      day.withdrawals += Number(tx.amount) || 0;
      day.commission += Number(tx.commission) || 0;
    }
  }

  for (const expense of expenses) {
    bucket(expense.date).expenses += Number(expense.amount) || 0;
  }

  return [...days.values()]
    .map(day => ({ ...day, netProfit: day.commission - day.expenses }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Per-customer breakdown, most profitable first. */
function buildPerCustomer(transactions) {
  const byCustomer = new Map();

  for (const tx of transactions) {
    if (!byCustomer.has(tx.customerId)) {
      byCustomer.set(tx.customerId, {
        customerId: tx.customerId,
        customerName: tx.customerName,
        deposits: 0,
        withdrawals: 0,
        commission: 0,
        txCount: 0
      });
    }

    const row = byCustomer.get(tx.customerId);
    row.txCount += 1;

    if (tx.type === 'deposit') {
      row.deposits += Number(tx.amount) || 0;
    } else {
      row.withdrawals += Number(tx.amount) || 0;
      row.commission += Number(tx.commission) || 0;
    }
  }

  return [...byCustomer.values()].sort((a, b) => b.commission - a.commission);
}

/** The full report for a range: totals, per-day trend, and per-customer rows. */
async function buildReport(params) {
  const range = resolveRange(params);

  const [transactions, expenses] = await Promise.all([
    store.listAllTransactions({ from: range.from, to: range.to }),
    store.listExpenses({ from: range.from, to: range.to })
  ]);

  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let totalCommission = 0;

  for (const tx of transactions) {
    if (tx.type === 'deposit') {
      totalDeposits += Number(tx.amount) || 0;
    } else {
      totalWithdrawals += Number(tx.amount) || 0;
      totalCommission += Number(tx.commission) || 0;
    }
  }

  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  return {
    range,
    totals: {
      transactionCount: transactions.length,
      totalDeposits,
      totalWithdrawals,
      totalCommission,
      totalExpenses,
      netProfit: totalCommission - totalExpenses
    },
    daily: buildDailySeries(transactions, expenses),
    perCustomer: buildPerCustomer(transactions)
  };
}

module.exports = { buildReport, resolveRange };
