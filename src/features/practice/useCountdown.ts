import { useEffect, useRef, useState } from 'react';

/**
 * Counts down to a wall-clock deadline.
 *
 * Recomputes from Date.now() on every tick rather than decrementing, so a
 * throttled background tab (which may only fire once a minute) still reports
 * the correct remaining time, and a page reload picks up exactly where it left
 * off. `onExpire` fires at most once per deadline.
 *
 * @returns milliseconds remaining, floored at 0.
 */
export function useCountdown(deadlineAt: number | null, onExpire: () => void): number {
  const [remaining, setRemaining] = useState(() =>
    deadlineAt ? Math.max(0, deadlineAt - Date.now()) : 0,
  );

  // Keeps the latest callback without restarting the interval
  const onExpireRef = useRef(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; });

  const firedRef = useRef(false);

  useEffect(() => {
    if (deadlineAt === null) {
      setRemaining(0);
      return;
    }
    firedRef.current = false;

    const tick = () => {
      const left = Math.max(0, deadlineAt - Date.now());
      setRemaining(left);
      if (left === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    };

    tick(); // immediate — handles a rehydrate that is already past the deadline
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadlineAt]);

  return remaining;
}

/** Formats milliseconds as MM:SS (or H:MM:SS past an hour). */
export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
