/**
 * Generates the key pair that lets this server push notifications to devices.
 *
 * Usage:
 *   node backend/scripts/generateVapidKeys.js
 *
 * Copy both lines into the server's environment variables. The pair identifies
 * this server to the browser push services; regenerating it invalidates every
 * existing subscription, so every device would have to allow notifications
 * again. Generate once, keep it.
 */

const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('\nVAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('VAPID_SUBJECT=mailto:your-email@example.com\n');
console.log('Add all three to Render → Environment, then redeploy.\n');
