import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Wallet, ClipboardCheck, Save, Loader } from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * The office cash drawer.
 *
 * Customer balances tell you what the office owes; they do not tell you how much
 * money is actually in the drawer. That is what this screen answers, and the
 * count lets the owner compare the theoretical number against a physical count.
 */
export default function CashBox() {
  const [box, setBox] = useState(null);
  const [counts, setCounts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [openingInput, setOpeningInput] = useState('');
  const [savingOpening, setSavingOpening] = useState(false);

  const [countedInput, setCountedInput] = useState('');
  const [countNotes, setCountNotes] = useState('');
  const [savingCount, setSavingCount] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [boxData, countsData, settingsData] = await Promise.all([
        api.getCashBox(),
        api.getCashCounts(),
        api.getSettings()
      ]);
      setBox(boxData);
      setCounts(countsData);
      setSettings(settingsData);
      setOpeningInput(String(settingsData.openingCash ?? 0));
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const handleSaveOpening = async (e) => {
    e.preventDefault();
    setSavingOpening(true);
    setMessage('');
    try {
      await api.updateSettings({ openingCash: Number(openingInput) || 0 });
      setMessage('تم حفظ رأس المال الافتتاحي ✅');
      setTimeout(() => setMessage(''), 3000);
      await loadAll();
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setSavingOpening(false);
    }
  };

  const handleSaveCount = async (e) => {
    e.preventDefault();

    const counted = Number(countedInput);
    if (!Number.isFinite(counted) || counted < 0) {
      setMessage('خطأ: أدخل المبلغ المعدود بشكل صحيح');
      return;
    }

    setSavingCount(true);
    setMessage('');
    try {
      const record = await api.addCashCount(counted, countNotes);
      setCountedInput('');
      setCountNotes('');
      setMessage(
        record.difference === 0
          ? 'الجرد مطابق تماماً للمتوقع ✅'
          : `تم تسجيل الجرد. الفرق: ${fmt(record.difference)} د.ع ${record.difference > 0 ? '(زيادة)' : '(نقص)'}`
      );
      setTimeout(() => setMessage(''), 6000);
      await loadAll();
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setSavingCount(false);
    }
  };

  if (loading) {
    return (
      <div className="panel-card" style={{ textAlign: 'center', padding: '3rem' }}>
        <Loader className="spin" size={32} />
        <p style={{ color: 'var(--text-muted)' }}>جاري تحميل بيانات الصندوق...</p>
      </div>
    );
  }

  const difference = countedInput !== '' && box
    ? Number(countedInput) - box.expectedCash
    : null;

  return (
    <div>
      {message && (
        <div className={`toast ${message.includes('خطأ') ? 'toast-error' : 'toast-success'}`}>
          {message}
        </div>
      )}

      {/* The headline number */}
      <div className="panel-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <Wallet size={28} color="var(--primary)" />
          <h2 style={{ margin: 0 }}>صندوق المكتب</h2>
        </div>

        <div style={{
          padding: '1.5rem',
          borderRadius: '12px',
          textAlign: 'center',
          border: '2px solid var(--primary)',
          backgroundColor: 'rgba(8, 145, 178, 0.04)',
          marginBottom: '1.5rem'
        }}>
          <p style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)' }}>
            المفروض يكون بالصندوق الآن
          </p>
          <h2 style={{ margin: 0, fontSize: '34px', color: 'var(--primary)', fontWeight: 900 }}>
            {fmt(box?.expectedCash)} د.ع
          </h2>
        </div>

        {/* How that number is reached */}
        <div className="table-wrapper">
          <table className="app-table">
            <tbody>
              <tr>
                <td>رأس المال الافتتاحي</td>
                <td style={{ fontWeight: 'bold' }}>{fmt(box?.openingCash)} د.ع</td>
              </tr>
              <tr>
                <td>+ النقد الداخل (إيداعات الزبائن)</td>
                <td style={{ fontWeight: 'bold', color: 'var(--success)' }}>{fmt(box?.cashIn)} د.ع</td>
              </tr>
              <tr>
                <td>− النقد الخارج (سحوبات وحوالات)</td>
                <td style={{ fontWeight: 'bold', color: 'var(--danger)' }}>{fmt(box?.cashOut)} د.ع</td>
              </tr>
              <tr>
                <td>− المصاريف</td>
                <td style={{ fontWeight: 'bold', color: 'var(--danger)' }}>{fmt(box?.expensesTotal)} د.ع</td>
              </tr>
              <tr style={{ backgroundColor: 'var(--bg-light)' }}>
                <td style={{ fontWeight: 'bold' }}>= المتوقع</td>
                <td style={{ fontWeight: 900, color: 'var(--primary)' }}>{fmt(box?.expectedCash)} د.ع</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: 0 }}>
          العمولة ({fmt(box?.commission)} د.ع) غير مطروحة — لأنها لا تخرج من الصندوق أصلاً، تبقى ربحاً بداخله.
        </p>
      </div>

      {/* Opening capital */}
      <div className="panel-card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>رأس المال الافتتاحي</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          المبلغ الذي كان بالصندوق قبل تسجيل أول عملية بالنظام.
        </p>

        <form onSubmit={handleSaveOpening} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
            <input
              type="number"
              className="form-input"
              value={openingInput}
              onChange={e => setOpeningInput(e.target.value)}
              style={{ direction: 'ltr', textAlign: 'left' }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingOpening}>
            <Save size={18} />
            {savingOpening ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </form>
      </div>

      {/* Physical count */}
      <div className="panel-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <ClipboardCheck size={22} color="var(--accent)" />
          <h3 style={{ margin: 0 }}>جرد الصندوق</h3>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          عُدّ النقد الموجود فعلاً وأدخل المبلغ — النظام يسجّل الفرق ويحفظه.
        </p>

        <form onSubmit={handleSaveCount}>
          <div className="form-group">
            <label>المبلغ المعدود فعلياً (د.ع) *</label>
            <input
              type="number"
              className="form-input"
              value={countedInput}
              onChange={e => setCountedInput(e.target.value)}
              placeholder="مثال: 4500000"
              required
              min="0"
              style={{ direction: 'ltr', textAlign: 'left', fontSize: '20px' }}
            />
          </div>

          {difference !== null && Number.isFinite(difference) && (
            <div
              className="toast"
              style={{
                backgroundColor: difference === 0 ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)',
                color: difference === 0 ? 'var(--success)' : 'var(--danger)',
                borderColor: difference === 0 ? 'var(--success)' : 'var(--danger)'
              }}
            >
              {difference === 0
                ? 'مطابق تماماً للمتوقع'
                : `الفرق عن المتوقع: ${fmt(difference)} د.ع ${difference > 0 ? '(زيادة بالصندوق)' : '(نقص بالصندوق)'}`}
            </div>
          )}

          <div className="form-group">
            <label>ملاحظات</label>
            <input
              type="text"
              className="form-input"
              value={countNotes}
              onChange={e => setCountNotes(e.target.value)}
              placeholder="سبب الفرق إن وُجد..."
            />
          </div>

          <button type="submit" className="btn btn-success btn-block" disabled={savingCount}>
            {savingCount ? 'جاري التسجيل...' : 'تسجيل الجرد'}
          </button>
        </form>
      </div>

      {/* Count history */}
      <div className="panel-card">
        <h3 style={{ marginTop: 0 }}>سجل الجرد السابق</h3>

        {counts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>
            لا يوجد جرد مسجل بعد.
          </p>
        ) : (
          <div className="table-wrapper">
            <table className="app-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المعدود</th>
                  <th>المتوقع</th>
                  <th>الفرق</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {counts.map(count => (
                  <tr key={count.id}>
                    <td style={{ fontSize: '14px' }}>{new Date(count.at).toLocaleString('ar-EG')}</td>
                    <td style={{ fontWeight: 'bold' }}>{fmt(count.countedAmount)}</td>
                    <td>{fmt(count.expectedAmount)}</td>
                    <td style={{
                      fontWeight: 'bold',
                      color: count.difference === 0 ? 'var(--success)' : 'var(--danger)'
                    }}>
                      {count.difference === 0 ? 'مطابق' : fmt(count.difference)}
                    </td>
                    <td style={{ fontSize: '14px' }}>{count.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
