const { 
  default: makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState, 
  BufferJSON, 
  initAuthCreds,
  proto
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const { db } = require('./firebaseAdmin');
const path = require('path');
const fs = require('fs-extra');

// Logger configuration
const logger = pino({ level: 'silent' });

// Global WhatsApp connection status
let sock = null;
let qrCodeData = null; // Stores latest QR code string or image URL
let connectionState = 'disconnected'; // 'connecting' | 'connected' | 'disconnected' | 'qr_ready'

// --- Custom Firebase Auth State for Baileys ---
async function useFirebaseAuthState(firestoreDb) {
  const credsRef = firestoreDb.collection('whatsapp_auth').doc('creds');
  const keysRef = firestoreDb.collection('whatsapp_auth_keys');

  // Load credentials
  let creds;
  try {
    const credsDoc = await credsRef.get();
    if (credsDoc.exists) {
      creds = JSON.parse(JSON.stringify(credsDoc.data()), BufferJSON.reviver);
    } else {
      creds = initAuthCreds();
      await credsRef.set(JSON.parse(JSON.stringify(creds, BufferJSON.replacer)));
    }
  } catch (error) {
    console.error("Error loading credentials from Firestore:", error);
    creds = initAuthCreds();
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          try {
            await Promise.all(
              ids.map(async (id) => {
                let value;
                const docId = `${type}-${id}`;
                const doc = await keysRef.doc(docId).get();
                if (doc.exists) {
                  value = JSON.parse(JSON.stringify(doc.data().value), BufferJSON.reviver);
                  if (type === 'app-state-sync-key' && value) {
                    value = proto.Message.AppStateSyncKeyData.fromObject(value);
                  }
                  data[id] = value;
                }
              })
            );
          } catch (error) {
            console.error(`Error fetching keys of type ${type} from Firestore:`, error);
          }
          return data;
        },
        set: async (data) => {
          try {
            const batch = firestoreDb.batch();
            for (const category in data) {
              for (const id in data[category]) {
                const value = data[category][id];
                const docId = `${category}-${id}`;
                const docRef = keysRef.doc(docId);
                if (value) {
                  batch.set(docRef, { value: JSON.parse(JSON.stringify(value, BufferJSON.replacer)) });
                } else {
                  batch.delete(docRef);
                }
              }
            }
            await batch.commit();
          } catch (error) {
            console.error("Error setting keys in Firestore:", error);
          }
        }
      }
    },
    saveCreds: async () => {
      try {
        await credsRef.set(JSON.parse(JSON.stringify(creds, BufferJSON.replacer)));
      } catch (error) {
        console.error("Error saving credentials to Firestore:", error);
      }
    }
  };
}

// --- Initialize WhatsApp Socket Connection ---
async function connectToWhatsApp() {
  connectionState = 'connecting';
  qrCodeData = null;
  console.log("Connecting to WhatsApp...");

  let authState, saveCreds;

  if (db) {
    // Cloud Mode: Store credentials in Firebase Firestore
    console.log("Initializing Cloud Auth State via Firebase...");
    const result = await useFirebaseAuthState(db);
    authState = result.state;
    saveCreds = result.saveCreds;
  } else {
    // Local Fallback Mode: Store credentials in local directory
    console.log("Initializing Local Auth State via File System...");
    const sessionDir = path.join(__dirname, 'data', 'whatsapp_session');
    fs.ensureDirSync(sessionDir);
    const result = await useMultiFileAuthState(sessionDir);
    authState = result.state;
    saveCreds = result.saveCreds;
  }

  sock = makeWASocket({
    auth: authState,
    printQRInTerminal: true,
    logger,
    browser: ['Smart Teller Client', 'Safari', '3.0']
  });

  // Handle credentials update
  sock.ev.on('creds.update', saveCreds);

  // Handle connection status update
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      connectionState = 'qr_ready';
      try {
        // Generate QR code data URL for the frontend with high resolution and clear border
        qrCodeData = await QRCode.toDataURL(qr, {
          width: 512,
          margin: 4,
          color: {
            dark: '#000000ff',
            light: '#ffffffff'
          }
        });
        console.log("QR Code updated. Scan this code to log in.");
      } catch (err) {
        console.error("Failed to generate QR Code Data URL:", err);
      }
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Connection closed due to:', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
      connectionState = 'disconnected';
      qrCodeData = null;

      if (shouldReconnect) {
        // Reconnect after delay to avoid loop issues
        setTimeout(connectToWhatsApp, 5000);
      } else {
        console.log("Logged out from WhatsApp. Please scan QR Code again.");
        // Clear session data if logged out
        if (db) {
          try {
            await db.collection('whatsapp_auth').doc('creds').delete();
            // Clear keys in batch
            const keysSnap = await db.collection('whatsapp_auth_keys').get();
            const batch = db.batch();
            keysSnap.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            console.log("Cleared Firebase WhatsApp credentials.");
          } catch (e) {
            console.error("Error clearing Firebase WhatsApp session:", e);
          }
        } else {
          const sessionDir = path.join(__dirname, 'data', 'whatsapp_session');
          await fs.remove(sessionDir).catch(err => console.error(err));
          console.log("Cleared Local WhatsApp session files.");
        }
        setTimeout(connectToWhatsApp, 3000);
      }
    } else if (connection === 'open') {
      console.log('WhatsApp Bot connected successfully!');
      connectionState = 'connected';
      qrCodeData = null;
    }
  });
}

