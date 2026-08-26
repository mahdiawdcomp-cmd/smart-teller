const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
const rateLimit = require('express-rate-limit');

dotenv.config();

const auth = require('./auth');
const share = require('./sharedAccess');
const store = require('./store');
const users = require('./users');

/** Maps a store error onto its HTTP status, defaulting to 500. */
function sendStoreError(res, error, fallbackMessage) {
  const status = error.status || 500;
  if (status >= 500) console.error('[STORE ERROR]', error);
  res.status(status).json({ error: error.message || fallbackMessage });
}

// Refuses to start when the admin password or JWT secret is missing.
auth.assertConfigured();

const app = express();

// Render (and any proxy) puts the real client IP in X-Forwarded-For.
app.set('trust proxy', 1);

// Log every incoming request
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  next();
});

const PORT = process.env.PORT || 5000;

// The frontend is served by this same server in production, so cross-origin
// access is not needed. Anything else must be named explicitly — an open policy
// lets any website on the internet call this API with a stolen token.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header: same-origin navigation, curl, or the WhatsApp bot.
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // Vite dev server.
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS'));
  }
}));
/**
 * Security headers.
 *
 * Written out rather than pulled from a package so each one is visible and
 * justified. The app is a single same-origin page, so the policy can be strict.
 */
app.use((req, res, next) => {
  // Never let this be framed — clickjacking on a page that moves money.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +   // inline styles are used throughout the UI
    "img-src 'self' data:; " +               // QR codes arrive as data URLs
    "font-src 'self' data:; " +
    "connect-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'none'; " +
    "form-action 'self'; " +
    "frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // Render terminates TLS; tell browsers never to try this host over plain HTTP.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// A statement PDF travels as base64, so those two routes need room. Everything
// else is small, and a 50MB ceiling on every endpoint was free memory pressure.
const LARGE_BODY_ROUTES = ['/api/whatsapp/send-statement', '/api/pdf/generate'];

app.use((req, res, next) => {
  const limit = LARGE_BODY_ROUTES.includes(req.path) ? '25mb' : '256kb';
  express.json({ limit })(req, res, next);
});
app.use(express.urlencoded({ limit: '256kb', extended: true }));

// Import Firebase Admin initializers
const { db } = require('./firebaseAdmin');

// Import WhatsApp bot module
const { getWhatsAppStatus, sendStatementPDF, logoutWhatsApp, requestPairingCodeForPhone } = require('./whatsapp');

// Import background scheduler
require('./scheduler');

// Reporting and the automatic off-server backup
const reports = require('./reports');
const backup = require('./backup');

// Path for local database fallback
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'database.json');
fs.ensureFileSync(LOCAL_DB_PATH);

// Helper function to read from database (Dual Mode)
async function readData() {
  if (db) {
    try {
      const customersSnap = await db.collection('customers').get();
      const expensesSnap = await db.collection('expenses').get();
      
      const customers = [];
      customersSnap.forEach(doc => {
        customers.push({ id: doc.id, ...doc.data() });
      });

      const expenses = [];
      expensesSnap.forEach(doc => {
        expenses.push({ id: doc.id, ...doc.data() });
      });

      return { customers, expenses };
    } catch (e) {
      console.error("Firebase read error, falling back to local file:", e);
    }
  }

  // Fallback to Local JSON
  try {
    const data = await fs.readJson(LOCAL_DB_PATH);
    return data || { customers: [], expenses: [] };
  } catch (err) {
    return { customers: [], expenses: [] };
  }
}

// Local writes go through store.mutateLocal so they share the ledger's lock.
// There is deliberately no unlocked write helper here any more.

/**
 * Records who opened (or tried to open) a customer's shared statement link.
 * Best-effort: a logging failure must never block the customer from seeing the statement.
 */
async function logSharedAccess(customer, req, success) {
  const entry = {
    at: new Date().toISOString(),
    ip: share.clientIp(req),
    success
  };

  try {
    if (db) {
      const docRef = db.collection('customers').doc(customer.id);
      const updatedLog = share.appendAccessLog(customer.sharedAccessLog, entry);
      await docRef.update({ sharedAccessLog: updatedLog });
    } else {
      await store.mutateLocal(data => {
        const target = data.customers.find(c => c.id === customer.id);
        if (target) {
          target.sharedAccessLog = share.appendAccessLog(target.sharedAccessLog, entry);
        }
      });
    }
  } catch (err) {
    console.error('[SHARE] Failed to record access log:', err.message);
  }
}

// --- SECURITY GATE ---
// Everything under /api requires a valid admin token, except the login endpoints
// and the public shared-statement endpoint (which has its own phone verification).
const PUBLIC_API_PREFIXES = ['/auth/', '/shared/', '/health'];

app.use('/api', (req, res, next) => {
  const isPublic = PUBLIC_API_PREFIXES.some(prefix => req.path.startsWith(prefix));
  if (isPublic) return next();
  return auth.requireAuth(req, res, next);
});

// Brute-force protection on the login endpoints.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'محاولات كثيرة جداً، يرجى الانتظار 15 دقيقة ثم المحاولة مجدداً.' }
});

