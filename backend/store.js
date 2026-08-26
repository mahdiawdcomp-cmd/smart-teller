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
//
// Money is held as whole dinars. The Iraqi dinar has no fractional unit in
// circulation, and floating point cannot represent 0.1 exactly — a few hundred
// fractional operations and a balance drifts away from the sum of its own
// ledger. Keeping every stored amount integral makes the arithmetic exact.

/** Rounds a money value to whole dinars. */
function roundMoney(value) {
  return Math.round(Number(value) || 0);
}

/** Legacy rows may hold fractions; below this a difference is float noise, not money. */
const MONEY_EPSILON = 0.005;

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

  const rawAmount = Number(input.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw badRequest('المبلغ يجب أن يكون رقماً أكبر من صفر');
  }

  const amount = roundMoney(rawAmount);
  if (amount <= 0) {
    throw badRequest('المبلغ يجب أن يكون ديناراً واحداً على الأقل');
  }

  const rawCommission = Number(input.commission);
  const commission = type === 'deposit'
    ? 0
    : (Number.isFinite(rawCommission) && rawCommission > 0 ? roundMoney(rawCommission) : 0);

  const date = input.date ? new Date(input.date) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw badRequest('تاريخ العملية غير صحيح');
  }
  // A future-dated operation would sit in reports for a day that has not
  // happened yet. The frontend blocks it too, but the client is not the guard.
  if (date.getTime() > Date.now() + 60_000) {
    throw badRequest('لا يمكن تسجيل عملية بتاريخ مستقبلي');
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
    // Spread first: a write is always a full-file overwrite, so any section this
    // function forgets to carry over is silently erased on the next save.
    return {
      ...(data || {}),
      customers: data?.customers || [],
      expenses: data?.expenses || [],
      auditLogs: data?.auditLogs || [],
      cashCounts: data?.cashCounts || [],
      settings: data?.settings || {}
    };
  } catch {
    return { customers: [], expenses: [], auditLogs: [], cashCounts: [], settings: {} };
  }
}

async function writeLocal(data) {
  await fs.writeJson(LOCAL_DB_PATH, data, { spaces: 2 });
}

/**
 * Read-modify-write the local database under the same lock the ledger uses.
 *
 * Any code path that reads the file, mutates it and writes it back must go
 * through here. A write that skips the lock overwrites the whole file and can
 * erase a transaction another request just committed.
 */
