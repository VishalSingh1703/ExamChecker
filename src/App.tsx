import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseError } from './lib/supabase';
import { getMyAccess, createAccessRequest } from './lib/access';
import { AuthGate } from './components/AuthGate';
import { ExamSetup } from './components/ExamSetup';
import { GradingView } from './components/GradingView';
import { ReportView } from './components/ReportView';
import { InfoModal } from './components/InfoModal';
import { ProfileView } from './components/ProfileView';
import { PasswordResetScreen } from './components/PasswordResetScreen';
import { HistoryView } from './components/HistoryView';
import { AdminPanel } from './components/AdminPanel';
import { AnalyticsView } from './components/AnalyticsView';
import { QuestionBankView } from './components/QuestionBankView';
import { ExamProvider, useExam, useExamDispatch } from './context/ExamContext';
import type { ExamSession } from './types';

const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL as string | undefined) ?? '';

const BASE_TABS = [
  { id: 'setup' as const, label: 'Setup' },
  { id: 'grade' as const, label: 'Grade' },
  { id: 'report' as const, label: 'Report' },
  { id: 'history' as const, label: 'History' },
  { id: 'analytics' as const, label: 'Analytics' },
];

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('dark-mode');
    const isDark = stored !== null
      ? stored === 'true'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
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
  session: Session;
  dark: boolean;
  setDark: (v: boolean) => void;
  isAdmin?: boolean;
}

function AppInner({ session, dark, setDark, isAdmin }: AppInnerProps) {
  const userId = session?.user?.id ?? '';
  const { activeTab } = useExam();
  const dispatch = useExamDispatch();
  const [showInfo, setShowInfo] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const TABS = [
    ...BASE_TABS,
    ...(isAdmin ? [{ id: 'admin' as const, label: 'Admin' }] : []),
  ];

  function navigate(tabId: ExamSession['activeTab']) {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tabId });
    setShowProfile(false);
    setMenuOpen(false);
  }

  // Close drawer on ESC
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [menuOpen]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const iconBtn = 'w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}

      {/* Mobile drawer backdrop */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 sm:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Mobile slide-in drawer */}
      <div className={`fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-gray-900 shadow-2xl flex flex-col transition-transform duration-200 ease-in-out sm:hidden ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <span className="text-base font-bold text-gray-900 dark:text-gray-100">Exam Checker</span>
          <button onClick={() => setMenuOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-2">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => navigate(tab.id)}
              className={`w-full text-left px-5 py-3.5 text-sm font-medium transition-colors flex items-center gap-3 ${
                activeTab === tab.id
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-r-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}

          <div className="mx-4 my-2 border-t border-gray-100 dark:border-gray-800" />

          <button
            onClick={() => navigate('question-bank')}
            className={`w-full text-left px-5 py-3.5 text-sm font-medium transition-colors flex items-center gap-3 ${
              activeTab === 'question-bank'
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-r-2 border-blue-600 dark:border-blue-400'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload Questions
          </button>

          <button
            onClick={() => { setShowInfo(true); setMenuOpen(false); }}
            className="w-full text-left px-5 py-3.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-3"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            How it works
          </button>
        </nav>

        {/* Drawer footer: dark mode + profile */}
        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4 flex items-center justify-between">
          <button
            onClick={() => setDark(!dark)}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
          >
            {dark ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="5" /><path strokeLinecap="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            onClick={() => { setShowProfile(p => !p); setMenuOpen(false); }}
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Account
          </button>
        </div>
      </div>

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-3 sm:px-4 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMenuOpen(true)}
            className="sm:hidden w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <button
            onClick={() => { setShowProfile(false); setMenuOpen(false); }}
            className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 hover:opacity-80"
          >
            Exam Checker
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Upload Questions — hidden on mobile (in drawer) */}
          <button
            onClick={() => navigate('question-bank')}
            title="Upload Questions to Bank"
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'question-bank'
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload Questions
          </button>

          {/* Info — hidden on mobile (in drawer) */}
          <button onClick={() => setShowInfo(true)} title="How it works" className={`hidden sm:flex ${iconBtn} border border-gray-200 dark:border-gray-700 font-bold text-sm`}>
            ?
          </button>

          {/* Dark mode — always visible */}
          <button onClick={() => setDark(!dark)} title={dark ? 'Light mode' : 'Dark mode'} className={iconBtn}>
            {dark ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="5" /><path strokeLinecap="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            )}
          </button>

          {/* Profile — always visible */}
          <button
            onClick={() => { setShowProfile(p => !p); setMenuOpen(false); }}
            title="Account"
            className={`${iconBtn} ${showProfile ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : ''}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </button>
        </div>
      </header>

      {showProfile ? (
        <main className="p-3 sm:p-4 max-w-4xl mx-auto">
          <ProfileView user={session.user} onBack={() => setShowProfile(false)} />
        </main>
      ) : (
        <>
          {/* Desktop tab bar — hidden on mobile */}
          <nav className="hidden sm:block bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 print:hidden">
            <div className="flex gap-1 max-w-4xl mx-auto">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => navigate(tab.id)}
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
          <main className={`p-3 sm:p-4 mx-auto ${activeTab === 'analytics' || activeTab === 'admin' ? 'max-w-6xl' : 'max-w-4xl'}`}>
            {activeTab === 'setup' && <ExamSetup userId={userId} />}
            {activeTab === 'grade' && <GradingView />}
            {activeTab === 'report' && <ReportView userId={userId} />}
            {activeTab === 'history' && <HistoryView userId={userId} />}
            {activeTab === 'analytics' && <AnalyticsView userId={userId} />}
            {activeTab === 'admin' && isAdmin && <AdminPanel adminEmail={ADMIN_EMAIL} />}
            {activeTab === 'question-bank' && (
              <QuestionBankView
                userId={userId}
                onBack={() => navigate('setup')}
              />
            )}
          </main>

          {/* Footer */}
          <footer className="mt-8 pb-6 text-center text-xs text-gray-400 dark:text-gray-600 print:hidden">
            © {new Date().getFullYear()} Vishal Singh. All rights reserved.
          </footer>
        </>
      )}
    </div>
  );
}

