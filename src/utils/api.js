// Base URL configuration
const API_BASE = import.meta.env.DEV
  ? 'http://localhost:5000/api'
  : '/api';

const TOKEN_KEY = 'teller_session';

// ─── Session token handling ───

export const session = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY)
};

/** Called when the server rejects our token, so the UI can drop back to the login screen. */
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function readError(res, fallback) {
  const data = await res.json().catch(() => ({}));
  return new Error(data.error || fallback);
}

/**
 * fetch wrapper that attaches the admin token and reacts to an expired session.
 * Every owner-only endpoint goes through here.
 */
async function authFetch(path, options = {}) {
  const token = session.get();

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  if (res.status === 401 || res.status === 403) {
    session.clear();
    onUnauthorized();
    throw await readError(res, 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً');
  }

  return res;
}

/** fetch wrapper for public endpoints (login, shared statement). */
async function publicFetch(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
}

export const api = {
  // Get database summary
  getSummary: async () => {
    const res = await authFetch('/summary');
    if (!res.ok) throw await readError(res, 'فشل تحميل ملخص البيانات');
    return res.json();
  },

  // Customers
  getCustomers: async () => {
    const res = await authFetch('/customers');
    if (!res.ok) throw await readError(res, 'فشل تحميل قائمة الزبائن');
    return res.json();
  },

  addCustomer: async (name, phone) => {
    const res = await authFetch('/customers', {
      method: 'POST',
      body: JSON.stringify({ name, phone })
    });
    if (!res.ok) throw await readError(res, 'فشل إضافة الزبون');
    return res.json();
  },

  addTransaction: async (customerId, transactionData) => {
    const res = await authFetch(`/customers/${customerId}/transactions`, {
      method: 'POST',
      body: JSON.stringify(transactionData)
    });
    if (!res.ok) throw await readError(res, 'فشل إضافة العملية الحسابية');
    return res.json();
  },

  // Shared Statement API
  // days: link lifetime; the server clamps it and mints a brand-new token each time.
  toggleShareLink: async (customerId, isShared, days) => {
    const res = await authFetch(`/customers/${customerId}/share`, {
      method: 'POST',
      body: JSON.stringify({ isShared, days })
    });
    if (!res.ok) throw await readError(res, 'فشل تعديل حالة الرابط');
    return res.json();
  },

  getSharedStatement: async (token, phone) => {
    const res = await publicFetch(`/shared/statement/${token}`, {
      method: 'POST',
      body: JSON.stringify({ phone })
    });
    if (!res.ok) {
      throw await readError(res, 'فشل جلب الكشف، تأكد من صحة رقم الهاتف');
    }
    return res.json();
  },

  // Expenses
  getExpenses: async () => {
    const res = await authFetch('/expenses');
    if (!res.ok) throw await readError(res, 'فشل تحميل المصاريف');
    return res.json();
  },

  addExpense: async (title, amount, notes) => {
    const res = await authFetch('/expenses', {
      method: 'POST',
      body: JSON.stringify({ title, amount, notes })
    });
    if (!res.ok) throw await readError(res, 'فشل إضافة المصروف');
    return res.json();
  },

  deleteExpense: async (id) => {
    const res = await authFetch(`/expenses/${id}`, { method: 'DELETE' });
    if (!res.ok) throw await readError(res, 'فشل حذف المصروف');
    return res.json();
  },

  // Profits
  getProfits: async () => {
    const res = await authFetch('/profits');
    if (!res.ok) throw await readError(res, 'فشل تحميل حساب الأرباح');
    return res.json();
  },

  // WhatsApp
  getWhatsAppStatus: async () => {
    const res = await authFetch('/whatsapp/status');
    if (!res.ok) throw await readError(res, 'فشل الاتصال بخادم الواتساب');
    return res.json();
  },

  logoutWhatsApp: async () => {
    const res = await authFetch('/whatsapp/logout', { method: 'POST' });
    if (!res.ok) throw await readError(res, 'فشل قطع اتصال الواتساب');
    return res.json();
  },

  pairPhone: async (phoneNumber) => {
    const res = await authFetch('/whatsapp/pair-phone', {
      method: 'POST',
      body: JSON.stringify({ phoneNumber })
    });
    if (!res.ok) throw await readError(res, 'فشل طلب رمز الربط');
    return res.json();
  },

  sendStatement: async (statementData) => {
    const res = await authFetch('/whatsapp/send-statement', {
      method: 'POST',
      body: JSON.stringify(statementData)
    });
    if (!res.ok) throw await readError(res, 'فشل إرسال كشف الحساب بالواتساب');
    return res.json();
  },

  // PDF Generator API
  generatePdf: async (pdfData) => {
    const res = await authFetch('/pdf/generate', {
      method: 'POST',
      body: JSON.stringify(pdfData)
    });
    if (!res.ok) throw await readError(res, 'فشل توليد ملف الكشف PDF');
    return res.json(); // returns { pdfBase64 }
  },

  // Auth API
  login: async (password) => {
    const res = await publicFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    if (!res.ok) throw await readError(res, 'فشل تسجيل الدخول');
    return res.json();
  },

  verifyOtp: async (otp, otpSessionId) => {
    const res = await publicFetch('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ otp, otpSessionId })
    });
    if (!res.ok) throw await readError(res, 'فشل التحقق من الرمز');
    return res.json();
  },

  // Validates the stored token on app start
  checkSession: async () => {
    const res = await authFetch('/auth/me');
    if (!res.ok) throw await readError(res, 'جلسة غير صالحة');
    return res.json();
  }
};
