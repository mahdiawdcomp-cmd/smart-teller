/**
 * Notifications: the in-app feed, and push to the device.
 *
 * Two different jobs sharing one source of truth. The feed answers "what
 * happened while I was away" when the owner opens the site. Push answers "tell
 * me now" when they are not looking at it at all — a transaction is money
 * leaving or entering the drawer, and the owner of an exchange office wants to
 * know the moment a teller records one.
 */

const store = require('./store');

let webpush = null;
try {
  webpush = require('web-push');
} catch {
  console.warn('[PUSH] web-push is not installed; device notifications are disabled.');
}

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:owner@smart-teller.local';

const pushConfigured = !!(webpush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('Push notifications ready.');
} else if (webpush) {
  console.warn(
    '[PUSH] VAPID keys are not set — device notifications are off. ' +
    'Generate a pair with: node backend/scripts/generateVapidKeys.js'
  );
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

// ─── The in-app feed ───

/**
 * The most recent operations across every customer, newest first.
 * Reads the cached ledger, so opening the bell costs nothing extra.
 */
async function recentActivity({ limit = 50, since = null } = {}) {
  const rows = await store.listAllTransactions({});

  const items = rows
    .filter(tx => (since ? tx.date > since : true))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit)
    .map(tx => {
      const commission = Number(tx.commission) || 0;
      const total = Number(tx.amount) + (tx.type === 'withdrawal' ? commission : 0);

      return {
        id: tx.id,
        customerId: tx.customerId,
        customerName: tx.customerName,
        type: tx.type,
        amount: Number(tx.amount),
        commission,
        total,
        notes: tx.notes || '',
        date: tx.date,
        title: tx.type === 'deposit' ? 'إيداع جديد' : 'سحب / حوالة',
        body: `${tx.customerName} — ${fmt(total)} د.ع`
      };
    });

  return { items, latest: items[0]?.date || null };
}

// ─── Push subscriptions ───

async function listSubscriptions() {
  if (store.hasCloudDb()) {
    return store.listPushSubscriptions();
  }
  const data = await store.readLocal();
  return data.pushSubscriptions || [];
}

/** Stores a browser's push endpoint. Keyed by endpoint, so re-subscribing is safe. */
async function saveSubscription(subscription, label) {
  if (!subscription?.endpoint) {
    const err = new Error('اشتراك الإشعارات غير صالح');
    err.status = 400;
    throw err;
  }

  const record = {
    endpoint: subscription.endpoint,
    keys: subscription.keys || {},
    label: label || '',
    createdAt: new Date().toISOString()
  };

  await store.savePushSubscription(record);
  return { ok: true };
}

async function removeSubscription(endpoint) {
  await store.deletePushSubscription(endpoint);
  return { ok: true };
}

/**
 * Sends one notification to every registered device.
 *
 * A device that has uninstalled the app or revoked permission answers 404/410;
 * those subscriptions are dropped rather than retried forever.
 */
async function sendPush({ title, body, tag, url }) {
  if (!pushConfigured) return { sent: 0, skipped: 'push not configured' };

  const subs = await listSubscriptions();
  if (subs.length === 0) return { sent: 0 };

  const payload = JSON.stringify({
    title,
    body,
    tag: tag || 'smart-teller',
    url: url || '/'
  });

  let sent = 0;
  const dead = [];

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
      sent++;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        dead.push(sub.endpoint);
      } else {
        console.error('[PUSH] Send failed:', error.statusCode || error.message);
      }
    }
  }));

  for (const endpoint of dead) {
    await store.deletePushSubscription(endpoint).catch(() => {});
  }

  return { sent, removed: dead.length };
}

/** Announces one transaction. Called after a transaction is committed, never before. */
async function notifyTransaction({ customerName, transaction, balance }) {
  const commission = Number(transaction.commission) || 0;
  const total = Number(transaction.amount) + (transaction.type === 'withdrawal' ? commission : 0);
  const isDeposit = transaction.type === 'deposit';

  return sendPush({
    title: isDeposit ? '⬅️ إيداع جديد' : '➡️ سحب / حوالة',
    body:
      `${customerName}\n` +
      `${fmt(total)} د.ع` +
      (commission > 0 ? ` (عمولة ${fmt(commission)})` : '') +
      `\nالرصيد: ${fmt(balance)} د.ع`,
    tag: `tx-${transaction.id}`,
    url: '/'
  });
}

module.exports = {
  recentActivity,
  saveSubscription,
  removeSubscription,
  listSubscriptions,
  sendPush,
  notifyTransaction,
  isPushConfigured: () => pushConfigured,
  getPublicKey: () => VAPID_PUBLIC_KEY
};