// ── Access gate screens ────────────────────────────────────────────────────────

function AccessScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-4 gap-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-8 w-full max-w-sm border border-gray-200 dark:border-gray-800 text-center">
        {children}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-600">© {new Date().getFullYear()} Vishal Singh. All rights reserved.</p>
    </div>
  );
}

function AdminContactLink({ userEmail }: { userEmail?: string }) {
  if (!ADMIN_EMAIL) return null;
  const body = encodeURIComponent(`Hello, I have requested access to ExamChecker with email: ${userEmail ?? ''}`);
  const href = `mailto:${ADMIN_EMAIL}?subject=Access%20Request%20-%20ExamChecker&body=${body}`;
  return (
    <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
      Need help? Email the admin:{' '}
      <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline break-all">
        {ADMIN_EMAIL}
      </a>
    </p>
  );
}

function SignOutButton() {
  return (
    <button
      onClick={() => supabase?.auth.signOut()}
      className="mt-5 w-full py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
    >
      Sign Out
    </button>
  );
}

function PendingScreen({ userEmail }: { userEmail?: string }) {
  return (
    <AccessScreen>
      <div className="flex justify-center mb-4">
        <div className="w-14 h-14 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
          <svg className="w-7 h-7 text-yellow-500 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H5z" />
          </svg>
        </div>
      </div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Awaiting Approval</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Your access request has been submitted. The admin will review and approve your account.
      </p>
      <AdminContactLink userEmail={userEmail} />
      <SignOutButton />
    </AccessScreen>
  );
}

function RevokedScreen({ userEmail }: { userEmail?: string }) {
  return (
    <AccessScreen>
      <div className="flex justify-center mb-4">
        <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg className="w-7 h-7 text-red-500 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      </div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Access Revoked</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Your access to ExamChecker has been revoked. Please contact the admin to restore access.
      </p>
      {ADMIN_EMAIL && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
          Contact admin:{' '}
          <a
            href={`mailto:${ADMIN_EMAIL}?subject=Access%20Request%20-%20ExamChecker&body=${encodeURIComponent(`Hello, I have requested access to ExamChecker with email: ${userEmail ?? ''}`)}`}
            className="text-blue-600 dark:text-blue-400 hover:underline break-all"
          >
            {ADMIN_EMAIL}
          </a>
        </p>
      )}
      <SignOutButton />
    </AccessScreen>
  );
}

