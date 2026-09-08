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

  // 401 means the session is gone — drop back to the login screen.
  // 403 means the session is fine but this account lacks the permission, so the
  // user stays logged in and simply sees the refusal.
  if (res.status === 401) {
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

  // force=true confirms an add the server flagged as a possible duplicate.
  addCustomer: async (name, phone, force = false) => {
    const res = await authFetch(`/customers${force ? '?force=true' : ''}`, {
      method: 'POST',
      body: JSON.stringify({ name, phone })
    });

    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.error || 'يوجد زبون مشابه');
      err.code = 'POSSIBLE_DUPLICATE';
      err.duplicates = data.duplicates || [];
      throw err;
    }

    if (!res.ok) throw await readError(res, 'فشل إضافة الزبون');
    return res.json();
  },

  updateCustomer: async (customerId, patch) => {
    const res = await authFetch(`/customers/${customerId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
    if (!res.ok) throw await readError(res, 'فشل تعديل بيانات الزبون');
    return res.json();
  },

  // Archiving hides a customer from the daily list; it never deletes anything.
  archiveCustomer: async (customerId, archived = true) => {
    const res = await authFetch(`/customers/${customerId}/archive`, {
      method: 'POST',
      body: JSON.stringify({ archived })
    });
    if (!res.ok) throw await readError(res, archived ? 'فشل أرشفة الزبون' : 'فشل استرجاع الزبون');
    return res.json();
  },

  mergeCustomers: async (sourceId, targetId) => {
    const res = await authFetch(`/customers/${sourceId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ targetId })
    });
    if (!res.ok) throw await readError(res, 'فشل دمج الزبائن');
    return res.json();
  },

  // One customer with their ledger — the list endpoint no longer carries transactions.
  getCustomer: async (customerId) => {
    const res = await authFetch(`/customers/${customerId}`);
    if (!res.ok) throw await readError(res, 'فشل تحميل بيانات الزبون');
    return res.json();
  },

  // idempotencyKey makes a retry after a dropped connection safe: the server
  // replays the first result instead of recording the money a second time.
  addTransaction: async (customerId, transactionData, idempotencyKey) => {
    const res = await authFetch(`/customers/${customerId}/transactions`, {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {},
      body: JSON.stringify(transactionData)
    });
    if (!res.ok) throw await readError(res, 'فشل إضافة العملية الحسابية');
    return res.json();
  },

  getReceipt: async (customerId, txId, send = false) => {
    const res = await authFetch(`/customers/${customerId}/transactions/${txId}/receipt`, {
      method: 'POST',
      body: JSON.stringify({ send })
    });
    if (!res.ok) throw await readError(res, 'فشل توليد الوصل');
    return res.json();
  },

  searchTransactions: async (filters) => {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) params.set(key, value);
    });

    const res = await authFetch(`/transactions/search?${params}`);
    if (!res.ok) throw await readError(res, 'فشل البحث في العمليات');
    return res.json();
  },

  // Roles and users
  getRoles: async () => {
    const res = await authFetch('/roles');
    if (!res.ok) throw await readError(res, 'فشل تحميل الصلاحيات');
    return res.json();
  },

  // Notifications
  getNotifications: async () => {
    const res = await authFetch('/notifications');
    if (!res.ok) throw await readError(res, 'فشل تحميل الإشعارات');
    return res.json();
  },

  getNotificationConfig: async () => {
    const res = await authFetch('/notifications/config');
    if (!res.ok) throw await readError(res, 'فشل قراءة إعدادات الإشعارات');
    return res.json();
  },

  subscribePush: async (subscription) => {
    const res = await authFetch('/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription })
    });
    if (!res.ok) throw await readError(res, 'فشل تفعيل الإشعارات');
    return res.json();
  },

  unsubscribePush: async (endpoint) => {
    const res = await authFetch('/notifications/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint })
    });
    if (!res.ok) throw await readError(res, 'فشل إيقاف الإشعارات');
    return res.json();
  },

  testPush: async () => {
    const res = await authFetch('/notifications/test', { method: 'POST' });
    if (!res.ok) throw await readError(res, 'فشل إرسال التجربة');
    return res.json();
  },

  // Debts
  getDebts: async () => {
    const res = await authFetch('/debts');
    if (!res.ok) throw await readError(res, 'فشل تحميل قائمة الديون');
    return res.json();
  },

  sendDebtReminder: async () => {
    const res = await authFetch('/debts/remind', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل إرسال التذكير');
    return data;
  },

  getUsers: async () => {
    const res = await authFetch('/users');
    if (!res.ok) throw await readError(res, 'فشل تحميل المستخدمين');
    return res.json();
  },

  createUser: async (payload) => {
    const res = await authFetch('/users', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) throw await readError(res, 'فشل إضافة المستخدم');
    return res.json();
  },

  updateUser: async (id, patch) => {
    const res = await authFetch(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (!res.ok) throw await readError(res, 'فشل تعديل المستخدم');
    return res.json();
  },

  deleteUser: async (id) => {
    const res = await authFetch(`/users/${id}`, { method: 'DELETE' });
    if (!res.ok) throw await readError(res, 'فشل حذف المستخدم');
    return res.json();
  },

  retryWhatsApp: async () => {
    const res = await authFetch('/whatsapp/retry', { method: 'POST' });
    if (!res.ok) throw await readError(res, 'فشل إعادة المحاولة');
    return res.json();
  },

  updateTransaction: async (customerId, txId, transactionData) => {
    const res = await authFetch(`/customers/${customerId}/transactions/${txId}`, {
      method: 'PATCH',
      body: JSON.stringify(transactionData)
    });
    if (!res.ok) throw await readError(res, 'فشل تعديل العملية');
    return res.json();
  },

  deleteTransaction: async (customerId, txId) => {
    const res = await authFetch(`/customers/${customerId}/transactions/${txId}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw await readError(res, 'فشل حذف العملية');
    return res.json();
  },

  recomputeBalance: async (customerId) => {
    const res = await authFetch(`/customers/${customerId}/recompute`, { method: 'POST' });
    if (!res.ok) throw await readError(res, 'فشل إعادة حساب الرصيد');
    return res.json();
  },

  getAuditLogs: async (customerId) => {
    const query = customerId ? `?customerId=${encodeURIComponent(customerId)}` : '';
    const res = await authFetch(`/audit-logs${query}`);
    if (!res.ok) throw await readError(res, 'فشل تحميل سجل التدقيق');
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

  addExpense: async (title, amount, notes, date) => {
    const res = await authFetch('/expenses', {
      method: 'POST',
      body: JSON.stringify({ title, amount, notes, date })
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

  // Cash box
  getCashBox: async ({ from, to } = {}) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString() ? `?${params}` : '';

    const res = await authFetch(`/cashbox${query}`);
    if (!res.ok) throw await readError(res, 'فشل تحميل بيانات الصندوق');
    return res.json();
  },

  addCashCount: async (countedAmount, notes) => {
    const res = await authFetch('/cashbox/count', {
      method: 'POST',
      body: JSON.stringify({ countedAmount, notes })
    });
    if (!res.ok) throw await readError(res, 'فشل تسجيل الجرد');
    return res.json();
  },

  getCashCounts: async () => {
    const res = await authFetch('/cashbox/counts');
    if (!res.ok) throw await readError(res, 'فشل تحميل سجل الجرد');
    return res.json();
  },

  // Settings
  getSettings: async () => {
    const res = await authFetch('/settings');
    if (!res.ok) throw await readError(res, 'فشل تحميل الإعدادات');
    return res.json();
  },

  updateSettings: async (patch) => {
    const res = await authFetch('/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
    if (!res.ok) throw await readError(res, 'فشل حفظ الإعدادات');
    return res.json();
  },

  // Reports
  getReport: async ({ preset, from, to }) => {
    const params = new URLSearchParams();
    if (preset) params.set('preset', preset);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    const res = await authFetch(`/reports?${params}`);
    if (!res.ok) throw await readError(res, 'فشل توليد التقرير');
    return res.json();
  },

  // Backup — the file is binary (gzipped, and encrypted when configured),
  // so it must be read as a blob rather than as text.
  downloadBackup: async () => {
    const res = await authFetch('/backup/export');
    if (!res.ok) throw await readError(res, 'فشل تصدير النسخة الاحتياطية');

    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/);

    return {
      blob: await res.blob(),
      fileName: match ? match[1] : `smart-teller-backup-${new Date().toISOString().slice(0,10)}.stb`,
      encrypted: res.headers.get('x-backup-encrypted') === 'true'
    };
  },

  runBackup: async () => {
    const res = await authFetch('/backup/run', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل إرسال النسخة الاحتياطية');
    return data;
  },

  getBackupStatus: async () => {
    const res = await authFetch('/backup/status');
    if (!res.ok) throw await readError(res, 'فشل قراءة حالة النسخ الاحتياطي');
    return res.json();
  },

  // Auth API
  login: async (username, password) => {
    const res = await publicFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
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
