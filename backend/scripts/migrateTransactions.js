/**
 * One-off migration: moves every customer's embedded `transactions` array into
 * the `transactions` subcollection.
 *
 * Usage:
 *   node backend/scripts/migrateTransactions.js
 *
 * Safe to re-run: each transaction keeps its original id as the document id, so
 * a second run overwrites the same documents instead of duplicating them.
 * The server also migrates a customer lazily on first access, so running this
 * is an optimization, not a prerequisite.
 */

require('dotenv').config();

const store = require('../store');
const { db } = require('../firebaseAdmin');

(async () => {
  if (!db) {
    console.log('Local fallback mode — nothing to migrate (the array layout is fine locally).');
    process.exit(0);
  }

  try {
    console.log('Starting transaction migration...');
    const result = await store.migrateAllCustomers();
    console.log(`Done. Migrated ${result.migrated} of ${result.total} customers.`);

    console.log('\nVerifying balances against the migrated ledgers...');
    const customers = await store.listCustomers();
    let drifted = 0;

    for (const customer of customers) {
      const check = await store.recomputeBalance(customer.id, 'migration-script');
      if (check.drift !== 0) {
        drifted++;
        console.warn(
          `  ${customer.name}: stored ${check.storedBalance} -> corrected to ${check.computedBalance} ` +
          `(drift ${check.drift})`
        );
      }
    }

    console.log(
      drifted === 0
        ? 'All balances agree with their ledgers.'
        : `Corrected ${drifted} balance(s). See the audit log for details.`
    );
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
})();
