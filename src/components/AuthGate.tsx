import { useState } from 'react';
import { supabase } from '../lib/supabase';

type View = 'login' | 'signup' | 'forgot' | 'verify-sent' | 'reset-sent' | 'phone-otp';
type Method = 'email' | 'phone';

const inputClass =
  'w-full border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600';

export function AuthGate({ onAuth }: { onAuth: () => void }) {
  const [view, setView] = useState<View>('login');
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function resetForm(nextView: View) {
    setError('');
    setPassword('');
    setOtp('');
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
          <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 text-center mb-2">Enter the code</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-1">
          We sent a 6-digit code to
        </p>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 text-center mb-6">{phone}</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Verification Code</label>
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
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Verifying…' : 'Verify Code'}
          </button>
          <button
            onClick={handleSendOtp}
            disabled={loading}
            className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1"
          >
            Resend code
          </button>
          <button
            onClick={() => { setView('login'); setOtp(''); setError(''); }}
            className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1"
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
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 text-center mb-2">Check your email</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-1">We sent a verification link to</p>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 text-center mb-4 break-all">{email}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center mb-6">
          Click the link in the email to activate your account, then come back here to sign in.
        </p>
        <button onClick={() => resetForm('login')} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
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
          <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 text-center mb-2">Reset email sent</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-1">We sent a password reset link to</p>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 text-center mb-4 break-all">{email}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center mb-6">Check your inbox and click the link to reset your password.</p>
        <button onClick={() => resetForm('login')} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          Back to Sign In
        </button>
      </Screen>
    );
  }

  // ── Forgot password ───────────────────────────────────────────────────────
  if (view === 'forgot') {
    return (
      <Screen>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Forgot password?</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">Enter your email and we'll send you a reset link.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleForgotPassword()} autoFocus className={inputClass} placeholder="teacher@school.com" />
          </div>
          {error && <ErrorBox message={error} />}
          <button onClick={handleForgotPassword} disabled={loading || !email} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Sending…' : 'Send Reset Email'}
          </button>
          <button onClick={() => resetForm('login')} className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 py-1">
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Create account</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">We'll send a verification email to confirm your address.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus className={inputClass} placeholder="teacher@school.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSignUp()} className={inputClass} placeholder="Min. 6 characters" />
          </div>
          {error && <ErrorBox message={error} />}
          <button onClick={handleSignUp} disabled={loading || !email || !password} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Creating account…' : 'Create Account & Send Verification Email'}
          </button>
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            Already have an account?{' '}
            <button onClick={() => resetForm('login')} className="text-blue-600 dark:text-blue-400 font-medium hover:underline">Sign In</button>
          </p>
        </div>
      </Screen>
    );
  }

  // ── Login screen (default) — Email or Phone tabs ──────────────────────────
  return (
    <Screen>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Exam Checker</h1>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-5">Sign in to continue</p>

      {/* Method tabs */}
      <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mb-5">
        <button
          onClick={() => switchMethod('email')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            method === 'email'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          Email
        </button>
        <button
          onClick={() => switchMethod('phone')}
          className={`flex-1 py-2 text-sm font-medium transition-colors border-l border-gray-200 dark:border-gray-700 ${
            method === 'phone'
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          Phone
        </button>
      </div>

      {method === 'email' ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus className={inputClass} placeholder="teacher@school.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleEmailLogin()} className={inputClass} placeholder="••••••••" />
          </div>
          {error && <ErrorBox message={error} />}
          <button onClick={handleEmailLogin} disabled={loading || !email || !password} className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          <button onClick={() => resetForm('forgot')} className="w-full py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            Forgot Password?
          </button>
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            Don't have an account?{' '}
            <button onClick={() => resetForm('signup')} className="text-blue-600 dark:text-blue-400 font-medium hover:underline">Create one</button>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
              autoFocus
              className={inputClass}
              placeholder="+91 98765 43210"
            />
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Include country code (e.g. +91 for India, +1 for US)</p>
          </div>
          {error && <ErrorBox message={error} />}
          <button onClick={handleSendOtp} disabled={loading || !phone} className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'Sending code…' : 'Send OTP'}
          </button>
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            A 6-digit verification code will be sent via SMS. Works for both sign-in and sign-up.
          </p>
        </div>
      )}
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg p-8 w-full max-w-sm border border-gray-200 dark:border-gray-800">
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
