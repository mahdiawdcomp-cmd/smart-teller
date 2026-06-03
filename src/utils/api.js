// Base URL configuration
const API_BASE = import.meta.env.DEV 
  ? 'http://localhost:5000/api' 
  : '/api';

export const api = {
  // Get database summary
  getSummary: async () => {
    const res = await fetch(`${API_BASE}/summary`);
    if (!res.ok) throw new Error('فشل تحميل ملخص البيانات');
    return res.json();
  },

  // Customers
  getCustomers: async () => {
    const res = await fetch(`${API_BASE}/customers`);
    if (!res.ok) throw new Error('فشل تحميل قائمة الزبائن');
    return res.json();
  },

  addCustomer: async (name, phone) => {
    const res = await fetch(`${API_BASE}/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone })
    });
    if (!res.ok) throw new Error('فشل إضافة الزبون');
    return res.json();
  },

  addTransaction: async (customerId, transactionData) => {
    const res = await fetch(`${API_BASE}/customers/${customerId}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transactionData)
    });
    if (!res.ok) throw new Error('فشل إضافة العملية الحسابية');
    return res.json();
  },

  // Expenses
  getExpenses: async () => {
    const res = await fetch(`${API_BASE}/expenses`);
    if (!res.ok) throw new Error('فشل تحميل المصاريف');
    return res.json();
  },

  addExpense: async (title, amount, notes) => {
    const res = await fetch(`${API_BASE}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, amount, notes })
    });
    if (!res.ok) throw new Error('فشل إضافة المصروف');
    return res.json();
  },

  deleteExpense: async (id) => {
    const res = await fetch(`${API_BASE}/expenses/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('فشل حذف المصروف');
    return res.json();
  },

  // Profits
  getProfits: async () => {
    const res = await fetch(`${API_BASE}/profits`);
    if (!res.ok) throw new Error('فشل تحميل حساب الأرباح');
    return res.json();
  },

  // WhatsApp
  getWhatsAppStatus: async () => {
    const res = await fetch(`${API_BASE}/whatsapp/status`);
    if (!res.ok) throw new Error('فشل الاتصال بخادم الواتساب');
    return res.json();
  },

  logoutWhatsApp: async () => {
    const res = await fetch(`${API_BASE}/whatsapp/logout`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('فشل قطع اتصال الواتساب');
    return res.json();
  },

  sendStatement: async (statementData) => {
    const res = await fetch(`${API_BASE}/whatsapp/send-statement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(statementData)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'فشل إرسال كشف الحساب بالواتساب');
    }
    return res.json();
  },

  // PDF Generator API
  generatePdf: async (pdfData) => {
    const res = await fetch(`${API_BASE}/pdf/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pdfData)
    });
    if (!res.ok) throw new Error('فشل توليد ملف الكشف PDF');
    return res.json(); // returns { pdfBase64 }
  },

  // Auth API
  login: async (password) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'فشل تسجيل الدخول');
    }
    return res.json();
  },

  verifyOtp: async (otp) => {
    const res = await fetch(`${API_BASE}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'فشل التحقق من الرمز');
    }
    return res.json();
  }
};
