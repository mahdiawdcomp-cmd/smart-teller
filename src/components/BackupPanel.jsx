import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { ShieldCheck, Download, Send } from 'lucide-react';

/**
 * Backup controls.
 *
 * The server keeps a copy in backend/data/database.json, but Render wipes that
 * disk on every deploy — so a backup only counts once it has left the server.
 */
export default function BackupPanel() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const loadStatus = async () => {
    try {
      setStatus(await api.getBackupStatus());
    } catch {
      // A missing status is not worth interrupting the settings screen for.
    }
  };

  useEffect(() => { loadStatus(); }, []);

  const handleDownload = async () => {
    setBusy('download');
    setMessage('');
    try {
      const { blob, fileName, encrypted } = await api.downloadBackup();
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);

      setMessage(encrypted
        ? 'تم تنزيل النسخة الاحتياطية (مشفّرة) ✅'
        : 'تم تنزيل النسخة الاحتياطية — تحذير: غير مشفّرة');
      setTimeout(() => setMessage(''), 5000);
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
      const result = await api.runBackup();
      setMessage(`تم إرسال النسخة الاحتياطية إلى واتساب المالك ✅ (${result.fileName})`);
      setTimeout(() => setMessage(''), 6000);
      await loadStatus();
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setBusy('');
    }
  };

  const lastRun = status?.lastRun;

  return (
    <div className="panel-card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <ShieldCheck size={26} color="var(--success)" />
        <h3 style={{ margin: 0 }}>النسخ الاحتياطي</h3>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
        نسخة كاملة تلقائية تُرسل يومياً إلى واتساب المالك الساعة الثانية فجراً. احتفظ بالملفات — هي خط الدفاع الأخير عن بياناتك.
      </p>

      {/* An unencrypted backup is the biggest data exposure in the system: one
          forwardable file holding every customer, phone number and balance. */}
      {lastRun && lastRun.ok && lastRun.encrypted === false && (
        <div className="toast toast-error">
          <strong>تحذير:</strong> النسخة الاحتياطية تُرسل بدون تشفير.
          اضبط <span style={{ direction: 'ltr', display: 'inline-block' }}>BACKUP_PASSPHRASE</span> في
          إعدادات الخادم — الملف الحالي يحتوي كل أسماء الزبائن وأرقامهم وأرصدتهم بشكل مقروء.
        </div>
      )}

      {lastRun && lastRun.encrypted && (
        <div className="toast toast-success">
          🔐 النسخ مشفّرة. لفتح ملف:
          <code style={{ display: 'block', direction: 'ltr', textAlign: 'left', marginTop: '4px', fontSize: '12px' }}>
            node backend/scripts/decryptBackup.js file.stb "your-passphrase"
          </code>
        </div>
      )}

      {message && (
        <div className={`toast ${message.includes('خطأ') ? 'toast-error' : 'toast-success'}`}>
          {message}
        </div>
      )}

      {lastRun && (
        <div
          className="toast"
          style={{
            backgroundColor: lastRun.ok ? 'rgba(22, 163, 74, 0.08)' : 'rgba(220, 38, 38, 0.08)',
            color: lastRun.ok ? 'var(--success)' : 'var(--danger)',
            borderColor: lastRun.ok ? 'var(--success)' : 'var(--danger)'
          }}
        >
          آخر نسخة: {new Date(lastRun.startedAt).toLocaleString('ar-EG')}
          {lastRun.ok
            ? ` — تمت بنجاح (${lastRun.counts?.transactions ?? 0} عملية)`
            : ` — فشلت: ${lastRun.error}`}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={handleDownload} disabled={busy !== ''} style={{ flex: 1, minWidth: '200px' }}>
          <Download size={18} />
          {busy === 'download' ? 'جاري التحضير...' : 'تنزيل نسخة الآن'}
        </button>

        <button className="btn btn-success" onClick={handleSendNow} disabled={busy !== ''} style={{ flex: 1, minWidth: '200px' }}>
          <Send size={18} />
          {busy === 'send' ? 'جاري الإرسال...' : 'إرسال نسخة للواتساب الآن'}
        </button>
      </div>
    </div>
  );
}