async function mutateLocal(mutator) {
  return withLocalLock(async () => {
    const data = await readLocal();
    const result = await mutator(data);
    await writeLocal(data);
    return result;
  });
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

/**
 * One customer with their transactions, newest first.
 *
 * `transactionsTruncated` is part of the contract, not a detail: a statement
 * computes its opening balance by walking the ledger from the beginning, so a
 * silently shortened list produces confidently wrong numbers. The caller has to
 * be able to tell that it is not looking at the whole history.
 */
async function getCustomer(customerId, { limit = 2000 } = {}) {
  if (db) {
    await ensureMigrated(customerId);

    const docRef = db.collection('customers').doc(customerId);
    const doc = await docRef.get();
    if (!doc.exists) throw notFound('الزبون غير موجود');

    // Fetch one extra row purely to detect that more exist.
    const txSnap = await docRef
      .collection('transactions')
      .orderBy('date', 'desc')
      .limit(limit + 1)
      .get();

    const all = txSnap.docs.map(d => d.data());
    const truncated = all.length > limit;

    const { transactions, ...rest } = doc.data();
    return {
      id: doc.id,
      ...rest,
      transactions: truncated ? all.slice(0, limit) : all,
      transactionsTruncated: truncated
    };
  }

  const data = await readLocal();
  const customer = data.customers.find(c => c.id === customerId);
  if (!customer) throw notFound('الزبون غير موجود');

  const txs = [...(customer.transactions || [])].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  return {
    ...customer,
    transactions: txs.slice(0, limit),
    transactionsTruncated: txs.length > limit
  };
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

  invalidateLedgerCache();

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

  invalidateLedgerCache();

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

  invalidateLedgerCache();

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

    if (Math.abs(computed - stored) >= MONEY_EPSILON) {
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

      if (Math.abs(sum - storedBalance) >= MONEY_EPSILON) {
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

  // Rounded so a legacy fractional row cannot report drift forever.
  const drift = Math.abs(computed - stored) < MONEY_EPSILON ? 0 : computed - stored;

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

// ─── Duplicate detection & customer management ───

/** Last 10 digits, so 07xx and +9647xx compare equal. */
function phoneKey(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('00964')) digits = digits.slice(5);
  else if (digits.startsWith('964')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.length >= 9 ? digits.slice(-10) : '';
}

/** Arabic names vary in spelling; compare on a stripped form. */
function nameKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/[ـً-ْ]/g, '')   // tatweel and diacritics
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Customers that look like the one being added.
 *
 * A duplicate customer is worse than a missing one: the same person's money
 * ends up split across two accounts and neither balance is true.
 */
async function findPossibleDuplicates({ name, phone, excludeId = null }) {
  const customers = await listCustomers();
  const targetPhone = phoneKey(phone);
  const targetName = nameKey(name);

  return customers.filter(c => {
    if (excludeId && c.id === excludeId) return false;
    if (c.archived) return false;

    const samePhone = targetPhone && phoneKey(c.phone) === targetPhone;
    const sameName = targetName && nameKey(c.name) === targetName;
    return samePhone || sameName;
  });
}

/** Edits a customer's details. Balance and ledger are untouched. */
async function updateCustomer(customerId, patch) {
  const update = {};

  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw badRequest('اسم الزبون مطلوب');
    update.name = name;
  }
  if (patch.phone !== undefined) update.phone = String(patch.phone).trim();
  if (patch.archived !== undefined) update.archived = !!patch.archived;
  if (patch.notes !== undefined) update.notes = String(patch.notes).slice(0, 500);

  if (Object.keys(update).length === 0) throw badRequest('لا توجد تغييرات');

  if (db) {
    const docRef = db.collection('customers').doc(customerId);
    const doc = await docRef.get();
    if (!doc.exists) throw notFound('الزبون غير موجود');

    await docRef.update(update);
    return { id: customerId, ...doc.data(), ...update };
  }

  return mutateLocal(data => {
    const customer = data.customers.find(c => c.id === customerId);
    if (!customer) throw notFound('الزبون غير موجود');
    Object.assign(customer, update);
    return { ...customer };
  });
}

/**
 * Merges one customer into another: every transaction moves across, the
 * balances add up, and the source is archived rather than deleted so the
 * history of the merge survives.
 */
async function mergeCustomers(sourceId, targetId, actor) {
  if (sourceId === targetId) throw badRequest('لا يمكن دمج الزبون مع نفسه');

  const [source, target] = await Promise.all([
    getCustomer(sourceId, { limit: 100000 }),
    getCustomer(targetId, { limit: 100000 })
  ]);

  const moved = source.transactions.length;

  if (db) {
    const sourceRef = db.collection('customers').doc(sourceId);
    const targetRef = db.collection('customers').doc(targetId);

    // Copy in batches, then flip the source off. Transactions keep their ids,
    // so a retry after a failure overwrites instead of duplicating.
    for (let i = 0; i < source.transactions.length; i += MIGRATION_BATCH) {
      const batch = db.batch();
      for (const tx of source.transactions.slice(i, i + MIGRATION_BATCH)) {
        batch.set(targetRef.collection('transactions').doc(tx.id), {
          ...tx,
          mergedFrom: sourceId
        });
      }
      await batch.commit();
    }

    for (let i = 0; i < source.transactions.length; i += MIGRATION_BATCH) {
      const batch = db.batch();
      for (const tx of source.transactions.slice(i, i + MIGRATION_BATCH)) {
        batch.delete(sourceRef.collection('transactions').doc(tx.id));
      }
      await batch.commit();
    }

    await targetRef.update({
      balance: (Number(target.balance) || 0) + (Number(source.balance) || 0),
      txCount: (Number(target.txCount) || 0) + moved
    });

    await sourceRef.update({
      balance: 0,
      txCount: 0,
      archived: true,
      mergedInto: targetId,
      mergedAt: new Date().toISOString()
    });
  } else {
    await mutateLocal(data => {
      const src = data.customers.find(c => c.id === sourceId);
      const tgt = data.customers.find(c => c.id === targetId);
      if (!src || !tgt) throw notFound('الزبون غير موجود');

      const moving = (src.transactions || []).map(tx => ({ ...tx, mergedFrom: sourceId }));
      tgt.transactions = [...moving, ...(tgt.transactions || [])]
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      tgt.balance = (Number(tgt.balance) || 0) + (Number(src.balance) || 0);
      tgt.txCount = tgt.transactions.length;

      src.transactions = [];
      src.balance = 0;
      src.txCount = 0;
      src.archived = true;
      src.mergedInto = targetId;
      src.mergedAt = new Date().toISOString();
    });
  }

  invalidateLedgerCache();

  await appendAuditLog(buildAuditEntry({
    action: 'merge',
    customerId: targetId,
    customerName: target.name,
    before: { customer: source.name, balance: source.balance, transactions: moved },
    after: { customer: target.name, balance: (Number(target.balance) || 0) + (Number(source.balance) || 0) },
    actor
  }));

  return { movedTransactions: moved, targetId, sourceId };
}

// ─── Idempotency ───
//
// A teller on a weak connection presses save, sees nothing happen, and presses
// again. Without this, that records the transaction twice and the customer's
// balance is wrong in a way nobody notices until they complain.

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Returns the stored result for a key, or null when it is a fresh request. */
async function getIdempotentResult(key) {
  if (!key) return null;

  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;

  if (db) {
    const doc = await db.collection('idempotency').doc(key).get();
    if (!doc.exists) return null;

    const record = doc.data();
    if (new Date(record.at).getTime() < cutoff) return null;
    return record.result;
  }

  const data = await readLocal();
  const record = (data.idempotency || {})[key];
  if (!record) return null;
  if (new Date(record.at).getTime() < cutoff) return null;
  return record.result;
}

async function saveIdempotentResult(key, result) {
  if (!key) return;

  const record = { at: new Date().toISOString(), result };

  if (db) {
    await db.collection('idempotency').doc(key).set(record);
    return;
  }

  await mutateLocal(data => {
    if (!data.idempotency) data.idempotency = {};
    data.idempotency[key] = record;

    // Trim expired keys so the local file does not grow without bound.
    const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
    for (const [existingKey, existing] of Object.entries(data.idempotency)) {
      if (new Date(existing.at).getTime() < cutoff) delete data.idempotency[existingKey];
    }
  });
}

// ─── Reporting: scanning the ledger across customers ───

/**
 * Every transaction in a date range, tagged with its customer.
 *
 * Queries each customer's subcollection separately rather than using a
 * collectionGroup query: a collection-group range query needs an index that has
 * to be created by hand, and a report silently failing on a fresh deployment is
 * worse than a few extra reads at this scale.
 */
// A short-lived cache of the whole ledger.
//
// Reports, search and the cash box all need the same rows, and an office
// refreshing a report three times in a row should not pay for three full scans.
// Sixty seconds is short enough that a teller never sees a stale number for
// long, and any write clears it immediately anyway.
let ledgerCache = null;
const LEDGER_CACHE_MS = 60 * 1000;

function invalidateLedgerCache() {
  ledgerCache = null;
}

/** Every transaction in the office, tagged with its customer. One query. */
async function loadWholeLedger() {
  if (ledgerCache && Date.now() - ledgerCache.at < LEDGER_CACHE_MS) {
    return ledgerCache.rows;
  }

  const customers = await listCustomers();
  const nameById = new Map(customers.map(c => [c.id, c.name]));
  const rows = [];

  if (db) {
    // One collectionGroup query reaches every customer's transactions at once.
    // The previous version issued two queries PER CUSTOMER, so a report on fifty
    // customers cost a hundred round trips before it could render anything.
    const snap = await db.collectionGroup('transactions').get();

    snap.forEach(doc => {
      const customerId = doc.ref.parent.parent?.id;
      if (!customerId) return;
      rows.push({
        ...doc.data(),
        customerId,
        customerName: nameById.get(customerId) || ''
      });
    });

    // Customers still holding the old embedded array have no subcollection yet,
    // so their history would be missing from every total until they migrate.
    for (const customer of customers) {
      if (customer.txMigrated === true) continue;

      const doc = await db.collection('customers').doc(customer.id).get();
      const embedded = doc.exists ? doc.data().transactions : null;
      if (!Array.isArray(embedded)) continue;

      for (const tx of embedded) {
        rows.push({
          ...tx,
          balanceDelta: Number.isFinite(tx.balanceDelta)
            ? tx.balanceDelta
            : computeDelta(tx.type, tx.amount, tx.commission),
          customerId: customer.id,
          customerName: customer.name
        });
      }
    }
  } else {
    const data = await readLocal();
    for (const customer of data.customers) {
      for (const tx of (customer.transactions || [])) {
        rows.push({ ...tx, customerId: customer.id, customerName: customer.name });
      }
    }
  }

  rows.sort((a, b) => new Date(a.date) - new Date(b.date));
  ledgerCache = { at: Date.now(), rows };
  return rows;
}

/** Transactions within a date range, filtered from the cached ledger. */
async function listAllTransactions({ from = null, to = null } = {}) {
  const rows = await loadWholeLedger();

  const fromIso = from ? new Date(from).toISOString() : null;
  const toIso = to ? new Date(to).toISOString() : null;
  if (!fromIso && !toIso) return rows;

  return rows.filter(tx => {
    if (fromIso && tx.date < fromIso) return false;
    if (toIso && tx.date > toIso) return false;
    return true;
  });
}

/** Expenses in a date range. */
async function listExpenses({ from = null, to = null } = {}) {
  let expenses;

  if (db) {
    const snap = await db.collection('expenses').get();
    expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } else {
    expenses = (await readLocal()).expenses;
  }

  const fromIso = from ? new Date(from).toISOString() : null;
  const toIso = to ? new Date(to).toISOString() : null;

  return expenses.filter(e => {
    if (fromIso && e.date < fromIso) return false;
    if (toIso && e.date > toIso) return false;
    return true;
  });
}

/**
 * Searches every customer's ledger at once.
 *
 * When a customer walks in saying "I transferred five million two months ago",
 * opening accounts one by one is not an answer.
 */
async function searchTransactions({
  q = '',
  from = null,
  to = null,
  type = null,
  minAmount = null,
  maxAmount = null,
  customerId = null,
  limit = 200
} = {}) {
  const all = await listAllTransactions({ from, to });

  const term = String(q || '').trim().toLowerCase();
  const normalizedTerm = nameKey(term);
  const min = Number.isFinite(Number(minAmount)) && minAmount !== null && minAmount !== ''
    ? Number(minAmount) : null;
  const max = Number.isFinite(Number(maxAmount)) && maxAmount !== null && maxAmount !== ''
    ? Number(maxAmount) : null;

  const matches = all.filter(tx => {
    if (customerId && tx.customerId !== customerId) return false;
    if (type && tx.type !== type) return false;

    const total = (Number(tx.amount) || 0) +
      (tx.type === 'withdrawal' ? (Number(tx.commission) || 0) : 0);

    if (min !== null && total < min) return false;
    if (max !== null && total > max) return false;

    if (term) {
      const haystack = [
        tx.customerName,
        tx.notes,
        String(tx.amount),
        String(total)
      ].join(' ').toLowerCase();

      if (!haystack.includes(term) && !nameKey(haystack).includes(normalizedTerm)) {
        return false;
      }
    }

    return true;
  });

  // Newest first: recent operations are what people ask about.
  matches.sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    total: matches.length,
    truncated: matches.length > limit,
    results: matches.slice(0, limit)
  };
}

// ─── Settings (opening cash, and anything else the office configures) ───

const DEFAULT_SETTINGS = { openingCash: 0 };

async function getSettings() {
  if (db) {
    const doc = await db.collection('settings').doc('office').get();
    return { ...DEFAULT_SETTINGS, ...(doc.exists ? doc.data() : {}) };
  }

  const data = await readLocal();
  return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
}

async function updateSettings(patch) {
  const clean = {};
  if (patch.openingCash !== undefined) {
    const value = Number(patch.openingCash);
    if (!Number.isFinite(value)) throw badRequest('رأس المال الافتتاحي يجب أن يكون رقماً');
    clean.openingCash = roundMoney(value);
  }

  if (Object.keys(clean).length === 0) throw badRequest('لا توجد إعدادات صالحة للحفظ');

  if (db) {
    await db.collection('settings').doc('office').set(clean, { merge: true });
    return getSettings();
  }

  return withLocalLock(async () => {
    const data = await readLocal();
    data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}), ...clean };
    await writeLocal(data);
    return data.settings;
  });
}

