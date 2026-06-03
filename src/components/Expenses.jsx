import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { PlusCircle, Trash2, DollarSign, Wallet, Percent, TrendingUp } from 'lucide-react';

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [profits, setProfits] = useState({ totalCustomerProfit: 0, totalExpenses: 0, netProfit: 0 });
  const [loading, setLoading] = useState(false);
  
  // Form states
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');

  const loadData = async () => {
    try {
      const expList = await api.getExpenses();
      setExpenses(expList);
      const profData = await api.getProfits();
      setProfits(profData);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title || !amount) {
      setMessage('يرجى ملء الحقول المطلوبة');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      await api.addExpense(title, amount, notes);
      setTitle('');
      setAmount('');
      setNotes('');
      setMessage('تم تسجيل المصروف بنجاح!');
      loadData();
      setTimeout(() => setMessage(''), 3000);
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id, title) => {
    if (!window.confirm(`هل أنت متأكد من حذف مصروف "${title}"؟`)) return;

    try {
      await api.deleteExpense(id);
      loadData();
    } catch (err) {
      alert(`خطأ في الحذف: ${err.message}`);
    }
  };

  return (
    <div>
      {/* 1. Profits Summary Dashboard */}
      <div className="dashboard-grid">
        {/* Total Revenues (Commissions) */}
        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(22, 163, 74, 0.1)', color: 'var(--success)' }}>
            <Percent size={32} />
          </div>
          <div className="stat-info">
            <h3>إجمالي أرباح الصيرفة (العمولات)</h3>
            <p style={{ color: 'var(--success)' }}>
              {Number(profits.totalCustomerProfit).toLocaleString('en-US')} د.ع
            </p>
          </div>
        </div>

        {/* Total Expenses */}
        <div className="stat-card">
          <div className="stat-icon" style={{ backgroundColor: 'rgba(220, 38, 38, 0.1)', color: 'var(--danger)' }}>
            <Wallet size={32} />
          </div>
          <div className="stat-info">
            <h3>إجمالي المصاريف الأخرى</h3>
            <p style={{ color: 'var(--danger)' }}>
              {Number(profits.totalExpenses).toLocaleString('en-US')} د.ع
            </p>
          </div>
        </div>

        {/* Net Profit */}
        <div className="stat-card">
          <div className="stat-icon" style={{ 
            backgroundColor: profits.netProfit >= 0 ? 'rgba(8, 145, 178, 0.1)' : 'rgba(220, 38, 38, 0.1)', 
            color: profits.netProfit >= 0 ? 'var(--primary)' : 'var(--danger)' 
          }}>
            <TrendingUp size={32} />
          </div>
          <div className="stat-info">
            <h3>صافي الأرباح الكلي</h3>
            <p style={{ color: profits.netProfit >= 0 ? 'var(--primary)' : 'var(--danger)' }}>
              {Number(profits.netProfit).toLocaleString('en-US')} د.ع
            </p>
          </div>
        </div>
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', alignItems: 'start' }}>
        
        {/* 2. Add New Expense Form */}
        <div className="panel-card">
          <div className="panel-header">
            <h2>إضافة مصروف جديد</h2>
          </div>

          {message && (
            <div className={`toast ${message.includes('خطأ') ? 'toast-error' : 'toast-success'}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>عنوان المصروف *</label>
              <input
                type="text"
                className="form-input"
                placeholder="مثلاً: إيجار المحل، فاتورة الإنترنت، رواتب"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>مبلغ المصروف (بالدينار العراقي) *</label>
              <input
                type="number"
                className="form-input"
                placeholder="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                required
                min="0"
              />
            </div>

            <div className="form-group">
              <label>ملاحظات إضافية</label>
              <textarea
                className="form-input"
                placeholder="أي ملاحظات حول هذا المصروف..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
                style={{ height: '100px', resize: 'none' }}
              />
            </div>

            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              <PlusCircle size={20} />
              حفظ المصروف
            </button>
          </form>
        </div>

        {/* 3. Expenses List */}
        <div className="panel-card" style={{ minHeight: '400px' }}>
          <div className="panel-header">
            <h2>سجل المصاريف الأخرى</h2>
          </div>

          {expenses.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '3rem' }}>
              لا توجد مصاريف مسجلة حالياً.
            </p>
          ) : (
            <div className="table-wrapper">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>المصروف</th>
                    <th>المبلغ</th>
                    <th>ملاحظات</th>
                    <th>التاريخ</th>
                    <th style={{ textAlign: 'center' }}>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp) => (
                    <tr key={exp.id}>
                      <td style={{ fontWeight: 'bold' }}>{exp.title}</td>
                      <td style={{ color: 'var(--danger)', fontWeight: 'bold' }}>
                        {Number(exp.amount).toLocaleString('en-US')} د.ع
                      </td>
                      <td style={{ fontSize: '16px', color: 'var(--text-muted)' }}>{exp.notes || '-'}</td>
                      <td style={{ fontSize: '14px' }}>
                        {new Date(exp.date).toLocaleDateString('ar-EG')}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '0.4rem 0.8rem', fontSize: '14px', borderRadius: '6px' }}
                          onClick={() => handleDelete(exp.id, exp.title)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
