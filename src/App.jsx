import React, { useState, useEffect } from 'react';
import { api, session, setUnauthorizedHandler } from './utils/api';
import CustomerList from './components/CustomerList';
import TransactionForm from './components/TransactionForm';
import Statements from './components/Statements';
import Expenses from './components/Expenses';
import WhatsAppSetup from './components/WhatsAppSetup';
import SharedStatementView from './components/SharedStatementView';
import { Landmark, Users, ArrowUpRight, ArrowDownRight, LogOut, Key, Phone, ShieldCheck } from 'lucide-react';

export default function App() {
  // Authentication states
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpSessionId, setOtpSessionId] = useState(null);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authWarning, setAuthWarning] = useState('');

  // Active navigation tab
  const [activeTab, setActiveTab] = useState('customers'); // 'customers' | 'expenses' | 'whatsapp'
  
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

  // Check URL for shared statement token
  const searchParams = new URLSearchParams(window.location.search);
  const sharedToken = searchParams.get('shared');

  // Drop straight back to the login screen whenever the server rejects our token.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setIsAuthenticated(false);
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
        await api.checkSession();
        if (cancelled) return;
        setIsAuthenticated(true);
        loadCustomers();
      } catch {
        session.clear();
        if (!cancelled) setIsAuthenticated(false);
      }
    })();

    return () => { cancelled = true; };
  }, [sharedToken]);

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
      const res = await api.login(password);
      if (res.requiresOTP) {
        setOtpSessionId(res.otpSessionId);
        setOtpSent(true);
        setAuthWarning(res.message);
      } else {
        // Logged in directly (two-factor not configured for this install)
        session.set(res.token);
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
    setOtpSent(false);
    setOtpSessionId(null);
    setPassword('');
    setOtp('');
  };

  // Handle Add Customer Submit
  const handleAddCustomerSubmit = async (e) => {
    e.preventDefault();
    setAddCustError('');
    if (!newCustName) {
      setAddCustError('اسم الزبون مطلوب');
      return;
    }

    try {
      await api.addCustomer(newCustName, newCustPhone);
      setNewCustName('');
      setNewCustPhone('');
      setShowAddCustomerModal(false);
      loadCustomers(); // Reload list
    } catch (err) {
      setAddCustError(err.message);
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
                <label>أدخل رمز الدخول الرئيسي *</label>
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
        
        <button className="btn btn-danger" onClick={handleLogout} style={{ padding: '0.5rem 1.25rem', fontSize: '16px' }}>
          <LogOut size={16} />
          خروج
        </button>
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
              className={`tab-btn ${activeTab === 'expenses' ? 'active' : ''}`}
              onClick={() => setActiveTab('expenses')}
            >
              💰 المصاريف والأرباح
            </button>
            <button 
              className={`tab-btn ${activeTab === 'whatsapp' ? 'active' : ''}`}
              onClick={() => setActiveTab('whatsapp')}
            >
              📱 إعدادات البوت والواتساب
            </button>
          </nav>
        )}

        {/* Active Tab Panel Content */}
        {selectedCustomer ? (
          /* Detailed Statement View */
          <Statements
            customer={selectedCustomer}
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
                onSelectCustomer={(cust) => setSelectedCustomer(cust)}
                onOpenTransaction={(cust) => setActiveTransactionCustomer(cust)}
                onOpenAddCustomer={() => setShowAddCustomerModal(true)}
              />
            )}

            {activeTab === 'expenses' && <Expenses />}

            {activeTab === 'whatsapp' && <WhatsAppSetup />}
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
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="panel-header">
              <h2>إضافة زبون جديد للمكتب</h2>
            </div>

            {addCustError && (
              <div className="toast toast-error">
                {addCustError}
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
          </div>
        </div>
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
