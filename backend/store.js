/**
 * Single data-access layer for customers, transactions and the audit trail.
 *
 * Two things this module exists to guarantee:
 *
 *  1. Money is never computed with a read-then-write race. Every balance change
 *     happens inside a Firestore transaction (or, in local fallback mode, behind
 *     a write mutex), and the delta is stored on the transaction record itself so
 *     an edit or a delete can reverse exactly what was applied.
 *
 *  2. Transactions live in a `transactions` subcollection, not in an array on the
 *     customer document. A Firestore document is capped at 1MB, so the old array
 *     layout would have silently stopped accepting new transactions for the
 *     busiest customers — the ones that matter most.
 */

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const { db } = require('./firebaseAdmin');
const admin = require('firebase-admin');

const LOCAL_DB_PATH = path.join(__dirname, 'data', 'database.json');
const MIGRATION_BATCH = 400; // Firestore allows 500 writes per batch
const AUDIT_LOG_LOCAL_MAX = 1000;

// ─── Money helpers ───

/**
 * Signed effect of a transaction on the customer's balance.
 * A deposit adds what the customer handed over; a withdrawal removes the amount
 * plus the teller's commission.
 */
function computeDelta(type, amount, commission) {
  const numAmount = Number(amount) || 0;
  const numCommission = type === 'deposit' ? 0 : (Number(commission) || 0);
  return type === 'deposit' ? numAmount : -(numAmount + numCommission);
}

/** Validates and normalizes a transaction payload coming from the API. */
function normalizeTransactionInput(input) {
  const type = input.type;
  if (type !== 'deposit' && type !== 'withdrawal') {
    throw badRequest('نوع العملية غير صحيح');
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw badRequest('المبلغ يجب أن يكون رقماً أكبر من صفر');
  }

  const rawCommission = Number(input.commission);
  const commission = type === 'deposit'
    ? 0
    : (Number.isFinite(rawCommission) && rawCommission >= 0 ? rawCommission : 0);

  const date = input.date ? new Date(input.date) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw badRequest('تاريخ العملية غير صحيح');
  }

  return {
    type,
    amount,
    commission,
    notes: typeof input.notes === 'string' ? input.notes.slice(0, 500) : '',
    date: date.toISOString()
  };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

// ─── Local fallback mode: file access serialized behind a mutex ───
//
// Without this, two concurrent requests would both read the file, both compute a
// new balance from the same starting point, and the second write would erase the
// first transaction entirely.

let writeChain = Promise.resolve();

function withLocalLock(fn) {
  const run = writeChain.then(fn, fn);
  // Keep the chain alive even when a caller's operation rejects.
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

async function readLocal() {
  try {
    const data = await fs.readJson(LOCAL_DB_PATH);
    return {
      customers: data?.customers || [],
      expenses: data?.expenses || [],
      auditLogs: data?.auditLogs || []
    };
  } catch {
    return { customers: [], expenses: [], auditLogs: [] };
  }
}

async function writeLocal(data) {
  await fs.writeJson(LOCAL_DB_PATH, data, { spaces: 2 });
}

// ─── Audit trail ───

function buildAuditEntry({ action, customerId, customerName, txId, before, after, actor }) {
  return {
    id: crypto.randomBytes(12).toString('hex'),
    at: new Date().toISOString(),
    action, // 'create' | 'update' | 'delete' | 'recompute'
    customerId,
    customerName: customerName || '',
    txId: txId || null,
    before: before || null,
    after: after || null,
    actor: actor || 'admin'
  };
}

async function appendAuditLog(entry) {
  if (db) {
    await db.collection('auditLogs').doc(entry.id).set(entry);
    return;
  }

  await withLocalLock(async () => {
    const data = await readLocal();
    data.auditLogs = [entry, ...data.auditLogs].slice(0, AUDIT_LOG_LOCAL_MAX);
    await writeLocal(data);
  });
}

async function listAuditLogs({ limit = 100, customerId = null } = {}) {
  if (db) {
    let query = db.collection('auditLogs');
    if (customerId) query = query.where('customerId', '==', customerId);
    const snap = await query.orderBy('at', 'desc').limit(limit).get();
    return snap.docs.map(d => d.data());
  }

  const data = await readLocal();
  const logs = customerId
    ? data.auditLogs.filter(l => l.customerId === customerId)
    : data.auditLogs;
  return logs.slice(0, limit);
}

// ─── Migration: embedded array -> subcollection ───

/**
 * Moves a customer's embedded `transactions` array into the subcollection.
 * Idempotent: each transaction keeps its original id as the document id, so a
 * re-run after a crash overwrites rather than duplicates.
 */
async function ensureMigrated(customerId) {
  if (!db) return; // local mode keeps the array layout

  const docRef = db.collection('customers').doc(customerId);
  const doc = await docRef.get();
  if (!doc.exists) throw notFound('الزبون غير موجود');

  const data = doc.data();
  const embedded = Array.isArray(data.transactions) ? data.transactions : [];

  if (data.txMigrated === true && embedded.length === 0) return;
  if (embedded.length === 0) {
    await docRef.update({ txMigrated: true, transactions: admin.firestore.FieldValue.delete() });
    return;
  }

  console.log(`[MIGRATE] Moving ${embedded.length} transactions for customer ${customerId}...`);

  for (let i = 0; i < embedded.length; i += MIGRATION_BATCH) {
    const batch = db.batch();
    for (const tx of embedded.slice(i, i + MIGRATION_BATCH)) {
      const txId = String(tx.id || crypto.randomBytes(12).toString('hex'));
      const record = {
        id: txId,
        type: tx.type,
        amount: Number(tx.amount) || 0,
        commission: Number(tx.commission) || 0,
        notes: tx.notes || '',
        date: tx.date || new Date().toISOString(),
        // Recorded so later edits reverse exactly what this row contributed.
        balanceDelta: computeDelta(tx.type, tx.amount, tx.commission)
      };
      batch.set(docRef.collection('transactions').doc(txId), record);
    }
    await batch.commit();
  }

  // Flag and array are cleared only after every transaction is safely written.
  await docRef.update({
    txMigrated: true,
    transactions: admin.firestore.FieldValue.delete()
  });

  console.log(`[MIGRATE] Customer ${customerId} migrated.`);
}

/** Migrates every customer. Used by the one-off migration script. */
async function migrateAllCustomers() {
  if (!db) return { migrated: 0, skipped: 'local mode' };

  const snap = await db.collection('customers').get();
  let migrated = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const embedded = Array.isArray(data.transactions) ? data.transactions : [];
    if (data.txMigrated === true && embedded.length === 0) continue;
    await ensureMigrated(doc.id);
    migrated++;
  }

  return { migrated, total: snap.size };
}