// ─── Cash box ───

/**
 * What should physically be in the drawer.
 *
 * Deposits bring cash in, withdrawals take cash out, expenses take cash out.
 * The commission is deliberately absent: it is never handed over, so it stays
 * in the drawer as part of what the deposits already brought in.
 */
async function getCashBox({ from = null, to = null } = {}) {
  const [settings, transactions, expenses] = await Promise.all([
    getSettings(),
    listAllTransactions({ from, to }),
    listExpenses({ from, to })
  ]);

  let cashIn = 0;
  let cashOut = 0;
  let commission = 0;

  for (const tx of transactions) {
    if (tx.type === 'deposit') {
      cashIn += Number(tx.amount) || 0;
    } else {
      cashOut += Number(tx.amount) || 0;
      commission += Number(tx.commission) || 0;
    }
  }

  const expensesTotal = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // The opening capital only belongs in an all-time view; a filtered period
  // reports the movement within that period, not the whole drawer.
  const isFullHistory = !from && !to;
  const openingCash = isFullHistory ? (Number(settings.openingCash) || 0) : 0;

  const expectedCash = openingCash + cashIn - cashOut - expensesTotal;
  const counts = await listCashCounts({ limit: 1 });

  return {
    openingCash,
    cashIn,
    cashOut,
    commission,
    expensesTotal,
    expectedCash,
    isFullHistory,
    lastCount: counts[0] || null
  };
}

