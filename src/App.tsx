import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseError } from './lib/supabase';
import { AuthGate } from './components/AuthGate';
import { ExamSetup } from './components/ExamSetup';
import { GradingView } from './components/GradingView';
import { ReportView } from './components/ReportView';
import { ExamProvider, useExam, useExamDispatch } from './context/ExamContext';

const TABS = [
  { id: 'setup', label: 'Setup' },
  { id: 'grade', label: 'Grade' },
  { id: 'report', label: 'Report' },
] as const;

function AppInner({ session }: { session: Session | null }) {
  const { activeTab } = useExam();
  const dispatch = useExamDispatch();

  async function handleLogout() {
    if (supabase) await supabase.auth.signOut();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between print:hidden">
        <h1 className="text-lg font-bold text-gray-900">Exam Checker</h1>
        {session && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 hidden sm:block">{session.user.email}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1 rounded-lg hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      {/* Tabs */}
      <nav className="bg-white border-b border-gray-200 px-4 print:hidden">
        <div className="flex gap-1 max-w-4xl mx-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', payload: tab.id })}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
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

  useEffect(() => {
    // If Supabase isn't configured, skip auth entirely
    if (!supabase) {
      setSession(null);
      return;
    }

    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  // If Supabase isn't set up, or user is logged in — show the app
  if (!supabase || session) {
    return (
      <ExamProvider>
        {supabaseError && (
          <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-xs text-yellow-700 text-center print:hidden">
            Auth disabled: {supabaseError}
          </div>
        )}
        <AppInner session={session} />
      </ExamProvider>
    );
  }

  // Supabase is configured but no session — show login
  return <AuthGate onAuth={() => {}} />;
}
