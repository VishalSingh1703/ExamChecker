import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseError } from './lib/supabase';
import { AuthGate } from './components/AuthGate';
import { ExamSetup } from './components/ExamSetup';
import { GradingView } from './components/GradingView';
import { ReportView } from './components/ReportView';
import { InfoModal } from './components/InfoModal';
import { ExamProvider, useExam, useExamDispatch } from './context/ExamContext';

const TABS = [
  { id: 'setup', label: 'Setup' },
  { id: 'grade', label: 'Grade' },
  { id: 'report', label: 'Report' },
] as const;

// Lifted to module level so it never reinitializes on remount
function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('dark-mode');
    const isDark = stored !== null
      ? stored === 'true'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    // Apply synchronously so there's no flash on first render
    document.documentElement.classList.toggle('dark', isDark);
    return isDark;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('dark-mode', String(dark));
  }, [dark]);

  return [dark, setDark] as const;
}

interface AppInnerProps {
  session: Session | null;
  dark: boolean;
  setDark: (v: boolean) => void;
}

function AppInner({ session, dark, setDark }: AppInnerProps) {
  const { activeTab } = useExam();
  const dispatch = useExamDispatch();
  const [showInfo, setShowInfo] = useState(false);

  async function handleLogout() {
    if (supabase) await supabase.auth.signOut();
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}

      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between print:hidden">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Exam Checker</h1>

        <div className="flex items-center gap-2">
          {/* Info button */}
          <button
            onClick={() => setShowInfo(true)}
            title="How it works"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors font-bold text-sm border border-gray-200 dark:border-gray-700"
          >
            ?
          </button>

          {/* Dark / light toggle */}
          <button
            onClick={() => setDark(!dark)}
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {dark ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="5" />
                <path strokeLinecap="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>

          {session && (
            <>
              <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:block ml-1">{session.user.email}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 px-3 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      {/* Tabs */}
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 print:hidden">
        <div className="flex gap-1 max-w-4xl mx-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', payload: tab.id })}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="p-4 max-w-4xl mx-auto">
        {activeTab === 'setup' && <ExamSetup />}
        {activeTab === 'grade' && <GradingView />}
        {activeTab === 'report' && <ReportView />}
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Dark mode lives here — never remounts, survives session changes
  const [dark, setDark] = useDarkMode();

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (!supabase || session) {
    return (
      <ExamProvider>
        {supabaseError && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2 text-xs text-yellow-700 dark:text-yellow-400 text-center print:hidden">
            Auth disabled: {supabaseError}
          </div>
        )}
        <AppInner session={session} dark={dark} setDark={setDark} />
      </ExamProvider>
    );
  }

  return <AuthGate onAuth={() => {}} />;
}