// Maps a pending OTP session to the account that started it, so a delivered
// code can only ever complete the login it was issued for.
const pendingOtpUsers = new Map();

// --- API ROUTES ---

// 0. Health check (public, used by uptime monitors)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// 1. Get database summary
app.get('/api/summary', async (req, res) => {
  try {
    // Expenses are an owner-only figure; the gated /api/expenses route would
    // refuse a staff account, so this one must not hand them over either.
    const canSeeExpenses = users.permissionsFor(req.auth?.role).canViewReports;

    const [customers, expenses] = await Promise.all([
      store.listCustomers(),
      canSeeExpenses ? readData().then(d => d.expenses || []) : Promise.resolve([])
    ]);
    res.json({ customers, expenses });
  } catch (error) {
    sendStoreError(res, error, 'فشل تحميل الملخص');
  }
});

// 2. Get all customers (list view — transactions are fetched per customer)
app.get('/api/customers', async (req, res) => {
  try {
    res.json(await store.listCustomers());
  } catch (error) {
    sendStoreError(res, error, 'فشل تحميل قائمة الزبائن');
  }
});

// 2.1 Get one customer with their ledger
app.get('/api/customers/:id', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 2000, 5000);
    res.json(await store.getCustomer(req.params.id, { limit }));
  } catch (error) {
    sendStoreError(res, error, 'فشل تحميل بيانات الزبون');
  }
});

// 3. Add new customer
app.post('/api/customers', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'اسم الزبون مطلوب' });
    }
    // Bounded so a single record cannot be used to bloat storage or a PDF.
    if (String(name).length > 120) {
      return res.status(400).json({ error: 'اسم الزبون طويل جداً (الحد 120 حرفاً)' });
    }
    if (phone && String(phone).length > 30) {
      return res.status(400).json({ error: 'رقم الهاتف غير صحيح' });
    }

    // A duplicate customer splits one person's money across two accounts and
    // neither balance is right, so the server refuses until it is confirmed.
    if (req.query.force !== 'true') {
      const duplicates = await store.findPossibleDuplicates({ name, phone });
      if (duplicates.length > 0) {
        return res.status(409).json({
          error: 'يوجد زبون مشابه مسجّل مسبقاً',
          code: 'POSSIBLE_DUPLICATE',
          duplicates: duplicates.map(d => ({
            id: d.id, name: d.name, phone: d.phone, balance: d.balance
          }))
        });
      }
    }

    const customer = await store.addCustomer({ name: String(name).trim(), phone });
    res.status(201).json(customer);
  } catch (error) {
    sendStoreError(res, error, 'فشل إضافة الزبون');
  }
});

// 3.1 Edit a customer's details (admin only — a renamed customer changes every
// statement they have ever received)
app.patch('/api/customers/:id', auth.requirePermission('canManageCustomers'), async (req, res) => {
  try {
    res.json(await store.updateCustomer(req.params.id, req.body));
  } catch (error) {
    sendStoreError(res, error, 'فشل تعديل بيانات الزبون');
  }
});

