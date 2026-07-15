import { useState, type ReactNode } from 'react';
import { supabase } from '../../services/data/supabase';
import { Logo } from '../../app/AppShell';
import { Button, Icon, TextInput, inputClass } from '../../components/ui';

type View = 'login' | 'signup' | 'forgot' | 'verify-sent' | 'reset-sent' | 'phone-otp';
type Method = 'email' | 'phone';

export function AuthGate({ banner }: { banner?: ReactNode }) {
  const [view, setView] = useState<View>('login');
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function resetForm(nextView: View) {
    setError('');
    setPassword('');
    setOtp('');
    setShowPassword(false);
    setView(nextView);
  }

  function switchMethod(m: Method) {
    setMethod(m);
    setError('');
    setOtp('');
    setView('login');
  }

  async function handleEmailLogin() {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } catch {
      setError('Could not reach the authentication server. Please try again later.');
    }
    setLoading(false);
  }

  async function handleSignUp() {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else if (data.user && data.user.identities?.length === 0) {
        setError('An account with this email already exists. Please sign in instead.');
      } else {
        setView('verify-sent');
      }
    } catch {
      setError('Could not reach the authentication server. Please try again later.');
    }
    setLoading(false);
  }

  async function handleForgotPassword() {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) setError(error.message);
      else setView('reset-sent');
    } catch {
      setError('Could not reach the authentication server. Please try again later.');
    }
    setLoading(false);
  }

  function formattedPhone(): string {
    const digits = phone.replace(/[^\d+]/g, '');
    return digits.startsWith('+') ? digits : `+${digits}`;
  }

  async function handleSendOtp() {
    if (!supabase) return;
    if (phone.replace(/\D/g, '').length < 8) {
      setError('Enter a valid phone number with country code (e.g. +91 98765 43210).');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: formattedPhone() });
      if (error) setError(error.message);
      else setView('phone-otp');
    } catch {
      setError('Could not reach the authentication server. Please try again later.');
    }
    setLoading(false);
  }

  async function handleVerifyOtp() {
    if (!supabase) return;
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: formattedPhone(), token: otp, type: 'sms' });
      if (error) setError(error.message);
    } catch {
      setError('Could not reach the authentication server. Please try again later.');
    }
    setLoading(false);
  }

  const passwordToggle = (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => setShowPassword(p => !p)}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      aria-label={showPassword ? 'Hide password' : 'Show password'}
    >
      <Icon name={showPassword ? 'eyeOff' : 'eye'} className="w-4 h-4" />
    </button>
  );

  // ── Phone OTP entry ─────────────────────────────────────────────────────────
  if (view === 'phone-otp') {
    return (
      <Screen banner={banner}>
        <StatusIcon icon="phone" />
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 text-center mb-2">Enter the code</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-1">We sent a 6-digit code to</p>
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 text-center mb-6">{phone}</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Verification Code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
              autoFocus
              className={`${inputClass} text-center text-2xl tracking-widest`}
              placeholder="000000"
            />
          </div>
          {error && <ErrorBox message={error} />}
          <Button className="w-full" onClick={handleVerifyOtp} disabled={otp.length < 6} loading={loading}>
            {loading ? 'Verifying…' : 'Verify Code'}
          </Button>
          <button onClick={handleSendOtp} disabled={loading} className="w-full text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 py-1">
            Resend code
          </button>
          <button onClick={() => { setView('login'); setOtp(''); setError(''); }} className="w-full text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 py-1">
            ← Back
          </button>
        </div>
      </Screen>
    );
  }

  // ── Verification email sent ─────────────────────────────────────────────────
  if (view === 'verify-sent') {
    return (
      <Screen banner={banner}>
        <StatusIcon icon="mail" tone="success" />
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 text-center mb-2">Check your email</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-1">We sent a verification link to</p>
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 text-center mb-4 break-all">{email}</p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center mb-6">
          Click the link in the email to activate your account, then come back here to sign in.
        </p>
        <Button className="w-full" onClick={() => resetForm('login')}>Back to Sign In</Button>
      </Screen>
    );
  }

  // ── Reset email sent ────────────────────────────────────────────────────────
  if (view === 'reset-sent') {
    return (
      <Screen banner={banner}>
        <StatusIcon icon="lock" />
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 text-center mb-2">Reset email sent</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-1">We sent a password reset link to</p>
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 text-center mb-4 break-all">{email}</p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center mb-6">Check your inbox and click the link to reset your password.</p>
        <Button className="w-full" onClick={() => resetForm('login')}>Back to Sign In</Button>
      </Screen>
    );
  }

  // ── Forgot password ─────────────────────────────────────────────────────────
  if (view === 'forgot') {
    return (
      <Screen banner={banner}>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-1 tracking-tight">Forgot password?</h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">Enter your email and we'll send you a reset link.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleForgotPassword()} autoFocus placeholder="teacher@school.com" />
          </div>
          {error && <ErrorBox message={error} />}
          <Button className="w-full" onClick={handleForgotPassword} disabled={!email} loading={loading}>
            {loading ? 'Sending…' : 'Send Reset Email'}
          </Button>
          <button onClick={() => resetForm('login')} className="w-full text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 py-1">
            ← Back to Sign In
          </button>
        </div>
      </Screen>
    );
  }

  // ── Sign up ─────────────────────────────────────────────────────────────────
  if (view === 'signup') {
    return (
      <Screen banner={banner}>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-1 tracking-tight">Create account</h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6">Submit a request — once approved, you'll receive access to ExamChecker.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="teacher@school.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Password</label>
            <div className="relative">
              <TextInput type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSignUp()} className="pr-10" placeholder="Min. 6 characters" />
              {passwordToggle}
            </div>
          </div>
          {error && <ErrorBox message={error} />}
          <Button className="w-full" onClick={handleSignUp} disabled={!email || !password} loading={loading}>
            {loading ? 'Submitting request…' : 'Request Access'}
          </Button>
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Already have an account?{' '}
            <button onClick={() => resetForm('login')} className="text-purple-700 dark:text-purple-400 font-medium hover:underline">Sign In</button>
          </p>
        </div>
      </Screen>
    );
  }

  // ── Login (default) ─────────────────────────────────────────────────────────
  return (
    <Screen banner={banner}>
      <div className="flex items-center gap-3 mb-1">
        <Logo className="w-9 h-9" />
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">ExamChecker</h1>
      </div>
      <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-5">Sign in to continue</p>

      <div className="flex rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden mb-5">
        {(['email', 'phone'] as Method[]).map(m => (
          <button
            key={m}
            onClick={() => switchMethod(m)}
            className={`flex-1 py-2 text-sm font-medium transition-colors capitalize ${
              method === m
                ? 'bg-purple-700 text-white'
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            } ${m === 'phone' ? 'border-l border-zinc-200 dark:border-zinc-700' : ''}`}
          >
            {m}
          </button>
        ))}
      </div>

      {method === 'email' ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Email</label>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="teacher@school.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Password</label>
            <div className="relative">
              <TextInput type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleEmailLogin()} className="pr-10" placeholder="••••••••" />
              {passwordToggle}
            </div>
          </div>
          {error && <ErrorBox message={error} />}
          <Button className="w-full" onClick={handleEmailLogin} disabled={!email || !password} loading={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>
          <button onClick={() => resetForm('forgot')} className="w-full py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800">
            Forgot Password?
          </button>
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Don't have an account?{' '}
            <button onClick={() => resetForm('signup')} className="text-purple-700 dark:text-purple-400 font-medium hover:underline">Create one</button>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Phone Number</label>
            <TextInput
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
              autoFocus
              placeholder="+91 98765 43210"
            />
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">Include country code (e.g. +91 for India, +1 for US)</p>
          </div>
          {error && <ErrorBox message={error} />}
          <Button className="w-full" onClick={handleSendOtp} disabled={!phone} loading={loading}>
            {loading ? 'Sending code…' : 'Send OTP'}
          </Button>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">
            A 6-digit verification code will be sent via SMS. Works for both sign-in and sign-up.
          </p>
        </div>
      )}
    </Screen>
  );
}

// ── Local pieces ──────────────────────────────────────────────────────────────

function Screen({ children, banner }: { children: ReactNode; banner?: ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      {banner}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg p-8 w-full max-w-sm border border-zinc-200 dark:border-zinc-800 animate-fade-in">
          {children}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ icon, tone = 'accent' }: { icon: 'phone' | 'mail' | 'lock'; tone?: 'accent' | 'success' }) {
  const cls = tone === 'success'
    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
    : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400';
  return (
    <div className="flex justify-center mb-4">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${cls}`}>
        <Icon name={icon} className="w-6 h-6" />
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
      {message}
    </p>
  );
}
