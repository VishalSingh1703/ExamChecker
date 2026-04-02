import { useState } from 'react';
import { supabase } from '../lib/supabase';

type View = 'login' | 'signup' | 'forgot' | 'verify-sent' | 'reset-sent' | 'phone-otp';
type Method = 'email' | 'phone';

const inputClass =
  'w-full border border-slate-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-700 focus:border-transparent bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600';

export function AuthGate({ onAuth }: { onAuth: () => void }) {
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

  // ── Email: sign in ────────────────────────────────────────────────────────
  async function handleEmailLogin() {
    if (!supabase) return;
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else onAuth();
    setLoading(false);
  }

  // ── Email: sign up ────────────────────────────────────────────────────────
  async function handleSignUp() {
    if (!supabase) return;
    setLoading(true);
    setError('');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
    } else if (data.user && data.user.identities?.length === 0) {
      setError('An account with this email already exists. Please sign in instead.');
    } else {
      setView('verify-sent');
    }
    setLoading(false);
  }

  // ── Email: forgot password ────────────────────────────────────────────────
  async function handleForgotPassword() {
    if (!supabase) return;
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) setError(error.message);
    else setView('reset-sent');
    setLoading(false);
  }

  // ── Phone: send OTP ───────────────────────────────────────────────────────
  async function handleSendOtp() {
    if (!supabase) return;
    const formatted = phone.startsWith('+') ? phone : `+${phone}`;
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithOtp({ phone: formatted });
    if (error) setError(error.message);
    else setView('phone-otp');
    setLoading(false);
  }

  // ── Phone: verify OTP ─────────────────────────────────────────────────────
  async function handleVerifyOtp() {
    if (!supabase) return;
    const formatted = phone.startsWith('+') ? phone : `+${phone}`;
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.verifyOtp({
      phone: formatted,
      token: otp,
      type: 'sms',
    });
    if (error) setError(error.message);
    else onAuth();
    setLoading(false);
  }

  // ── Phone OTP entry screen ────────────────────────────────────────────────
  if (view === 'phone-otp') {
    return (
      <Screen>
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-purple-700 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 text-center mb-2">Enter the code</h2>
        <p className="text-sm text-slate-500 dark:text-zinc-400 text-center mb-1">
          We sent a 6-digit code to
        </p>
        <p className="text-sm font-medium text-gray-800 dark:text-zinc-200 text-center mb-6">{phone}</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Verification Code</label>
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
          <button
            onClick={handleVerifyOtp}
            disabled={loading || otp.length < 6}
            className="w-full bg-purple-700 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Verifying…' : 'Verify Code'}
          </button>
          <button
            onClick={handleSendOtp}
            disabled={loading}
            className="w-full text-sm text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 py-1"
          >
            Resend code
          </button>
          <button
            onClick={() => { setView('login'); setOtp(''); setError(''); }}
            className="w-full text-sm text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 py-1"
          >
            ← Back
          </button>
        </div>
      </Screen>
    );
  }

  // ── Email verification sent ───────────────────────────────────────────────
  if (view === 'verify-sent') {
    return (
      <Screen>
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 text-center mb-2">Check your email</h2>
        <p className="text-sm text-slate-500 dark:text-zinc-400 text-center mb-1">We sent a verification link to</p>
        <p className="text-sm font-medium text-gray-800 dark:text-zinc-200 text-center mb-4 break-all">{email}</p>
        <p className="text-xs text-slate-400 dark:text-zinc-500 text-center mb-6">
          Click the link in the email to activate your account, then come back here to sign in.
        </p>
        <button onClick={() => resetForm('login')} className="w-full bg-purple-700 text-white py-2 rounded-lg text-sm font-medium hover:bg-purple-800">
          Back to Sign In
        </button>
      </Screen>
    );
  }

  // ── Password reset sent ───────────────────────────────────────────────────
  if (view === 'reset-sent') {
    return (
      <Screen>
        <div className="flex justify-center mb-4">
          <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-purple-700 dark:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-zinc-100 text-center mb-2">Reset email sent</h2>
        <p className="text-sm text-slate-500 dark:text-zinc-400 text-center mb-1">We sent a password reset link to</p>
        <p className="text-sm font-medium text-gray-800 dark:text-zinc-200 text-center mb-4 break-all">{email}</p>
        <p className="text-xs text-slate-400 dark:text-zinc-500 text-center mb-6">Check your inbox and click the link to reset your password.</p>
        <button onClick={() => resetForm('login')} className="w-full bg-purple-700 text-white py-2 rounded-lg text-sm font-medium hover:bg-purple-800">
          Back to Sign In
        </button>
      </Screen>
    );
  }

  // ── Forgot password ───────────────────────────────────────────────────────
  if (view === 'forgot') {
    return (
      <Screen>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-1">Forgot password?</h1>
        <p className="text-slate-500 dark:text-zinc-400 text-sm mb-6">Enter your email and we'll send you a reset link.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleForgotPassword()} autoFocus className={inputClass} placeholder="teacher@school.com" />
          </div>
          {error && <ErrorBox message={error} />}
          <button onClick={handleForgotPassword} disabled={loading || !email} className="w-full bg-purple-700 text-white py-2 rounded-lg text-sm font-medium hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Sending…' : 'Send Reset Email'}
          </button>
          <button onClick={() => resetForm('login')} className="w-full text-sm text-slate-500 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-zinc-200 py-1">
            ← Back to Sign In
          </button>
        </div>
      </Screen>
    );
  }

  // ── Sign up (email only) ──────────────────────────────────────────────────
  if (view === 'signup') {
    return (
      <Screen>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-1">Create account</h1>
        <p className="text-slate-500 dark:text-zinc-400 text-sm mb-6">Submit a request — once approved, you'll receive access to ExamChecker.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus className={inputClass} placeholder="teacher@school.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Password</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSignUp()} className={`${inputClass} pr-10`} placeholder="Min. 6 characters" />
              <button type="button" tabIndex={-1} onClick={() => setShowPassword(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300">
                {showPassword
                  ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                }
              </button>
            </div>
          </div>
          {error && <ErrorBox message={error} />}
          <button onClick={handleSignUp} disabled={loading || !email || !password} className="w-full bg-purple-700 text-white py-2 rounded-lg text-sm font-medium hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Submitting request…' : 'Request Access'}
          </button>
          <p className="text-center text-sm text-slate-500 dark:text-zinc-400">
            Already have an account?{' '}
            <button onClick={() => resetForm('login')} className="text-purple-700 dark:text-purple-400 font-medium hover:underline">Sign In</button>
          </p>
        </div>
      </Screen>
    );
  }

  // ── Login screen (default) — Email or Phone tabs ──────────────────────────
  return (
    <Screen>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 mb-1">Exam Checker</h1>
      <p className="text-slate-500 dark:text-zinc-400 text-sm mb-5">Sign in to continue</p>

      {/* Method tabs */}
      <div className="flex rounded-lg border border-slate-200 dark:border-zinc-700 overflow-hidden mb-5">
        <button
          onClick={() => switchMethod('email')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            method === 'email'
              ? 'bg-purple-700 text-white'
              : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800'
          }`}
        >
          Email
        </button>
        <button
          onClick={() => switchMethod('phone')}
          className={`flex-1 py-2 text-sm font-medium transition-colors border-l border-slate-200 dark:border-zinc-700 ${
            method === 'phone'
              ? 'bg-purple-700 text-white'
              : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800'
          }`}
        >
          Phone
        </button>
      </div>

      {method === 'email' ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus className={inputClass} placeholder="teacher@school.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Password</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleEmailLogin()} className={`${inputClass} pr-10`} placeholder="••••••••" />
              <button type="button" tabIndex={-1} onClick={() => setShowPassword(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300">
                {showPassword
                  ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                }
              </button>
            </div>
          </div>
          {error && <ErrorBox message={error} />}
          <button onClick={handleEmailLogin} disabled={loading || !email || !password} className="w-full bg-purple-700 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          <button onClick={() => resetForm('forgot')} className="w-full py-2.5 border border-slate-300 dark:border-zinc-700 rounded-lg text-sm font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800">
            Forgot Password?
          </button>
          <p className="text-center text-sm text-slate-500 dark:text-zinc-400">
            Don't have an account?{' '}
            <button onClick={() => resetForm('signup')} className="text-purple-700 dark:text-purple-400 font-medium hover:underline">Create one</button>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300 mb-1">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
              autoFocus
              className={inputClass}
              placeholder="+91 98765 43210"
            />
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-1">Include country code (e.g. +91 for India, +1 for US)</p>
          </div>
          {error && <ErrorBox message={error} />}
          <button onClick={handleSendOtp} disabled={loading || !phone} className="w-full bg-purple-700 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Sending code…' : 'Send OTP'}
          </button>
          <p className="text-xs text-slate-400 dark:text-zinc-500 text-center">
            A 6-digit verification code will be sent via SMS. Works for both sign-in and sign-up.
          </p>
        </div>
      )}
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-lg p-8 w-full max-w-sm border border-slate-200 dark:border-zinc-800">
        {children}
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