// 3.2 Merge a duplicate customer into the real one
app.post('/api/customers/:id/merge', auth.requirePermission('canManageCustomers'), async (req, res) => {
  try {
    const { targetId } = req.body;
    if (!targetId) return res.status(400).json({ error: 'يجب تحديد الزبون الهدف' });

    res.json(await store.mergeCustomers(req.params.id, targetId, auth.actorLabel(req)));
  } catch (error) {
    sendStoreError(res, error, 'فشل دمج الزبائن');
  }
});

// 3.3 Ask whether a name/phone looks like an existing customer
app.get('/api/customers-duplicates/check', async (req, res) => {
  try {
    const { name, phone, excludeId } = req.query;
    res.json(await store.findPossibleDuplicates({ name, phone, excludeId: excludeId || null }));
  } catch (error) {
    sendStoreError(res, error, 'فشل فحص التكرار');
  }
});

// 4. Add a transaction (atomic: the ledger entry and the balance move together)
app.post('/api/customers/:id/transactions', async (req, res) => {
  try {
    // Idempotency: a teller on a weak connection presses save, sees nothing, and
    // presses again. Replaying the stored result beats recording the money twice.
    // Scoped to the customer: the same key can never replay onto another account.
    const rawKey = req.get('Idempotency-Key') || req.body.idempotencyKey || null;
    const key = rawKey ? `${req.params.id}:${rawKey}` : null;

    if (key) {
      const previous = await store.getIdempotentResult(key);
      if (previous) {
        return res.status(200).json({ ...previous, replayed: true });
      }
    }

    const result = await store.addTransaction(req.params.id, req.body, auth.actorLabel(req));
    if (key) await store.saveIdempotentResult(key, result);

    res.status(201).json(result);
  } catch (error) {
    sendStoreError(res, error, 'فشل إضافة العملية');
  }
});

// 4.1 Edit a transaction — reverses the old effect and applies the new one
app.patch('/api/customers/:id/transactions/:txId', auth.requirePermission('canEditLedger'), async (req, res) => {
  try {
    const result = await store.updateTransaction(
      req.params.id,
      req.params.txId,
      req.body,
      auth.actorLabel(req)
    );
    res.json(result);
  } catch (error) {
    sendStoreError(res, error, 'فشل تعديل العملية');
  }
});

// 4.2 Delete a transaction — reverses its exact contribution to the balance
app.delete('/api/customers/:id/transactions/:txId', auth.requirePermission('canEditLedger'), async (req, res) => {
  try {
    const result = await store.deleteTransaction(
      req.params.id,
      req.params.txId,
      auth.actorLabel(req)
    );
    res.json(result);
  } catch (error) {
    sendStoreError(res, error, 'فشل حذف العملية');
  }
});

// 4.3 Rebuild a customer's balance from their ledger and report any drift
app.post('/api/customers/:id/recompute', auth.requirePermission('canEditLedger'), async (req, res) => {
  try {
    const result = await store.recomputeBalance(req.params.id, auth.actorLabel(req));
    res.json(result);
  } catch (error) {
    sendStoreError(res, error, 'فشل إعادة حساب الرصيد');
  }
});

// 4.4 Audit trail — who changed what, and what the values were before
app.get('/api/audit-logs', auth.requirePermission('canEditLedger'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const customerId = req.query.customerId || null;
    res.json(await store.listAuditLogs({ limit, customerId }));
  } catch (error) {
    sendStoreError(res, error, 'فشل تحميل سجل التدقيق');
  }
});

