import { useEffect, useRef } from 'react';

/**
 * Keeps the screen in step with the server.
 *
 * The app only ever fetched when it mounted or when you yourself did something,
 * so an office with the site open on a phone and a computer showed two different
 * books: a transaction recorded on one stayed invisible on the other until
 * somebody thought to reload. For a shared ledger that is not a cosmetic
 * problem — it is two people reading different balances for the same customer.
 *
 * Two triggers, because they cover different habits:
 *
 *   - Coming back to the tab. Someone records a transaction on their phone, then
 *     turns to the computer; the moment that window is looked at again it
 *     refreshes. This is the one that matters most, and it costs nothing while
 *     nobody is looking.
 *
 *   - A quiet poll while the tab is actually visible, for the screen sitting
 *     open on the counter that nobody is switching away from.
 *
 * Polling stops entirely when the tab is hidden — a phone in a pocket should not
 * be waking up to ask a server for a ledger nobody is reading.
 */
export default function useAutoRefresh(refresh, { intervalMs = 20000, enabled = true } = {}) {
  // Held in a ref so a re-render with a new closure does not restart the timer.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    // Never let two refreshes overlap: on a slow connection the interval would
    // otherwise stack requests faster than they come back.
    const run = async () => {
      if (inFlight.current) return;
      if (document.visibilityState !== 'visible') return;

      inFlight.current = true;
      try {
        await refreshRef.current();
      } catch {
        // A failed background refresh is not worth interrupting anyone over;
        // the next tick tries again.
      } finally {
        inFlight.current = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };

    const timer = setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [intervalMs, enabled]);
}
