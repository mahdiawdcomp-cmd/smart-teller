import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { CheckCircle, XCircle, Loader, LogOut, QrCode } from 'lucide-react';

export default function WhatsAppSetup() {
  const [statusData, setStatusData] = useState({ status: 'disconnected', qr: null });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const fetchStatus = async () => {
    try {
      const data = await api.getWhatsAppStatus();
      setStatusData(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll status every 5 seconds to get QR code updates and connection status changes
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    if (!window.confirm('هل أنت متأكد من رغبتك في قطع الاتصال بالواتساب؟')) return;
    
    setLoading(true);
    setMessage('');
    try {
      await api.logoutWhatsApp();
      setMessage('تم قطع الاتصال بنجاح. يرجى الانتظار لتوليد رمز QR جديد.');
      fetchStatus();
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel-card text-center">
      <div className="panel-header">
        <h2>إعدادات واتساب بوت (إرسال تلقائي)</h2>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
        
        {/* Connection Status Indicator */}
        <div className="status-indicator">
          {statusData.status === 'connected' && (
            <>
              <CheckCircle size={32} color="var(--success)" />
              <span>الحالة: <strong style={{ color: 'var(--success)' }}>متصل بنجاح ✅</strong></span>
            </>
          )}
          {statusData.status === 'connecting' && (
            <>
              <Loader size={32} className="indicator-dot connecting" />
              <span>الحالة: <strong>جاري الاتصال... ⏳</strong></span>
            </>
          )}
          {statusData.status === 'qr_ready' && (
            <>
              <QrCode size={32} color="var(--accent)" />
              <span>الحالة: <strong style={{ color: 'var(--accent)' }}>انتظار مسح رمز QR 📱</strong></span>
            </>
          )}
          {statusData.status === 'disconnected' && (
            <>
              <XCircle size={32} color="var(--danger)" />
              <span>الحالة: <strong style={{ color: 'var(--danger)' }}>غير متصل ❌</strong></span>
            </>
          )}
        </div>

        {message && (
          <div className={`toast ${message.includes('خطأ') ? 'toast-error' : 'toast-success'}`} style={{ width: '100%', maxWidth: '400px' }}>
            {message}
          </div>
        )}

        {/* QR Code display */}
        {statusData.status === 'qr_ready' && statusData.qr ? (
          <div className="qr-container">
            <p style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text-dark)', maxWidth: '500px', margin: '0 auto 1rem auto' }}>
              افتح الواتساب في هاتفك 🡨 الأجهزة المرتبطة 🡨 ربط جهاز 🡨 قم بتوجيه الكاميرا إلى المربع أدناه:
            </p>
            
            <div className="qr-box" style={{ border: '4px solid var(--primary)', padding: '8px', background: '#ffffff', borderRadius: '12px' }}>
              <img src={statusData.qr} alt="WhatsApp QR Code" style={{ display: 'block', width: '100%', height: '100%' }} />
            </div>

            <p style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--accent)', margin: '0.5rem 0' }}>
              (يتحدث الرمز تلقائياً كل بضعة ثوانٍ)
            </p>

            {/* Troubleshooting & Tips */}
            <div style={{
              textAlign: 'right',
              maxWidth: '500px',
              backgroundColor: '#fffbeb',
              border: '2px solid #fef3c7',
              borderRadius: '12px',
              padding: '1.5rem',
              marginTop: '1rem',
              boxShadow: 'var(--shadow)'
            }}>
              <h4 style={{ color: '#b45309', margin: '0 0 0.75rem 0', fontSize: '18px', fontWeight: 'bold' }}>💡 نصائح لحل مشكلة مسح الرمز:</h4>
              <ul style={{ margin: 0, paddingRight: '1.25rem', fontSize: '16px', color: '#78350f', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <li>
                  <strong>رمز جديد بعد البصمة:</strong> عند الضغط على "ربط جهاز"، يطلب الهاتف بصمة إصبعك أولاً. خلال هذه الأثناء قد تنتهي صلاحية الرمز على الشاشة. <strong>يرجى الانتظار حتى يظهر رمز جديد أمامك على الشاشة (يتحدث تلقائياً) ثم امسحه فوراً بعد أن تفتح الكاميرا في الهاتف.</strong>
                </li>
                <li>
                  <strong>إيقاف الوضع المظلم (Dark Mode):</strong> إذا كنت تستخدم إضافات الوضع الليلي أو المظلم في المتصفح، يرجى إيقافها مؤقتاً لأنها تعكس ألوان الرمز وتمنع الهاتف من قراءته.
                </li>
                <li>
                  <strong>حجم الشاشة والتركيز:</strong> يمكنك تكبير أو تصغير الصفحة بالضغط على زر <code>Ctrl</code> مع زر <code>+</code> أو <code>-</code> لمساعدة الكاميرا في التركيز.
                </li>
                <li>
                  <strong>نظافة العدسة والمسافة:</strong> نظّف عدسة كاميرا الهاتف واجعل الهاتف على مسافة متوسطة مناسبة من الشاشة.
                </li>
              </ul>
            </div>
          </div>
        ) : statusData.status === 'connected' ? (
          <div style={{ marginTop: '2rem', padding: '1.5rem', backgroundColor: 'rgba(22, 163, 74, 0.05)', borderRadius: '12px', border: '1px solid rgba(22, 163, 74, 0.2)' }}>
            <p style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--success)', margin: '0 0 1rem 0' }}>
              الواتساب متصل ويعمل في الخلفية بنشاط!
            </p>
            <p style={{ fontSize: '16px', color: 'var(--text-muted)', margin: '0 0 1.5rem 0' }}>
              يمكنك الآن إرسال الكشوفات للزبائن بضغطة زر واحدة، وسيقوم المجدول الأسبوعي بإرسال الرسائل كل خميس/جمعة تلقائياً.
            </p>
            <button 
              className="btn btn-danger" 
              onClick={handleLogout}
              disabled={loading}
              style={{ padding: '0.8rem 2rem' }}
            >
              <LogOut size={20} />
              قطع الاتصال وتسجيل الخروج
            </button>
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <Loader size={48} style={{ animation: 'spin 2s linear infinite', color: 'var(--primary)', margin: '0 auto 1.5rem auto' }} />
            <p style={{ fontSize: '18px', color: 'var(--text-muted)' }}>
              جاري تجهيز سيرفر الواتساب وتوليد الرمز... يرجى الانتظار ثوانٍ معدودة.
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
