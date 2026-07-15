import { useState, useEffect } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../services/data/supabase';
import type { UserStats } from '../../services/data/stats';
import { Button, Card, Icon, TextInput, Alert } from '../../components/ui';

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
    if (!supabase) return;
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
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setError(error.message);
    } else {
      setSuccess('Password updated successfully!');
      setNewPassword('');
      setConfirmPassword('');
    }
    setLoading(false);
  }

  return (
    <div className="max-w-lg mx-auto space-y-5 py-4 animate-fade-in">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-200"
      >
        <Icon name="chevronLeft" className="w-4 h-4" />
        Back
      </button>

      <Card className="p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-accent-100 dark:bg-accent-900/40 flex items-center justify-center shrink-0">
            <Icon name="user" className="w-6 h-6 text-accent-700 dark:text-accent-400" />
          </div>
          <div>
            <p className="text-xs font-medium text-ink-400 dark:text-ink-500 uppercase tracking-wide mb-0.5">Signed in as</p>
            <p className="text-base font-semibold text-ink-900 dark:text-ink-100 break-all">{user.email}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-ink-900 dark:text-ink-100 mb-4">Your Usage</h2>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Reports Generated', value: stats?.reports_generated ?? 0 },
            { label: 'Pages Scanned', value: stats?.pages_scanned ?? 0 },
            { label: 'Words Extracted', value: (stats?.words_extracted ?? 0).toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="bg-ink-50 dark:bg-ink-800 rounded-xl p-4 text-center border border-ink-100 dark:border-ink-700">
              <p className="text-2xl font-bold text-accent-700 dark:text-accent-400">{value}</p>
              <p className="text-xs text-ink-500 dark:text-ink-400 mt-1 leading-tight">{label}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-400 dark:text-ink-600 mt-3">Counts are cumulative and never decrease.</p>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-ink-900 dark:text-ink-100 mb-4">Change Password</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300 mb-1">New Password</label>
            <TextInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min. 6 characters" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-700 dark:text-ink-300 mb-1">Confirm Password</label>
            <TextInput type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleChangePassword()} placeholder="Re-enter new password" />
          </div>

          {error && <Alert tone="error">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}

          <Button className="w-full" onClick={handleChangePassword} disabled={!newPassword || !confirmPassword} loading={loading}>
            {loading ? 'Updating…' : 'Update Password'}
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-base font-semibold text-ink-900 dark:text-ink-100 mb-1">Sign Out</h2>
        <p className="text-sm text-ink-500 dark:text-ink-400 mb-4">You will be returned to the login screen.</p>
        <button
          onClick={() => supabase?.auth.signOut()}
          className="w-full py-2.5 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 rounded-xl text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          Sign Out
        </button>
      </Card>
    </div>
  );
}
