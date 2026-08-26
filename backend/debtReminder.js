/**
 * Debt reminders.
 *
 * A customer's balance going negative is the office lending money, and the
 * moment it stops being visible is the moment it stops being collected. This
 * checks the book on a schedule the owner sets and sends them the list.
 *
 * It reminds the OWNER, not the customers. Messaging customers automatically is
 * a different decision with real consequences for the relationship, so that
 * stays a deliberate act through the statement screen.
 */

const cron = require('node-cron');

const store = require('./store');
const { sendTextMessage, getWhatsAppStatus } = require('./whatsapp');

const OWNER_PHONE_NUMBER = process.env.OWNER_PHONE_NUMBER;

const DEFAULTS = {
  debtReminderEnabled: false,
  debtReminderDays: 7,        // remind every N days
  debtReminderMinAmount: 0,   // ignore debts smaller than this
  debtReminderHour: 10        // hour of day, Baghdad time
};

let lastRun = null;

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/** Customers who owe the office money, largest debt first. */
async function collectDebtors(minAmount) {
  const customers = await store.listCustomers();

  return customers
    .filter(c => !c.archived && (Number(c.balance) || 0) < 0)
    .map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone || '',
      debt: Math.abs(Number(c.balance) || 0)
    }))
    .filter(d => d.debt >= (Number(minAmount) || 0))
    .sort((a, b) => b.debt - a.debt);
}

/** Builds the WhatsApp message. Long lists are trimmed so it stays readable. */
function buildMessage(debtors, everyDays) {
  const total = debtors.reduce((sum, d) => sum + d.debt, 0);
  const shown = debtors.slice(0, 20);

  const lines = shown.map((d, i) =>
    `${i + 1}. ${d.name} — ${fmt(d.debt)} د.ع${d.phone ? `\n   ${d.phone}` : ''}`
  );

  const more = debtors.length > shown.length
    ? `\n\n… و${debtors.length - shown.length} زبون آخر.`
    : '';

  return (
    `📌 *تذكير الديون*\n` +
    `${new Date().toLocaleDateString('ar-EG')}\n\n` +
    `عدد المدينين: ${debtors.length}\n` +
    `إجمالي الديون: *${fmt(total)} د.ع*\n\n` +
    `${lines.join('\n')}${more}\n\n` +
    `— يتكرر هذا التذكير كل ${everyDays} يوم. تغيّره من إعدادات الموقع.`
  );
}

/**
 * Runs one reminder cycle.
 * `force` bypasses the interval, for the "send now" button.
 */
async function runReminder({ force = false } = {}) {
  const startedAt = new Date().toISOString();

  try {
    const settings = { ...DEFAULTS, ...(await store.getSettings()) };

    if (!force && !settings.debtReminderEnabled) {
      return { startedAt, ok: false, skipped: 'disabled' };
    }

    // Only when the chosen number of days has passed since the last one.
    if (!force && settings.debtReminderLastSent) {
      const elapsedDays =
        (Date.now() - new Date(settings.debtReminderLastSent).getTime()) / 86400000;
      if (elapsedDays < Number(settings.debtReminderDays)) {
        return { startedAt, ok: false, skipped: 'not-due' };
      }
    }

    const debtors = await collectDebtors(settings.debtReminderMinAmount);

    if (debtors.length === 0) {
      // Nothing owed is good news, not a message worth sending on a schedule.
      if (!force) {
        await store.updateSettings({ debtReminderLastSent: new Date().toISOString() });
        return { startedAt, ok: true, debtors: 0, sent: false };
      }
      return { startedAt, ok: true, debtors: 0, sent: false, note: 'لا يوجد مدينون حالياً' };
    }

    if (!OWNER_PHONE_NUMBER) {
      return { startedAt, ok: false, error: 'رقم المالك غير مضبوط بإعدادات الخادم' };
    }

    if (getWhatsAppStatus().status !== 'connected') {
      // Not marked as sent, so it goes out once WhatsApp is back.
      return { startedAt, ok: false, error: 'الواتساب غير متصل' };
    }

    await sendTextMessage(
      OWNER_PHONE_NUMBER,
      buildMessage(debtors, settings.debtReminderDays)
    );

    await store.updateSettings({ debtReminderLastSent: new Date().toISOString() });

    const total = debtors.reduce((sum, d) => sum + d.debt, 0);
    console.log(`[DEBT] Reminder sent: ${debtors.length} debtors, ${fmt(total)} IQD.`);

    lastRun = { startedAt, ok: true, debtors: debtors.length, totalDebt: total, sent: true };
    return lastRun;
  } catch (error) {
    console.error('[DEBT] Reminder failed:', error.message);
    lastRun = { startedAt, ok: false, error: error.message };
    return lastRun;
  }
}

// Checked hourly rather than once a day: the owner picks the hour, and a single
// fixed cron time would ignore that choice.
const reminderJob = cron.schedule('0 * * * *', async () => {
  try {
    const settings = { ...DEFAULTS, ...(await store.getSettings()) };
    if (!settings.debtReminderEnabled) return;

    const hourNow = Number(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Baghdad', hour: '2-digit', hour12: false })
    );
    if (hourNow !== Number(settings.debtReminderHour)) return;

    await runReminder();
  } catch (error) {
    console.error('[DEBT] Scheduler error:', error.message);
  }
}, { scheduled: true, timezone: 'Asia/Baghdad' });

console.log('Debt reminder scheduler loaded (checks hourly, Baghdad time).');

module.exports = {
  DEFAULTS,
  runReminder,
  collectDebtors,
  reminderJob,
  getLastRun: () => lastRun
};
