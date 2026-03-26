import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { UserStats } from '../services/stats';

const inputClass =
  'w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600';

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
        className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Account info */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <div className="flex items-center gap-4 mb-1">
          <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">Signed in as</p>
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100 break-all">{user.email}</p>
          </div>
        </div>
      </div>

      {/* Usage stats */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Your Usage</h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Reports Generated', value: stats?.reports_generated ?? 0, color: 'text-blue-600 dark:text-blue-400' },
            { label: 'Pages Scanned', value: stats?.pages_scanned ?? 0, color: 'text-indigo-600 dark:text-indigo-400' },
            { label: 'Words Extracted', value: (stats?.words_extracted ?? 0).toLocaleString(), color: 'text-purple-600 dark:text-purple-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center border border-gray-100 dark:border-gray-700">
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-tight">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-600 mt-3">Counts are cumulative and never decrease.</p>
      </div>

      {/* Change password */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Change Password</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
              placeholder="Min. 6 characters"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Password</label>
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
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </div>

      {/* Sign out */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Sign Out</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">You will be returned to the login screen.</p>
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
