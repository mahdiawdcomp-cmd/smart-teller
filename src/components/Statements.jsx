import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import Modal from './Modal';
import { FileText, Send, Download, Calendar, User, ArrowLeft, Loader, Pencil, Trash2, History, RefreshCw, Receipt } from 'lucide-react';

/** Money as plain digits — no currency word repeated on every cell of a ledger. */
const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US');

/** Renders an audit-log snapshot as a short Arabic line. */
function describeAuditValue(value) {
  if (!value) return '—';

  if (typeof value.balance === 'number' && value.type === undefined) {
    return `الرصيد: ${value.balance.toLocaleString('en-US')} د.ع`;
  }

  const label = value.type === 'deposit' ? 'إيداع' : 'سحب';
  const total = (Number(value.amount) || 0) + (value.type === 'withdrawal' ? (Number(value.commission) || 0) : 0);
  const commission = Number(value.commission) || 0;

  return `${label} ${total.toLocaleString('en-US')} د.ع` +
    (commission > 0 ? ` (عمولة ${commission.toLocaleString('en-US')})` : '') +
    (value.notes ? ` — ${value.notes}` : '');
}

export default function Statements({ customer, onBack, onLedgerChanged, permissions = {} }) {
  const canEditLedger = permissions.canEditLedger !== false;
  const [filter, setFilter] = useState('all'); // 'all' | 'month' | 'prev_month' | 'custom'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filteredTransactions, setFilteredTransactions] = useState([]);
  
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadingSend, setLoadingSend] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  
  // Shared Link State
  const [isShared, setIsShared] = useState(customer?.isSharedLinkActive || false);
  const [sharedToken, setSharedToken] = useState(customer?.sharedToken || null);
  const [linkActionLoading, setLinkActionLoading] = useState(false);

  // Ledger editing state
  const [editingTx, setEditingTx] = useState(null); // the transaction being edited
  const [editForm, setEditForm] = useState({ type: 'deposit', amount: '', commission: '', notes: '' });
  const [ledgerBusy, setLedgerBusy] = useState(false);
  const [editError, setEditError] = useState('');

  // Audit trail state
  const [showAudit, setShowAudit] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  /**
   * The selected period as explicit bounds.
   *
   * The table and the PDF both read from here. When they each did their own
   * filtering, any difference between the two made the printed statement
   * disagree with the screen it was printed from.
   */
  const getPeriodBounds = () => {
    const now = new Date();

    if (filter === 'month') {
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
    }
    if (filter === 'prev_month') {
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      };
    }
    if (filter === 'custom') {
      const start = startDate ? new Date(startDate) : null;
      if (start) start.setHours(0, 0, 0, 0);
      const end = endDate ? new Date(endDate) : null;
      if (end) end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    return { start: null, end: null }; // 'all'
  };

  const inPeriod = (tx, bounds) => {
    const d = new Date(tx.date);
    if (bounds.start && d < bounds.start) return false;
    if (bounds.end && d > bounds.end) return false;
    return true;
  };

  // Apply filters
  useEffect(() => {
    if (!customer || !customer.transactions) return;

    const bounds = getPeriodBounds();
    setFilteredTransactions(customer.transactions.filter(t => inPeriod(t, bounds)));
  }, [customer, filter, startDate, endDate]);

  /** Signed effect of a transaction, matching the server's balanceDelta. */
  const deltaOf = (tx) => Number.isFinite(tx.balanceDelta)
    ? tx.balanceDelta
    : (tx.type === 'deposit' ? tx.amount : -(tx.amount + (tx.commission || 0)));

  /**
   * The period as a ledger: oldest first, each row carrying the balance as it
   * stood immediately after that operation.
   *
   * Read top to bottom the balance column tells the account's whole story, which
   * is the point of a ledger and what the previous table could not do — it
   * showed amounts with no running total, so the only way to check a balance was
   * to add the rows up by hand.
   *
   * The screen and the printed statement both read from here, so the paper can
   * never disagree with what it was printed from.
   */
  const buildLedger = () => {
    if (!customer || !customer.transactions) {
      return { opening: 0, rows: [], closing: 0, totalDebit: 0, totalCredit: 0 };
    }

    const bounds = getPeriodBounds();
    const chronological = [...customer.transactions].reverse();

    // Everything before the period, summed — not today's balance, which would be
    // wrong for any period that is not the present one.
    const opening = chronological
      .filter(tx => bounds.start && new Date(tx.date) < bounds.start)
      .reduce((sum, tx) => sum + deltaOf(tx), 0);

    let running = opening;
    let totalDebit = 0;
    let totalCredit = 0;

    const rows = chronological.filter(tx => inPeriod(tx, bounds)).map(tx => {
      const commission = Number(tx.commission) || 0;
      const isDeposit = tx.type === 'deposit';

      // Debit is what the customer owes us, credit what we owe them. A
      // withdrawal carries its commission: both leave the customer's balance.
      const debit = isDeposit ? 0 : Number(tx.amount) + commission;
      const credit = isDeposit ? Number(tx.amount) : 0;

      totalDebit += debit;
      totalCredit += credit;
      running += deltaOf(tx);

      return { ...tx, debit, credit, commission, runningBalance: running };
    });

    return { opening, rows, closing: running, totalDebit, totalCredit };
  };

  const ledger = buildLedger();

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

  // The printed statement is the same ledger the screen is showing.
  const getPdfPayload = () => {
    if (!customer || !customer.transactions) return null;

    const { opening: openingBalance, rows: filteredWithBal, closing: finalBalance } = ledger;

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

  // 4. Shared Link Management
  const handleToggleShare = async (enable) => {
    setLinkActionLoading(true);
    try {
      const res = await api.toggleShareLink(customer.id, enable);
      setIsShared(res.isSharedLinkActive);
      setSharedToken(res.sharedToken);
      setStatusMessage(enable ? 'تم تفعيل الرابط بنجاح! ✅' : 'تم إيقاف الرابط 🚫');
      setTimeout(() => setStatusMessage(''), 3000);
      
      // Update local customer object for UI consistency
      customer.isSharedLinkActive = res.isSharedLinkActive;
      customer.sharedToken = res.sharedToken;
    } catch (err) {
      setStatusMessage(`خطأ: ${err.message}`);
    } finally {
      setLinkActionLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!sharedToken) return;
    const link = `${window.location.origin}/?shared=${sharedToken}`;
    navigator.clipboard.writeText(link).then(() => {
      setStatusMessage('تم نسخ الرابط! يمكنك إرساله للزبون.');
      setTimeout(() => setStatusMessage(''), 3000);
    });
  };

  // 5. Ledger editing — every change goes through the server, which reverses the
  // old effect on the balance and applies the new one in one atomic step.
  const openEdit = (tx) => {
    setEditError('');
    setEditingTx(tx);
    setEditForm({
      type: tx.type,
      amount: String(tx.amount ?? ''),
      commission: String(tx.commission ?? ''),
      notes: tx.notes || ''
    });
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setEditError('');

    const amount = Number(editForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setEditError('المبلغ يجب أن يكون رقماً أكبر من صفر');
      return;
    }

    setLedgerBusy(true);
    try {
      await api.updateTransaction(customer.id, editingTx.id, {
        type: editForm.type,
        amount,
        commission: editForm.type === 'deposit' ? 0 : (Number(editForm.commission) || 0),
        notes: editForm.notes,
        date: editingTx.date // editing values, not moving the operation in time
      });

      setEditingTx(null);
      setStatusMessage('تم تعديل العملية وتصحيح الرصيد ✅');
      setTimeout(() => setStatusMessage(''), 3000);
      if (onLedgerChanged) await onLedgerChanged();
      if (showAudit) loadAuditLogs();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setLedgerBusy(false);
    }
  };

  const handleDeleteTx = async (tx) => {
    const total = tx.amount + (tx.type === 'withdrawal' ? (tx.commission || 0) : 0);
    const confirmText =
      `حذف هذه العملية نهائياً؟\n\n` +
      `${tx.type === 'deposit' ? 'إيداع' : 'سحب/حوالة'}: ${Number(total).toLocaleString('en-US')} د.ع\n` +
      `بتاريخ: ${new Date(tx.date).toLocaleString('ar-EG')}\n\n` +
      `سيتم تصحيح الرصيد تلقائياً، وسيبقى الحذف مسجلاً في سجل التدقيق.`;

    if (!window.confirm(confirmText)) return;

    setLedgerBusy(true);
    try {
      await api.deleteTransaction(customer.id, tx.id);
      setStatusMessage('تم حذف العملية وتصحيح الرصيد 🗑️');
      setTimeout(() => setStatusMessage(''), 3000);
      if (onLedgerChanged) await onLedgerChanged();
      if (showAudit) loadAuditLogs();
    } catch (err) {
      setStatusMessage(`خطأ: ${err.message}`);
    } finally {
      setLedgerBusy(false);
    }
  };

  // Rebuilds the balance from the ledger — the safety check that the stored
  // number still agrees with the operations behind it.
  const handleRecompute = async () => {
    setLedgerBusy(true);
    try {
      const res = await api.recomputeBalance(customer.id);
      setStatusMessage(
        res.drift === 0
          ? 'الرصيد مطابق تماماً لمجموع العمليات ✅'
          : `تم تصحيح الرصيد: من ${res.storedBalance.toLocaleString('en-US')} إلى ${res.computedBalance.toLocaleString('en-US')} د.ع`
      );
      setTimeout(() => setStatusMessage(''), 5000);
      if (onLedgerChanged) await onLedgerChanged();
    } catch (err) {
      setStatusMessage(`خطأ: ${err.message}`);
    } finally {
      setLedgerBusy(false);
    }
  };

  // 6. Receipt for one operation — proof the office can hand the customer.
  const handleReceipt = async (tx, send) => {
    setLedgerBusy(true);
    try {
      const res = await api.getReceipt(customer.id, tx.id, send);

      if (send && res.sent) {
        setStatusMessage('تم إرسال الوصل للزبون على الواتساب ✅');
      } else {
        triggerDownload(res.pdfBase64, `وصل_${customer.name.replace(/\s+/g, '_')}_${tx.id.slice(0, 6)}.pdf`);
        setStatusMessage('تم تنزيل الوصل 📥');
      }

      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err) {
      setStatusMessage(`خطأ: ${err.message}`);
    } finally {
      setLedgerBusy(false);
    }
  };

  const loadAuditLogs = async () => {
    setAuditLoading(true);
    try {
      setAuditLogs(await api.getAuditLogs(customer.id));
    } catch (err) {
      setStatusMessage(`خطأ في تحميل السجل: ${err.message}`);
    } finally {
      setAuditLoading(false);
    }
  };

  const toggleAudit = () => {
    const next = !showAudit;
    setShowAudit(next);
    if (next) loadAuditLogs();
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

      {/* A partial ledger would make the opening balance and every running total
          wrong, so it is never presented as if it were the full history. */}
      {customer.transactionsTruncated && (
        <div className="toast toast-error">
          تنبيه: هذا الزبون لديه عمليات أكثر مما يمكن عرضه دفعة واحدة. الكشف يعرض الأحدث فقط،
          والرصيد الافتتاحي المعروض في الـ PDF قد لا يشمل العمليات الأقدم.
        </div>
      )}

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

      {/* Shared Link Controls */}
      <div className="panel-card" style={{ marginBottom: '2rem', border: '1.5px solid var(--border-light)', backgroundColor: 'var(--bg-light)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              🔗 رابط الكشف المباشر للزبون
              {isShared ? (
                <span className="badge badge-deposit" style={{ fontSize: '12px' }}>نشط ويتم التحديث تلقائياً</span>
              ) : (
                <span className="badge badge-withdrawal" style={{ fontSize: '12px', backgroundColor: 'var(--text-muted)' }}>متوقف</span>
              )}
            </h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>
              شارك الرابط مع الزبون ليتمكن من رؤية كشف حسابه المحدث باستمرار عبر هاتفه.
            </p>
          </div>
          
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {isShared ? (
              <>
                <button 
                  className="btn btn-primary" 
                  onClick={handleCopyLink}
                >
                  نسخ الرابط
                </button>
                <button 
                  className="btn btn-danger" 
                  onClick={() => handleToggleShare(false)}
                  disabled={linkActionLoading}
                >
                  {linkActionLoading ? 'جاري...' : 'إيقاف الرابط'}
                </button>
              </>
            ) : (
              <button 
                className="btn btn-success" 
                onClick={() => handleToggleShare(true)}
                disabled={linkActionLoading}
              >
                {linkActionLoading ? 'جاري...' : 'إنشاء وتفعيل رابط'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Transactions Ledger Table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>جدول العمليات للفترة المحددة ({getPeriodText()})</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {canEditLedger && (
          <button className="btn btn-secondary" onClick={handleRecompute} disabled={ledgerBusy} style={{ padding: '0.5rem 1rem' }}>
            <RefreshCw size={16} />
            تدقيق الرصيد
          </button>
          )}
          {canEditLedger && (
          <button className="btn btn-secondary" onClick={toggleAudit} style={{ padding: '0.5rem 1rem' }}>
            <History size={16} />
            {showAudit ? 'إخفاء سجل التعديلات' : 'سجل التعديلات'}
          </button>
          )}
        </div>
      </div>

      {ledger.rows.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '3rem 0' }}>
          لا توجد عمليات مسجلة في هذه الفترة المحددة.
        </p>
      ) : (
        <div className="table-wrapper">
          <table className="app-table ledger-table cards-on-mobile">
            <thead>
              <tr>
                <th style={{ width: '130px' }}>التاريخ</th>
                <th>البيان</th>
                <th style={{ width: '130px' }}>مدين — عليه</th>
                <th style={{ width: '130px' }}>دائن — له</th>
                <th style={{ width: '140px' }}>الرصيد</th>
                <th style={{ width: '120px' }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {/* Where the period starts from. Without it the first balance in
                  the column would appear to come from nowhere. */}
              <tr className="ledger-opening">
                <td data-label="التاريخ">—</td>
                <td data-label="البيان" style={{ fontWeight: 700 }}>رصيد سابق (افتتاحي)</td>
                <td data-label="مدين">—</td>
                <td data-label="دائن">—</td>
                <td data-label="الرصيد" style={{ fontWeight: 800, color: ledger.opening >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {fmtMoney(ledger.opening)}
                </td>
                <td data-label=""></td>
              </tr>

              {ledger.rows.map((tx) => {
                return (
                  <tr key={tx.id}>
                    <td data-label="التاريخ" style={{ fontSize: '14px', whiteSpace: 'nowrap' }}>
                      {new Date(tx.date).toLocaleDateString('ar-EG')}
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>
                        {new Date(tx.date).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>

                    <td data-label="البيان" style={{ fontSize: '15px' }}>
                      {tx.notes || (tx.type === 'deposit' ? 'إيداع' : 'سحب / حوالة')}
                      {tx.commission > 0 && (
                        <span style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)' }}>
                          منها عمولة {fmtMoney(tx.commission)}
                        </span>
                      )}
                      {tx.editedAt && (
                        <span style={{ display: 'block', fontSize: '12px', color: 'var(--accent)' }}>
                          عُدّلت بتاريخ {new Date(tx.editedAt).toLocaleDateString('ar-EG')}
                        </span>
                      )}
                    </td>

                    <td data-label="مدين — عليه" style={{ fontWeight: 700, color: 'var(--danger)' }}>
                      {tx.debit ? fmtMoney(tx.debit) : '—'}
                    </td>

                    <td data-label="دائن — له" style={{ fontWeight: 700, color: 'var(--success)' }}>
                      {tx.credit ? fmtMoney(tx.credit) : '—'}
                    </td>

                    <td data-label="الرصيد" style={{
                      fontWeight: 800,
                      color: tx.runningBalance >= 0 ? 'var(--success)' : 'var(--danger)'
                    }}>
                      {fmtMoney(tx.runningBalance)}
                    </td>

                    <td data-label="">
                      <div className="action-group" style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleReceipt(tx, false)}
                          disabled={ledgerBusy}
                          title="تنزيل وصل العملية"
                          style={{ padding: '0.4rem 0.6rem' }}
                        >
                          <Receipt size={16} />
                        </button>
                        {customer.phone && (
                          <button
                            className="btn btn-success"
                            onClick={() => handleReceipt(tx, true)}
                            disabled={ledgerBusy}
                            title="إرسال الوصل للزبون بالواتساب"
                            style={{ padding: '0.4rem 0.6rem' }}
                          >
                            <Send size={16} />
                          </button>
                        )}
                        {canEditLedger && (
                          <>
                            <button
                              className="btn btn-secondary"
                              onClick={() => openEdit(tx)}
                              disabled={ledgerBusy}
                              title="تعديل العملية"
                              style={{ padding: '0.4rem 0.6rem' }}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              className="btn btn-danger"
                              onClick={() => handleDeleteTx(tx)}
                              disabled={ledgerBusy}
                              title="حذف العملية"
                              style={{ padding: '0.4rem 0.6rem' }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* The three numbers an accountant checks first. */}
            <tfoot>
              <tr className="ledger-total">
                <td data-label="" colSpan={2} style={{ fontWeight: 800 }}>الإجمالي</td>
                <td data-label="مجموع المدين" style={{ fontWeight: 800, color: 'var(--danger)' }}>
                  {fmtMoney(ledger.totalDebit)}
                </td>
                <td data-label="مجموع الدائن" style={{ fontWeight: 800, color: 'var(--success)' }}>
                  {fmtMoney(ledger.totalCredit)}
                </td>
                <td data-label="الرصيد النهائي" style={{
                  fontWeight: 900,
                  color: ledger.closing >= 0 ? 'var(--success)' : 'var(--danger)'
                }}>
                  {fmtMoney(ledger.closing)}
                </td>
                <td data-label=""></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Audit trail — what changed, and what the value was before */}
      {showAudit && (
        <div className="panel-card" style={{ marginTop: '2rem', backgroundColor: 'var(--bg-light)' }}>
          <h3 style={{ marginTop: 0 }}>سجل التعديلات والحذف</h3>

          {auditLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>جاري التحميل...</p>
          ) : auditLogs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>لا توجد تعديلات مسجلة على هذا الحساب.</p>
          ) : (
            <div className="table-wrapper">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الإجراء</th>
                    <th>قبل</th>
                    <th>بعد</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map(log => (
                    <tr key={log.id}>
                      <td style={{ fontSize: '14px' }}>{new Date(log.at).toLocaleString('ar-EG')}</td>
                      <td>
                        <span className={`badge ${log.action === 'delete' ? 'badge-withdrawal' : 'badge-deposit'}`}>
                          {log.action === 'create' && 'إضافة'}
                          {log.action === 'update' && 'تعديل'}
                          {log.action === 'delete' && 'حذف'}
                          {log.action === 'recompute' && 'تصحيح رصيد'}
                        </span>
                      </td>
                      <td style={{ fontSize: '14px' }}>{describeAuditValue(log.before)}</td>
                      <td style={{ fontSize: '14px' }}>{describeAuditValue(log.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Edit transaction modal */}
      {editingTx && (
        <Modal title="تعديل العملية" onClose={() => setEditingTx(null)}>

            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: 0 }}>
              بتاريخ {new Date(editingTx.date).toLocaleString('ar-EG')} — سيتم تصحيح الرصيد تلقائياً بعد الحفظ.
            </p>

            {editError && <div className="toast toast-error">{editError}</div>}

            <form onSubmit={handleSaveEdit}>
              <div className="form-group">
                <label>نوع العملية *</label>
                <select
                  className="form-input"
                  value={editForm.type}
                  onChange={e => setEditForm({ ...editForm, type: e.target.value })}
                >
                  <option value="deposit">إيداع (ينطيني)</option>
                  <option value="withdrawal">سحب/حوالة (ياخذ)</option>
                </select>
              </div>

              <div className="form-group">
                <label>المبلغ (د.ع) *</label>
                <input
                  type="number"
                  className="form-input"
                  value={editForm.amount}
                  onChange={e => setEditForm({ ...editForm, amount: e.target.value })}
                  required
                  min="1"
                  style={{ direction: 'ltr', textAlign: 'left' }}
                />
              </div>

              {editForm.type === 'withdrawal' && (
                <div className="form-group">
                  <label>العمولة (د.ع)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={editForm.commission}
                    onChange={e => setEditForm({ ...editForm, commission: e.target.value })}
                    min="0"
                    style={{ direction: 'ltr', textAlign: 'left' }}
                  />
                </div>
              )}

              <div className="form-group">
                <label>الملاحظات</label>
                <input
                  type="text"
                  className="form-input"
                  value={editForm.notes}
                  onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingTx(null)} disabled={ledgerBusy}>
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary" disabled={ledgerBusy}>
                  {ledgerBusy ? 'جاري الحفظ...' : 'حفظ التعديل'}
                </button>
              </div>
            </form>
        </Modal>
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