// --- Send PDF Statement via WhatsApp ---
async function sendStatementPDF(phoneNumber, pdfBase64, customerName, periodText) {
  if (connectionState !== 'connected' || !sock) {
    throw new Error('WhatsApp Bot is not connected. Please scan QR code first.');
  }

  // Format phone number to WhatsApp ID format (e.g. 9647701234567@s.whatsapp.net)
  let cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
  if (!cleanNumber.startsWith('964') && cleanNumber.startsWith('0')) {
    cleanNumber = '964' + cleanNumber.substring(1);
  } else if (!cleanNumber.startsWith('964')) {
    cleanNumber = '964' + cleanNumber; // Default to Iraq country code if missing
  }

  const recipientJid = `${cleanNumber}@s.whatsapp.net`;
  const pdfBuffer = Buffer.from(pdfBase64, 'base64');

  const captionText = `مرحباً زبوننا العزيز ${customerName}،\nمرفق كشف حسابك للفترة: ${periodText}.\n\nتطبيق حساب الصراف الذكي 🏦`;

  // Send document message
  await sock.sendMessage(recipientJid, {
    document: pdfBuffer,
    mimetype: 'application/pdf',
    fileName: `كشف_حساب_${customerName.replace(/\s+/g, '_')}.pdf`,
    caption: captionText
  });

  console.log(`PDF Statement sent to ${customerName} (${phoneNumber})`);
  return true;
}

// --- Send Text Message via WhatsApp ---
async function sendTextMessage(phoneNumber, text) {
  if (connectionState !== 'connected' || !sock) {
    throw new Error('WhatsApp Bot is not connected.');
  }

  let cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
  if (!cleanNumber.startsWith('964') && cleanNumber.startsWith('0')) {
    cleanNumber = '964' + cleanNumber.substring(1);
  } else if (!cleanNumber.startsWith('964')) {
    cleanNumber = '964' + cleanNumber;
  }

  const recipientJid = `${cleanNumber}@s.whatsapp.net`;
  await sock.sendMessage(recipientJid, { text });
  console.log(`Text message sent to ${phoneNumber}`);
  return true;
}

// --- Check and initialize WhatsApp connection on startup ---
setTimeout(() => {
  connectToWhatsApp().catch(err => console.error("Error starting WhatsApp bot:", err));
}, 1000);

module.exports = {
  getWhatsAppStatus: () => ({
    status: connectionState,
    qr: qrCodeData
  }),
  sendStatementPDF,
  sendTextMessage,
  logoutWhatsApp: async () => {
    if (sock) {
      try {
        await sock.logout();
      } catch (err) {
        console.error("Error logging out of WhatsApp socket:", err);
      }
    }
  }
};
