/**
 * Application chrome: header, tab navigation, mobile drawer, footer.
 * Pure layout — receives navigation state and callbacks from App.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { ExamSession } from '../types';
import { Icon, type IconName } from '../components/ui';

type TabId = ExamSession['activeTab'];

export interface NavTab {
  id: TabId;
  label: string;
  icon: IconName;
}

const TOOL_TABS: NavTab[] = [
  { id: 'question-bank', label: 'Upload Questions', icon: 'upload' },
  { id: 'question-paper', label: 'Question Paper', icon: 'document' },
];

interface AppShellProps {
  tabs: NavTab[];
  activeTab: TabId;
  onNavigate: (tab: TabId) => void;
  onShowInfo: () => void;
  onToggleProfile: () => void;
  profileOpen: boolean;
  dark: boolean;
  setDark: (v: boolean) => void;
  banner?: ReactNode;
  children: ReactNode;
}

export function Logo({ className = 'w-8 h-8' }: { className?: string }) {
  return (
    <div className={`${className} rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center shadow-sm shadow-purple-700/30 shrink-0`}>
      <Icon name="cap" className="w-[62%] h-[62%] text-white" strokeWidth={1.8} />
    </div>
  );
}

export function AppShell({
  tabs, activeTab, onNavigate, onShowInfo, onToggleProfile, profileOpen, dark, setDark, banner, children,
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  function navigate(tab: TabId) {
    onNavigate(tab);
    setMenuOpen(false);
  }

  // Close drawer on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [menuOpen]);

  // Prevent body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const iconBtn = 'w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors';

  const drawerItem = (active: boolean) =>
    `w-full text-left px-5 py-3 text-sm font-medium transition-colors flex items-center gap-3 ${
      active
        ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 border-r-2 border-purple-600'
        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
    }`;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {banner}

      {/* ── Mobile drawer ─────────────────────────────────────────────────── */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 sm:hidden" onClick={() => setMenuOpen(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col transition-transform duration-200 ease-in-out sm:hidden ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Logo className="w-7 h-7" />
            <span className="text-base font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">ExamChecker</span>
          </div>
          <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <Icon name="x" className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => navigate(tab.id)} className={drawerItem(activeTab === tab.id)}>
              <Icon name={tab.icon} className="w-4 h-4 shrink-0" />
              {tab.label}
            </button>
          ))}

          <div className="mx-4 my-2 border-t border-zinc-100 dark:border-zinc-800" />

          {TOOL_TABS.map(tab => (
            <button key={tab.id} onClick={() => navigate(tab.id)} className={drawerItem(activeTab === tab.id)}>
              <Icon name={tab.icon} className="w-4 h-4 shrink-0" />
              {tab.label}
            </button>
          ))}

          <button
            onClick={() => { onShowInfo(); setMenuOpen(false); }}
            className="w-full text-left px-5 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-3"
          >
            <Icon name="info" className="w-4 h-4 shrink-0" />
            How it works
          </button>
        </nav>

        <div className="border-t border-zinc-100 dark:border-zinc-800 px-5 py-4 flex items-center justify-between">
          <button onClick={() => setDark(!dark)} className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <Icon name={dark ? 'sun' : 'moon'} className="w-4 h-4" />
            {dark ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            onClick={() => { onToggleProfile(); setMenuOpen(false); }}
            className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"
          >
            <Icon name="user" className="w-4 h-4" />
            Account
          </button>
        </div>
      </div>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-zinc-900/90 backdrop-blur border-b border-zinc-200 dark:border-zinc-800 px-3 sm:px-5 py-2.5 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMenuOpen(true)}
            className="sm:hidden w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Open menu"
          >
            <Icon name="menu" className="w-5 h-5" />
          </button>

          <button
            onClick={() => navigate('setup')}
            className="flex items-center gap-2.5 hover:opacity-85 transition-opacity"
          >
            <Logo />
            <span className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">ExamChecker</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {TOOL_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => navigate(tab.id)}
              title={tab.label}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Icon name={tab.icon} className="w-4 h-4" />
              {tab.label}
            </button>
          ))}

          <button onClick={onShowInfo} title="How it works" className={`hidden sm:flex ${iconBtn}`} aria-label="How it works">
            <Icon name="info" className="w-[18px] h-[18px]" />
          </button>

          <button onClick={() => setDark(!dark)} title={dark ? 'Light mode' : 'Dark mode'} className={iconBtn} aria-label="Toggle dark mode">
            <Icon name={dark ? 'sun' : 'moon'} className="w-[18px] h-[18px]" />
          </button>

          <button
            onClick={onToggleProfile}
            title="Account"
            aria-label="Account"
            className={`${iconBtn} ${profileOpen ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400' : ''}`}
          >
            <Icon name="user" className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ── Desktop tab bar ───────────────────────────────────────────────── */}
      {!profileOpen && (
        <nav className="hidden sm:block bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-4 print:hidden">
          <div className="flex gap-1 max-w-4xl mx-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => navigate(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === tab.id
                    ? 'border-purple-600 text-purple-700 dark:text-purple-400'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                <Icon name={tab.icon} className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {children}

      <footer className="mt-8 pb-6 text-center text-xs text-zinc-400 dark:text-zinc-600 print:hidden">
        © {new Date().getFullYear()} Vishal Singh. All rights reserved.
      </footer>
    </div>
  );
}