function ExpiredScreen({ userEmail }: { userEmail?: string }) {
  return (
    <AccessScreen>
      <div className="flex justify-center mb-4">
        <div className="w-14 h-14 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
          <svg className="w-7 h-7 text-orange-500 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      </div>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Trial Expired</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Your trial period has ended. Please contact the admin to renew your access.
      </p>
      {ADMIN_EMAIL && (
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
          Contact admin:{' '}
          <a
            href={`mailto:${ADMIN_EMAIL}?subject=Access%20Request%20-%20ExamChecker&body=${encodeURIComponent(`Hello, I have requested access to ExamChecker with email: ${userEmail ?? ''}`)}`}
            className="text-blue-600 dark:text-blue-400 hover:underline break-all"
          >
            {ADMIN_EMAIL}
          </a>
        </p>
      )}
      <SignOutButton />
    </AccessScreen>
  );
}

// ── Root App component ─────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [dark, setDark] = useDarkMode();
  const [accessStatus, setAccessStatus] = useState<'loading' | 'ok' | 'pending' | 'revoked' | 'expired'>('loading');

  useEffect(() => {
    if (!supabase) { setSession(null); return; }

    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
        setSession(s ?? null);
      } else {
        setPasswordRecovery(false);
        setSession(s ?? null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Run access check whenever session changes to a valid session
  useEffect(() => {
    if (!session) return;

    async function checkAccess(s: Session) {
      const isAdmin = ADMIN_EMAIL && s.user.email === ADMIN_EMAIL;
      if (isAdmin) { setAccessStatus('ok'); return; }

      const access = await getMyAccess(s.user.id);
      if (!access) {
        await createAccessRequest(s.user.id, s.user.email ?? '');
        setAccessStatus('pending');
        return;
      }
      if (access.status === 'revoked') { setAccessStatus('revoked'); return; }
      if (access.status === 'pending') { setAccessStatus('pending'); return; }
      if (access.status === 'approved') {
        const expired = access.trial_ends_at ? new Date(access.trial_ends_at) < new Date() : false;
        setAccessStatus(expired ? 'expired' : 'ok');
        return;
      }
    }

    checkAccess(session);
  }, [session]);

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  // User clicked a password-reset link — intercept before anything else
  if (passwordRecovery) {
    return <PasswordResetScreen />;
  }

  if (!supabase || session) {
    // If supabase is not configured, skip access check entirely
    if (!supabase) {
      return (
        <ExamProvider>
          {supabaseError && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2 text-xs text-yellow-700 dark:text-yellow-400 text-center print:hidden">
              Auth disabled: {supabaseError}
            </div>
          )}
          <AppInner session={session!} dark={dark} setDark={setDark} />
        </ExamProvider>
      );
    }

    const isAdmin = !!(ADMIN_EMAIL && session?.user.email === ADMIN_EMAIL);

    // Access check screens
    if (accessStatus === 'loading') {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Checking access…
          </div>
        </div>
      );
    }

    if (accessStatus === 'pending') {
      return <PendingScreen userEmail={session?.user.email} />;
    }

    if (accessStatus === 'revoked') {
      return <RevokedScreen userEmail={session?.user.email} />;
    }

    if (accessStatus === 'expired') {
      return <ExpiredScreen userEmail={session?.user.email} />;
    }

    // accessStatus === 'ok'
    return (
      <ExamProvider>
        {supabaseError && (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2 text-xs text-yellow-700 dark:text-yellow-400 text-center print:hidden">
            Auth disabled: {supabaseError}
          </div>
        )}
        <AppInner session={session!} dark={dark} setDark={setDark} isAdmin={isAdmin} />
      </ExamProvider>
    );
  }

  return <AuthGate onAuth={() => {}} />;
}
