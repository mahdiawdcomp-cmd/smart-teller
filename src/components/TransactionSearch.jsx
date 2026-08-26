import React, { useState } from 'react';
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

  const runSearch = async (e) => {
    if (e) e.preventDefault();

    setLoading(true);
    setError('');
    try {
      setResult(await api.searchTransactions(filters));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" onClick={clear}>
              مسح
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
              {loading ? <Loader className="spin" size={18} /> : <Search size={18} />}
              {loading ? 'جاري البحث...' : 'بحث'}
            </button>
          </div>
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
              <table className="app-table">
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
                        <td style={{ fontSize: '14px' }}>
                          {new Date(tx.date).toLocaleString('ar-EG')}
                        </td>
                        <td style={{ fontWeight: 'bold' }}>{tx.customerName}</td>
                        <td>
                          <span className={`badge ${tx.type === 'deposit' ? 'badge-deposit' : 'badge-withdrawal'}`}>
                            {tx.type === 'deposit' ? 'إيداع' : 'سحب'}
                          </span>
                        </td>
                        <td style={{
                          fontWeight: 'bold',
                          color: tx.type === 'deposit' ? 'var(--success)' : 'var(--danger)'
                        }}>
                          {fmt(total)} د.ع
                        </td>
                        <td style={{ fontSize: '14px' }}>{tx.notes || '-'}</td>
                        <td>
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
