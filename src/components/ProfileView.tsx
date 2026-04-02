import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { UserStats } from '../services/stats';

const inputClass =
  'w-full border border-slate-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600';

interface Props {
  user: User;
  onBack: () => void;
}

export function ProfileView({ user, onBack }: Props) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stats, setStats] = useState<UserStats | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('user_stats')
      .select('user_id, reports_generated, pages_scanned, words_extracted')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setStats(data as UserStats); });
  }, [user.id]);

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    const { error } = await supabase!.auth.updateUser({ password: newPassword });
    if (error) {
      setError(error.message);
    } else {
      setSuccess('Password updated successfully!');
      setNewPassword('');
      setConfirmPassword('');
    }
    setLoading(false);
  }

  async function handleSignOut() {
    if (supabase) await supabase.auth.signOut();
  }

  return (
    <div className="max-w-lg mx-auto space-y-5 py-4">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Account info */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 p-6">
        <div className="flex items-center gap-4 mb-1">
          <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-purple-700 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400 dark:text-zinc-500 uppercase tracking-wide mb-0.5">Signed in as</p>
            <p className="text-base font-semibold text-slate-900 dark:text-zinc-100 break-all">{user.email}</p>
          </div>
        </div>
      </div>

      {/* Usage stats */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100 mb-4">Your Usage</h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Reports Generated', value: stats?.reports_generated ?? 0, color: 'text-purple-700 dark:text-purple-400' },
            { label: 'Pages Scanned', value: stats?.pages_scanned ?? 0, color: 'text-purple-600 dark:text-purple-300' },
            { label: 'Words Extracted', value: (stats?.words_extracted ?? 0).toLocaleString(), color: 'text-violet-600 dark:text-violet-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-4 text-center border border-slate-100 dark:border-zinc-700">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 leading-tight">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 dark:text-zinc-600 mt-3">Counts are cumulative and never decrease.</p>
      </div>

      {/* Change password */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100 mb-4">Change Password</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
              placeholder="Min. 6 characters"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()}
              className={inputClass}
              placeholder="Re-enter new password"
            />
          </div>

          {error && (
            <p className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {success && (
            <p className="text-green-700 dark:text-green-400 text-sm bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              {success}
            </p>
          )}

          <button
            onClick={handleChangePassword}
            disabled={loading || !newPassword || !confirmPassword}
            className="w-full bg-purple-700 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </div>

      {/* Sign out */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-zinc-100 mb-1">Sign Out</h2>
        <p className="text-sm text-slate-500 dark:text-zinc-400 mb-4">You will be returned to the login screen.</p>
        <button
          onClick={handleSignOut}
          className="w-full py-2.5 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
