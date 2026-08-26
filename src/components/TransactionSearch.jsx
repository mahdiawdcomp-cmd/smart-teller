import React, { useState, useEffect, useRef } from 'react';
import { api } from '../utils/api';
import { Search, Loader, FileText } from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/**
 * Searches every customer's ledger at once.
 *
 * When somebody walks in saying "I transferred five million about two months
 * ago", opening customer accounts one at a time is not an answer.
 */
export default function TransactionSearch({ onOpenCustomer }) {
  const [filters, setFilters] = useState({
    q: '', from: '', to: '', type: '', minAmount: '', maxAmount: ''
  });

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Identifies the newest request. A slow reply from an earlier keystroke must
  // not overwrite the results of a later one.
  const requestId = useRef(0);

  const runSearch = async (e) => {
    if (e) e.preventDefault();

    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const data = await api.searchTransactions(filters);
      if (id === requestId.current) setResult(data);
    } catch (err) {
      if (id === requestId.current) setError(err.message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };

  /**
   * Searches as you type.
   *
   * Debounced so a five-letter name is one request instead of five, and skipped
   * entirely when every field is empty — an empty query would pull the whole
   * ledger of every customer for nothing.
   */
  useEffect(() => {
    const hasAnyFilter = Object.values(filters).some(v => String(v || '').trim() !== '');

    if (!hasAnyFilter) {
      requestId.current++;   // cancel anything still in flight
      setResult(null);
      setLoading(false);
      setError('');
      return;
    }

    const timer = setTimeout(() => { runSearch(); }, 350);
    return () => clearTimeout(timer);
  }, [filters.q, filters.from, filters.to, filters.type, filters.minAmount, filters.maxAmount]);

  const clear = () => {
    setFilters({ q: '', from: '', to: '', type: '', minAmount: '', maxAmount: '' });
    setResult(null);
  };

  const set = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });

  return (
    <div>
      <div className="panel-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <Search size={28} color="var(--primary)" />
          <h2 style={{ margin: 0 }}>البحث في العمليات</h2>
        </div>

        <form onSubmit={runSearch}>
          <div className="form-group">
            <label>بحث نصي (اسم الزبون، ملاحظة، أو مبلغ)</label>
            <input
              type="text"
              className="form-input"
              value={filters.q}
              onChange={set('q')}
              placeholder="مثال: أحمد  أو  5000000  أو  حوالة بغداد"
            />
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: '150px' }}>
              <label>من تاريخ</label>
              <input type="date" className="form-input" value={filters.from} onChange={set('from')} />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: '150px' }}>
              <label>إلى تاريخ</label>
              <input type="date" className="form-input" value={filters.to} onChange={set('to')} />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: '150px' }}>
              <label>النوع</label>
              <select className="form-input" value={filters.type} onChange={set('type')}>
                <option value="">الكل</option>
                <option value="deposit">إيداع</option>
                <option value="withdrawal">سحب / حوالة</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: '150px' }}>
              <label>أقل مبلغ</label>
              <input
                type="number"
                className="form-input"
                value={filters.minAmount}
                onChange={set('minAmount')}
                style={{ direction: 'ltr', textAlign: 'left' }}
              />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: '150px' }}>
              <label>أعلى مبلغ</label>
              <input
                type="number"
                className="form-input"
                value={filters.maxAmount}
                onChange={set('maxAmount')}
                style={{ direction: 'ltr', textAlign: 'left' }}
              />
            </div>
          </div>

          {error && <div className="toast toast-error">{error}</div>}

          {/* Results follow what you type; the button stays for a deliberate
              re-run and for anyone who reaches for it out of habit. */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button type="button" className="btn btn-secondary" onClick={clear}>
              مسح
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
              {loading ? <Loader className="spin" size={18} /> : <Search size={18} />}
              {loading ? 'جاري البحث...' : 'بحث'}
            </button>
          </div>

          <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', margin: '0.6rem 0 0 0' }}>
            النتائج تظهر تلقائياً وأنت تكتب
          </p>
        </form>
      </div>

      {result && (
        <div className="panel-card">
          <h3 style={{ marginTop: 0 }}>
            النتائج: {result.total} عملية
            {result.truncated && (
              <span style={{ fontSize: '14px', color: 'var(--danger)', marginRight: '8px' }}>
                (يُعرض أول {result.results.length} فقط — ضيّق البحث)
              </span>
            )}
          </h3>

          {result.results.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
              لا توجد عمليات مطابقة.
            </p>
          ) : (
            <div className="table-wrapper">
              <table className="app-table cards-on-mobile">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الزبون</th>
                    <th>النوع</th>
                    <th>المبلغ</th>
                    <th>الملاحظات</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map(tx => {
                    const total = Number(tx.amount) +
                      (tx.type === 'withdrawal' ? (Number(tx.commission) || 0) : 0);

                    return (
                      <tr key={`${tx.customerId}-${tx.id}`}>
                        <td data-label="التاريخ" style={{ fontSize: '14px' }}>
                          {new Date(tx.date).toLocaleString('ar-EG')}
                        </td>
                        <td data-label="الزبون" style={{ fontWeight: 'bold' }}>{tx.customerName}</td>
                        <td data-label="النوع">
                          <span className={`badge ${tx.type === 'deposit' ? 'badge-deposit' : 'badge-withdrawal'}`}>
                            {tx.type === 'deposit' ? 'إيداع' : 'سحب'}
                          </span>
                        </td>
                        <td data-label="المبلغ" style={{
                          fontWeight: 'bold',
                          color: tx.type === 'deposit' ? 'var(--success)' : 'var(--danger)'
                        }}>
                          {fmt(total)} د.ع
                        </td>
                        <td data-label="ملاحظات" style={{ fontSize: '14px' }}>{tx.notes || '-'}</td>
                        <td data-label="">
                          {onOpenCustomer && (
                            <button
                              className="btn btn-secondary"
                              onClick={() => onOpenCustomer({ id: tx.customerId, name: tx.customerName })}
                              style={{ padding: '0.4rem 0.6rem' }}
                              title="فتح كشف الزبون"
                            >
                              <FileText size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