/** Records a physical count of the drawer and the difference against expectations. */
async function addCashCount({ countedAmount, notes }, actor) {
  const rawCounted = Number(countedAmount);
  if (!Number.isFinite(rawCounted) || rawCounted < 0) {
    throw badRequest('المبلغ المعدود يجب أن يكون رقماً صحيحاً');
  }
  const counted = roundMoney(rawCounted);

  const box = await getCashBox();
  const record = {
    id: crypto.randomBytes(12).toString('hex'),
    at: new Date().toISOString(),
    countedAmount: counted,
    expectedAmount: box.expectedCash,
    difference: counted - box.expectedCash,
    notes: typeof notes === 'string' ? notes.slice(0, 500) : '',
    actor: actor || 'admin'
  };

  if (db) {
    await db.collection('cashCounts').doc(record.id).set(record);
  } else {
    await withLocalLock(async () => {
      const data = await readLocal();
      data.cashCounts = [record, ...(data.cashCounts || [])].slice(0, 500);
      await writeLocal(data);
    });
  }

  return record;
}

async function listCashCounts({ limit = 30 } = {}) {
  if (db) {
    const snap = await db.collection('cashCounts').orderBy('at', 'desc').limit(limit).get();
    return snap.docs.map(d => d.data());
  }

  const data = await readLocal();
  return (data.cashCounts || []).slice(0, limit);
}

