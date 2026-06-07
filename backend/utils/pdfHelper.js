const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// ─── Load Amiri font files as base64 for embedding in HTML ───
const amiriRegularPath = path.join(__dirname, '..', 'fonts', 'Amiri-Regular.ttf');
const amiriBoldPath = path.join(__dirname, '..', 'fonts', 'Amiri-Bold.ttf');

let amiriRegularB64 = '';
let amiriBoldB64 = '';

try {
  amiriRegularB64 = fs.readFileSync(amiriRegularPath).toString('base64');
  amiriBoldB64 = fs.readFileSync(amiriBoldPath).toString('base64');
  console.log('[PDF] Amiri fonts loaded successfully.');
} catch (e) {
  console.warn('[PDF] Could not load Amiri fonts:', e.message);
}

// ─── Singleton browser instance ───
let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  console.log('[PDF] Launching browser...');
  browserInstance = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--no-first-run'
    ]
  });
  console.log('[PDF] Browser launched successfully.');
  return browserInstance;
}

// ─── Format number helper ───
function fmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

// ─── Build the full HTML template ───
function buildHtml(customerName, transactions, periodText, balance, openingBalance, finalBalance) {

  // Build transaction rows
  let rowsHtml = '';

  // Opening balance row
  rowsHtml += `
    <tr class="opening-row">
      <td>-</td>
      <td class="notes">رصيد سابق (افتتاحي)</td>
      <td>-</td>
      <td>-</td>
      <td>${fmt(openingBalance)} د.ع</td>
    </tr>`;

  (transactions || []).forEach((tx, idx) => {
    const dateStr = new Date(tx.date).toLocaleDateString('en-US');

    let displayNotes = tx.notes || '-';
    if (tx.type === 'withdrawal' && tx.commission > 0) {
      displayNotes = `${tx.notes || ''} (العمولة: ${fmt(tx.commission)} د.ع)`;
    }

    const totalAmount = tx.type === 'withdrawal'
      ? tx.amount + (tx.commission || 0)
      : tx.amount;

    const rowClass = idx % 2 === 0 ? 'even' : 'odd';

    const debitCell = tx.type === 'withdrawal' ? `${fmt(totalAmount)} د.ع` : '-';
    const creditCell = tx.type === 'deposit' ? `${fmt(tx.amount)} د.ع` : '-';

    rowsHtml += `
      <tr class="${rowClass}">
        <td>${dateStr}</td>
        <td class="notes">${displayNotes}</td>
        <td>${debitCell}</td>
        <td>${creditCell}</td>
        <td>${fmt(tx.runningBalance)} د.ع</td>
      </tr>`;
  });

  const balanceLabel = finalBalance >= 0 ? 'له' : 'عليه';
  const summaryColor = finalBalance >= 0 ? '#16a34a' : '#dc2626';

  // Font face CSS - embed base64 if loaded, else use system Arabic fonts
  let fontCSS = '';
  if (amiriRegularB64 && amiriBoldB64) {
    fontCSS = `
      @font-face {
        font-family: 'Amiri';
        src: url(data:font/truetype;base64,${amiriRegularB64}) format('truetype');
        font-weight: 400;
      }
      @font-face {
        font-family: 'Amiri';
        src: url(data:font/truetype;base64,${amiriBoldB64}) format('truetype');
        font-weight: 700;
      }`;
  }

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
${fontCSS}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Amiri', 'Traditional Arabic', 'Tahoma', 'Arial', sans-serif;
  direction: rtl;
  text-align: right;
  padding: 30px 35px;
  color: #0f172a;
  font-size: 13px;
  line-height: 1.7;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ─── Title ─── */
.header {
  text-align: center;
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 2px solid #334155;
}
.header h1 {
  font-size: 26px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 4px;
}
.header .period {
  color: #64748b;
  font-size: 13px;
}

/* ─── Customer Info ─── */
.info-card {
  background: #f8fafc;
  border: 1.5px solid #cbd5e1;
  border-radius: 8px;
  padding: 12px 20px;
  margin-bottom: 20px;
}
.info-card p {
  font-weight: 700;
  font-size: 13px;
  margin: 4px 0;
}

/* ─── Table ─── */
table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
  border: 1.5px solid #94a3b8;
}
thead th {
  background: #334155;
  color: #fff;
  font-weight: 700;
  padding: 10px 8px;
  text-align: center;
  font-size: 12px;
  border: 1px solid #475569;
}
tbody td {
  padding: 7px 6px;
  text-align: center;
  font-size: 11px;
  border-bottom: 1px solid #e2e8f0;
}
.notes {
  max-width: 180px;
  word-wrap: break-word;
  font-size: 10.5px;
}
.opening-row {
  background: #e2e8f0;
  font-weight: 700;
}
.even { background: #fff; }
.odd  { background: #f8fafc; }

tr { page-break-inside: avoid; }

/* ─── Summary ─── */
.summary {
  background: #f1f5f9;
  border: 2px solid #94a3b8;
  border-radius: 8px;
  padding: 14px 20px;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  color: ${summaryColor};
}
</style>
</head>
<body>

<div class="header">
  <h1>كشف حساب الصراف الذكي</h1>
  <div class="period">تاريخ الكشف: ${periodText || 'كامل المدة'}</div>
</div>

<div class="info-card">
  <p>اسم الزبون: ${customerName}</p>
  <p>الرصيد الكلي الحالي للمكتب: ${fmt(balance)} د.ع</p>
</div>

<table>
  <thead>
    <tr>
      <th style="width:14%">التاريخ</th>
      <th style="width:28%">الملاحظات</th>
      <th style="width:18%">عليه (مطلوب)</th>
      <th style="width:18%">له (مسدد)</th>
      <th style="width:22%">الرصيد</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHtml}
  </tbody>
</table>

<div class="summary">
  الرصيد النهائي للمرحلة المحددة: ${fmt(finalBalance)} د.ع (${balanceLabel})
</div>

</body>
</html>`;
}

// ─── Main: Generate PDF as Base64 ───
async function generatePdfBase64(customerName, transactions, periodText, balance, openingBalance, finalBalance) {
  // Support both object and positional call signatures
  let cName = customerName, txs = transactions, period = periodText;
  let bal = balance, opBal = openingBalance || 0, finBal = finalBalance || 0;

  if (typeof customerName === 'object' && customerName !== null) {
    const d = customerName;
    cName  = d.customerName;
    txs    = d.transactions || [];
    period = d.periodText || 'كامل المدة';
    bal    = d.balance || 0;
    opBal  = d.openingBalance || 0;
    finBal = d.finalBalance || 0;
  }

  const html = buildHtml(cName, txs, period, bal, opBal, finBal);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Brief wait for font rendering
    await new Promise(r => setTimeout(r, 500));

    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '15px', right: '20px', bottom: '15px', left: '20px' },
      printBackground: true,
      preferCSSPageSize: false
    });

    return Buffer.from(pdfBuffer).toString('base64');
  } finally {
    await page.close();
  }
}

module.exports = {
  generatePdfBase64
};
