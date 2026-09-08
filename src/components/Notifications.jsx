import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../utils/api';
import { Bell, BellRing, BellOff, Volume2, VolumeX, Smartphone, Check, X } from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

const SEEN_KEY = 'teller_notifications_seen';
const SOUND_KEY = 'teller_notifications_sound';

/**
 * A short chime, synthesised rather than loaded.
 *
 * A sound file would be one more request on a connection this app already waits
 * on, and it would need hosting and a licence. Two quick tones cost nothing and
 * carry across a noisy shop.
 */
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    // Browsers suspend audio until the user has interacted with the page; by the
    // time a notification arrives they have signed in, so this resolves.
    if (ctx.state === 'suspended') ctx.resume();

    const play = (freq, startAt, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      // Fade in and out — a raw square edge clicks unpleasantly.
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + duration + 0.05);
    };

    play(880, 0, 0.18);      // A5
    play(1174.66, 0.14, 0.28); // D6

    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    // A missing chime is not worth surfacing.
  }
}

/** Turns a VAPID public key into the byte array the Push API expects. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export default function Notifications({ onOpenCustomer }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const [soundOn, setSoundOn] = useState(() => localStorage.getItem(SOUND_KEY) !== 'off');
  const [pushState, setPushState] = useState('unknown'); // unknown|unsupported|off|on|blocked
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  // The newest transaction this browser has already seen; anything after it is new.
  const lastSeen = useRef(localStorage.getItem(SEEN_KEY) || null);
  const firstLoad = useRef(true);

  const load = async () => {
    try {
      const data = await api.getNotifications();
      setItems(data.items);

      const fresh = lastSeen.current
        ? data.items.filter(i => i.date > lastSeen.current)
        : [];

      // The first load after opening the app should not scream about everything
      // that happened while it was closed — it just sets the mark.
      if (firstLoad.current) {
        firstLoad.current = false;
        if (!lastSeen.current && data.latest) {
          lastSeen.current = data.latest;
          localStorage.setItem(SEEN_KEY, data.latest);
        } else {
          setUnread(fresh.length);
        }
        return;
      }

      if (fresh.length > 0) {
        setUnread(u => u + fresh.length);
        if (localStorage.getItem(SOUND_KEY) !== 'off') playChime();
        lastSeen.current = data.latest;
        localStorage.setItem(SEEN_KEY, data.latest);
      }
    } catch {
      // A failed poll is not worth interrupting anyone over.
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);

    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  // Work out whether this device can receive push, and whether it already does.
  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushState('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        setPushState('blocked');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && await reg.pushManager.getSubscription();
        setPushState(sub ? 'on' : 'off');
      } catch {
        setPushState('off');
      }
    })();
  }, []);

  const enablePush = async () => {
    setBusy(true);
    setMessage('');
    try {
      const config = await api.getNotificationConfig();
      if (!config.enabled || !config.publicKey) {
        setMessage('إشعارات الجهاز غير مُفعّلة على الخادم بعد.');
        setBusy(false);
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushState(permission === 'denied' ? 'blocked' : 'off');
        setMessage('لم يتم السماح بالإشعارات.');
        setBusy(false);
        return;
      }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey)
      });

      await api.subscribePush(sub.toJSON());
      setPushState('on');
      setMessage('تم تفعيل إشعارات الجهاز ✅');
      setTimeout(() => setMessage(''), 5000);
    } catch (err) {
      setMessage(`تعذّر التفعيل: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const disablePush = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        await api.unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setPushState('off');
      setMessage('تم إيقاف إشعارات الجهاز');
      setTimeout(() => setMessage(''), 4000);
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    try {
      const r = await api.testPush();
      setMessage(r.sent > 0
        ? `أُرسلت تجربة إلى ${r.sent} جهاز — شوف شاشتك.`
        : 'ماكو أي جهاز مفعّل الإشعارات بعد.');
      setTimeout(() => setMessage(''), 6000);
    } catch (err) {
      setMessage(`خطأ: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  /**
   * While the sheet is open the page behind it must not scroll.
   *
   * Two reasons: dragging the sheet should not drag the ledger underneath it,
   * and removing the page scrollbar removes the sliver of width it was taking —
   * which was pushing the sheet a few pixels past the edge of the screen.
   */
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const openPanel = () => {
    setOpen(!open);
    if (!open) {
      setUnread(0);
      if (items[0]) {
        lastSeen.current = items[0].date;
        localStorage.setItem(SEEN_KEY, items[0].date);
      }
    }
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
    if (next) playChime();
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={openPanel}
        title="الإشعارات"
        aria-label="الإشعارات"
        style={{
          position: 'relative',
          width: '44px', height: '44px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: unread > 0 ? 'var(--accent)' : 'var(--text-muted)'
        }}
      >
        {unread > 0 ? <BellRing size={24} /> : <Bell size={24} />}

        {unread > 0 && (
          <span style={{
            position: 'absolute', top: '4px', left: '4px',
            minWidth: '20px', height: '20px', padding: '0 5px',
            borderRadius: '10px', backgroundColor: 'var(--danger)', color: '#fff',
            fontSize: '11px', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* Rendered at the document root rather than inside the header.
          Nested in the header, the sheet kept inheriting an offset from its
          ancestors and sat 13px off the edge of the screen; at the root its
          position is the viewport's and nothing else can shift it. */}
      {open && createPortal(
        <>
          {/* Tapping anywhere else closes the panel. */}
          <div className="notif-backdrop" onClick={() => setOpen(false)} />

          {/* A dropdown on a wide screen, a sheet from the bottom on a phone.
              Anchored to the bell, it was being clipped by the small screen and
              half the list simply could not be reached. */}
          <div className="notif-panel">
            <div className="notif-header">
              <h3 style={{ margin: 0, fontSize: '17px' }}>الإشعارات</h3>

              <button
                onClick={toggleSound}
                title={soundOn ? 'إيقاف الصوت' : 'تشغيل الصوت'}
                style={{
                  width: '40px', height: '40px', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'var(--bg-light)', border: '1px solid var(--border-light)',
                  borderRadius: '9px', cursor: 'pointer',
                  color: soundOn ? 'var(--success)' : 'var(--text-muted)'
                }}
              >
                {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>

              {/* On the sheet there is no "outside" left to tap, so it needs its own way out. */}
              <button
                className="notif-close"
                onClick={() => setOpen(false)}
                aria-label="إغلاق"
                title="إغلاق"
              >
                <X size={20} />
              </button>
            </div>

            <div className="notif-body">

            {/* Device notifications */}
            <div style={{
              backgroundColor: 'var(--bg-light)',
              borderRadius: '10px', padding: '0.75rem', marginBottom: '0.9rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <Smartphone size={17} color="var(--primary)" />
                <strong style={{ fontSize: '14px' }}>إشعارات الجهاز</strong>
              </div>

              {pushState === 'unsupported' && (
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.7 }}>
                  هذا المتصفح ما يدعم إشعارات الجهاز.
                </p>
              )}

              {pushState === 'blocked' && (
                <p style={{ fontSize: '13px', color: 'var(--danger)', margin: 0, lineHeight: 1.7 }}>
                  الإشعارات محظورة لهذا الموقع. فعّلها من إعدادات المتصفح ثم أعد المحاولة.
                </p>
              )}

              {pushState === 'off' && (
                <>
                  <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 0.6rem 0', lineHeight: 1.7 }}>
                    فعّلها حتى توصلك كل عملية على شاشة التلفون، حتى لو الموقع مغلق.
                  </p>
                  <button className="btn btn-primary btn-block" onClick={enablePush} disabled={busy}>
                    {busy ? 'جاري التفعيل...' : 'فعّل إشعارات الجهاز'}
                  </button>
                </>
              )}

              {pushState === 'on' && (
                <>
                  <p style={{ fontSize: '13px', color: 'var(--success)', margin: '0 0 0.6rem 0', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Check size={15} /> مفعّلة على هذا الجهاز
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-secondary" onClick={sendTest} disabled={busy} style={{ flex: 1, padding: '0.5rem' }}>
                      تجربة
                    </button>
                    <button className="btn btn-secondary" onClick={disablePush} disabled={busy} style={{ flex: 1, padding: '0.5rem' }}>
                      <BellOff size={16} />
                      إيقاف
                    </button>
                  </div>
                </>
              )}

              {message && (
                <p style={{ fontSize: '13px', margin: '0.6rem 0 0 0', color: 'var(--text-main)', lineHeight: 1.7 }}>
                  {message}
                </p>
              )}
            </div>

            {/* The feed */}
            {items.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem', fontSize: '14px' }}>
                ماكو أي حركة بعد.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {items.slice(0, 30).map(item => {
                  const isDeposit = item.type === 'deposit';
                  return (
                    <button
                      key={`${item.customerId}-${item.id}`}
                      onClick={() => {
                        setOpen(false);
                        onOpenCustomer?.({ id: item.customerId, name: item.customerName });
                      }}
                      style={{
                        textAlign: 'right', width: '100%',
                        background: 'transparent',
                        border: '1px solid var(--border-light)',
                        borderRight: `4px solid ${isDeposit ? 'var(--success)' : 'var(--danger)'}`,
                        borderRadius: '10px', padding: '0.65rem 0.75rem', cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span style={{ fontWeight: 700, fontSize: '14px' }}>{item.customerName}</span>
                        <span style={{
                          fontWeight: 800, fontSize: '14px', direction: 'ltr',
                          color: isDeposit ? 'var(--success)' : 'var(--danger)'
                        }}>
                          {isDeposit ? '+' : '−'}{fmt(item.total)}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {isDeposit ? 'إيداع' : 'سحب / حوالة'} — {new Date(item.date).toLocaleString('ar-EG')}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
