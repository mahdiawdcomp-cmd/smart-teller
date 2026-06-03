const cron = require('node-cron');
const { db } = require('./firebaseAdmin');
const { sendStatementPDF, getWhatsAppStatus } = require('./whatsapp');
const { generatePdfBase64 } = require('./utils/pdfHelper');
const fs = require('fs-extra');
const path = require('path');

const LOCAL_DB_PATH = path.join(__dirname, 'data', 'database.json');

// Helper to read data (similar to server.js)
async function readCustomers() {
  if (db) {
    try {
      const customersSnap = await db.collection('customers').get();
      const customers = [];
      customersSnap.forEach(doc => {
        customers.push({ id: doc.id, ...doc.data() });
      });
      return customers;
    } catch (e) {
      console.error("Firebase read error in scheduler, falling back to local file:", e);
    }
  }

  try {
    const data = await fs.readJson(LOCAL_DB_PATH);
    return data?.customers || [];
  } catch (err) {
    return [];
  }
}

// Function to generate and send weekly statements
async function sendWeeklyStatements() {
  const wsStatus = getWhatsAppStatus();
  if (wsStatus.status !== 'connected') {
    console.warn("[Scheduler] WhatsApp Bot is not connected. Skipping weekly scheduled statements.");
    return;
  }

  console.log("[Scheduler] Starting weekly scheduled statement dispatch...");

  try {
    const customers = await readCustomers();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    let sentCount = 0;

    for (const customer of customers) {
      if (!customer.phone || !customer.transactions || customer.transactions.length === 0) {
        continue;
      }

      // Filter transactions for the last 7 days
      const weeklyTransactions = customer.transactions.filter(tx => {
        const txDate = new Date(tx.date);
        return txDate >= oneWeekAgo;
      });

      // Only send if there were active transactions in the last week
      if (weeklyTransactions.length > 0) {
        console.log(`[Scheduler] Generating weekly statement for ${customer.name}...`);

        const todayStr = new Date().toLocaleDateString('ar-EG');
        const lastWeekStr = oneWeekAgo.toLocaleDateString('ar-EG');
        const periodText = `من ${lastWeekStr} إلى ${todayStr}`;

        // Generate PDF base64
        const pdfBase64 = await generatePdfBase64(
          customer.name,
          weeklyTransactions,
          periodText,
          customer.balance
        );

        // Send via WhatsApp
        try {
          await sendStatementPDF(customer.phone, pdfBase64, customer.name, `الأسبوعي (${periodText})`);
          sentCount++;
          // Delay between messages to avoid spam trigger
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (sendError) {
          console.error(`[Scheduler] Failed to send WhatsApp to ${customer.name} (${customer.phone}):`, sendError.message);
        }
      }
    }

    console.log(`[Scheduler] Weekly scheduled statement dispatch completed. Sent to ${sentCount} customers.`);
  } catch (error) {
    console.error("[Scheduler] Error running scheduled task:", error);
  }
}

// --- Schedule Configuration ---
// Runs every Friday at 8:00 PM (0 20 * * 5)
const weeklyJob = cron.schedule('0 20 * * 5', () => {
  console.log("[Scheduler] Cron Triggered: Running weekly statement sender...");
  sendWeeklyStatements();
}, {
  scheduled: true,
  timezone: "Asia/Baghdad" // Iraq Standard Time
});

console.log("Weekly WhatsApp statement scheduler loaded (Runs Fridays at 8:00 PM Baghdad Time).");

module.exports = {
  sendWeeklyStatements, // Expose manually if needed for triggers
  weeklyJob
};