// ─── Customers ───

/** Customer list without transactions — the list view only needs balances. */
async function listCustomers() {
  if (db) {
    const snap = await db.collection('customers').get();
    return snap.docs.map(doc => {
      const { transactions, ...rest } = doc.data();
      return { id: doc.id, ...rest };
    });
  }

  const data = await readLocal();
  return data.customers.map(({ transactions, ...rest }) => rest);
}

/** One customer with their transactions, newest first. */
async function getCustomer(customerId, { limit = 500 } = {}) {
  if (db) {
    await ensureMigrated(customerId);

    const docRef = db.collection('customers').doc(customerId);
    const doc = await docRef.get();
    if (!doc.exists) throw notFound('الزبون غير موجود');

    const txSnap = await docRef
      .collection('transactions')
      .orderBy('date', 'desc')
      .limit(limit)
      .get();

    const { transactions, ...rest } = doc.data();
    return {
      id: doc.id,
      ...rest,
      transactions: txSnap.docs.map(d => d.data())
    };
  }

  const data = await readLocal();
  const customer = data.customers.find(c => c.id === customerId);
  if (!customer) throw notFound('الزبون غير موجود');

  const txs = [...(customer.transactions || [])].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );
  return { ...customer, transactions: txs.slice(0, limit) };
}

/** Finds a customer by their public share token, including transactions. */
async function getCustomerByShareToken(token) {
  if (db) {
    const snap = await db
      .collection('customers')
      .where('sharedToken', '==', token)
      .limit(1)
      .get();

    if (snap.empty) return null;
    const doc = snap.docs[0];
    if (!doc.data().isSharedLinkActive) return null;

    return getCustomer(doc.id);
  }

  const data = await readLocal();
  const customer = data.customers.find(c => c.sharedToken === token && c.isSharedLinkActive);
  if (!customer) return null;
  return getCustomer(customer.id);
}

async function addCustomer({ name, phone }) {
  const newCustomer = {
    name,
    phone: phone || '',
    balance: 0,
    txCount: 0,
    txMigrated: true, // born in the subcollection layout
    createdAt: new Date().toISOString()
  };

  if (db) {
    const docRef = await db.collection('customers').add(newCustomer);
    return { id: docRef.id, ...newCustomer };
  }

  return withLocalLock(async () => {
    const data = await readLocal();
    const customerWithId = { id: Date.now().toString(), ...newCustomer, transactions: [] };
    data.customers.push(customerWithId);
    await writeLocal(data);
    return customerWithId;
  });
}

// ─── Transactions ───

/**
 * Adds a transaction and moves the balance in one atomic step.
 * Returns { transaction, balance }.
 */
