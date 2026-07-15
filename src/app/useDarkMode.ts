import { useState, useEffect } from 'react';
import { readString, writeString, storageKeys } from '../services/storage';

/**
 * Dark-mode state. Lives at the top-level App component so it survives
 * session-driven remounts; applies the `dark` class synchronously in the
 * initializer to avoid a flash of the wrong theme.
 */
export function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const stored = readString(storageKeys.darkMode);
    const isDark = stored !== null ? stored === 'true' : false;
    document.documentElement.classList.toggle('dark', isDark);
    return isDark;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    writeString(storageKeys.darkMode, String(dark));
  }, [dark]);

  return [dark, setDark] as const;
}
