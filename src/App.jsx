import React, { useState, useEffect } from 'react';
import { api, session, setUnauthorizedHandler } from './utils/api';
import CustomerList from './components/CustomerList';
import TransactionForm from './components/TransactionForm';
import Statements from './components/Statements';
import Expenses from './components/Expenses';
import WhatsAppSetup from './components/WhatsAppSetup';
import CashBox from './components/CashBox';
import Reports from './components/Reports';
import BackupPanel from './components/BackupPanel';
import UsersPanel from './components/UsersPanel';
import DebtReminder from './components/DebtReminder';
import Modal from './components/Modal';
import TransactionSearch from './components/TransactionSearch';
import WelcomeTour, { shouldShowTour, resetTour } from './components/WelcomeTour';
import SharedStatementView from './components/SharedStatementView';
import { Landmark, Users, ArrowUpRight, ArrowDownRight, LogOut, Key, Phone, ShieldCheck } from 'lucide-react';

export default function App() {
  // Authentication states
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpSessionId, setOtpSessionId] = useState(null);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authWarning, setAuthWarning] = useState('');

  // Active navigation tab
  const [activeTab, setActiveTab] = useState('customers'); // 'customers' | 'cashbox' | 'reports' | 'expenses' | 'whatsapp'
  
  // Data states
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Modal and focus states
  const [selectedCustomer, setSelectedCustomer] = useState(null); // for Statement view
  const [activeTransactionCustomer, setActiveTransactionCustomer] = useState(null); // for Transaction form modal
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  
  // Add Customer form states
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [addCustError, setAddCustError] = useState('');
  // Possible duplicates the server flagged; adding proceeds only once confirmed.
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  // Editing / merging an existing customer
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editCustForm, setEditCustForm] = useState({ name: '', phone: '' });
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [editCustError, setEditCustError] = useState('');
  const [editCustBusy, setEditCustBusy] = useState(false);

  // The welcome tour: three showings per account, then it stops on its own.
  const [showTour, setShowTour] = useState(false);

  const permissions = currentUser?.permissions || {};

  // Check URL for shared statement token
  const searchParams = new URLSearchParams(window.location.search);
  const sharedToken = searchParams.get('shared');

  // Drop straight back to the login screen whenever the server rejects our token.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setIsAuthenticated(false);
      setCurrentUser(null);
      setOtpSent(false);
      setOtpSessionId(null);
      setCustomers([]);
    });
  }, []);

  // Validate the stored token with the server on mount — a token that merely exists
  // in localStorage proves nothing.
  useEffect(() => {
    if (sharedToken) return; // Skip auth check if viewing a shared statement
    if (!session.get()) return;

    let cancelled = false;
    (async () => {
      try {
        const me = await api.checkSession();
        if (cancelled) return;
        setCurrentUser(me.user);
        setIsAuthenticated(true);
        setShowTour(shouldShowTour(me.user));
        loadCustomers();
      } catch {
        session.clear();
        if (!cancelled) setIsAuthenticated(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sharedToken]);

  // Opens the statement view for one customer, pulling their ledger from the server.
  // The list endpoint returns balances only, so the transactions are fetched here.
  const openCustomerStatement = async (customer) => {
    setLoading(true);
    try {
      const full = await api.getCustomer(customer.id);
      setSelectedCustomer(full);
    } catch (err) {
      window.alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Re-reads the open customer after an edit or a delete.
  const refreshSelectedCustomer = async () => {
    if (!selectedCustomer) return;
    try {
      const full = await api.getCustomer(selectedCustomer.id);
      setSelectedCustomer(full);
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch all customers data
  const loadCustomers = async () => {
    setLoading(true);
    try {
      const list = await api.getCustomers();
      setCustomers(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // 1. Password Verification (First Step)
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthWarning('');
    if (!password) return;

    setAuthLoading(true);
    try {
      const res = await api.login(username, password);
      if (res.requiresOTP) {
        setOtpSessionId(res.otpSessionId);
        setOtpSent(true);
        setAuthWarning(res.message);
      } else {
        // Logged in directly (staff account, or two-factor not configured)
        session.set(res.token);
        setCurrentUser(res.user);
        setShowTour(shouldShowTour(res.user));
        setIsAuthenticated(true);
        loadCustomers();
        if (res.warning) {
          alert(res.warning);
        }
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  // 2. OTP Verification (Second Step)
  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!otp) return;

    setAuthLoading(true);
    try {
      const res = await api.verifyOtp(otp, otpSessionId);
      if (res.success) {
        session.set(res.token);
        setCurrentUser(res.user);
        setShowTour(shouldShowTour(res.user));
        setOtpSessionId(null);
        setOtpSent(false);
        setPassword('');
        setOtp('');
        setIsAuthenticated(true);
        loadCustomers();
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  // Handle Logout
  const handleLogout = () => {
    if (!window.confirm('هل أنت متأكد من تسجيل الخروج؟')) return;
    session.clear();
    setIsAuthenticated(false);
    setCurrentUser(null);
    setOtpSent(false);
    setOtpSessionId(null);
    setPassword('');
    setOtp('');
  };

  // Handle Add Customer Submit
  const handleAddCustomerSubmit = async (e, force = false) => {
    if (e) e.preventDefault();
    setAddCustError('');
    if (!newCustName) {
      setAddCustError('اسم الزبون مطلوب');
      return;
    }

    try {
      await api.addCustomer(newCustName, newCustPhone, force);
      setNewCustName('');
      setNewCustPhone('');
      setDuplicateWarning(null);
      setShowAddCustomerModal(false);
      loadCustomers(); // Reload list
    } catch (err) {
      // The server refuses a likely duplicate once; the user confirms or cancels.
      if (err.code === 'POSSIBLE_DUPLICATE') {
        setDuplicateWarning(err.duplicates);
        setAddCustError('');
        return;
      }
      setAddCustError(err.message);
    }
  };

  // Archiving asks first and says plainly that nothing is being deleted, because
  // "حذف" on a money record is the one action people expect to be irreversible.
  const handleArchiveCustomer = async (customer, archive) => {
    const balance = Number(customer.balance) || 0;

    const confirmText = archive
      ? `أرشفة الزبون "${customer.name}"؟

` +
        `راح يختفي من قائمة الزبائن، بس كل عملياته وكشف حسابه يبقون محفوظين، ` +
        `وتكدر ترجّعه بأي وقت من تبويب الأرشيف.` +
        (balance !== 0
          ? `

⚠️ انتبه: رصيده الحالي ${Math.abs(balance).toLocaleString('en-US')} د.ع ` +
            `(${balance > 0 ? 'له' : 'عليه'}) — وراح يظل محسوباً بالصندوق والتقارير.`
          : '')
      : `استرجاع الزبون "${customer.name}" لقائمة الزبائن؟`;

    if (!window.confirm(confirmText)) return;

    try {
      await api.archiveCustomer(customer.id, archive);
      await loadCustomers();
    } catch (err) {
      window.alert(err.message);
    }
  };

  const openEditCustomer = (customer) => {
    setEditingCustomer(customer);
    setEditCustForm({ name: customer.name, phone: customer.phone || '' });
    setMergeTargetId('');
    setEditCustError('');
  };

  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    setEditCustBusy(true);
    setEditCustError('');

    try {
      await api.updateCustomer(editingCustomer.id, editCustForm);
      setEditingCustomer(null);
      await loadCustomers();
    } catch (err) {
      setEditCustError(err.message);
    } finally {
      setEditCustBusy(false);
    }
  };

  // Merging moves every transaction across and archives the duplicate, so the
  // confirmation spells out exactly what is about to happen.
  const handleMergeCustomer = async () => {
    if (!mergeTargetId) {
      setEditCustError('اختر الزبون الذي سيتم الدمج معه');
      return;
    }

    const target = customers.find(c => c.id === mergeTargetId);
    const confirmText =
      `دمج "${editingCustomer.name}" داخل "${target?.name}"؟

` +
      `ستنتقل كل عمليات "${editingCustomer.name}" إلى "${target?.name}"، ` +
      `ويُجمع الرصيدان، ويُؤرشف الحساب المكرر.

هذا الإجراء لا يمكن التراجع عنه.`;

    if (!window.confirm(confirmText)) return;

    setEditCustBusy(true);
    setEditCustError('');
    try {
      const res = await api.mergeCustomers(editingCustomer.id, mergeTargetId);
      setEditingCustomer(null);
      await loadCustomers();
      window.alert(`تم الدمج بنجاح. نُقلت ${res.movedTransactions} عملية.`);
    } catch (err) {
      setEditCustError(err.message);
    } finally {
      setEditCustBusy(false);
    }
  };

  // Calculate high level stats (deposits/withdrawals sums)
  const getAppStats = () => {
    let creditSum = 0; // Total money customers deposited (positive balance)
    let debtSum = 0;   // Total money customers owe (negative balance)
    
    customers.forEach(c => {
      const bal = parseFloat(c.balance) || 0;
      if (bal > 0) creditSum += bal;
      else if (bal < 0) debtSum += Math.abs(bal);
    });

    return {
      totalCustomers: customers.length,
      creditSum,
      debtSum
    };
  };

  const stats = getAppStats();

  // If URL has ?shared=TOKEN, render ONLY the shared public view
  if (sharedToken) {
    return <SharedStatementView token={sharedToken} />;
  }

  // If not authenticated, render login panel
  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="logo-icon" style={{ margin: '0 auto 1.5rem auto', width: '60px', height: '60px', borderRadius: '12px' }}>
            <Landmark size={36} color="#ffffff" />
          </div>
          
          <h2>حساب الصراف الذكي 🏦</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
            نظام محاسبة الحوالات والأرباح الآمن والمبسط
          </p>

          {authError && (
            <div className="toast toast-error">
              {authError}
            </div>
          )}

          {authWarning && (
            <div className="toast toast-success" style={{ backgroundColor: 'rgba(217, 119, 6, 0.1)', color: 'var(--accent)', borderColor: 'rgba(217, 119, 6, 0.3)' }}>
              {authWarning}
            </div>
          )}

          {/* OTP screen or Password screen */}
          {!otpSent ? (
            <form onSubmit={handlePasswordSubmit}>
              <div className="form-group" style={{ textAlign: 'right' }}>
                <label>اسم المستخدم *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="owner"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  style={{ direction: 'ltr', textAlign: 'left' }}
                />
              </div>

              <div className="form-group" style={{ textAlign: 'right' }}>
                <label>كلمة المرور *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="رمز الدخول الصعب..."
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    style={{ paddingLeft: '3rem' }}
                  />
                  <Key size={20} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '15px' }} />
                </div>
              </div>
              
              <button type="submit" className="btn btn-primary btn-block" disabled={authLoading}>
                {authLoading ? 'جاري التحقق...' : 'تسجيل الدخول'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleOtpSubmit}>
              <div className="form-group" style={{ textAlign: 'right' }}>
                <label>أدخل رمز التحقق (OTP) المرسل لواتساب *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="كود الـ 6 أرقام..."
                    value={otp}
                    onChange={e => setOtp(e.target.value)}
                    required
                    style={{ paddingLeft: '3rem', fontSize: '24px', textAlign: 'center', letterSpacing: '2px' }}
                  />
                  <ShieldCheck size={20} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '15px' }} />
                </div>
              </div>
              
              <button type="submit" className="btn btn-success btn-block" disabled={authLoading}>
                {authLoading ? 'جاري التحقق...' : 'تأكيد الرمز والدخول'}
              </button>

              <button 
                type="button" 
                className="btn btn-secondary btn-block" 
                onClick={() => { setOtpSent(false); setOtpSessionId(null); setOtp(''); }}
                style={{ marginTop: '1rem' }}
              >
                رجوع للرمز الرئيسي
              </button>
            </form>
          )}

        </div>
      </div>
    );
  }

  // --- Authenticated Layout ---
  return (
    <div>
      {/* App Header */}
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-icon">
            <Landmark size={24} color="#ffffff" />
          </div>
          <h1>حساب الصراف الذكي</h1>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {currentUser && (
          <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
            {currentUser.name}
            <span className={`badge ${currentUser.role === 'admin' ? 'badge-deposit' : 'badge-withdrawal'}`} style={{ marginRight: '6px', fontSize: '11px' }}>
              {currentUser.role === 'admin' ? 'مدير' : 'موظف'}
            </span>
          </span>
        )}
        <button className="btn btn-danger" onClick={handleLogout} style={{ padding: '0.5rem 1.25rem', fontSize: '16px' }}>
          <LogOut size={16} />
          خروج
        </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="main-container">
        
        {/* Main Stats Banner (Only show if not in Statement details view) */}
        {!selectedCustomer && (
          <div className="dashboard-grid">
            
            {/* Total Customers */}
            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(8, 145, 178, 0.1)', color: 'var(--primary)' }}>
                <Users size={32} />
              </div>
              <div className="stat-info">
                <h3>إجمالي عدد الزبائن</h3>
                <p>{stats.totalCustomers} زبائن</p>
              </div>
            </div>

            {/* Sum of Credit Balances (له) */}
            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(22, 163, 74, 0.1)', color: 'var(--success)' }}>
                <ArrowUpRight size={32} />
              </div>
              <div className="stat-info">
                <h3>مجموع مبالغ الزبائن (له)</h3>
                <p style={{ color: 'var(--success)' }}>
                  {stats.creditSum.toLocaleString('en-US')} د.ع
                </p>
              </div>
            </div>

            {/* Sum of Debt Balances (عليه) */}
            <div className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: 'var(--danger)' }}>
                <ArrowDownRight size={32} />
              </div>
              <div className="stat-info">
                <h3>مجموع الديون المطلوبة (عليه)</h3>
                <p style={{ color: 'var(--danger)' }}>
                  {stats.debtSum.toLocaleString('en-US')} د.ع
                </p>
              </div>
            </div>

          </div>
        )}

        {/* Tab Selection Navigation (Only show if not in Statement details view) */}
        {!selectedCustomer && (
          <nav className="tabs-nav">
            <button 
              className={`tab-btn ${activeTab === 'customers' ? 'active' : ''}`}
              onClick={() => setActiveTab('customers')}
            >
              📂 الزبائن والحسابات
            </button>
            <button 
              className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`}
              onClick={() => setActiveTab('search')}
            >
              🔎 البحث في العمليات
            </button>
            {permissions.canViewReports && (
            <button 
              className={`tab-btn ${activeTab === 'expenses' ? 'active' : ''}`}
              onClick={() => setActiveTab('expenses')}
            >
              💰 المصاريف والأرباح
            </button>
            )}
            {permissions.canViewReports && (
            <button 
              className={`tab-btn ${activeTab === 'cashbox' ? 'active' : ''}`}
              onClick={() => setActiveTab('cashbox')}
            >
              🧾 صندوق المكتب
            </button>
            )}
            {permissions.canViewReports && (
            <button 
              className={`tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
              onClick={() => setActiveTab('reports')}
            >
              📊 التقارير
            </button>
            )}
            {permissions.canManageSettings && (
            <button 
              className={`tab-btn ${activeTab === 'whatsapp' ? 'active' : ''}`}
              onClick={() => setActiveTab('whatsapp')}
            >
              📱 الإعدادات والنسخ الاحتياطي
            </button>
            )}
          </nav>
        )}

        {/* Active Tab Panel Content */}
        {selectedCustomer ? (
          /* Detailed Statement View */
          <Statements
            customer={selectedCustomer}
            permissions={permissions}
            onLedgerChanged={refreshSelectedCustomer}
            onBack={() => {
              setSelectedCustomer(null);
              loadCustomers(); // reload to get any balance updates
            }}
          />
        ) : (
          /* Grid Tabs */
          <>
            {activeTab === 'customers' && (
              <CustomerList
                customers={customers}
                onSelectCustomer={openCustomerStatement}
                onEditCustomer={openEditCustomer}
                onArchiveCustomer={handleArchiveCustomer}
                permissions={permissions}
                onOpenTransaction={(cust) => setActiveTransactionCustomer(cust)}
                onOpenAddCustomer={() => setShowAddCustomerModal(true)}
              />
            )}

            {activeTab === 'search' && (
              <TransactionSearch onOpenCustomer={openCustomerStatement} />
            )}

            {activeTab === 'expenses' && permissions.canViewReports && <Expenses />}

            {activeTab === 'cashbox' && permissions.canViewReports && <CashBox />}

            {activeTab === 'reports' && permissions.canViewReports && <Reports />}

            {activeTab === 'whatsapp' && permissions.canManageSettings && (
              <>
                <WhatsAppSetup />
                {permissions.canViewReports && <DebtReminder />}
                <BackupPanel />
                {permissions.canManageUsers && <UsersPanel />}

                <div className="panel-card" style={{ marginTop: '1.5rem' }}>
                  <h3 style={{ marginTop: 0 }}>شرح الموقع</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                    دليل سريع يشرح كل شاشة خطوة خطوة.
                  </p>
                  <button
                    className="btn btn-primary btn-block"
                    onClick={() => { resetTour(currentUser.id); setShowTour(true); }}
                  >
                    افتح شرح الموقع
                  </button>
                </div>
              </>
            )}
          </>
        )}

      </main>

      {/* FOOTER */}
      <footer className="app-footer">
        جميع الحقوق محفوظة © {new Date().getFullYear()} - حساب الصراف الذكي 🏦
      </footer>

      {/* --- MODAL POPUPS --- */}

      {/* 1. Modal for Add New Customer */}
      {showAddCustomerModal && (
        <Modal
          title="إضافة زبون جديد للمكتب"
          onClose={() => { setShowAddCustomerModal(false); setDuplicateWarning(null); setAddCustError(''); }}
        >

            {addCustError && (
              <div className="toast toast-error">
                {addCustError}
              </div>
            )}

            {/* A duplicate splits one person's money across two accounts, so the
                server refuses once and the user decides deliberately. */}
            {duplicateWarning && (
              <div className="toast toast-error" style={{ textAlign: 'right' }}>
                <strong>يوجد زبون مشابه مسجّل مسبقاً:</strong>
                <ul style={{ margin: '0.5rem 1rem 0.75rem 0', paddingRight: '1rem' }}>
                  {duplicateWarning.map(d => (
                    <li key={d.id} style={{ marginBottom: '0.25rem' }}>
                      {d.name}
                      {d.phone ? ` — ${d.phone}` : ''}
                      {` — الرصيد: ${Number(d.balance || 0).toLocaleString('en-US')} د.ع`}
                    </li>
                  ))}
                </ul>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => { setDuplicateWarning(null); setShowAddCustomerModal(false); }}
                    style={{ flex: 1 }}
                  >
                    إلغاء الإضافة
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => handleAddCustomerSubmit(null, true)}
                    style={{ flex: 1 }}
                  >
                    زبون مختلف — أضفه
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleAddCustomerSubmit}>
              <div className="form-group">
                <label>اسم الزبون بالكامل *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="مثال: أحمد عبد الله حميد"
                  value={newCustName}
                  onChange={e => setNewCustName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>رقم الهاتف (الواتساب) *</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="مثال: 07701234567"
                    value={newCustPhone}
                    onChange={e => setNewCustPhone(e.target.value)}
                    required
                  />
                  <Phone size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '15px' }} />
                </div>
              </div>

              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setShowAddCustomerModal(false)}
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary">
                  إضافة الزبون
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* The welcome tour, shown over the app on the first few sign-ins */}
      {showTour && currentUser && (
        <WelcomeTour user={currentUser} onClose={() => setShowTour(false)} />
      )}

      {/* 1.5 Modal for editing / merging a customer */}
      {editingCustomer && (
        <Modal
          title="تعديل بيانات الزبون"
          onClose={() => { setEditingCustomer(null); setEditCustError(''); }}
        >

            {editCustError && <div className="toast toast-error">{editCustError}</div>}

            <form onSubmit={handleSaveCustomer}>
              <div className="form-group">
                <label>اسم الزبون *</label>
                <input
                  type="text"
                  className="form-input"
                  value={editCustForm.name}
                  onChange={e => setEditCustForm({ ...editCustForm, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>رقم الهاتف</label>
                <input
                  type="text"
                  className="form-input"
                  value={editCustForm.phone}
                  onChange={e => setEditCustForm({ ...editCustForm, phone: e.target.value })}
                />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingCustomer(null)} disabled={editCustBusy}>
                  إغلاق
                </button>
                <button type="submit" className="btn btn-primary" disabled={editCustBusy}>
                  {editCustBusy ? 'جاري الحفظ...' : 'حفظ التعديل'}
                </button>
              </div>
            </form>

            <hr style={{ margin: '1.5rem 0', border: 'none', borderTop: '1px solid var(--border-light)' }} />

            <h3 style={{ fontSize: '17px' }}>دمج هذا الزبون مع زبون آخر</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
              تُنقل كل العمليات إلى الزبون المختار، ويُجمع الرصيدان، ويُؤرشف هذا الحساب.
            </p>

            <div className="form-group">
              <select
                className="form-input"
                value={mergeTargetId}
                onChange={e => setMergeTargetId(e.target.value)}
              >
                <option value="">— اختر الزبون الأصلي —</option>
                {customers
                  .filter(c => c.id !== editingCustomer.id && !c.archived)
                  .map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.phone ? ` — ${c.phone}` : ''}
                    </option>
                  ))}
              </select>
            </div>

            <button
              type="button"
              className="btn btn-danger btn-block"
              onClick={handleMergeCustomer}
              disabled={editCustBusy || !mergeTargetId}
            >
              {editCustBusy ? 'جاري الدمج...' : 'دمج الحسابين'}
            </button>
        </Modal>
      )}

      {/* 2. Modal for Transaction Creation */}
      {activeTransactionCustomer && (
        <TransactionForm
          customer={activeTransactionCustomer}
          onClose={() => setActiveTransactionCustomer(null)}
          onSuccess={() => {
            setActiveTransactionCustomer(null);
            loadCustomers(); // Reload list to see balance update
          }}
        />
      )}

    </div>
  );
}