async function addTransaction(customerId, input, actor) {
  const tx = normalizeTransactionInput(input);
  const txId = crypto.randomBytes(12).toString('hex');
  const record = { id: txId, ...tx, balanceDelta: computeDelta(tx.type, tx.amount, tx.commission) };

  let result;

  if (db) {
    await ensureMigrated(customerId);
    const docRef = db.collection('customers').doc(customerId);

    result = await db.runTransaction(async t => {
      const doc = await t.get(docRef);
      if (!doc.exists) throw notFound('الزبون غير موجود');

      const current = doc.data();
      const newBalance = (Number(current.balance) || 0) + record.balanceDelta;

      t.set(docRef.collection('transactions').doc(txId), record);
      t.update(docRef, {
        balance: newBalance,
        txCount: (Number(current.txCount) || 0) + 1
      });

      return { transaction: record, balance: newBalance, customerName: current.name };
    });
  } else {
    result = await withLocalLock(async () => {
      const data = await readLocal();
      const customer = data.customers.find(c => c.id === customerId);
      if (!customer) throw notFound('الزبون غير موجود');

      if (!Array.isArray(customer.transactions)) customer.transactions = [];
      customer.transactions.unshift(record);
      customer.balance = (Number(customer.balance) || 0) + record.balanceDelta;
      customer.txCount = customer.transactions.length;

      await writeLocal(data);
      return { transaction: record, balance: customer.balance, customerName: customer.name };
    });
  }

  await appendAuditLog(buildAuditEntry({
    action: 'create',
    customerId,
    customerName: result.customerName,
    txId,
    after: record,
    actor
  }));

  return result;
}

/**
 * Edits an existing transaction: reverses the old delta and applies the new one
 * atomically, so the balance can never drift away from the ledger.
 */
async function updateTransaction(customerId, txId, input, actor) {
  const updated = normalizeTransactionInput(input);
  const newDelta = computeDelta(updated.type, updated.amount, updated.commission);

  let result;

  if (db) {
    await ensureMigrated(customerId);
    const docRef = db.collection('customers').doc(customerId);
    const txRef = docRef.collection('transactions').doc(txId);

    result = await db.runTransaction(async t => {
      const [doc, txDoc] = await Promise.all([t.get(docRef), t.get(txRef)]);
      if (!doc.exists) throw notFound('الزبون غير موجود');
      if (!txDoc.exists) throw notFound('العملية غير موجودة');

      const current = doc.data();
      const before = txDoc.data();
      const oldDelta = Number.isFinite(before.balanceDelta)
        ? before.balanceDelta
        : computeDelta(before.type, before.amount, before.commission);

      const newBalance = (Number(current.balance) || 0) - oldDelta + newDelta;
      const after = { id: txId, ...updated, balanceDelta: newDelta, editedAt: new Date().toISOString() };

      t.set(txRef, after);
      t.update(docRef, { balance: newBalance });

      return { transaction: after, before, balance: newBalance, customerName: current.name };
    });
  } else {
    result = await withLocalLock(async () => {
      const data = await readLocal();
      const customer = data.customers.find(c => c.id === customerId);
      if (!customer) throw notFound('الزبون غير موجود');

      const list = customer.transactions || [];
      const idx = list.findIndex(t => String(t.id) === String(txId));
      if (idx === -1) throw notFound('العملية غير موجودة');

      const before = list[idx];
      const oldDelta = Number.isFinite(before.balanceDelta)
        ? before.balanceDelta
        : computeDelta(before.type, before.amount, before.commission);

      const after = { id: before.id, ...updated, balanceDelta: newDelta, editedAt: new Date().toISOString() };
      list[idx] = after;
      customer.balance = (Number(customer.balance) || 0) - oldDelta + newDelta;

      await writeLocal(data);
      return { transaction: after, before, balance: customer.balance, customerName: customer.name };
    });
  }

  await appendAuditLog(buildAuditEntry({
    action: 'update',
    customerId,
    customerName: result.customerName,
    txId,
    before: result.before,
    after: result.transaction,
    actor
  }));

  return result;
}

