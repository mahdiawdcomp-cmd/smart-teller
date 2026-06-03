import React, { useState } from 'react';
import { UserPlus, Search, FileText, ArrowLeftRight, User } from 'lucide-react';

export default function CustomerList({ customers, onSelectCustomer, onOpenTransaction, onOpenAddCustomer }) {
  const [search, setSearch] = useState('');

  // Filter customers by name or phone number
  const filteredCustomers = customers.filter(c => {
    const term = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(term) ||
      (c.phone && c.phone.includes(term))
    );
  });

  return (
    <div className="panel-card">
      <div className="panel-header">
        <h2>إدارة وعرض حسابات الزبائن</h2>
        <button className="btn btn-primary" onClick={onOpenAddCustomer}>
          <UserPlus size={20} />
          إضافة زبون جديد
        </button>
      </div>

      {/* Large Search Bar */}
      <div className="search-wrapper">
        <input
          type="text"
          className="search-input"
          placeholder="🔍 ابحث عن اسم الزبون أو رقم الهاتف..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ paddingRight: '1rem', textAlign: 'right' }}
        />
      </div>

      {/* Customer Ledger Table */}
      {filteredCustomers.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '4rem 0' }}>
          {search ? 'لم يتم العثور على أي زبون مطابق للبحث.' : 'لا يوجد زبائن مسجلين حالياً. اضغط على زر "إضافة زبون جديد" بالأعلى للبدء.'}
        </p>
      ) : (
        <div className="table-wrapper">
          <table className="app-table">
            <thead>
              <tr>
                <th>اسم الزبون</th>
                <th>رقم الهاتف</th>
                <th>حالة الرصيد</th>
                <th>الرصيد المتبقي (د.ع)</th>
                <th style={{ textAlign: 'center' }}>إجراءات الحساب</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => {
                const isCredit = (c.balance || 0) >= 0;
                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 'bold', fontSize: '20px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                        <User size={18} color="var(--primary)" />
                        {c.name}
                      </span>
                    </td>
                    <td style={{ fontSize: '18px', color: 'var(--text-muted)' }}>
                      {c.phone || '-'}
                    </td>
                    <td>
                      <span className={`badge ${isCredit ? 'badge-deposit' : 'badge-withdrawal'}`} style={{ fontSize: '14px' }}>
                        {isCredit ? 'مطلب (له)' : 'مطلوب (عليه)'}
                      </span>
                    </td>
                    <td style={{ 
                      fontWeight: '900', 
                      fontSize: '20px',
                      color: isCredit ? 'var(--success)' : 'var(--danger)' 
                    }}>
                      {Math.abs(c.balance || 0).toLocaleString('en-US')} د.ع
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: '0.75rem' }}>
                        
                        {/* Add Transaction Button */}
                        <button
                          className="btn btn-success"
                          style={{ padding: '0.5rem 1rem', fontSize: '16px', borderRadius: '8px' }}
                          onClick={() => onOpenTransaction(c)}
                        >
                          <ArrowLeftRight size={16} />
                          عملية جديدة
                        </button>

                        {/* Statement Button */}
                        <button
                          className="btn btn-primary"
                          style={{ padding: '0.5rem 1rem', fontSize: '16px', borderRadius: '8px', backgroundColor: 'var(--primary)' }}
                          onClick={() => onSelectCustomer(c)}
                        >
                          <FileText size={16} />
                          كشف الحساب
                        </button>
                        
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
