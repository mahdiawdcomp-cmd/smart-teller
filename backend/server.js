const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Import Firebase Admin initializers
const { db } = require('./firebaseAdmin');

// Import WhatsApp bot module
const { getWhatsAppStatus, sendStatementPDF, logoutWhatsApp, requestPairingCodeForPhone } = require('./whatsapp');

// Import background scheduler
require('./scheduler');

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

// Helper function to write to database (Dual Mode)
async function writeData(data) {
  // Always write to local file for backup/safety
  try {
    await fs.writeJson(LOCAL_DB_PATH, data, { spaces: 2 });
  } catch (err) {
    console.error("Error writing to local file backup:", err);
  }

  if (db) {
    // We don't overwrite the whole Firestore, we manage documents individually
    // This helper is mainly for local sync. In full Cloud mode, API endpoints will write to Firestore directly.
    console.log("Firebase Firestore is active, database operations will write directly to cloud docs.");
  }
}

// --- API ROUTES ---

// 1. Get database summary
app.get('/api/summary', async (req, res) => {
  try {
    const data = await readData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Get all customers
app.get('/api/customers', async (req, res) => {
  try {
    const data = await readData();
    res.json(data.customers || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Add new customer
app.post('/api/customers', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const newCustomer = {
      name,
      phone: phone || '',
      balance: 0,
      transactions: [],
      createdAt: new Date().toISOString()
    };

    if (db) {
      const docRef = await db.collection('customers').add(newCustomer);
      return res.status(201).json({ id: docRef.id, ...newCustomer });
    } else {
      const data = await readData();
      const id = Date.now().toString();
      const customerWithId = { id, ...newCustomer };
      data.customers.push(customerWithId);
      await writeData(data);
      return res.status(201).json(customerWithId);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Add transaction to a customer
// Balance equation: Deposits (give) increase, Withdrawals (take) decrease.
app.post('/api/customers/:id/transactions', async (req, res) => {
  try {
    const customerId = req.params.id;
    const { type, amount, commission, notes } = req.body; // type: 'deposit' | 'withdrawal'

    if (!type || !amount) {
      return res.status(400).json({ error: 'Type and Amount are required' });
    }

    const numAmount = parseFloat(amount);
    const numCommission = type === 'deposit' ? 0 : (parseFloat(commission) || 0);

    const transaction = {
      id: Date.now().toString(),
      type, // 'deposit' (زبون عطاني) or 'withdrawal' (زبون سحب/حوالة)
      amount: numAmount,
      commission: numCommission,
      notes: notes || '',
      date: new Date().toISOString()
    };

    if (db) {
      const docRef = db.collection('customers').doc(customerId);
      const doc = await docRef.get();
      if (!doc.exists) return res.status(404).json({ error: 'Customer not found' });

      const customer = doc.data();
      const currentTransactions = customer.transactions || [];
      const updatedTransactions = [transaction, ...currentTransactions];
      
      // Update balance: for withdrawals, deduct amount + commission
      let balanceChange = type === 'deposit' ? numAmount : -(numAmount + numCommission);
      const newBalance = (customer.balance || 0) + balanceChange;

      await docRef.update({
        transactions: updatedTransactions,
        balance: newBalance
      });

      return res.json({ id: customerId, ...customer, transactions: updatedTransactions, balance: newBalance });
    } else {
      const data = await readData();
      const customer = data.customers.find(c => c.id === customerId);
      if (!customer) return res.status(404).json({ error: 'Customer not found' });

      if (!customer.transactions) customer.transactions = [];
      customer.transactions.unshift(transaction);
      
      let balanceChange = type === 'deposit' ? numAmount : -(numAmount + numCommission);
      customer.balance = (customer.balance || 0) + balanceChange;

      await writeData(data);
      return res.json(customer);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Get all expenses
app.get('/api/expenses', async (req, res) => {
  try {
    const data = await readData();
    res.json(data.expenses || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Add new expense
app.post('/api/expenses', async (req, res) => {
  try {
    const { title, amount, notes } = req.body;
    if (!title || !amount) return res.status(400).json({ error: 'Title and Amount are required' });

    const newExpense = {
      title,
      amount: parseFloat(amount),
      notes: notes || '',
      date: new Date().toISOString()
    };

    if (db) {
      const docRef = await db.collection('expenses').add(newExpense);
      return res.status(201).json({ id: docRef.id, ...newExpense });
    } else {
      const data = await readData();
      const id = Date.now().toString();
      const expenseWithId = { id, ...newExpense };
      data.expenses.push(expenseWithId);
      await writeData(data);
      return res.status(201).json(expenseWithId);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Delete an expense
app.delete('/api/expenses/:id', async (req, res) => {
  try {
    const expenseId = req.params.id;

    if (db) {
      await db.collection('expenses').doc(expenseId).delete();
      return res.json({ message: 'Expense deleted successfully' });
    } else {
      const data = await readData();
      data.expenses = data.expenses.filter(e => e.id !== expenseId);
      await writeData(data);
      return res.json({ message: 'Expense deleted successfully' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Profits calculation API
app.get('/api/profits', async (req, res) => {
  try {
    const data = await readData();
    
    // Calculate total commission from all customer transactions
    let totalCustomerProfit = 0;
    data.customers.forEach(customer => {
      if (customer.transactions) {
        customer.transactions.forEach(tx => {
          totalCustomerProfit += parseFloat(tx.commission) || 0;
        });
      }
    });

    // Calculate total general expenses
    let totalExpenses = 0;
    data.expenses.forEach(exp => {
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

// --- WHATSAPP BOT ROUTES ---

// 9. Get WhatsApp connection status and QR code
app.get('/api/whatsapp/status', (req, res) => {
  res.json(getWhatsAppStatus());
});

// Request pairing code via phone number
app.post('/api/whatsapp/pair-phone', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'PhoneNumber is required' });
    }
    const code = await requestPairingCodeForPhone(phoneNumber);
    res.json({ success: true, code });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Disconnect/Logout WhatsApp
app.post('/api/whatsapp/logout', async (req, res) => {
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
  try {
    const { customerName, transactions, periodText, balance } = req.body;
    if (!customerName || !transactions) {
      return res.status(400).json({ error: 'CustomerName and transactions are required' });
    }
    const { generatePdfBase64 } = require('./utils/pdfHelper');
    const base64 = await generatePdfBase64(customerName, transactions, periodText || 'كامل المدة', balance || 0);
    res.json({ pdfBase64: base64 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- AUTHENTICATION ROUTES ---
let currentOtp = null;
let otpExpiry = null;

// 13. Login check
app.post('/api/auth/login', async (req, res) => {
  try {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'IraqCell@2026';
    const ownerPhone = process.env.OWNER_PHONE_NUMBER;

    if (password !== adminPassword) {
      return res.status(401).json({ error: 'كلمة المرور خاطئة!' });
    }

    const { getWhatsAppStatus, sendTextMessage } = require('./whatsapp');
    const wsStatus = getWhatsAppStatus();

    // If WhatsApp is connected and owner phone is set, require OTP
    if (wsStatus.status === 'connected' && ownerPhone) {
      currentOtp = Math.floor(100000 + Math.random() * 900000).toString();
      otpExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes validity

      const otpText = `🔒 رمز التحقق للدخول إلى تطبيق حساب الصراف الذكي هو: *${currentOtp}*\nصالح لمدة 5 دقائق.`;
      
      try {
        await sendTextMessage(ownerPhone, otpText);
        return res.json({ requiresOTP: true, message: 'تم إرسال رمز التحقق إلى حسابك بالواتساب' });
      } catch (e) {
        console.error("Failed to send OTP via WhatsApp:", e);
        // Fallback: allow login directly if sending fails to avoid lockout
        return res.json({ success: true, token: 'session-active', warning: 'فشل إرسال رمز التحقق بالواتساب، تم الدخول بالرمز الرئيسي.' });
      }
    }

    // Direct login if WhatsApp is not set up
    return res.json({ success: true, token: 'session-active', warning: 'الواتساب غير متصل حالياً، تم الدخول بالرمز الرئيسي فقط.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 14. Verify OTP
app.post('/api/auth/verify-otp', (req, res) => {
  const { otp } = req.body;
  
  if (!currentOtp || !otpExpiry || Date.now() > otpExpiry) {
    return res.status(400).json({ error: 'رمز التحقق منتهي الصلاحية أو غير موجود، يرجى طلب رمز جديد.' });
  }

  if (otp !== currentOtp) {
    return res.status(401).json({ error: 'رمز التحقق غير صحيح!' });
  }

  // Clear OTP on success
  currentOtp = null;
  otpExpiry = null;

  res.json({ success: true, token: 'session-active' });
});

// Serve frontend static files in production
const frontendDist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/.*/, (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Smart Teller Server is running on port ${PORT}`);
});
