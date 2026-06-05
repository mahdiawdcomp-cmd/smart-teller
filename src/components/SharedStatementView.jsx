import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Landmark, ShieldCheck, Lock, LogOut } from 'lucide-react';

export default function SharedStatementView({ token }) {
  const [phone, setPhone] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState('');
  const [customerData, setCustomerData] = useState(null);

  // Check if session phone is saved
  useEffect(() => {
    const savedPhone = sessionStorage.getItem(`shared_auth_${token}`);
    if (savedPhone) {
      fetchStatement(savedPhone);
    }
  }, [token]);

  const fetchStatement = async (phoneNumber) => {
    setIsVerifying(true);
    setError('');
    try {
      const data = await api.getSharedStatement(token, phoneNumber);
      setCustomerData(data);
      sessionStorage.setItem(`shared_auth_${token}`, phoneNumber);
    } catch (err) {
      setError(err.message);
      sessionStorage.removeItem(`shared_auth_${token}`);
      setCustomerData(null);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLoginSubmit = (e) => {
    e.preventDefault();
    if (!phone) {
      setError('يرجى إدخال رقم الهاتف');
      return;
    }
    fetchStatement(phone);
  };

  const handleLogout = () => {
    sessionStorage.removeItem(`shared_auth_${token}`);
    setCustomerData(null);
    setPhone('');
  };

  if (!customerData) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="logo-icon" style={{ margin: '0 auto 1.5rem auto', width: '60px', height: '60px', borderRadius: '12px' }}>
            <Landmark size={36} color="#ffffff" />
          </div>
          
          <h2>كشف حساب إلكتروني</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
            لأغراض الأمان، يرجى إدخال رقم هاتفك المسجل لدينا لعرض كشف الحساب
          </p>

          {error && (
            <div className="toast toast-error">
              {error}
            </div>
          )}

          <form onSubmit={handleLoginSubmit}>
            <div className="form-group" style={{ textAlign: 'right' }}>
              <label>رقم الهاتف (الواتساب) *</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="مثال: 07701234567"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                  style={{ paddingLeft: '3rem', fontSize: '18px', textAlign: 'left', direction: 'ltr' }}
                />
                <ShieldCheck size={20} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '15px' }} />
              </div>
            </div>
            
            <button type="submit" className="btn btn-primary btn-block" disabled={isVerifying}>
              {isVerifying ? 'جاري التحقق...' : 'عرض كشف الحساب'}
              {!isVerifying && <Lock size={16} style={{ marginRight: '8px' }} />}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Formatting helper
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', minHeight: '100vh', backgroundColor: 'var(--bg-light)', paddingBottom: '2rem' }}>
      {/* Header */}
      <header style={{ backgroundColor: 'var(--primary)', padding: '1.5rem 1rem', color: 'white', textAlign: 'center', position: 'relative', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px', marginBottom: '1.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
        <button 
          onClick={handleLogout}
          style={{ position: 'absolute', top: '1rem', left: '1rem', background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: 0.8 }}
        >
          <LogOut size={18} />
          خروج
        </button>
        <Landmark size={32} style={{ margin: '0 auto 0.5rem auto' }} />
        <h1 style={{ margin: 0, fontSize: '20px' }}>كشف حساب الصراف الذكي</h1>
        <p style={{ margin: '0.5rem 0 0 0', opacity: 0.8, fontSize: '14px' }}>يتم تحديث هذا الكشف تلقائياً مع كل عملية</p>
      </header>

      <div style={{ padding: '0 1rem' }}>
        {/* Info Card */}
        <div className="info-card" style={{ backgroundColor: 'white', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem', border: '1px solid var(--border-light)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '15px', color: 'var(--text-muted)' }}>اسم الزبون:</p>
          <h2 style={{ margin: '0 0 1rem 0', fontSize: '20px', color: 'var(--text-main)' }}>{customerData.name}</h2>
          
          <div style={{ padding: '1rem', backgroundColor: customerData.balance >= 0 ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)', borderRadius: '8px', border: `1px solid ${customerData.balance >= 0 ? 'var(--success)' : 'var(--danger)'}`, textAlign: 'center' }}>
            <p style={{ margin: '0 0 0.25rem 0', fontSize: '14px', color: customerData.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              الرصيد النهائي الحالي
            </p>
            <h3 style={{ margin: 0, fontSize: '24px', color: customerData.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {fmt(Math.abs(customerData.balance))} د.ع
              <span style={{ fontSize: '14px', marginRight: '8px' }}>({customerData.balance >= 0 ? 'له' : 'عليه'})</span>
            </h3>
          </div>
        </div>

        {/* Transactions List (Mobile friendly card layout instead of table) */}
        <h3 style={{ fontSize: '16px', color: 'var(--text-muted)', marginBottom: '1rem', paddingRight: '0.5rem' }}>حركة الحساب (سجل العمليات):</h3>
        
        {customerData.transactions && customerData.transactions.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {customerData.transactions.map((tx, idx) => {
              const isDeposit = tx.type === 'deposit';
              const amountClass = isDeposit ? 'text-success' : 'text-danger';
              const sign = isDeposit ? '+' : '-';
              const totalAmount = isDeposit ? tx.amount : tx.amount + (tx.commission || 0);

              return (
                <div key={tx.id || idx} style={{ backgroundColor: 'white', borderRadius: '12px', padding: '1rem', border: '1px solid var(--border-light)', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-light)', padding: '2px 8px', borderRadius: '12px' }}>
                        {new Date(tx.date).toLocaleDateString('en-US')}
                      </span>
                    </div>
                    <div className={amountClass} style={{ fontWeight: 'bold', fontSize: '16px', direction: 'ltr' }}>
                      {sign} {fmt(totalAmount)}
                    </div>
                  </div>
                  
                  <div style={{ fontSize: '14px', color: 'var(--text-main)', marginBottom: '0.5rem', lineHeight: '1.5' }}>
                    {tx.notes || (isDeposit ? 'إيداع نقدي' : 'سحب/حوالة')}
                    {!isDeposit && tx.commission > 0 && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block' }}>
                        (يتضمن عمولة: {fmt(tx.commission)})
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem', backgroundColor: 'white', borderRadius: '12px', color: 'var(--text-muted)' }}>
            لا توجد عمليات مسجلة بعد.
          </div>
        )}
      </div>
    </div>
  );
}
