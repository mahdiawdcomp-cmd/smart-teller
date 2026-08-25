/**
 * Generates a bcrypt hash for the admin password.
 *
 * Usage:
 *   node backend/scripts/hashPassword.js "your-password"
 *
 * Copy the printed value into ADMIN_PASSWORD_HASH in your .env / Render env vars,
 * and remove any plain ADMIN_PASSWORD value.
 */

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('Usage: node backend/scripts/hashPassword.js "your-password"');
  process.exit(1);
}

if (password.length < 10) {
  console.error('Refusing: the password must be at least 10 characters long.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);

console.log('\nADMIN_PASSWORD_HASH=' + hash + '\n');
console.log('Also generate a JWT secret:');
console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex') + '\n');
