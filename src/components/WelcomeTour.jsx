import React, { useState, useEffect } from 'react';
import {
  Landmark, UserPlus, ArrowLeftRight, FileText, Search, Wallet,
  BarChart3, ShieldCheck, Receipt, X, ChevronLeft, ChevronRight
} from 'lucide-react';

/**
 * The welcome tour.
 *
 * Shown three times per account, then it stops on its own — long enough to learn
 * the app, short enough not to become an obstacle. The count is stored per user
 * id, so a new employee on a shared phone still gets their own three.
 *
 * Built for a phone first: this is where the app is actually used, so the card
 * fills the screen, the text is large, and the controls sit under the thumb.
 */

const STORAGE_PREFIX = 'teller_tour_seen_';
const MAX_SHOWS = 3;

/** How many times this user has already seen the tour. */
function timesSeen(userId) {
  const raw = localStorage.getItem(STORAGE_PREFIX + userId);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function markSeen(userId) {
  localStorage.setItem(STORAGE_PREFIX + userId, String(timesSeen(userId) + 1));
}

/** Marks the tour finished for good, whatever the count says. */
function markDone(userId) {
  localStorage.setItem(STORAGE_PREFIX + userId, String(MAX_SHOWS));
}

/**
 * Whether to show the tour.
 *
 * Two gates. The server flag is the one that matters: switching the tour off is
 * a decision about the account, not about the browser it was made in, and
 * keeping it per-device meant dismissing it on the phone left it still
 * appearing on the computer. The local count only stops it after a few showings
 * for someone who never dismisses it explicitly.
 */
export function shouldShowTour(user, serverEnabled = true) {
  if (!user?.id) return false;
  if (serverEnabled === false) return false;
  return timesSeen(user.id) < MAX_SHOWS;
}

/** Lets the user reopen it later from the settings screen. */
export function resetTour(userId) {
  localStorage.removeItem(STORAGE_PREFIX + userId);
}

// Steps everyone sees. Owner-only screens are appended below.
const COMMON_STEPS = [
  {
    icon: Landmark,
    color: '#0891b2',
    title: 'أهلاً بك في حساب الصراف الذكي',
    body: 'هذا دليل سريع يعلّمك كل شي بالموقع خطوة خطوة. راح يظهرلك ثلاث مرات بس، وبعدها يوقف لحاله.',
    tip: 'تكدر تتخطاه بأي لحظة، وترجعله من صفحة الإعدادات.'
  },
  {
    icon: UserPlus,
    color: '#16a34a',
    title: '١ — شلون تضيف زبون جديد',
    body: 'من تبويب «الزبائن والحسابات»، اضغط زر «إضافة زبون جديد» الأخضر. اكتب اسم الزبون الكامل ورقم هاتفه، وبعدها اضغط «إضافة الزبون».',
    tip: 'رقم الهاتف مهم — بيه تنرسل كشوفات الحساب والوصولات على الواتساب.'
  },
  {
    icon: ShieldCheck,
    color: '#d97706',
    title: '٢ — النظام يحميك من الزبون المكرر',
    body: 'إذا كان اسم الزبون أو رقمه يشبه زبون موجود، الموقع راح يوقفك ويعرضلك الحساب الموجود. لأن نفس الشخص بحسابين يعني رصيدين غلط.',
    tip: 'إذا متأكد إنه شخص ثاني فعلاً، اضغط «زبون مختلف — أضفه».'
  },
  {
    icon: ArrowLeftRight,
    color: '#0891b2',
    title: '٣ — شلون تسجّل عملية (فلوس داخلة أو خارجة)',
    body: 'قرب اسم الزبون اضغط «عملية جديدة». اختر نوعها: «إيداع» يعني الزبون انطاك فلوس، و«سحب/حوالة» يعني أنت انطيته. اكتب المبلغ، وإذا اكو عمولة اكتبها.',
    tip: 'لازم تعلّم مربع التأكيد قبل الحفظ — حماية من الضغط بالغلط.'
  },
  {
    icon: FileText,
    color: '#0891b2',
    title: '٤ — كشف الحساب',
    body: 'زر «كشف الحساب» يفتحلك كل عمليات الزبون ورصيده. تكدر تختار الفترة، تنزّل الكشف PDF، أو ترسله للزبون على الواتساب بضغطة.',
    tip: 'زر «رابط الكشف» ينطي الزبون رابط يشوف بيه حسابه بأي وقت من تلفونه.'
  },
  {
    icon: Receipt,
    color: '#16a34a',
    title: '٥ — وصل لكل عملية',
    body: 'بجدول العمليات، كل سطر بيه زر وصل. الوصل يبيّن المبلغ والعمولة والرصيد وقت العملية — دليلك إذا الزبون أنكر.',
    tip: 'الزر الأخضر يرسل الوصل للزبون مباشرة على الواتساب.'
  },
  {
    icon: Search,
    color: '#7c3aed',
    title: '٦ — البحث بكل العمليات',
    body: 'تبويب «البحث في العمليات» يدوّرلك بكل الزبائن مرة وحدة — بالمبلغ، بالتاريخ، بالنوع، أو بالملاحظة.',
    tip: 'مفيد لمن يجيك زبون يكول «حوّلت مبلغ قبل شهرين» وما تتذكر.'
  }
];

const OWNER_STEPS = [
  {
    icon: Wallet,
    color: '#d97706',
    title: '٧ — صندوق المكتب',
    body: 'يحسبلك شكد المفروض يكون بجيبك فعلاً: رأس المال + الداخل − الخارج − المصاريف. وتكدر تسجّل جرد فعلي ويطلعلك الفرق.',
    tip: 'سجّل الجرد كل يوم — أي نقص ينكشف بيومه مو بعد شهر.'
  },
  {
    icon: BarChart3,
    color: '#0891b2',
    title: '٨ — التقارير',
    body: 'أرباحك حسب الفترة: اليوم، الأسبوع، الشهر، أو فترة تختارها. وتشوف الربح اليومي وأرباحك من كل زبون، وتصدّرها Excel.',
    tip: 'قارن الشهر الحالي بالشهر السابق حتى تعرف وين تمشي.'
  },
  {
    icon: ShieldCheck,
    color: '#16a34a',
    title: '٩ — الإعدادات، الموظفين، والنسخ الاحتياطي',
    body: 'من هنا تربط الواتساب، وتضيف موظفين بحسابات منفصلة (الموظف يسجّل عمليات بس)، وتشوف النسخ الاحتياطية اللي تنرسللك كل يوم.',
    tip: 'النسخة الاحتياطية مشفّرة — احتفظ بكلمة سرها بمكان ثاني غير التلفون.'
  }
];

const LAST_STEP = {
  icon: Landmark,
  color: '#16a34a',
  title: 'هذا كل شي — جاهز تبدي',
  body: 'صار عندك كل اللي تحتاجه. ابدي بإضافة أول زبون، وسجّل أول عملية.',
  tip: 'إذا نسيت شي، ارجعله من زر «شرح الموقع» بصفحة الإعدادات.'
};

export default function WelcomeTour({ user, onClose, onDismissForever }) {
  const [step, setStep] = useState(0);

  const steps = [
    ...COMMON_STEPS,
    ...(user?.permissions?.canViewReports ? OWNER_STEPS : []),
    LAST_STEP
  ];

  // Counted once per opening, not once per step.
  useEffect(() => {
    if (user?.id) markSeen(user.id);
  }, [user?.id]);

  const isLast = step === steps.length - 1;
  const current = steps[step];
  const Icon = current.icon;

  const finish = (permanently) => {
    if (permanently && user?.id) markDone(user.id);
    // Also switch it off for the account, so it cannot come back on another
    // device. Best effort — a failure here must not trap anyone in the tour.
    if (permanently && onDismissForever) onDismissForever();
    onClose();
  };

  const remaining = user?.id ? Math.max(MAX_SHOWS - timesSeen(user.id), 0) : 0;

  return (
    <div
      className="modal-overlay"
      style={{ padding: '0.75rem', alignItems: 'center', zIndex: 9999 }}
    >
      <div
        className="modal-content"
        style={{
          maxWidth: '440px',
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Progress + skip */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {steps.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === step ? '22px' : '8px',
                  height: '8px',
                  borderRadius: '4px',
                  backgroundColor: i === step ? current.color : (i < step ? '#94a3b8' : '#e2e8f0'),
                  transition: 'width .2s'
                }}
              />
            ))}
          </div>

          <button
            onClick={() => finish(false)}
            title="إغلاق"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '6px', minWidth: '44px', minHeight: '44px'
            }}
          >
            <X size={22} />
          </button>
        </div>

        {/* Body */}
        <div style={{ textAlign: 'center', flex: 1 }}>
          <div
            style={{
              width: '76px', height: '76px', borderRadius: '20px',
              backgroundColor: `${current.color}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.1rem auto'
            }}
          >
            <Icon size={40} color={current.color} />
          </div>

          <h2 style={{ fontSize: '21px', marginBottom: '0.85rem', color: 'var(--text-main)', lineHeight: 1.4 }}>
            {current.title}
          </h2>

          <p style={{ fontSize: '17px', lineHeight: 1.9, color: 'var(--text-main)', marginBottom: '1rem' }}>
            {current.body}
          </p>

          {current.tip && (
            <div
              style={{
                backgroundColor: `${current.color}0f`,
                border: `1px solid ${current.color}44`,
                borderRadius: '10px',
                padding: '0.8rem 0.9rem',
                fontSize: '15px',
                lineHeight: 1.75,
                color: 'var(--text-main)',
                textAlign: 'right'
              }}
            >
              💡 {current.tip}
            </div>
          )}
        </div>

        {/* Controls — big enough for a thumb */}
        <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.4rem' }}>
          {step > 0 && (
            <button
              className="btn btn-secondary"
              onClick={() => setStep(step - 1)}
              style={{ minHeight: '52px', padding: '0 1rem' }}
            >
              <ChevronRight size={20} />
              السابق
            </button>
          )}

          <button
            className="btn btn-primary"
            onClick={() => (isLast ? finish(true) : setStep(step + 1))}
            style={{ flex: 1, minHeight: '52px', fontSize: '17px' }}
          >
            {isLast ? 'تمام، خلصنا' : 'التالي'}
            {!isLast && <ChevronLeft size={20} />}
          </button>
        </div>

        {/* A real button, not muted text at the bottom: someone who wants this
            to stop should not have to hunt for the way to stop it. */}
        <button
          className="btn btn-secondary"
          onClick={() => finish(true)}
          style={{ marginTop: '0.85rem', minHeight: '48px', width: '100%' }}
        >
          إيقاف الشرح نهائياً
        </button>

        {remaining > 0 && (
          <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)', margin: '0.35rem 0 0 0' }}>
            سيظهر هذا الشرح {remaining} {remaining === 1 ? 'مرة' : 'مرات'} إضافية
          </p>
        )}
      </div>
    </div>
  );
}
