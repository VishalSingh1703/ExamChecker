import { useState } from 'react';
import { supabase } from '../../services/data/supabase';
import { Button, Icon, TextInput, Alert } from '../../components/ui';

export function PasswordResetScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleReset() {
    if (!supabase) return;
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
    } else {
      setDone(true);
      // Sign out so the user logs in fresh with the new password
      await supabase.auth.signOut();
    }
    setLoading(false);
  }

  if (done) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg p-8 w-full max-w-sm border border-zinc-200 dark:border-zinc-800 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
            <Icon name="check" className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Password updated!</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Your password has been changed. Please sign in with your new password.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg p-8 w-full max-w-sm border border-zinc-200 dark:border-zinc-800">
        <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-4">
          <Icon name="lock" className="w-6 h-6 text-purple-700 dark:text-purple-400" />
        </div>
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">Set new password</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">Choose a strong password for your account.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">New Password</label>
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus placeholder="Min. 6 characters" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Confirm Password</label>
            <TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleReset()} placeholder="Re-enter new password" />
          </div>

          {error && <Alert tone="error">{error}</Alert>}

          <Button className="w-full" onClick={handleReset} disabled={!password || !confirm} loading={loading}>
            {loading ? 'Updating password…' : 'Set New Password'}
          </Button>
        </div>
      </div>
    </div>
  );
}
