import React, { useState } from 'react';
import { api } from '../utils/api';
import { ArrowLeftRight, X, ShieldAlert } from 'lucide-react';
import confetti from 'canvas-confetti';

const formatNumberWithCommas = (val) => {
  if (!val) return '';
  const cleanVal = val.toString().replace(/[^0-9]/g, '');
  if (!cleanVal) return '';
  return Number(cleanVal).toLocaleString('en-US');
};

const parseRawNumber = (val) => {
  if (!val) return 0;
  return parseFloat(val.toString().replace(/,/g, '')) || 0;
};

/** Local datetime string for an <input type="datetime-local"> value. */
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function TransactionForm({ customer, onClose, onSuccess }) {
  const [type, setType] = useState('deposit'); // 'deposit' | 'withdrawal'
  const [amount, setAmount] = useState('');
  const [commission, setCommission] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmCheckbox, setConfirmCheckbox] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Backdating: the teller records yesterday's operation today, and a wrong date
  // silently corrupts every daily report built on top of it.
  const [useCustomDate, setUseCustomDate] = useState(false);
  const [customDate, setCustomDate] = useState(toLocalInputValue(new Date()));

  // One key per open form. A retry after a dropped connection reuses it, so the
  // server replays the first result instead of recording the money twice.
  const [idempotencyKey] = useState(() =>
    (window.crypto?.randomUUID?.() || `k-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const rawAmount = parseRawNumber(amount);
    const rawCommission = parseRawNumber(commission);

    if (rawAmount <= 0) {
      setError('يرجى إدخال مبلغ صحيح أكبر من الصفر');
      return;
    }

    if (!confirmCheckbox) {
      setError('يرجى النقر على مربع التأكيد أسفل النموذج للمتابعة');
      return;
    }

    if (useCustomDate) {
      const picked = new Date(customDate);
      if (Number.isNaN(picked.getTime())) {
        setError('التاريخ المُدخل غير صحيح');
        return;
      }
      if (picked.getTime() > Date.now() + 60_000) {
        setError('لا يمكن تسجيل عملية بتاريخ مستقبلي');
        return;
      }
    }

    setLoading(true);
    try {
      const transactionData = {
        type,
        amount: rawAmount,
        commission: type === 'deposit' ? 0 : rawCommission,
        notes: notes || '',
        ...(useCustomDate ? { date: new Date(customDate).toISOString() } : {})
      };

      await api.addTransaction(customer.id, transactionData, idempotencyKey);
      
      // Celebrate success with confetti! Give a premium visual reward.
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });

      onSuccess();
    } catch (err) {
      setError(`خطأ: ${err.message}`);
      setLoading(false);
    }
  };

  // Convert numbers to readable format for the elderly
  const getReadableAmountText = () => {
    if (!amount) return '0 دينار عراقي';
    return amount + ' دينار عراقي';
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '550px' }}>
        
        {/* Modal Header */}
        <div className="panel-header" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ArrowLeftRight size={24} color="var(--primary)" />
            عملية مالية لـ: {customer.name}
          </h2>
          <button onClick={onClose} className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', borderRadius: '8px' }}>
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="toast toast-error" style={{ marginBottom: '1.5rem' }}>
            <ShieldAlert size={20} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          
          {/* Transaction Type Radio Selector */}
          <div className="form-group">
            <label>نوع العملية الحسابية *</label>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              
              {/* Deposit */}
              <label style={{ 
                flex: 1, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '0.5rem',
                padding: '1rem',
                border: `3px solid ${type === 'deposit' ? 'var(--success)' : 'var(--border)'}`,
                borderRadius: '12px',
                cursor: 'pointer',
                backgroundColor: type === 'deposit' ? 'rgba(22, 163, 74, 0.05)' : 'transparent',
                fontWeight: 'bold',
                fontSize: '20px'
              }}>
                <input 
                  type="radio" 
                  name="txType" 
                  value="deposit" 
                  checked={type === 'deposit'} 
                  onChange={() => { setType('deposit'); setCommission(''); }}
                  style={{ width: '20px', height: '20px' }}
                />
                إيداع (ينطيني فلوس)
              </label>

              {/* Withdrawal */}
              <label style={{ 
                flex: 1, 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                gap: '0.5rem',
                padding: '1rem',
                border: `3px solid ${type === 'withdrawal' ? 'var(--danger)' : 'var(--border)'}`,
                borderRadius: '12px',
                cursor: 'pointer',
                backgroundColor: type === 'withdrawal' ? 'rgba(220, 38, 38, 0.05)' : 'transparent',
                fontWeight: 'bold',
                fontSize: '20px'
              }}>
                <input 
                  type="radio" 
                  name="txType" 
                  value="withdrawal" 
                  checked={type === 'withdrawal'} 
                  onChange={() => setType('withdrawal')}
                  style={{ width: '20px', height: '20px' }}
                />
                سحب/حوالة (ياخذ)
              </label>

            </div>
          </div>

          {/* Amount Input */}
          <div className="form-group">
            <label style={{ fontSize: '20px' }}>المبلغ بالدينار العراقي *</label>
            <input
              type="text"
              className="form-input"
              style={{ fontSize: '26px', fontWeight: 'bold', letterSpacing: '0.5px' }}
              placeholder="0"
              value={amount}
              onChange={e => setAmount(formatNumberWithCommas(e.target.value))}
              required
            />
            {/* Big readable text for amount confirmation */}
            {amount && (
              <p style={{ 
                marginTop: '0.5rem', 
                fontSize: '22px', 
                fontWeight: '900', 
                color: type === 'deposit' ? 'var(--success)' : 'var(--danger)',
                backgroundColor: '#f8fafc',
                padding: '0.5rem',
                borderRadius: '8px',
                textAlign: 'center',
                border: '1px dashed var(--border)'
              }}>
                المبلغ المحدد: {getReadableAmountText()}
              </p>
            )}
          </div>

          {/* Commission Input (Only for withdrawals) */}
          {type === 'withdrawal' && (
            <div className="form-group">
              <label>عمولة الصراف (أرباحك من هذه العملية) *</label>
              <input
                type="text"
                className="form-input"
                placeholder="0"
                value={commission}
                onChange={e => setCommission(formatNumberWithCommas(e.target.value))}
              />
            </div>
          )}

          {/* Notes Input */}
          <div className="form-group">
            <label>ملاحظات حول العملية</label>
            <input
              type="text"
              className="form-input"
              placeholder="مثلاً: حوالة من بغداد، دفعة نقداً"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {/* Backdating: the default is now, but an operation from an earlier day
              can carry its real date so the daily reports stay true. */}
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useCustomDate}
                onChange={e => setUseCustomDate(e.target.checked)}
                style={{ width: '18px', height: '18px' }}
              />
              العملية بتاريخ سابق (وليس الآن)
            </label>

            {useCustomDate && (
              <input
                type="datetime-local"
                className="form-input"
                value={customDate}
                onChange={e => setCustomDate(e.target.value)}
                max={toLocalInputValue(new Date())}
                style={{ marginTop: '0.5rem', direction: 'ltr', textAlign: 'left' }}
              />
            )}
          </div>

          {/* Safety Checkbox for elderly users */}
          <div style={{ 
            backgroundColor: '#fffbeb', 
            border: '2px solid #f59e0b', 
            padding: '1rem', 
            borderRadius: '12px',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem'
          }}>
            <input
              type="checkbox"
              id="confirmCheck"
              checked={confirmCheckbox}
              onChange={e => setConfirmCheckbox(e.target.checked)}
              style={{ width: '24px', height: '24px', cursor: 'pointer', marginTop: '4px' }}
            />
            <label htmlFor="confirmCheck" style={{ fontSize: '18px', fontWeight: 'bold', color: '#b45309', cursor: 'pointer' }}>
              أؤكد أنني راجعت مبلغ العملية المكتوب باللون {type === 'deposit' ? 'الأخضر' : 'الأحمر'} وأنه صحيح 100% بدون أخطاء.
            </label>
          </div>

          {/* Form Actions */}
          <div className="modal-footer">
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={onClose}
              style={{ padding: '0.8rem 1.5rem' }}
            >
              إلغاء
            </button>
            <button 
              type="submit" 
              className={`btn ${type === 'deposit' ? 'btn-success' : 'btn-danger'}`}
              disabled={loading || !confirmCheckbox}
              style={{ padding: '0.8rem 2.5rem' }}
            >
              {type === 'deposit' ? 'إيداع المبلغ' : 'سحب المبلغ'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