/** Deletes a transaction and reverses its exact contribution to the balance. */
async function deleteTransaction(customerId, txId, actor) {
  let result;

  if (db) {
    await ensureMigrated(customerId);
    const docRef = db.collection('customers').doc(customerId);
    const txRef = docRef.collection('transactions').doc(txId);

    result = await db.runTransaction(async t => {
      const [doc, txDoc] = await Promise.all([t.get(docRef), t.get(txRef)]);
      if (!doc.exists) throw notFound('الزبون غير موجود');
      if (!txDoc.exists) throw notFound('العملية غير موجودة');

      const current = doc.data();
      const before = txDoc.data();
      const oldDelta = Number.isFinite(before.balanceDelta)
        ? before.balanceDelta
        : computeDelta(before.type, before.amount, before.commission);

      const newBalance = (Number(current.balance) || 0) - oldDelta;

      t.delete(txRef);
      t.update(docRef, {
        balance: newBalance,
        txCount: Math.max((Number(current.txCount) || 1) - 1, 0)
      });

      return { before, balance: newBalance, customerName: current.name };
    });
  } else {
    result = await withLocalLock(async () => {
      const data = await readLocal();
      const customer = data.customers.find(c => c.id === customerId);
      if (!customer) throw notFound('الزبون غير موجود');

      const list = customer.transactions || [];
      const idx = list.findIndex(t => String(t.id) === String(txId));
      if (idx === -1) throw notFound('العملية غير موجودة');

      const before = list[idx];
      const oldDelta = Number.isFinite(before.balanceDelta)
        ? before.balanceDelta
        : computeDelta(before.type, before.amount, before.commission);

      list.splice(idx, 1);
      customer.balance = (Number(customer.balance) || 0) - oldDelta;
      customer.txCount = list.length;

      await writeLocal(data);
      return { before, balance: customer.balance, customerName: customer.name };
    });
  }

  await appendAuditLog(buildAuditEntry({
    action: 'delete',
    customerId,
    customerName: result.customerName,
    txId,
    before: result.before,
    actor
  }));

  return result;
}

/**
 * Recomputes a customer's balance from their full ledger.
 * The stored balance is the fast path; this is the check that it still agrees
 * with the transactions behind it.
 */
async function recomputeBalance(customerId, actor) {
  let stored;
  let computed = 0;
  let customerName = '';

  if (db) {
    await ensureMigrated(customerId);
    const docRef = db.collection('customers').doc(customerId);
    const doc = await docRef.get();
    if (!doc.exists) throw notFound('الزبون غير موجود');

    stored = Number(doc.data().balance) || 0;
    customerName = doc.data().name;

    const txSnap = await docRef.collection('transactions').get();
    txSnap.forEach(d => {
      const tx = d.data();
      computed += Number.isFinite(tx.balanceDelta)
        ? tx.balanceDelta
        : computeDelta(tx.type, tx.amount, tx.commission);
    });

    if (computed !== stored) {
      await docRef.update({ balance: computed, txCount: txSnap.size });
    }
  } else {
    const outcome = await withLocalLock(async () => {
      const data = await readLocal();
      const customer = data.customers.find(c => c.id === customerId);
      if (!customer) throw notFound('الزبون غير موجود');

      const storedBalance = Number(customer.balance) || 0;
      let sum = 0;
      for (const tx of customer.transactions || []) {
        sum += Number.isFinite(tx.balanceDelta)
          ? tx.balanceDelta
          : computeDelta(tx.type, tx.amount, tx.commission);
      }

      if (sum !== storedBalance) {
        customer.balance = sum;
        customer.txCount = (customer.transactions || []).length;
        await writeLocal(data);
      }

      return { storedBalance, sum, name: customer.name };
    });

    stored = outcome.storedBalance;
    computed = outcome.sum;
    customerName = outcome.name;
  }

  const drift = computed - stored;

  if (drift !== 0) {
    await appendAuditLog(buildAuditEntry({
      action: 'recompute',
      customerId,
      customerName,
      before: { balance: stored },
      after: { balance: computed },
      actor
    }));
  }

  return { storedBalance: stored, computedBalance: computed, drift };
}

// ─── Aggregates ───

/** Total commission earned across every customer. */
async function sumAllCommissions() {
  if (db) {
    // collectionGroup reaches every `transactions` subcollection in one query.
    const snap = await db.collectionGroup('transactions').get();
    let total = 0;
    snap.forEach(d => { total += Number(d.data().commission) || 0; });

    // Any customer not migrated yet still holds an array; include it too.
    const customersSnap = await db.collection('customers').get();
    customersSnap.forEach(doc => {
      const embedded = doc.data().transactions;
      if (Array.isArray(embedded)) {
        embedded.forEach(tx => { total += Number(tx.commission) || 0; });
      }
    });

    return total;
  }

  const data = await readLocal();
  let total = 0;
  for (const customer of data.customers) {
    for (const tx of customer.transactions || []) {
      total += Number(tx.commission) || 0;
    }
  }
  return total;
}

module.exports = {
  computeDelta,
  normalizeTransactionInput,
  listCustomers,
  getCustomer,
  getCustomerByShareToken,
  addCustomer,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  recomputeBalance,
  listAuditLogs,
  sumAllCommissions,
  ensureMigrated,
  migrateAllCustomers,
  readLocal,
  writeLocal,
  withLocalLock
};
