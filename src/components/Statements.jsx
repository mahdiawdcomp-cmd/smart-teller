import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { FileText, Send, Download, Calendar, User, ArrowLeft, Loader } from 'lucide-react';

export default function Statements({ customer, onBack }) {
  const [filter, setFilter] = useState('all'); // 'all' | 'month' | 'prev_month' | 'custom'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filteredTransactions, setFilteredTransactions] = useState([]);
  
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadingSend, setLoadingSend] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Apply filters
  useEffect(() => {
    if (!customer || !customer.transactions) return;

    let txs = [...customer.transactions];
    const now = new Date();

    if (filter === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      txs = txs.filter(t => new Date(t.date) >= startOfMonth);
    } else if (filter === 'prev_month') {
      const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      txs = txs.filter(t => {
        const d = new Date(t.date);
        return d >= startOfPrevMonth && d <= endOfPrevMonth;
      });
    } else if (filter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        txs = txs.filter(t => new Date(t.date) >= start);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        txs = txs.filter(t => new Date(t.date) <= end);
      }
    }

    setFilteredTransactions(txs);
  }, [customer, filter, startDate, endDate]);

  // Format date range text in Arabic
  const getPeriodText = () => {
    const now = new Date();
    if (filter === 'all') return 'كامل المدة الحسابية';
    if (filter === 'month') {
      return `شهر ${now.toLocaleString('ar-EG-u-nu-latn', { month: 'long' })} ${now.getFullYear()}`;
    }
    if (filter === 'prev_month') {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `الشهر السابق: ${prev.toLocaleString('ar-EG-u-nu-latn', { month: 'long' })} ${prev.getFullYear()}`;
    }
    if (filter === 'custom') {
      return `من ${startDate || 'البداية'} إلى ${endDate || 'اليوم'}`;
    }
    return '';
  };

  // Helper to trigger local browser download from base64 PDF
  const triggerDownload = (base64, filename) => {
    const linkSource = `data:application/pdf;base64,${base64}`;
    const downloadLink = document.createElement("a");
    downloadLink.href = linkSource;
    downloadLink.download = filename;
    downloadLink.click();
  };

  // Helper to construct the chronological PDF payload with running balances
  const getPdfPayload = () => {
    if (!customer || !customer.transactions) return null;
    
    // Reverse array to sort oldest to newest (chronological order)
    const chronologicalTxs = [...customer.transactions].reverse();
    
    let currentBal = 0;
    const txsWithBal = chronologicalTxs.map(tx => {
      const change = tx.type === 'deposit' ? tx.amount : -(tx.amount + (tx.commission || 0));
      currentBal += change;
      return { ...tx, runningBalance: currentBal };
    });
    
    let filteredWithBal = [...txsWithBal];
    const now = new Date();
    if (filter === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      filteredWithBal = filteredWithBal.filter(t => new Date(t.date) >= startOfMonth);
    } else if (filter === 'prev_month') {
      const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      filteredWithBal = filteredWithBal.filter(t => {
        const d = new Date(t.date);
        return d >= startOfPrevMonth && d <= endOfPrevMonth;
      });
    } else if (filter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filteredWithBal = filteredWithBal.filter(t => new Date(t.date) >= start);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filteredWithBal = filteredWithBal.filter(t => new Date(t.date) <= end);
      }
    }
    
    let openingBalance = 0;
    if (filteredWithBal.length > 0) {
      const firstFilteredTx = filteredWithBal[0];
      const firstIdx = txsWithBal.findIndex(t => t.id === firstFilteredTx.id);
      if (firstIdx > 0) {
        openingBalance = txsWithBal[firstIdx - 1].runningBalance;
      }
    } else {
      openingBalance = customer.balance;
    }
    
    const finalBalance = filteredWithBal.length > 0 
      ? filteredWithBal[filteredWithBal.length - 1].runningBalance 
      : openingBalance;
      
    return {
      customerName: customer.name,
      transactions: filteredWithBal,
      openingBalance,
      finalBalance,
      periodText: getPeriodText(),
      balance: customer.balance
    };
  };

  // 1. Download PDF locally
  const handleDownloadPdf = async () => {
    setLoadingPdf(true);
    setStatusMessage('');
    try {
      const payload = getPdfPayload();
      if (!payload) return;

      const res = await api.generatePdf(payload);
      
      const filename = `كشف_حساب_${customer.name.replace(/\s+/g, '_')}_${filter}.pdf`;
      triggerDownload(res.pdfBase64, filename);
      setStatusMessage('تم تحميل الكشف بنجاح! 📥');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      setStatusMessage(`خطأ في توليد الملف: ${err.message}`);
    } finally {
      setLoadingPdf(false);
    }
  };

  // 2. Fully Automatic Send via connected WhatsApp Bot
  const handleSendAutomatic = async () => {
    if (!customer.phone) {
      setStatusMessage('خطأ: لا يوجد رقم هاتف مسجل لهذا الزبون');
      return;
    }

    if (!window.confirm(`هل أنت متأكد من رغبتك في إرسال كشف PDF لـ ${customer.name} تلقائياً الآن؟`)) return;

    setLoadingSend(true);
    setStatusMessage('');
    try {
      const payload = getPdfPayload();
      if (!payload) return;

      // 1. Generate PDF
      const pdfRes = await api.generatePdf(payload);

      // 2. Send via WhatsApp Bot API
      await api.sendStatement({
        phoneNumber: customer.phone,
        pdfBase64: pdfRes.pdfBase64,
        customerName: customer.name,
        periodText: getPeriodText()
      });

      setStatusMessage('تم إرسال كشف الحساب كملف PDF تلقائياً بنجاح! 🚀✅');
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err) {
      setStatusMessage(`خطأ في الإرسال: ${err.message}`);
    } finally {
      setLoadingSend(false);
    }
  };

  // 3. Quick Text Summary via manual WhatsApp link (Backup)
  const handleSendManualText = () => {
    if (!customer.phone) {
      setStatusMessage('خطأ: لا يوجد رقم هاتف مسجل لهذا الزبون');
      return;
    }

    const periodText = getPeriodText();
    const formattedBalance = Number(customer.balance).toLocaleString('en-US') + ' د.ع';
    
    // Format Arabic message
    const messageText = `مرحباً زبوننا العزيز ${customer.name}،\n\nإليك ملخص حسابك المالي للفترة (${periodText}):\n\nرصيدك الحالي المتبقي هو: *${formattedBalance}*\n\nتطبيق حساب الصراف الذكي 🏦`;
    
    let cleanNumber = customer.phone.replace(/[^0-9]/g, '');
    if (!cleanNumber.startsWith('964') && cleanNumber.startsWith('0')) {
      cleanNumber = '964' + cleanNumber.substring(1);
    }
    
    const waUrl = `https://api.whatsapp.com/send?phone=${cleanNumber}&text=${encodeURIComponent(messageText)}`;
    window.open(waUrl, '_blank');
  };

  // Calculate totals for selected filtered transactions
  const totalDeposits = filteredTransactions
    .filter(t => t.type === 'deposit')
    .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

  const totalWithdrawals = filteredTransactions
    .filter(t => t.type === 'withdrawal')
    .reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);

  const customerProfit = filteredTransactions
    .reduce((sum, t) => sum + (parseFloat(t.commission || 0)), 0);

  return (
    <div className="panel-card">
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button onClick={onBack} className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }}>
            <ArrowLeft size={20} />
            رجوع
          </button>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <User size={24} />
            كشف حساب: {customer.name}
          </h2>
        </div>
        <div style={{ fontSize: '18px', color: 'var(--text-muted)' }}>
          الهاتف: {customer.phone || 'غير مسجل'}
        </div>
      </div>

      {statusMessage && (
        <div className={`toast ${statusMessage.includes('خطأ') ? 'toast-error' : 'toast-success'}`}>
          {statusMessage}
        </div>
      )}

      {/* Stats Summary for Period */}
      <div className="dashboard-grid" style={{ marginBottom: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="stat-card" style={{ padding: '1.25rem 1rem' }}>
          <div className="stat-info">
            <h3>مجموع المقبوضات (له)</h3>
            <p style={{ color: 'var(--success)', fontSize: '22px', fontWeight: 'bold' }}>
              {totalDeposits.toLocaleString('en-US')} د.ع
            </p>
          </div>
        </div>
        <div className="stat-card" style={{ padding: '1.25rem 1rem' }}>
          <div className="stat-info">
            <h3>مجموع المسحوبات (عليه)</h3>
            <p style={{ color: 'var(--danger)', fontSize: '22px', fontWeight: 'bold' }}>
              {totalWithdrawals.toLocaleString('en-US')} د.ع
            </p>
          </div>
        </div>
        <div className="stat-card" style={{ padding: '1.25rem 1rem' }}>
          <div className="stat-info">
            <h3>أرباح الصراف من الزبون</h3>
            <p style={{ color: 'var(--primary)', fontSize: '22px', fontWeight: 'bold' }}>
              {customerProfit.toLocaleString('en-US')} د.ع
            </p>
          </div>
        </div>
        <div className="stat-card" style={{ 
          padding: '1.25rem 1rem', 
          border: `2px solid ${(customer.balance || 0) >= 0 ? 'var(--success)' : 'var(--danger)'}`,
          backgroundColor: (customer.balance || 0) >= 0 ? 'rgba(22, 163, 74, 0.02)' : 'rgba(220, 38, 38, 0.02)'
        }}>
          <div className="stat-info">
            <h3>الرصيد الفعلي الحالي</h3>
            <p style={{ 
              color: (customer.balance || 0) >= 0 ? 'var(--success)' : 'var(--danger)', 
              fontSize: '22px', 
              fontWeight: '900' 
            }}>
              {Number(customer.balance || 0).toLocaleString('en-US')} د.ع
              <span style={{ fontSize: '14px', marginRight: '5px', fontWeight: 'bold' }}>
                ({(customer.balance || 0) >= 0 ? 'له' : 'عليه'})
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Date Filter Buttons */}
      <div className="ledger-header">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button 
            className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('all')}
            style={{ padding: '0.6rem 1rem', fontSize: '16px' }}
          >
            كامل المدة
          </button>
          <button 
            className={`btn ${filter === 'month' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('month')}
            style={{ padding: '0.6rem 1rem', fontSize: '16px' }}
          >
            الشهر الحالي
          </button>
          <button 
            className={`btn ${filter === 'prev_month' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('prev_month')}
            style={{ padding: '0.6rem 1rem', fontSize: '16px' }}
          >
            الشهر السابق
          </button>
          <button 
            className={`btn ${filter === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setFilter('custom')}
            style={{ padding: '0.6rem 1rem', fontSize: '16px' }}
          >
            فترة مخصصة 📅
          </button>
        </div>

        {filter === 'custom' && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input 
              type="date" 
              className="form-input" 
              value={startDate} 
              onChange={e => setStartDate(e.target.value)}
              style={{ padding: '0.4rem', fontSize: '16px', width: '150px' }}
            />
            <span>إلى</span>
            <input 
              type="date" 
              className="form-input" 
              value={endDate} 
              onChange={e => setEndDate(e.target.value)}
              style={{ padding: '0.4rem', fontSize: '16px', width: '150px' }}
            />
          </div>
        )}
      </div>

      {/* Dispatch Action Buttons */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
        
        {/* Download PDF button */}
        <button 
          className="btn btn-primary" 
          onClick={handleDownloadPdf}
          disabled={loadingPdf}
          style={{ flex: 1, padding: '0.85rem' }}
        >
          {loadingPdf ? <Loader className="spin" size={20} /> : <Download size={20} />}
          تنزيل كشف PDF على الجهاز
        </button>

        {/* Fully Automatic PDF Bot send */}
        <button 
          className="btn btn-success" 
          onClick={handleSendAutomatic}
          disabled={loadingSend}
          style={{ flex: 1, padding: '0.85rem' }}
        >
          {loadingSend ? <Loader className="spin" size={20} /> : <Send size={20} />}
          إرسال كملف PDF تلقائياً (واتساب)
        </button>

        {/* Fast Text Manual Send */}
        <button 
          className="btn btn-secondary" 
          onClick={handleSendManualText}
          style={{ flex: 1, padding: '0.85rem', backgroundColor: '#075e54' }}
        >
          <Send size={20} />
          إرسال ملخص نصي سريع (واتساب)
        </button>
        
      </div>

      {/* Transactions Ledger Table */}
      <h3>جدول العمليات للفترة المحددة ({getPeriodText()})</h3>
      
      {filteredTransactions.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '3rem 0' }}>
          لا توجد عمليات مسجلة في هذه الفترة المحددة.
        </p>
      ) : (
        <div className="table-wrapper">
          <table className="app-table">
            <thead>
              <tr>
                <th>التاريخ والوقت</th>
                <th>نوع العملية</th>
                <th>المبلغ الإجمالي (د.ع)</th>
                <th>الملاحظات</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx) => {
                const totalAmount = tx.amount + (tx.type === 'withdrawal' ? (tx.commission || 0) : 0);
                const displayNotes = tx.type === 'withdrawal' && tx.commission > 0
                  ? `${tx.notes || ''} (العمولة: ${tx.commission.toLocaleString('en-US')} د.ع)`
                  : (tx.notes || '-');

                return (
                  <tr key={tx.id}>
                    <td style={{ fontSize: '15px' }}>
                      {new Date(tx.date).toLocaleString('ar-EG')}
                    </td>
                    <td>
                      <span className={`badge ${tx.type === 'deposit' ? 'badge-deposit' : 'badge-withdrawal'}`}>
                        {tx.type === 'deposit' ? 'إيداع (ينطيني)' : 'سحب/حوالة (ياخذ)'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 'bold', color: tx.type === 'deposit' ? 'var(--success)' : 'var(--danger)' }}>
                      {Number(totalAmount).toLocaleString('en-US')} د.ع
                    </td>
                    <td style={{ fontSize: '16px', color: 'var(--text-dark)' }}>
                      {displayNotes}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