// ─── Backup ───

/**
 * A complete, restorable snapshot of the office's data.
 *
 * The local database.json is not a backup: Render wipes the disk on every
 * deploy. This is the export that actually leaves the server.
 */
async function exportEverything() {
  const customers = await listCustomers();
  const full = [];

  for (const customer of customers) {
    const detail = await getCustomer(customer.id, { limit: 100000 });
    full.push(detail);
  }

  const [expenses, settings, cashCounts, auditLogs] = await Promise.all([
    listExpenses({}),
    getSettings(),
    listCashCounts({ limit: 500 }),
    listAuditLogs({ limit: 500 })
  ]);

  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    counts: {
      customers: full.length,
      transactions: full.reduce((sum, c) => sum + (c.transactions?.length || 0), 0),
      expenses: expenses.length
    },
    customers: full,
    expenses,
    settings,
    cashCounts,
    auditLogs
  };
}

module.exports = {
  computeDelta,
  roundMoney,
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
  listAllTransactions,
  loadWholeLedger,
  invalidateLedgerCache,
  listExpenses,
  searchTransactions,
  findPossibleDuplicates,
  updateCustomer,
  mergeCustomers,
  getIdempotentResult,
  saveIdempotentResult,
  phoneKey,
  nameKey,
  getSettings,
  updateSettings,
  getCashBox,
  addCashCount,
  listCashCounts,
  exportEverything,
  readLocal,
  writeLocal,
  withLocalLock,
  mutateLocal
};
