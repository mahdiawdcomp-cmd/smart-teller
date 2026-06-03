import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { CheckCircle, XCircle, Loader, LogOut, QrCode } from 'lucide-react';

export default function WhatsAppSetup() {
  const [statusData, setStatusData] = useState({ status: 'disconnected', qr: null });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [pairingMethod, setPairingMethod] = useState('phone'); // 'phone' | 'qr'
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [targetNumber, setTargetNumber] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);

  const handleRequestPairingCode = async (e) => {
    e.preventDefault();
    if (!phoneNumber) {
      setMessage('خطأ: يرجى إدخال رقم الهاتف أولاً.');
      return;
    }
    
    setPairingLoading(true);
    setMessage('');
    setPairingCode('');
    setTargetNumber('');
    try {
      const data = await api.pairPhone(phoneNumber);
      if (data.code) {
        setPairingCode(data.code);
        setTargetNumber(data.cleanNumber || '');
        setMessage('تم توليد كود الربط بنجاح! يرجى إدخاله في هاتفك.');
      } else {
        throw new Error('لم يتم إرجاع كود من السيرفر');
      }
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setPairingLoading(false);
    }
  };

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

        {/* QR Code / Phone Pairing display */}
        {statusData.status === 'qr_ready' ? (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* Pairing Method Selection Tabs */}
            <div className="tabs-nav" style={{ width: '100%', maxWidth: '500px', margin: '0 auto 1.5rem auto' }}>
              <button 
                className={`tab-btn ${pairingMethod === 'phone' ? 'active' : ''}`}
                onClick={() => setPairingMethod('phone')}
                style={{ fontSize: '18px', padding: '0.5rem 1rem' }}
                type="button"
              >
                🔑 كود الهاتف (أسهل)
              </button>
              <button 
                className={`tab-btn ${pairingMethod === 'qr' ? 'active' : ''}`}
                onClick={() => setPairingMethod('qr')}
                style={{ fontSize: '18px', padding: '0.5rem 1rem' }}
                type="button"
              >
                📷 مسح كود QR
              </button>
            </div>

            {pairingMethod === 'phone' ? (
              <div className="pairing-phone-container" style={{ width: '100%', maxWidth: '500px', textAlign: 'right' }}>
                <form onSubmit={handleRequestPairingCode} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="form-group">
                    <label style={{ fontSize: '18px', fontWeight: 'bold' }}>رقم هاتف الواتساب المطلوب ربطه:</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="مثال: 07701234567" 
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      disabled={pairingLoading}
                      style={{ textAlign: 'left', direction: 'ltr', fontSize: '20px', padding: '0.8rem' }}
                    />
                  </div>
                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    disabled={pairingLoading}
                    style={{ width: '100%', fontSize: '18px', padding: '0.8rem' }}
                  >
                    {pairingLoading ? 'جاري طلب كود الربط... ⏳' : 'طلب كود الربط بالواتساب 🔑'}
                  </button>
                </form>

                {pairingCode && (
                  <div style={{
                    marginTop: '1.5rem',
                    padding: '1.5rem',
                    backgroundColor: '#f0fdf4',
                    border: '2px solid #bbf7d0',
                    borderRadius: '16px',
                    textAlign: 'center',
                    boxShadow: 'var(--shadow)'
                  }}>
                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '18px', color: 'var(--text-muted)' }}>كود ربط الجهاز الخاص بك هو:</p>
                    <div style={{
                      fontSize: '36px',
                      fontWeight: 'bold',
                      letterSpacing: '6px',
                      color: 'var(--success)',
                      backgroundColor: '#ffffff',
                      border: '2px dashed var(--success)',
                      padding: '1rem',
                      borderRadius: '12px',
                      display: 'inline-block',
                      fontFamily: 'monospace',
                      margin: '0.5rem 0 1rem 0'
                    }}>
                      {pairingCode}
                    </div>
                    
                    {targetNumber && (
                      <div style={{
                        backgroundColor: '#fffbeb',
                        border: '1px solid #fef3c7',
                        padding: '1rem',
                        borderRadius: '12px',
                        marginBottom: '1rem',
                        fontSize: '18px',
                        color: '#78350f',
                        textAlign: 'right'
                      }}>
                        <strong style={{ display: 'block', marginBottom: '0.5rem' }}>⚠️ تنبيه هام: الرقم الذي يجب كتابته في الموبايل هو:</strong>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', direction: 'ltr', fontWeight: 'bold', fontSize: '20px', backgroundColor: '#ffffff', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #fde68a' }}>
                          <span style={{ fontSize: '16px', color: 'var(--text-muted)' }}>العراق (+964)</span>
                          <span style={{ color: 'var(--danger)', fontSize: '24px', letterSpacing: '1px' }}>
                            {targetNumber.startsWith('964') ? targetNumber.substring(3) : targetNumber}
                          </span>
                        </div>
                        <p style={{ fontSize: '14px', margin: '0.5rem 0 0 0', color: '#b45309', lineHeight: '1.4' }}>
                          * تأكد من اختيار رمز دولة **العراق (+964)** في هاتفك، ثم اكتب الرقم المكتوب باللون الأحمر بالضبط (بدون كتابة الصفر 0 في البداية).
                        </p>
                      </div>
                    )}
                    
                    <h4 style={{ margin: '0.75rem 0 0.5rem 0', color: 'var(--text-dark)', fontSize: '18px', fontWeight: 'bold', textAlign: 'right' }}>⚠️ طريقة إدخال الكود في هاتفك:</h4>
                    <ol style={{ margin: 0, paddingRight: '1.25rem', fontSize: '16px', color: 'var(--text-dark)', textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <li>افتح تطبيق <strong>الواتساب</strong> في هاتفك.</li>
                      <li>اضغط على القائمة (الثلاث نقاط) 🡨 اختر <strong>الأجهزة المرتبطة</strong>.</li>
                      <li>اضغط على زر <strong>ربط جهاز</strong> (قم بتمرير بصمة إصبعك إذا طلبها الهاتف).</li>
                      <li>عندما تفتح كاميرا المسح، اضغط بالأسفل على <strong>"الربط برقم الهاتف بدلاً من ذلك" (Link with phone number instead)</strong>.</li>
                      <li>أدخل الكود الموضح أعلاه والمكون من 8 رموز ليتم الربط فوراً وتلقائياً.</li>
                    </ol>
                  </div>
                )}
              </div>
            ) : (
              <div className="qr-container" style={{ width: '100%' }}>
                {statusData.qr ? (
                  <>
                    <p style={{ fontSize: '20px', color: 'var(--text-dark)', maxWidth: '500px', margin: '0 auto 1rem auto' }}>
                      قم بتوجيه الكاميرا إلى المربع أدناه لمسح الرمز:
                    </p>
                    <div className="qr-box" style={{ border: '4px solid var(--primary)', padding: '8px', background: '#ffffff', borderRadius: '12px', margin: '0 auto' }}>
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
                      boxShadow: 'var(--shadow)',
                      margin: '1rem auto 0 auto'
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
                      </ul>
                    </div>
                  </>
                ) : (
                  <p style={{ fontSize: '18px', color: 'var(--text-muted)' }}>جاري توليد رمز QR... يرجى الانتظار</p>
                )}
              </div>
            )}
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
