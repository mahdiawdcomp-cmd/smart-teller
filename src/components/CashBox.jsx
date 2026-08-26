import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import {
  Wallet, ClipboardCheck, Save, Loader, TrendingUp, TrendingDown,
  Receipt, Calculator, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle
} from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * Notes in circulation, largest first — the order a teller stacks them in.
 * Counting by denomination instead of typing one total is how a real drawer is
 * counted: the arithmetic stops being a source of error, and a miscount points
 * at which stack to recheck.
 */
const DENOMINATIONS = [50000, 25000, 10000, 5000, 1000, 500, 250];

const todayRange = () => {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
};

/** One number with a label, used for the day's four figures. */
function Tile({ icon: Icon, label, value, color }) {
  return (
    <div style={{
      flex: '1 1 140px', minWidth: '140px',
      backgroundColor: 'var(--bg-light)', borderRadius: '12px',
      padding: '0.9rem', border: '1px solid var(--border-light)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.4rem' }}>
        <Icon size={16} color={color} />
        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div style={{ fontSize: '18px', fontWeight: 800, color, direction: 'ltr', textAlign: 'right' }}>
        {fmt(value)}
      </div>
    </div>
  );
}

/**
 * The office cash drawer.
 *
 * Customer balances say what the office owes; they do not say how much money is
 * physically in the drawer. That is the question this screen answers, and the
 * count is what proves the answer is true.
 */
