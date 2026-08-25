const cron = require('node-cron');
const { sendStatementPDF, getWhatsAppStatus } = require('./whatsapp');
const { generatePdfBase64 } = require('./utils/pdfHelper');
const store = require('./store');

async function readCustomers() {
  try {
    return await store.listCustomers();
  } catch (e) {
    console.error('[Scheduler] Failed to read customers:', e.message);
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
      if (!customer.phone) continue;

      // The list view no longer carries transactions — load this customer's ledger.
      let ledger;
      try {
        ledger = (await store.getCustomer(customer.id)).transactions || [];
      } catch (e) {
        console.error(`[Scheduler] Could not load ledger for ${customer.name}:`, e.message);
        continue;
      }

      // Filter transactions for the last 7 days
      const weeklyTransactions = ledger.filter(tx => {
        const txDate = new Date(tx.date);
        return txDate >= oneWeekAgo;
      });

      // Only send if there were active transactions in the last week
      if (weeklyTransactions.length > 0) {
        console.log(`[Scheduler] Generating weekly statement for ${customer.name}...`);

        const todayStr = new Date().toLocaleDateString('en-US');
        const lastWeekStr = oneWeekAgo.toLocaleDateString('en-US');
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
