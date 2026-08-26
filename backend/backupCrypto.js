/**
 * Backup encryption.
 *
 * A backup is the whole office in one file: every customer, their phone number,
 * their balance, and the full history of what they moved. It travels out of the
 * server to WhatsApp, sits in a phone's downloads, gets forwarded, gets backed
 * up again to somebody else's cloud. Plaintext there is the single largest data
 * exposure this system has.
 *
 * Format (all binary, concatenated):
 *   magic "STB1"      4 bytes   so the decrypt tool can refuse the wrong file
 *   salt             16 bytes   per-backup, so two backups never share a key
 *   iv               12 bytes   per-backup nonce for GCM
 *   authTag          16 bytes   detects any tampering or corruption
 *   ciphertext       rest       AES-256-GCM over the gzipped JSON
 *
 * The key is derived with scrypt, which is deliberately slow and memory-hard:
 * it makes guessing a weak passphrase expensive rather than instant.
 */

const crypto = require('crypto');

const MAGIC = Buffer.from('STB1', 'utf8');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

// scrypt cost. N=2^15 takes roughly a tenth of a second — unnoticeable once a
// day, and a hard wall for anyone trying passphrases in bulk.
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(
    Buffer.from(String(passphrase), 'utf8'),
    salt,
    KEY_BYTES,
    SCRYPT_OPTIONS
  );
}

/** Encrypts a buffer. Returns the sealed backup as a single buffer. */
function encrypt(plainBuffer, passphrase) {
  if (!passphrase || String(passphrase).length < 12) {
    throw new Error('عبارة تشفير النسخة الاحتياطية يجب أن تكون 12 حرفاً على الأقل');
  }

  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([MAGIC, salt, iv, authTag, ciphertext]);
}

/** Decrypts a sealed backup. Throws if the passphrase is wrong or the file was altered. */
function decrypt(sealedBuffer, passphrase) {
  if (sealedBuffer.length < MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new Error('الملف ليس نسخة احتياطية صالحة (حجمه أصغر من اللازم)');
  }

  if (!sealedBuffer.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('الملف ليس نسخة احتياطية مشفّرة من هذا النظام');
  }

  let offset = MAGIC.length;
  const salt = sealedBuffer.subarray(offset, offset += SALT_BYTES);
  const iv = sealedBuffer.subarray(offset, offset += IV_BYTES);
  const authTag = sealedBuffer.subarray(offset, offset += TAG_BYTES);
  const ciphertext = sealedBuffer.subarray(offset);

  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM cannot tell a wrong key from a modified file — both fail the same way.
    throw new Error('كلمة السر خاطئة، أو أن الملف تعرّض للتعديل أو التلف');
  }
}

module.exports = { encrypt, decrypt, MAGIC };
