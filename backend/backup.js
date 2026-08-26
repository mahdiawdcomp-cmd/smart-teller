/**
 * Automatic off-server backup.
 *
 * `backend/data/database.json` is not a backup — Render wipes the disk on every
 * deploy and on every restart. A backup only counts once it has left the server,
 * so this pushes a full JSON snapshot to the owner's WhatsApp on a schedule.
 */

const cron = require('node-cron');
const zlib = require('zlib');
const { promisify } = require('util');

const store = require('./store');
const backupCrypto = require('./backupCrypto');
const { sendDocument, getWhatsAppStatus } = require('./whatsapp');

const gzip = promisify(zlib.gzip);

const BACKUP_HOUR = process.env.BACKUP_CRON || '0 2 * * *'; // 2:00 AM daily
const OWNER_PHONE_NUMBER = process.env.OWNER_PHONE_NUMBER;
const BACKUP_PASSPHRASE = process.env.BACKUP_PASSPHRASE || '';

if (!BACKUP_PASSPHRASE) {
  console.warn(
    '[BACKUP] BACKUP_PASSPHRASE is not set. Backups will be sent UNENCRYPTED — ' +
    'a single file holding every customer, phone number and balance. Set it.'
  );
}

let lastRun = null;

/**
 * Builds the snapshot: gzipped, and encrypted when a passphrase is configured.
 *
 * Compression happens before encryption — the other order does not compress,
 * because properly encrypted data has no structure left to squeeze.
 */
async function buildBackupFile() {
  const snapshot = await store.exportEverything();
  const json = JSON.stringify(snapshot, null, 2);
  const compressed = await gzip(Buffer.from(json, 'utf8'));

  const stamp = new Date().toISOString().slice(0, 10);
  const encrypted = !!BACKUP_PASSPHRASE;

  const buffer = encrypted
    ? backupCrypto.encrypt(compressed, BACKUP_PASSPHRASE)
    : compressed;

  return {
    buffer,
    encrypted,
    fileName: encrypted
      ? `smart-teller-backup-${stamp}.stb`
      : `smart-teller-backup-${stamp}.json.gz`,
    snapshot,
    rawSize: Buffer.byteLength(json, 'utf8'),
    compressedSize: buffer.length
  };
}

/** Runs one backup and delivers it. Returns a result summary either way. */
async function runBackup({ silent = false } = {}) {
  const startedAt = new Date().toISOString();

  try {
    const backup = await buildBackupFile();

    if (!OWNER_PHONE_NUMBER) {
      const message = 'OWNER_PHONE_NUMBER is not set — the backup was built but has nowhere to go.';
      if (!silent) console.warn('[BACKUP] ' + message);
      lastRun = { startedAt, ok: false, error: message };
      return lastRun;
    }

    if (getWhatsAppStatus().status !== 'connected') {
      const message = 'WhatsApp is not connected — the backup could not be delivered.';
      if (!silent) console.warn('[BACKUP] ' + message);
      lastRun = { startedAt, ok: false, error: message };
      return lastRun;
    }

    const { customers, transactions, expenses } = backup.snapshot.counts;
    const caption =
      `🗂️ نسخة احتياطية تلقائية\n` +
      `التاريخ: ${new Date().toLocaleString('ar-EG')}\n\n` +
      `الزبائن: ${customers}\n` +
      `العمليات: ${transactions}\n` +
      `المصاريف: ${expenses}\n\n` +
      `احتفظ بهذا الملف — يحتوي على كامل بيانات المكتب.`;

    await sendDocument(
      OWNER_PHONE_NUMBER,
      backup.buffer,
      backup.fileName,
      'application/gzip',
      caption
    );

    console.log(`[BACKUP] Sent ${backup.fileName} (${Math.round(backup.compressedSize / 1024)}KB).`);

    lastRun = {
      startedAt,
      ok: true,
      encrypted: backup.encrypted,
      fileName: backup.fileName,
      counts: backup.snapshot.counts,
      compressedSize: backup.compressedSize
    };
    return lastRun;
  } catch (error) {
    console.error('[BACKUP] Failed:', error.message);
    lastRun = { startedAt, ok: false, error: error.message };
    return lastRun;
  }
}

const backupJob = cron.schedule(BACKUP_HOUR, () => {
  console.log('[BACKUP] Scheduled backup starting...');
  runBackup();
}, {
  scheduled: true,
  timezone: 'Asia/Baghdad'
});

console.log(`Daily backup scheduler loaded (cron "${BACKUP_HOUR}", Baghdad time).`);

module.exports = {
  isEncryptionConfigured: () => !!BACKUP_PASSPHRASE,
  runBackup,
  buildBackupFile,
  backupJob,
  getLastRun: () => lastRun
};
