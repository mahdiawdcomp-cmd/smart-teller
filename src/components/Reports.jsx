import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { BarChart3, Download, Loader } from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

const PRESETS = [
  { key: 'today', label: 'اليوم' },
  { key: 'week', label: 'آخر 7 أيام' },
  { key: 'month', label: 'الشهر الحالي' },
  { key: 'prev_month', label: 'الشهر السابق' },
  { key: 'year', label: 'السنة' },
  { key: 'all', label: 'كامل المدة' },
  { key: 'custom', label: 'فترة مخصصة' }
];

/**
 * Downloads rows as a CSV Excel will open correctly.
 * The BOM matters: without it Excel reads the Arabic as mojibake.
 */
function downloadCsv(filename, rows) {
  const escape = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = rows.map(row => row.map(escape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [preset, setPreset] = useState('month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadReport = async () => {
    setLoading(true);
    setError('');
    try {
      const params = preset === 'custom'
        ? { from: startDate, to: endDate }
        : { preset };
      setReport(await api.getReport(params));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // A custom range only makes sense once at least one side is chosen.
  useEffect(() => {
    if (preset === 'custom' && !startDate && !endDate) return;
    loadReport();
  }, [preset, startDate, endDate]);

  const exportPerCustomer = () => {
    if (!report) return;

    const rows = [
      ['الزبون', 'عدد العمليات', 'الإيداعات', 'السحوبات', 'العمولة (ربح)'],
      ...report.perCustomer.map(row => [
        row.customerName,
        row.txCount,
        row.deposits,
        row.withdrawals,
        row.commission
      ]),
      [],
      ['الإجمالي', report.totals.transactionCount, report.totals.totalDeposits, report.totals.totalWithdrawals, report.totals.totalCommission],
      ['المصاريف', '', '', '', report.totals.totalExpenses],
      ['صافي الربح', '', '', '', report.totals.netProfit]
    ];

    downloadCsv(`تقرير_الزبائن_${report.range.label}.csv`, rows);
  };

  const exportDaily = () => {
    if (!report) return;

    const rows = [
      ['التاريخ', 'الإيداعات', 'السحوبات', 'العمولة', 'المصاريف', 'صافي الربح'],
      ...report.daily.map(day => [
        day.date,
        day.deposits,
        day.withdrawals,
        day.commission,
        day.expenses,
        day.netProfit
      ])
    ];

    downloadCsv(`تقرير_يومي_${report.range.label}.csv`, rows);
  };

  const totals = report?.totals;
  const maxDaily = report
    ? Math.max(1, ...report.daily.map(d => Math.abs(d.netProfit)))
    : 1;

  return (
    <div>
      <div className="panel-card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <BarChart3 size={28} color="var(--primary)" />
          <h2 style={{ margin: 0 }}>التقارير</h2>
        </div>

        {/* Period picker */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          {PRESETS.map(item => (
            <button
              key={item.key}
              className={`btn ${preset === item.key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPreset(item.key)}
              style={{ padding: '0.5rem 1rem' }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: 1, minWidth: '160px' }}>
              <label>من تاريخ</label>
              <input type="date" className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: '160px' }}>
              <label>إلى تاريخ</label>
              <input type="date" className="form-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
        )}

        {error && <div className="toast toast-error">{error}</div>}
      </div>

      {loading ? (
        <div className="panel-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Loader className="spin" size={32} />
          <p style={{ color: 'var(--text-muted)' }}>جاري حساب التقرير...</p>
        </div>
      ) : !report ? (
        <div className="panel-card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          اختر فترة لعرض التقرير.
        </div>
      ) : (
        <>
          {/* Headline numbers */}
          <div className="dashboard-grid" style={{ marginBottom: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div className="stat-card" style={{ padding: '1.25rem 1rem' }}>
              <div className="stat-info">
                <h3>الإيداعات</h3>
                <p style={{ color: 'var(--success)', fontSize: '20px', fontWeight: 'bold' }}>{fmt(totals.totalDeposits)} د.ع</p>
              </div>
            </div>
            <div className="stat-card" style={{ padding: '1.25rem 1rem' }}>
              <div className="stat-info">
                <h3>السحوبات</h3>
                <p style={{ color: 'var(--danger)', fontSize: '20px', fontWeight: 'bold' }}>{fmt(totals.totalWithdrawals)} د.ع</p>
              </div>
            </div>
            <div className="stat-card" style={{ padding: '1.25rem 1rem' }}>
              <div className="stat-info">
                <h3>العمولات (الدخل)</h3>
                <p style={{ color: 'var(--primary)', fontSize: '20px', fontWeight: 'bold' }}>{fmt(totals.totalCommission)} د.ع</p>
              </div>
            </div>
            <div className="stat-card" style={{ padding: '1.25rem 1rem' }}>
              <div className="stat-info">
                <h3>المصاريف</h3>
                <p style={{ color: 'var(--danger)', fontSize: '20px', fontWeight: 'bold' }}>{fmt(totals.totalExpenses)} د.ع</p>
              </div>
            </div>
            <div className="stat-card" style={{
              padding: '1.25rem 1rem',
              border: `2px solid ${totals.netProfit >= 0 ? 'var(--success)' : 'var(--danger)'}`
            }}>
              <div className="stat-info">
                <h3>صافي الربح</h3>
                <p style={{
                  color: totals.netProfit >= 0 ? 'var(--success)' : 'var(--danger)',
                  fontSize: '22px',
                  fontWeight: 900
                }}>
                  {fmt(totals.netProfit)} د.ع
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <button className="btn btn-secondary" onClick={exportPerCustomer} disabled={report.perCustomer.length === 0}>
              <Download size={18} />
              تصدير تقرير الزبائن
            </button>
            <button className="btn btn-secondary" onClick={exportDaily} disabled={report.daily.length === 0}>
              <Download size={18} />
              تصدير التقرير اليومي
            </button>
          </div>

          {/* Daily trend */}
          <div className="panel-card" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginTop: 0 }}>الربح اليومي ({report.range.label})</h3>

            {report.daily.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>
                لا توجد عمليات في هذه الفترة.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {report.daily.map(day => {
                  const width = Math.round((Math.abs(day.netProfit) / maxDaily) * 100);
                  const positive = day.netProfit >= 0;

                  return (
                    <div key={day.date} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ width: '90px', fontSize: '13px', color: 'var(--text-muted)', direction: 'ltr', textAlign: 'left' }}>
                        {day.date}
                      </span>
                      <div style={{ flex: 1, backgroundColor: 'var(--bg-light)', borderRadius: '6px', height: '22px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${width}%`,
                          height: '100%',
                          backgroundColor: positive ? 'var(--success)' : 'var(--danger)',
                          opacity: 0.75
                        }} />
                      </div>
                      <span style={{
                        width: '110px',
                        fontSize: '14px',
                        fontWeight: 'bold',
                        direction: 'ltr',
                        textAlign: 'left',
                        color: positive ? 'var(--success)' : 'var(--danger)'
                      }}>
                        {fmt(day.netProfit)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Per-customer breakdown */}
          <div className="panel-card">
            <h3 style={{ marginTop: 0 }}>الأرباح حسب الزبون</h3>

            {report.perCustomer.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>
                لا توجد عمليات في هذه الفترة.
              </p>
            ) : (
              <div className="table-wrapper">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>الزبون</th>
                      <th>العمليات</th>
                      <th>الإيداعات</th>
                      <th>السحوبات</th>
                      <th>العمولة (الربح)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.perCustomer.map(row => (
                      <tr key={row.customerId}>
                        <td style={{ fontWeight: 'bold' }}>{row.customerName}</td>
                        <td>{row.txCount}</td>
                        <td style={{ color: 'var(--success)' }}>{fmt(row.deposits)}</td>
                        <td style={{ color: 'var(--danger)' }}>{fmt(row.withdrawals)}</td>
                        <td style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{fmt(row.commission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