// 4.1 Toggle Share Link for a Customer
app.post('/api/customers/:id/share', async (req, res) => {
  try {
    const customerId = req.params.id;
    const { isShared, days } = req.body;

    // A fresh token is minted on every enable, so revoking a link is permanent:
    // an old URL that leaked can never be reactivated.
    const enable = !!isShared;
    const newToken = enable ? require('crypto').randomBytes(24).toString('hex') : null;
    const expiresAt = enable ? share.buildExpiry(days) : null;

    const update = {
      isSharedLinkActive: enable,
      sharedToken: newToken,
      sharedExpiresAt: expiresAt
    };

    if (db) {
      const docRef = db.collection('customers').doc(customerId);
      const doc = await docRef.get();
      if (!doc.exists) return res.status(404).json({ error: 'Customer not found' });

      await docRef.update(update);
      return res.json(update);
    } else {
      const found = await store.mutateLocal(data => {
        const customer = data.customers.find(c => c.id === customerId);
        if (!customer) return false;
        Object.assign(customer, update);
        return true;
      });

      if (!found) return res.status(404).json({ error: 'Customer not found' });
      return res.json(update);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4.2 Get Shared Statement (Public - requires phone number match)
app.post('/api/shared/statement/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'يجب إدخال رقم الهاتف' });
    }

    // Guessing protection comes first, so a locked token costs an attacker nothing to learn.
    const limit = share.checkRateLimit(token);
    if (limit.blocked) {
      const minutes = Math.ceil(limit.retryAfterSeconds / 60);
      return res.status(429).json({
        error: `تم إيقاف المحاولات مؤقتاً بسبب محاولات خاطئة متكررة. حاول بعد ${minutes} دقيقة.`
      });
    }

    const customer = await store.getCustomerByShareToken(token);

    if (!customer) {
      share.recordFailure(token);
      return res.status(404).json({ error: 'الرابط غير صالح أو تم إيقافه' });
    }

    if (share.isExpired(customer.sharedExpiresAt)) {
      return res.status(410).json({ error: 'انتهت صلاحية هذا الرابط، يرجى طلب رابط جديد من المكتب' });
    }

    // Strict match on the normalized number — a partial number can never pass.
    if (!share.phoneMatches(customer.phone, phone)) {
      share.recordFailure(token);
      await logSharedAccess(customer, req, false);
      return res.status(401).json({ error: 'رقم الهاتف غير صحيح' });
    }

    share.clearFailures(token);
    await logSharedAccess(customer, req, true);

    // Return safe data (exclude sensitive owner-only flags)
    const safeCustomer = {
      name: customer.name,
      phone: customer.phone,
      balance: customer.balance,
      transactions: customer.transactions || [],
      createdAt: customer.createdAt
    };

    return res.json(safeCustomer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Get all expenses
app.get('/api/expenses', auth.requirePermission('canViewReports'), async (req, res) => {
  try {
    const data = await readData();
    res.json(data.expenses || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Add new expense
app.post('/api/expenses', auth.requirePermission('canViewReports'), async (req, res) => {
  try {
    const { title, amount, notes, date } = req.body;
    if (!title || !amount) return res.status(400).json({ error: 'يجب إدخال العنوان والمبلغ' });
    if (String(title).length > 200) {
      return res.status(400).json({ error: 'عنوان المصروف طويل جداً' });
    }

    const parsedAmount = store.roundMoney(amount);
    if (!Number.isFinite(Number(amount)) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'المبلغ يجب أن يكون رقماً أكبر من صفر' });
    }

    // Expenses can be backdated: the office records yesterday's rent today.
    const when = date ? new Date(date) : new Date();
    if (Number.isNaN(when.getTime())) {
      return res.status(400).json({ error: 'تاريخ المصروف غير صحيح' });
    }
    if (when.getTime() > Date.now() + 60_000) {
      return res.status(400).json({ error: 'لا يمكن تسجيل مصروف بتاريخ مستقبلي' });
    }

    const newExpense = {
      title,
      amount: parsedAmount,
      notes: notes || '',
      date: when.toISOString()
    };

    if (db) {
      const docRef = await db.collection('expenses').add(newExpense);
      return res.status(201).json({ id: docRef.id, ...newExpense });
    } else {
      const expenseWithId = { id: Date.now().toString(), ...newExpense };
      await store.mutateLocal(data => { data.expenses.push(expenseWithId); });
      return res.status(201).json(expenseWithId);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Delete an expense
app.delete('/api/expenses/:id', auth.requirePermission('canViewReports'), async (req, res) => {
  try {
    const expenseId = req.params.id;

    if (db) {
      await db.collection('expenses').doc(expenseId).delete();
      return res.json({ message: 'Expense deleted successfully' });
    } else {
      await store.mutateLocal(data => {
        data.expenses = data.expenses.filter(e => e.id !== expenseId);
      });
      return res.json({ message: 'Expense deleted successfully' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Profits calculation API
app.get('/api/profits', auth.requirePermission('canViewReports'), async (req, res) => {
  try {
    const data = await readData();

    // Commissions now live in the transactions subcollection.
    const totalCustomerProfit = await store.sumAllCommissions();

    // Calculate total general expenses
    let totalExpenses = 0;
    (data.expenses || []).forEach(exp => {
      totalExpenses += parseFloat(exp.amount) || 0;
    });

    const netProfit = totalCustomerProfit - totalExpenses;

    res.json({
      totalCustomerProfit,
      totalExpenses,
      netProfit
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4.5 Receipt for one transaction — the office's proof the operation happened
app.post('/api/customers/:id/transactions/:txId/receipt', async (req, res) => {
  try {
    // The full ledger: the balance shown on the receipt is derived by walking it
    // from the beginning, so a truncated page would print a wrong number.
    const customer = await store.getCustomer(req.params.id, { limit: 100000 });
    const transaction = (customer.transactions || []).find(t => t.id === req.params.txId);

    if (!transaction) return res.status(404).json({ error: 'العملية غير موجودة' });

    // The balance as it stood right after this operation, not today's balance:
    // a receipt that changes every time it is reprinted proves nothing.
    const chronological = [...customer.transactions].sort(
      (a, b) => new Date(a.date) - new Date(b.date)
    );

    let running = 0;
    let balanceAfter = 0;
    for (const tx of chronological) {
      running += Number.isFinite(tx.balanceDelta)
        ? tx.balanceDelta
        : store.computeDelta(tx.type, tx.amount, tx.commission);
      if (tx.id === transaction.id) {
        balanceAfter = running;
        break;
      }
    }

    const settings = await store.getSettings();
    const { generateReceiptBase64 } = require('./utils/pdfHelper');

    const pdfBase64 = await generateReceiptBase64({
      officeName: settings.officeName || 'حساب الصراف الذكي',
      customerName: customer.name,
      transaction,
      balanceAfter,
      issuedBy: req.auth?.name || ''
    });

    // Optionally deliver it straight to the customer.
    if (req.body?.send && customer.phone) {
      const { sendDocument, getWhatsAppStatus } = require('./whatsapp');

      if (getWhatsAppStatus().status !== 'connected') {
        return res.status(503).json({ error: 'الواتساب غير متصل، تم توليد الوصل لكن تعذّر إرساله', pdfBase64 });
      }

      await sendDocument(
        customer.phone,
        Buffer.from(pdfBase64, 'base64'),
        `وصل_${customer.name.replace(/\s+/g, '_')}_${transaction.id.slice(0, 6)}.pdf`,
        'application/pdf',
        `مرحباً ${customer.name}،
مرفق وصل العملية. يُرجى الاحتفاظ به.`
      );

      return res.json({ pdfBase64, sent: true });
    }

    res.json({ pdfBase64, sent: false });
  } catch (error) {
    sendStoreError(res, error, 'فشل توليد الوصل');
  }
});

// 4.6 Search every customer's ledger at once
app.get('/api/transactions/search', async (req, res) => {
  try {
    const { q, from, to, type, minAmount, maxAmount, customerId, limit } = req.query;
    res.json(await store.searchTransactions({
      q,
      from: from || null,
      to: to || null,
      type: type || null,
      minAmount: minAmount || null,
      maxAmount: maxAmount || null,
      customerId: customerId || null,
      limit: Math.min(Number(limit) || 200, 1000)
    }));
  } catch (error) {
    sendStoreError(res, error, 'فشل البحث في العمليات');
  }
});

// --- CASH BOX ---

// 8.1 What should be in the drawer right now (or within a period)
app.get('/api/cashbox', auth.requirePermission('canViewReports'), async (req, res) => {
  try {
    const { from, to } = req.query;
    res.json(await store.getCashBox({ from: from || null, to: to || null }));
  } catch (error) {
    sendStoreError(res, error, 'فشل تحميل بيانات الصندوق');
  }
});

// 8.2 Record a physical count and its difference against the expected amount
app.post('/api/cashbox/count', auth.requirePermission('canViewReports'), async (req, res) => {
  try {
    const record = await store.addCashCount(req.body, req.auth?.role || 'admin');
    res.status(201).json(record);
  } catch (error) {
    sendStoreError(res, error, 'فشل تسجيل الجرد');
  }
});

// 8.3 Previous counts
app.get('/api/cashbox/counts', auth.requirePermission('canViewReports'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    res.json(await store.listCashCounts({ limit }));
  } catch (error) {
    sendStoreError(res, error, 'فشل تحميل سجل الجرد');
  }
});

// --- SETTINGS ---

app.get('/api/settings', auth.requirePermission('canViewReports'), async (req, res) => {
  try {
    res.json(await store.getSettings());
  } catch (error) {
    sendStoreError(res, error, 'فشل تحميل الإعدادات');
  }
});

app.patch('/api/settings', auth.requirePermission('canManageSettings'), async (req, res) => {
  try {
    res.json(await store.updateSettings(req.body));
  } catch (error) {
    sendStoreError(res, error, 'فشل حفظ الإعدادات');
  }
});

// --- REPORTS ---

// 8.4 Totals, daily trend and per-customer rows for a date range
app.get('/api/reports', auth.requirePermission('canViewReports'), async (req, res) => {
  try {
    const { preset, from, to } = req.query;
    res.json(await reports.buildReport({ preset, from, to }));
  } catch (error) {
    sendStoreError(res, error, 'فشل توليد التقرير');
  }
});

// --- BACKUP ---

// 10.1 Download a full snapshot on demand
app.get('/api/backup/export', auth.requirePermission('canManageBackup'), async (req, res) => {
  try {
    const snapshot = await store.exportEverything();
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="smart-teller-backup-${stamp}.json"`);
    res.send(JSON.stringify(snapshot, null, 2));
  } catch (error) {
    sendStoreError(res, error, 'فشل تصدير النسخة الاحتياطية');
  }
});

// 10.2 Trigger the WhatsApp backup now, and report when it last ran
app.post('/api/backup/run', auth.requirePermission('canManageBackup'), async (req, res) => {
  try {
    const result = await backup.runBackup();
    res.status(result.ok ? 200 : 503).json(result);
  } catch (error) {
    sendStoreError(res, error, 'فشل تشغيل النسخ الاحتياطي');
  }
});

app.get('/api/backup/status', auth.requirePermission('canManageBackup'), (req, res) => {
  res.json({ lastRun: backup.getLastRun(), schedule: process.env.BACKUP_CRON || '0 2 * * *' });
});

// --- WHATSAPP BOT ROUTES ---

// 9. Get WhatsApp connection status and QR code
app.get('/api/whatsapp/status', auth.requirePermission('canManageSettings'), (req, res) => {
  res.json(getWhatsAppStatus());
});

// Diagnostics endpoint to debug connection issues
app.get('/api/whatsapp/diagnostics', auth.requirePermission('canManageSettings'), async (req, res) => {
  const diag = {
    firebaseConfigured: !!db,
    firestoreTest: null,
    whatsappStatus: getWhatsAppStatus(),
    sessionFilesCount: 0
  };

  if (db) {
    try {
      const testRef = db.collection('diagnostics_test').doc('ping');
      await testRef.set({ timestamp: new Date().toISOString() });
      const doc = await testRef.get();
      diag.firestoreTest = doc.exists ? 'success' : 'failed_to_read';
      await testRef.delete();
    } catch (e) {
      diag.firestoreTest = `error: ${e.message}`;
    }
  }

  try {
    const sessionDir = path.join(__dirname, 'data', 'whatsapp_session');
    if (await fs.pathExists(sessionDir)) {
      const files = await fs.readdir(sessionDir);
      diag.sessionFilesCount = files.length;
    }
  } catch (e) {
    diag.sessionFilesCount = `error: ${e.message}`;
  }

  res.json(diag);
});

// Request pairing code via phone number
app.post('/api/whatsapp/pair-phone', auth.requirePermission('canManageSettings'), async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'PhoneNumber is required' });
    }
    const result = await requestPairingCodeForPhone(phoneNumber);
    res.json({ success: true, code: result.code, cleanNumber: result.cleanNumber });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9.1 Manual retry after the automatic backoff has given up
app.post('/api/whatsapp/retry', auth.requirePermission('canManageSettings'), async (req, res) => {
  try {
    const { retryConnection } = require('./whatsapp');
    await retryConnection();
    res.json({ success: true, message: 'تمت إعادة محاولة الاتصال' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Disconnect/Logout WhatsApp
app.post('/api/whatsapp/logout', auth.requirePermission('canManageSettings'), async (req, res) => {
  try {
    await logoutWhatsApp();
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 11. Send Statement PDF via WhatsApp (Instant Manual Send)
app.post('/api/whatsapp/send-statement', async (req, res) => {
  try {
    const { phoneNumber, pdfBase64, customerName, periodText } = req.body;
    if (!phoneNumber || !pdfBase64 || !customerName) {
      return res.status(400).json({ error: 'PhoneNumber, pdfBase64 and customerName are required' });
    }
    await sendStatementPDF(phoneNumber, pdfBase64, customerName, periodText || 'كامل المدة');
    res.json({ success: true, message: 'Statement sent successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 12. Generate PDF Statement (returns base64)
app.post('/api/pdf/generate', async (req, res) => {
  console.log(`[PDF ROUTE] Request received for customer: ${req.body?.customerName}, tx count: ${req.body?.transactions?.length}`);
  try {
    const { customerName, transactions } = req.body;
    if (!customerName || !transactions) {
      return res.status(400).json({ error: 'CustomerName and transactions are required' });
    }
    const { generatePdfBase64 } = require('./utils/pdfHelper');
    const { periodText, balance, openingBalance, finalBalance } = req.body;

    // The helper takes positional arguments — passing req.body as one object made
    // the customer name an object and dropped every transaction.
    const base64 = await generatePdfBase64(
      customerName,
      transactions,
      periodText,
      balance,
      openingBalance,
      finalBalance
    );
    res.json({ pdfBase64: base64 });
  } catch (error) {
    console.error('[PDF ERROR]', error);
    res.status(500).json({ error: error.message });
  }
});

// --- AUTHENTICATION ROUTES ---

// 13. Login (step 1: password)
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const account = username || 'owner'; // an older client means the owner account

    // Per-account lockout, checked before the password so a locked account costs
    // an attacker nothing to discover and gains them nothing to keep trying.
    const lock = auth.checkAccountLock(account);
    if (lock.locked) {
      const minutes = Math.ceil(lock.retryAfterSeconds / 60);
      return res.status(429).json({
        error: `تم إيقاف هذا الحساب مؤقتاً بسبب محاولات خاطئة متكررة. حاول بعد ${minutes} دقيقة.`
      });
    }

    const user = await users.verifyCredentials(account, password, auth.verifyPassword);

    if (!user) {
      auth.recordLoginFailure(account);
      console.warn(`[AUTH] Failed login for "${account}" from ${share.clientIp(req)}`);
      // Deliberately does not say which half was wrong.
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور خاطئة!' });
    }

    auth.clearLoginFailures(account);

    // Two-factor protects the owner account, which is the one that can move money
    // around and manage everyone else. Staff sign in with a password alone.
    const needsOtp = user.role === 'admin' && !!auth.OWNER_PHONE_NUMBER;

    if (!needsOtp) {
      return res.json({
        success: true,
        token: auth.issueToken(user),
        user: users.publicUser(user),
        warning: user.role === 'admin' && !auth.OWNER_PHONE_NUMBER
          ? 'التحقق بخطوتين غير مفعّل — لم يتم ضبط رقم المالك. يُنصح بتفعيله.'
          : undefined
      });
    }

    const { getWhatsAppStatus, sendTextMessage } = require('./whatsapp');
    const wsStatus = getWhatsAppStatus();

    if (wsStatus.status !== 'connected') {
      // Two-factor is configured but undeliverable. Skipping it would defeat the
      // whole point, so access is refused unless the owner set an explicit escape hatch.
      if (auth.ALLOW_LOGIN_WITHOUT_OTP) {
        return res.json({
          success: true,
          token: auth.issueToken(user),
          user: users.publicUser(user),
          warning: 'تم الدخول بدون رمز تحقق (وضع الطوارئ مفعّل). أوقفه فور عودة الواتساب.'
        });
      }
      return res.status(503).json({
        error: 'الواتساب غير متصل، ولا يمكن إرسال رمز التحقق. اربط الواتساب أولاً أو فعّل وضع الطوارئ من إعدادات الخادم.'
      });
    }

    const { otpSessionId, code } = auth.createOtpSession();
    const otpText =
      `🔒 رمز التحقق للدخول إلى تطبيق حساب الصراف الذكي هو: *${code}*\n` +
      `صالح لمدة 5 دقائق. لا تشاركه مع أي شخص.`;

    try {
      await sendTextMessage(auth.OWNER_PHONE_NUMBER, otpText);
    } catch (e) {
      auth.discardOtpSession(otpSessionId);
      console.error('Failed to send OTP via WhatsApp:', e);
      return res.status(503).json({
        error: 'تعذّر إرسال رمز التحقق عبر الواتساب. حاول مجدداً بعد قليل.'
      });
    }

    // The pending session remembers which account is signing in, so the code
    // cannot be used to log in as somebody else.
    pendingOtpUsers.set(otpSessionId, user.id);

    return res.json({
      requiresOTP: true,
      otpSessionId,
      message: 'تم إرسال رمز التحقق إلى حسابك بالواتساب'
    });
  } catch (error) {
    console.error('[AUTH LOGIN ERROR]', error);
    res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

// 14. Login (step 2: OTP)
app.post('/api/auth/verify-otp', loginLimiter, async (req, res) => {
  const { otp, otpSessionId } = req.body;

  const result = auth.verifyOtpSession(otpSessionId, typeof otp === 'string' ? otp.trim() : otp);
  if (!result.ok) {
    return res.status(401).json({ error: result.error });
  }

  const userId = pendingOtpUsers.get(otpSessionId);
  pendingOtpUsers.delete(otpSessionId);

  const user = userId ? await users.findById(userId) : null;
  if (!user) {
    return res.status(401).json({ error: 'انتهت جلسة التحقق، يرجى إعادة تسجيل الدخول.' });
  }

  res.json({
    success: true,
    token: auth.issueToken(user),
    user: users.publicUser(user)
  });
});

// 15. Session check — lets the frontend drop a stale token on startup
app.get('/api/auth/me', auth.requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.auth.sub,
      username: req.auth.username,
      name: req.auth.name,
      role: req.auth.role,
      permissions: users.permissionsFor(req.auth.role)
    },
    expiresAt: req.auth.exp * 1000
  });
});

// --- USER MANAGEMENT (admin only) ---

app.get('/api/users', auth.requirePermission('canManageUsers'), async (req, res) => {
  try {
    const list = await users.listUsers();
    res.json([users.publicUser(users.envOwner()), ...list.map(users.publicUser)]);
  } catch (error) {
    sendStoreError(res, error, 'فشل تحميل المستخدمين');
  }
});

app.post('/api/users', auth.requirePermission('canManageUsers'), async (req, res) => {
  try {
    res.status(201).json(await users.createUser(req.body));
  } catch (error) {
    sendStoreError(res, error, 'فشل إضافة المستخدم');
  }
});

app.patch('/api/users/:id', auth.requirePermission('canManageUsers'), async (req, res) => {
  try {
    const updated = await users.updateUser(req.params.id, req.body);
    // Takes effect immediately rather than when the cached state expires.
    auth.invalidateUserState(req.params.id);
    res.json(updated);
  } catch (error) {
    sendStoreError(res, error, 'فشل تعديل المستخدم');
  }
});

app.delete('/api/users/:id', auth.requirePermission('canManageUsers'), async (req, res) => {
  try {
    if (req.params.id === req.auth.sub) {
      return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي' });
    }
    const removed = await users.deleteUser(req.params.id);
    auth.invalidateUserState(req.params.id);
    res.json(removed);
  } catch (error) {
    sendStoreError(res, error, 'فشل حذف المستخدم');
  }
});

// Set static folder for React frontend
const frontendDist = path.join(__dirname, '../dist');
if (fs.existsSync(frontendDist)) {
app.use(express.static(frontendDist, {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Fallback for React Router
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[GLOBAL ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Smart Teller Server is running on port ${PORT}`);
});