export default function CashBox() {
  const [box, setBox] = useState(null);
  const [today, setToday] = useState(null);
  const [counts, setCounts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showOpening, setShowOpening] = useState(false);

  const [openingInput, setOpeningInput] = useState('');
  const [savingOpening, setSavingOpening] = useState(false);

  // Counting mode: either type a total, or tally the notes.
  const [countMode, setCountMode] = useState('notes'); // 'notes' | 'total'
  const [noteCounts, setNoteCounts] = useState({});
  const [totalInput, setTotalInput] = useState('');
  const [countNotes, setCountNotes] = useState('');
  const [savingCount, setSavingCount] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const range = todayRange();
      const [boxData, todayData, countsData, settingsData] = await Promise.all([
        api.getCashBox(),
        api.getCashBox(range),
        api.getCashCounts(),
        api.getSettings()
      ]);
      setBox(boxData);
      setToday(todayData);
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

  // The counted total: either summed from the note tally, or typed directly.
  const countedTotal = countMode === 'notes'
    ? DENOMINATIONS.reduce((sum, note) => sum + note * (Number(noteCounts[note]) || 0), 0)
    : (Number(totalInput) || 0);

  const hasCounted = countMode === 'notes'
    ? DENOMINATIONS.some(n => Number(noteCounts[n]) > 0)
    : totalInput !== '';

  const difference = box && hasCounted ? countedTotal - box.expectedCash : null;

  const handleSaveOpening = async (e) => {
    e.preventDefault();
    setSavingOpening(true);
    setMessage('');
    try {
      await api.updateSettings({ openingCash: Number(openingInput) || 0 });
      setMessage('تم حفظ رأس المال الافتتاحي ✅');
      setTimeout(() => setMessage(''), 3000);
      setShowOpening(false);
      await loadAll();
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setSavingOpening(false);
    }
  };

  const handleSaveCount = async (e) => {
    e.preventDefault();

    if (!hasCounted) {
      setMessage('خطأ: أدخل المبلغ المعدود أولاً');
      return;
    }

    // A count with a gap is worth recording, but not by accident.
    if (difference !== 0) {
      const word = difference > 0 ? 'زيادة' : 'نقص';
      const confirmed = window.confirm(
        `الفرق عن المتوقع: ${fmt(difference)} د.ع (${word})\n\n` +
        `المعدود: ${fmt(countedTotal)} د.ع\n` +
        `المتوقع: ${fmt(box.expectedCash)} د.ع\n\n` +
        `هل تريد تسجيل الجرد بهذا الفرق؟`
      );
      if (!confirmed) return;
    }

    setSavingCount(true);
    setMessage('');
    try {
      const detail = countMode === 'notes'
        ? DENOMINATIONS
            .filter(n => Number(noteCounts[n]) > 0)
            .map(n => `${fmt(n)}×${noteCounts[n]}`)
            .join('، ')
        : '';

      const record = await api.addCashCount(
        countedTotal,
        [countNotes, detail].filter(Boolean).join(' | ')
      );

      setNoteCounts({});
      setTotalInput('');
      setCountNotes('');
      setMessage(
        record.difference === 0
          ? 'الجرد مطابق تماماً للمتوقع ✅'
          : `تم تسجيل الجرد. الفرق: ${fmt(record.difference)} د.ع`
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

  const lastCount = counts[0];

  return (
    <div>
      {message && (
        <div className={`toast ${message.includes('خطأ') ? 'toast-error' : 'toast-success'}`}>
          {message}
        </div>
      )}

      {/* ─── 1. The number that matters ─── */}
      <div className="panel-card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
          <Wallet size={24} color="var(--primary)" />
          <h2 style={{ margin: 0, fontSize: '20px' }}>صندوق المكتب</h2>
        </div>

        <div style={{
          padding: '1.6rem 1rem',
          borderRadius: '14px',
          textAlign: 'center',
          border: '2px solid var(--primary)',
          backgroundColor: 'rgba(8, 145, 178, 0.05)'
        }}>
          <p style={{ margin: '0 0 0.5rem 0', color: 'var(--text-muted)', fontSize: '15px' }}>
            المفروض يكون بالصندوق الآن
          </p>
          <div style={{ fontSize: '38px', color: 'var(--primary)', fontWeight: 900, direction: 'ltr', lineHeight: 1.2 }}>
            {fmt(box?.expectedCash)}
          </div>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--primary)', fontSize: '15px' }}>دينار عراقي</p>
        </div>

        {/* Last count, as a health indicator */}
        {lastCount ? (
          <div style={{
            marginTop: '0.9rem', padding: '0.75rem 0.9rem', borderRadius: '10px',
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            backgroundColor: lastCount.difference === 0 ? 'rgba(22,163,74,.08)' : 'rgba(217,119,6,.09)',
            border: `1px solid ${lastCount.difference === 0 ? 'var(--success)' : 'var(--accent)'}`
          }}>
            {lastCount.difference === 0
              ? <CheckCircle2 size={20} color="var(--success)" />
              : <AlertTriangle size={20} color="var(--accent)" />}
            <div style={{ fontSize: '14px', lineHeight: 1.6 }}>
              <strong>آخر جرد:</strong> {new Date(lastCount.at).toLocaleString('ar-EG')}
              <br />
              {lastCount.difference === 0
                ? 'كان مطابقاً تماماً'
                : `كان فيه ${lastCount.difference > 0 ? 'زيادة' : 'نقص'} بمقدار ${fmt(Math.abs(lastCount.difference))} د.ع`}
            </div>
          </div>
        ) : (
          <div className="toast" style={{
            marginTop: '0.9rem',
            backgroundColor: 'rgba(217,119,6,.09)', color: 'var(--accent)', borderColor: 'var(--accent)'
          }}>
            لم تسجّل أي جرد بعد. الرقم أعلاه محسوب من العمليات — الجرد هو اللي يثبت إنه صحيح.
          </div>
        )}
      </div>

      {/* ─── 2. Today ─── */}
      <div className="panel-card" style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.9rem', fontSize: '17px' }}>حركة اليوم</h3>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
          <Tile icon={TrendingUp}   label="داخل"   value={today?.cashIn}       color="var(--success)" />
          <Tile icon={TrendingDown} label="خارج"   value={today?.cashOut}      color="var(--danger)" />
          <Tile icon={Receipt}      label="عمولات" value={today?.commission}   color="var(--primary)" />
          <Tile icon={TrendingDown} label="مصاريف" value={today?.expensesTotal} color="var(--danger)" />
        </div>

        <p style={{
          marginTop: '0.9rem', marginBottom: 0, fontSize: '15px',
          color: (today?.commission - today?.expensesTotal) >= 0 ? 'var(--success)' : 'var(--danger)'
        }}>
          ربح اليوم: <strong>{fmt((today?.commission || 0) - (today?.expensesTotal || 0))} د.ع</strong>
        </p>
      </div>

      {/* ─── 3. Count the drawer ─── */}
      <div className="panel-card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
          <ClipboardCheck size={22} color="var(--accent)" />
          <h3 style={{ margin: 0, fontSize: '17px' }}>جرد الصندوق</h3>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: 0 }}>
          عُدّ النقد الموجود فعلاً، والنظام يقارنه بالمتوقع ويحفظ الفرق.
        </p>

        {/* Mode switch */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            type="button"
            className={`btn ${countMode === 'notes' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setCountMode('notes')}
            style={{ flex: 1, padding: '0.6rem' }}
          >
            <Calculator size={17} />
            عدّ الأوراق
          </button>
          <button
            type="button"
            className={`btn ${countMode === 'total' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setCountMode('total')}
            style={{ flex: 1, padding: '0.6rem' }}
          >
            المبلغ كاملاً
          </button>
        </div>

        <form onSubmit={handleSaveCount}>
          {countMode === 'notes' ? (
            <div style={{ marginBottom: '1rem' }}>
              {DENOMINATIONS.map(note => {
                const qty = Number(noteCounts[note]) || 0;
                return (
                  <div
                    key={note}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.6rem',
                      padding: '0.5rem 0', borderBottom: '1px solid var(--border-light)'
                    }}
                  >
                    <span style={{
                      width: '78px', fontWeight: 700, fontSize: '15px',
                      direction: 'ltr', textAlign: 'right'
                    }}>
                      {fmt(note)}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>×</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      className="form-input"
                      value={noteCounts[note] ?? ''}
                      onChange={e => setNoteCounts({ ...noteCounts, [note]: e.target.value })}
                      placeholder="0"
                      min="0"
                      style={{
                        flex: 1, minWidth: 0, padding: '0.5rem',
                        direction: 'ltr', textAlign: 'center', fontSize: '17px'
                      }}
                    />
                    <span style={{
                      width: '95px', fontSize: '14px', color: qty ? 'var(--text-main)' : 'var(--text-muted)',
                      direction: 'ltr', textAlign: 'left', fontWeight: qty ? 700 : 400
                    }}>
                      {fmt(note * qty)}
                    </span>
                  </div>
                );
              })}

              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingTop: '0.8rem', fontSize: '18px', fontWeight: 800
              }}>
                <span>المجموع المعدود</span>
                <span style={{ color: 'var(--primary)', direction: 'ltr' }}>{fmt(countedTotal)} د.ع</span>
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label>المبلغ المعدود فعلياً (د.ع)</label>
              <input
                type="number"
                inputMode="numeric"
                className="form-input"
                value={totalInput}
                onChange={e => setTotalInput(e.target.value)}
                placeholder="مثال: 4500000"
                min="0"
                style={{ direction: 'ltr', textAlign: 'left', fontSize: '20px' }}
              />
            </div>
          )}

          {/* Live difference, before anything is saved */}
          {difference !== null && (
            <div
              style={{
                padding: '0.9rem', borderRadius: '10px', marginBottom: '1rem', textAlign: 'center',
                backgroundColor: difference === 0 ? 'rgba(22,163,74,.09)' : 'rgba(220,38,38,.08)',
                border: `1.5px solid ${difference === 0 ? 'var(--success)' : 'var(--danger)'}`
              }}
            >
              {difference === 0 ? (
                <strong style={{ color: 'var(--success)', fontSize: '16px' }}>
                  مطابق تماماً للمتوقع ✅
                </strong>
              ) : (
                <>
                  <div style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    الفرق عن المتوقع
                  </div>
                  <strong style={{ color: 'var(--danger)', fontSize: '20px', direction: 'ltr', display: 'block' }}>
                    {fmt(difference)} د.ع
                  </strong>
                  <div style={{ fontSize: '14px', color: 'var(--danger)', marginTop: '0.2rem' }}>
                    {difference > 0 ? 'زيادة بالصندوق' : 'نقص بالصندوق'}
                  </div>
                </>
              )}
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

          <button
            type="submit"
            className="btn btn-success btn-block"
            disabled={savingCount || !hasCounted}
            style={{ minHeight: '52px' }}
          >
            {savingCount ? 'جاري التسجيل...' : 'تسجيل الجرد'}
          </button>
        </form>
      </div>

      {/* ─── 4. How the expected figure is reached ─── */}
      <div className="panel-card" style={{ marginBottom: '1.25rem' }}>
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
          style={{
            width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: 0, color: 'var(--text-main)', fontSize: '17px', fontWeight: 700, minHeight: '44px'
          }}
        >
          <span>كيف حُسب هذا الرقم؟</span>
          {showBreakdown ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>

        {showBreakdown && (
          <>
            <div className="table-wrapper" style={{ marginTop: '0.9rem' }}>
              <table className="app-table">
                <tbody>
                  <tr>
                    <td>رأس المال الافتتاحي</td>
                    <td style={{ fontWeight: 700, direction: 'ltr', textAlign: 'left' }}>{fmt(box?.openingCash)}</td>
                  </tr>
                  <tr>
                    <td>+ النقد الداخل (إيداعات)</td>
                    <td style={{ fontWeight: 700, color: 'var(--success)', direction: 'ltr', textAlign: 'left' }}>{fmt(box?.cashIn)}</td>
                  </tr>
                  <tr>
                    <td>− النقد الخارج (سحوبات وحوالات)</td>
                    <td style={{ fontWeight: 700, color: 'var(--danger)', direction: 'ltr', textAlign: 'left' }}>{fmt(box?.cashOut)}</td>
                  </tr>
                  <tr>
                    <td>− المصاريف</td>
                    <td style={{ fontWeight: 700, color: 'var(--danger)', direction: 'ltr', textAlign: 'left' }}>{fmt(box?.expensesTotal)}</td>
                  </tr>
                  <tr style={{ backgroundColor: 'var(--bg-light)' }}>
                    <td style={{ fontWeight: 700 }}>= المتوقع بالصندوق</td>
                    <td style={{ fontWeight: 900, color: 'var(--primary)', direction: 'ltr', textAlign: 'left' }}>{fmt(box?.expectedCash)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '13.5px', lineHeight: 1.8, marginBottom: 0 }}>
              العمولة ({fmt(box?.commission)} د.ع) غير مطروحة — لأنها لا تخرج من الصندوق أصلاً،
              تبقى بداخله كربح. لذلك المعادلة تبقى صحيحة دائماً:
              <br />
              <span style={{ color: 'var(--text-main)' }}>
                الصندوق = أرصدة الزبائن + الأرباح + رأس المال
              </span>
            </p>

            <button
              onClick={() => setShowOpening(!showOpening)}
              className="btn btn-secondary"
              style={{ marginTop: '0.9rem' }}
            >
              تعديل رأس المال الافتتاحي
            </button>

            {showOpening && (
              <form onSubmit={handleSaveOpening} style={{ marginTop: '0.9rem' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '13.5px' }}>
                  المبلغ الذي كان بالصندوق قبل تسجيل أول عملية بالنظام.
                </p>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <input
                    type="number"
                    inputMode="numeric"
                    className="form-input"
                    value={openingInput}
                    onChange={e => setOpeningInput(e.target.value)}
                    style={{ flex: 1, minWidth: '160px', direction: 'ltr', textAlign: 'left' }}
                  />
                  <button type="submit" className="btn btn-primary" disabled={savingOpening}>
                    <Save size={18} />
                    {savingOpening ? 'جاري الحفظ...' : 'حفظ'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>

      {/* ─── 5. History ─── */}
      <div className="panel-card">
        <h3 style={{ marginTop: 0, fontSize: '17px' }}>سجل الجرد</h3>

        {counts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>
            لا يوجد جرد مسجل بعد.
          </p>
        ) : (
          <div className="table-wrapper">
            <table className="app-table cards-on-mobile">
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
                    <td data-label="التاريخ" style={{ fontSize: '14px' }}>
                      {new Date(count.at).toLocaleString('ar-EG')}
                    </td>
                    <td data-label="المعدود" style={{ fontWeight: 700, direction: 'ltr', textAlign: 'left' }}>
                      {fmt(count.countedAmount)}
                    </td>
                    <td data-label="المتوقع" style={{ direction: 'ltr', textAlign: 'left' }}>
                      {fmt(count.expectedAmount)}
                    </td>
                    <td data-label="الفرق" style={{
                      fontWeight: 700, direction: 'ltr', textAlign: 'left',
                      color: count.difference === 0 ? 'var(--success)' : 'var(--danger)'
                    }}>
                      {count.difference === 0 ? 'مطابق' : fmt(count.difference)}
                    </td>
                    <td data-label="ملاحظات" style={{ fontSize: '13.5px' }}>{count.notes || '-'}</td>
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
