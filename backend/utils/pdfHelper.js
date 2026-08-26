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

// ─── Single-transaction receipt ───

/** Shared @font-face block so the receipt renders Arabic like the statement does. */
function receiptFontCss() {
  if (!amiriRegularB64 || !amiriBoldB64) return '';
  return `
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

/**
 * A slip for one operation.
 *
 * This is the office's protection when a customer later denies an operation: it
 * names the amount, the commission, the resulting balance and the moment it
 * happened, on one page the customer receives over WhatsApp.
 */
function buildReceiptHtml({ officeName, customerName, transaction, balanceAfter, issuedBy }) {
  const isDeposit = transaction.type === 'deposit';
  const commission = Number(transaction.commission) || 0;
  const total = Number(transaction.amount) + (isDeposit ? 0 : commission);

  const typeLabel = isDeposit ? 'إيداع (استلمنا منك)' : 'سحب / حوالة (سلّمنا لك)';
  const accent = isDeposit ? '#16a34a' : '#dc2626';
  const balanceLabel = balanceAfter >= 0 ? 'له' : 'عليه';

  const when = new Date(transaction.date).toLocaleString('ar-EG', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const commissionRow = (!isDeposit && commission > 0)
    ? `<tr><td>العمولة</td><td>${fmt(commission)} د.ع</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<style>
${receiptFontCss()}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Amiri', 'Traditional Arabic', serif;
  padding: 14px;
  color: #1f2937;
  direction: rtl;
}
.card { border: 2px solid ${accent}; border-radius: 10px; overflow: hidden; }
.head { background: ${accent}; color: #fff; padding: 14px; text-align: center; }
.head h1 { font-size: 19px; margin-bottom: 3px; }
.head p { font-size: 12px; opacity: .9; }
.body { padding: 14px; }
table { width: 100%; border-collapse: collapse; }
td { padding: 8px 6px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
td:first-child { color: #6b7280; width: 44%; }
td:last-child { font-weight: 700; }
.total td { font-size: 17px; color: ${accent}; border-bottom: 2px solid ${accent}; }
.balance {
  margin-top: 14px; padding: 12px; border-radius: 8px; text-align: center;
  background: ${balanceAfter >= 0 ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.08)'};
  border: 1px solid ${balanceAfter >= 0 ? '#16a34a' : '#dc2626'};
}
.balance span { display: block; font-size: 12px; color: #6b7280; margin-bottom: 3px; }
.balance strong { font-size: 20px; color: ${balanceAfter >= 0 ? '#16a34a' : '#dc2626'}; }
.foot { margin-top: 14px; text-align: center; font-size: 11px; color: #9ca3af; line-height: 1.7; }
</style>
</head>
<body>
  <div class="card">
    <div class="head">
      <h1>${officeName}</h1>
      <p>وصل عملية مالية</p>
    </div>
    <div class="body">
      <table>
        <tr><td>الزبون</td><td>${customerName}</td></tr>
        <tr><td>نوع العملية</td><td>${typeLabel}</td></tr>
        <tr><td>التاريخ والوقت</td><td>${when}</td></tr>
        <tr><td>المبلغ</td><td>${fmt(transaction.amount)} د.ع</td></tr>
        ${commissionRow}
        <tr class="total"><td>الإجمالي</td><td>${fmt(total)} د.ع</td></tr>
        ${transaction.notes ? `<tr><td>الملاحظات</td><td>${transaction.notes}</td></tr>` : ''}
      </table>

      <div class="balance">
        <span>رصيدك بعد هذه العملية</span>
        <strong>${fmt(Math.abs(balanceAfter))} د.ع (${balanceLabel})</strong>
      </div>

      <div class="foot">
        رقم الوصل: ${transaction.id}<br>
        ${issuedBy ? `أصدره: ${issuedBy}<br>` : ''}
        يُرجى الاحتفاظ بهذا الوصل للمراجعة.
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function generateReceiptBase64(payload) {
  const html = buildReceiptHtml(payload);

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 400));

    const pdfBuffer = await page.pdf({
      width: '80mm',           // receipt-printer friendly, still readable on a phone
      printBackground: true,
      margin: { top: '6px', right: '6px', bottom: '6px', left: '6px' }
    });

    return Buffer.from(pdfBuffer).toString('base64');
  } finally {
    await page.close();
  }
}

module.exports = {
  generatePdfBase64,
  generateReceiptBase64
};
