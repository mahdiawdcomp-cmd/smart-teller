import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * One dialog shell for the whole app.
 *
 * Every modal used to close its own way — or not at all. Two of them had no
 * close control whatsoever, which on a phone means the only way out is to
 * reload the page and lose whatever you were doing.
 *
 * Closing works three ways here, because people reach for different ones:
 *   - the ✕ button, for anyone looking for it
 *   - tapping the dark area outside, which is the reflex on a phone
 *   - the Escape key, which is the reflex on a keyboard
 *
 * The backdrop only closes when the press *starts* on the backdrop. Without
 * that, selecting text inside the dialog and releasing the finger outside it
 * would count as an outside tap and throw the dialog away mid-sentence.
 */
export default function Modal({
  onClose,
  title,
  children,
  maxWidth = '550px',
  closeOnBackdrop = true
}) {
  const pressStartedOnBackdrop = useRef(false);

  // Escape, and keeping the page behind from scrolling under the dialog.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const handleBackdropMouseDown = (e) => {
    pressStartedOnBackdrop.current = e.target === e.currentTarget;
  };

  const handleBackdropMouseUp = (e) => {
    if (!closeOnBackdrop) return;
    if (e.target === e.currentTarget && pressStartedOnBackdrop.current) onClose();
    pressStartedOnBackdrop.current = false;
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
      onTouchStart={handleBackdropMouseDown}
      onTouchEnd={handleBackdropMouseUp}
    >
      <div
        className="modal-content"
        style={{ maxWidth, width: '100%' }}
        role="dialog"
        aria-modal="true"
      >
        {/* Sticky, so it stays reachable however far the form scrolls, and
            sized for a thumb rather than a mouse pointer. */}
        <div className="modal-close-bar">
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            title="إغلاق"
            style={{
              width: '44px',
              height: '44px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-light)',
              border: '1px solid var(--border-light)',
              borderRadius: '10px',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              flexShrink: 0
            }}
          >
            <X size={22} />
          </button>

          {title && (
            <h2 style={{ margin: '0 0.75rem', fontSize: '18px', flex: 1, textAlign: 'right' }}>
              {title}
            </h2>
          )}
        </div>

        {children}

        {/* Says the way out exists, for anyone who does not think to tap outside. */}
        <p style={{
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '12.5px',
          margin: '1rem 0 0 0'
        }}>
          اضغط خارج النافذة أو على ✕ للإغلاق
        </p>
      </div>
    </div>
  );
}
