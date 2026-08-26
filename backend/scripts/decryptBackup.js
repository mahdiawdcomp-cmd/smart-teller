/**
 * Opens an encrypted backup file.
 *
 * Usage:
 *   node backend/scripts/decryptBackup.js <backup.stb> "<passphrase>" [output.json]
 *
 * The passphrase is the BACKUP_PASSPHRASE from the server's environment. If it
 * is lost, the file cannot be recovered by anyone, including us — that is the
 * point of encrypting it. Keep a copy somewhere separate from the backups.
 *
 * Try this once, now, on a real backup. A restore procedure nobody has ever run
 * is a guess, not a plan.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const backupCrypto = require('../backupCrypto');

const [, , inputPath, passphrase, outputPathArg] = process.argv;

if (!inputPath || !passphrase) {
  console.error('Usage: node backend/scripts/decryptBackup.js <backup.stb> "<passphrase>" [output.json]');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

try {
  const sealed = fs.readFileSync(inputPath);
  console.log(`Read ${(sealed.length / 1024).toFixed(1)} KB from ${path.basename(inputPath)}`);

  const compressed = backupCrypto.decrypt(sealed, passphrase);
  const json = zlib.gunzipSync(compressed).toString('utf8');
  const snapshot = JSON.parse(json);

  const outputPath = outputPathArg || inputPath.replace(/\.stb$/, '') + '.json';
  fs.writeFileSync(outputPath, json, 'utf8');

  console.log('\nDecrypted successfully.');
  console.log(`  exported at : ${snapshot.exportedAt}`);
  console.log(`  customers   : ${snapshot.counts?.customers ?? '?'}`);
  console.log(`  transactions: ${snapshot.counts?.transactions ?? '?'}`);
  console.log(`  expenses    : ${snapshot.counts?.expenses ?? '?'}`);
  console.log(`\nWritten to: ${outputPath}`);
} catch (error) {
  console.error(`\nFailed: ${error.message}`);
  process.exit(1);
}
