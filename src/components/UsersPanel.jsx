import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { Users as UsersIcon, UserPlus, Trash2, Pencil, ShieldCheck } from 'lucide-react';

const ROLE_LABELS = {
  admin: 'مدير (كل الصلاحيات)',
  staff: 'موظف (تسجيل عمليات فقط)'
};

const EMPTY_FORM = { username: '', name: '', password: '', role: 'staff', phone: '' };

/**
 * Staff accounts.
 *
 * With one shared password the audit trail could only ever say "admin", so a
 * mistake could never be traced to whoever made it. Each person gets an account,
 * and the ledger records their name against every change.
 */
export default function UsersPanel() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setList(await api.getUsers());
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setMessage('');
  };

  const openEdit = (user) => {
    setEditingId(user.id);
    // The password box stays empty on edit: leaving it blank keeps the current one.
    setForm({ username: user.username, name: user.name, password: '', role: user.role, phone: user.phone || '' });
    setShowForm(true);
    setMessage('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      if (editingId) {
        const patch = { name: form.name, role: form.role, phone: form.phone };
        if (form.password) patch.password = form.password;
        await api.updateUser(editingId, patch);
        setMessage('تم تعديل المستخدم ✅');
      } else {
        await api.createUser(form);
        setMessage('تمت إضافة المستخدم ✅');
      }

      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
      setTimeout(() => setMessage(''), 4000);
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (user) => {
    try {
      await api.updateUser(user.id, { active: !user.active });
      await load();
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    }
  };

  const handleDelete = async (user) => {
    if (!window.confirm(`حذف المستخدم "${user.name}" نهائياً؟`)) return;

    try {
      await api.deleteUser(user.id);
      setMessage('تم حذف المستخدم 🗑️');
      setTimeout(() => setMessage(''), 3000);
      await load();
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    }
  };

  return (
    <div className="panel-card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <UsersIcon size={26} color="var(--primary)" />
          <h3 style={{ margin: 0 }}>المستخدمون والصلاحيات</h3>
        </div>

        <button className="btn btn-primary" onClick={openCreate}>
          <UserPlus size={18} />
          إضافة مستخدم
        </button>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
        الموظف يسجّل العمليات فقط — لا يعدّل، لا يحذف، ولا يرى الأرباح والصندوق.
      </p>

      {message && (
        <div className={`toast ${message.includes('خطأ') ? 'toast-error' : 'toast-success'}`}>
          {message}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} style={{ backgroundColor: 'var(--bg-light)', padding: '1rem', borderRadius: '10px', marginBottom: '1rem' }}>
          <div className="form-group">
            <label>اسم المستخدم (للدخول) *</label>
            <input
              type="text"
              className="form-input"
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
              placeholder="ahmed"
              required
              disabled={!!editingId}
              style={{ direction: 'ltr', textAlign: 'left' }}
            />
          </div>

          <div className="form-group">
            <label>الاسم الكامل *</label>
            <input
              type="text"
              className="form-input"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="أحمد عبدالله"
              required
            />
          </div>

          <div className="form-group">
            <label>كلمة المرور {editingId ? '(اتركها فارغة لعدم التغيير)' : '*'}</label>
            <input
              type="password"
              className="form-input"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              required={!editingId}
              minLength={8}
              style={{ direction: 'ltr', textAlign: 'left' }}
            />
          </div>

          <div className="form-group">
            <label>الصلاحية *</label>
            <select
              className="form-input"
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
            >
              <option value="staff">{ROLE_LABELS.staff}</option>
              <option value="admin">{ROLE_LABELS.admin}</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={busy}>
              إلغاء
            </button>
            <button type="submit" className="btn btn-success" disabled={busy} style={{ flex: 1 }}>
              {busy ? 'جاري الحفظ...' : (editingId ? 'حفظ التعديل' : 'إضافة المستخدم')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>جاري التحميل...</p>
      ) : (
        <div className="table-wrapper">
          <table className="app-table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>اسم المستخدم</th>
                <th>الصلاحية</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {list.map(user => (
                <tr key={user.id}>
                  <td style={{ fontWeight: 'bold' }}>
                    {user.name}
                    {user.isEnvOwner && (
                      <ShieldCheck size={14} style={{ marginRight: '6px', verticalAlign: 'middle', color: 'var(--primary)' }} />
                    )}
                  </td>
                  <td style={{ direction: 'ltr', textAlign: 'left' }}>{user.username}</td>
                  <td>
                    <span className={`badge ${user.role === 'admin' ? 'badge-deposit' : 'badge-withdrawal'}`}>
                      {user.role === 'admin' ? 'مدير' : 'موظف'}
                    </span>
                  </td>
                  <td style={{ color: user.active === false ? 'var(--danger)' : 'var(--success)' }}>
                    {user.active === false ? 'موقوف' : 'نشط'}
                  </td>
                  <td>
                    {user.isEnvOwner ? (
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                        يُدار من إعدادات الخادم
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button className="btn btn-secondary" onClick={() => openEdit(user)} style={{ padding: '0.4rem 0.6rem' }} title="تعديل">
                          <Pencil size={15} />
                        </button>
                        <button className="btn btn-secondary" onClick={() => handleToggleActive(user)} style={{ padding: '0.4rem 0.6rem', fontSize: '13px' }}>
                          {user.active === false ? 'تفعيل' : 'إيقاف'}
                        </button>
                        <button className="btn btn-danger" onClick={() => handleDelete(user)} style={{ padding: '0.4rem 0.6rem' }} title="حذف">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
