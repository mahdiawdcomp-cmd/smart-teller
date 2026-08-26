import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { BellRing, Send, Loader, Save, ChevronDown, ChevronUp } from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * Debt reminders.
 *
 * A negative balance is the office lending money, and it stops being collected
 * the moment it stops being visible. This shows who owes what right now, and
 * sends the owner that list on a schedule they choose.
 *
 * The reminder goes to the owner, not to the customers — messaging customers
 * automatically is a different decision, with consequences for the relationship,
 * so it stays a deliberate act from the statement screen.
 */
export default function DebtReminder() {
  const [debts, setDebts] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [showList, setShowList] = useState(false);

  const [form, setForm] = useState({
    debtReminderEnabled: false,
    debtReminderDays: 7,
    debtReminderMinAmount: 0,
    debtReminderHour: 10
  });

  const load = async () => {
    setLoading(true);
    try {
      const [debtData, settingsData] = await Promise.all([api.getDebts(), api.getSettings()]);
      setDebts(debtData);
      setSettings(settingsData);
      setForm({
        debtReminderEnabled: !!settingsData.debtReminderEnabled,
        debtReminderDays: settingsData.debtReminderDays ?? 7,
        debtReminderMinAmount: settingsData.debtReminderMinAmount ?? 0,
        debtReminderHour: settingsData.debtReminderHour ?? 10
      });
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setBusy('save');
    setMessage('');
    try {
      await api.updateSettings({
        debtReminderEnabled: form.debtReminderEnabled,
        debtReminderDays: Number(form.debtReminderDays),
        debtReminderMinAmount: Number(form.debtReminderMinAmount) || 0,
        debtReminderHour: Number(form.debtReminderHour)
      });
      setMessage('تم حفظ إعدادات التذكير ✅');
      setTimeout(() => setMessage(''), 4000);
      await load();
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  const handleSendNow = async () => {
    setBusy('send');
    setMessage('');
    try {
      const result = await api.sendDebtReminder();
      setMessage(
        result.sent
          ? `تم إرسال التذكير — ${result.debtors} مدين، بمجموع ${fmt(result.totalDebt)} د.ع ✅`
          : (result.note || 'لا يوجد مدينون حالياً')
      );
      setTimeout(() => setMessage(''), 6000);
      await load();
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <div className="panel-card" style={{ marginTop: '1.5rem', textAlign: 'center', padding: '2rem' }}>
        <Loader className="spin" size={26} />
      </div>
    );
  }

  const lastSent = settings?.debtReminderLastSent;

  return (
    <div className="panel-card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
        <BellRing size={24} color="var(--accent)" />
        <h3 style={{ margin: 0 }}>تذكير الديون</h3>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: 0 }}>
        يوصلك على الواتساب كل مدة تحددها، بقائمة الزبائن اللي عليهم فلوس.
      </p>

      {message && (
        <div className={`toast ${message.includes('خطأ') ? 'toast-error' : 'toast-success'}`}>
          {message}
        </div>
      )}

      {/* Where things stand right now */}
      <div style={{
        padding: '1rem',
        borderRadius: '12px',
        marginBottom: '1rem',
        textAlign: 'center',
        backgroundColor: debts?.count ? 'rgba(220,38,38,.06)' : 'rgba(22,163,74,.07)',
        border: `1.5px solid ${debts?.count ? 'var(--danger)' : 'var(--success)'}`
      }}>
        {debts?.count ? (
          <>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>مجموع الديون على الزبائن</div>
            <div style={{ fontSize: '28px', fontWeight: 900, color: 'var(--danger)', direction: 'ltr' }}>
              {fmt(debts.totalDebt)}
            </div>
            <div style={{ fontSize: '14px', color: 'var(--danger)' }}>
              على {debts.count} زبون
            </div>
          </>
        ) : (
          <strong style={{ color: 'var(--success)', fontSize: '16px' }}>
            ماكو ديون على أي زبون ✅
          </strong>
        )}
      </div>

      {/* The debtor list itself */}
      {debts?.count > 0 && (
        <>
          <button
            onClick={() => setShowList(!showList)}
            className="btn btn-secondary btn-block"
            style={{ marginBottom: '1rem' }}
          >
            {showList ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            {showList ? 'إخفاء قائمة المدينين' : 'عرض قائمة المدينين'}
          </button>

          {showList && (
            <div className="table-wrapper" style={{ marginBottom: '1rem' }}>
              <table className="app-table cards-on-mobile">
                <thead>
                  <tr>
                    <th>الزبون</th>
                    <th>الهاتف</th>
                    <th>الدين (د.ع)</th>
                  </tr>
                </thead>
                <tbody>
                  {debts.debtors.map(d => (
                    <tr key={d.id}>
                      <td data-label="الزبون" style={{ fontWeight: 700 }}>{d.name}</td>
                      <td data-label="الهاتف" style={{ direction: 'ltr', textAlign: 'left' }}>{d.phone || '-'}</td>
                      <td data-label="الدين" style={{
                        fontWeight: 700, color: 'var(--danger)', direction: 'ltr', textAlign: 'left'
                      }}>
                        {fmt(d.debt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Schedule */}
      <form onSubmit={handleSave}>
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.debtReminderEnabled}
              onChange={e => setForm({ ...form, debtReminderEnabled: e.target.checked })}
              style={{ width: '20px', height: '20px' }}
            />
            <span style={{ fontWeight: 700 }}>فعّل التذكير التلقائي</span>
          </label>
        </div>

        {form.debtReminderEnabled && (
          <>
            <div className="form-group">
              <label>كل كم يوم؟</label>
              <input
                type="number"
                inputMode="numeric"
                className="form-input"
                value={form.debtReminderDays}
                onChange={e => setForm({ ...form, debtReminderDays: e.target.value })}
                min="1"
                max="365"
                style={{ direction: 'ltr', textAlign: 'left' }}
              />
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0.35rem 0 0 0' }}>
                مثال: 7 يعني مرة كل أسبوع، 30 يعني مرة بالشهر.
              </p>
            </div>

            <div className="form-group">
              <label>بأي ساعة؟ (بتوقيت بغداد)</label>
              <select
                className="form-input"
                value={form.debtReminderHour}
                onChange={e => setForm({ ...form, debtReminderHour: e.target.value })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {h === 0 ? '12 منتصف الليل'
                      : h < 12 ? `${h} صباحاً`
                      : h === 12 ? '12 ظهراً'
                      : `${h - 12} مساءً`}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>تجاهل الديون الأقل من (د.ع)</label>
              <input
                type="number"
                inputMode="numeric"
                className="form-input"
                value={form.debtReminderMinAmount}
                onChange={e => setForm({ ...form, debtReminderMinAmount: e.target.value })}
                min="0"
                style={{ direction: 'ltr', textAlign: 'left' }}
              />
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0.35rem 0 0 0' }}>
                خلّيها صفر حتى تشوف كل الديون. أي رقم أكبر يخفي الديون الصغيرة من التذكير.
              </p>
            </div>
          </>
        )}

        {lastSent && (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            آخر تذكير أُرسل: {new Date(lastSent).toLocaleString('ar-EG')}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={busy !== ''} style={{ flex: 1, minWidth: '150px' }}>
            <Save size={18} />
            {busy === 'save' ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>

          <button
            type="button"
            className="btn btn-success"
            onClick={handleSendNow}
            disabled={busy !== ''}
            style={{ flex: 1, minWidth: '150px' }}
          >
            <Send size={18} />
            {busy === 'send' ? 'جاري الإرسال...' : 'أرسل التذكير الآن'}
          </button>
        </div>
      </form>
    </div>
  );
}
