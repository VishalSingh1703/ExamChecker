/**
 * Gate screens shown after sign-in while access is pending / revoked / expired.
 */
import type { ReactNode } from 'react';
import { supabase } from '../services/data/supabase';
import { env } from '../config/env';
import { Icon, type IconName } from '../components/ui';

function AccessScreen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-950 bg-desk flex flex-col items-center justify-center p-4 gap-4">
      <div className="bg-white dark:bg-ink-900 rounded-xl shadow-lift p-8 w-full max-w-sm border border-ink-200 dark:border-ink-700 text-center">
        {children}
      </div>
      <p className="text-xs text-ink-400 dark:text-ink-600">© {new Date().getFullYear()} Vishal Singh. All rights reserved.</p>
    </div>
  );
}

function AdminContactLink({ userEmail }: { userEmail?: string }) {
  if (!env.adminEmail) return null;
  const body = encodeURIComponent(`Hello, I have requested access to ExamChecker with email: ${userEmail ?? ''}`);
  const href = `mailto:${env.adminEmail}?subject=Access%20Request%20-%20ExamChecker&body=${body}`;
  return (
    <p className="text-sm text-ink-500 dark:text-ink-400 mt-3">
      Need help? Email the admin:{' '}
      <a href={href} className="text-accent-700 dark:text-accent-400 hover:underline break-all">
        {env.adminEmail}
      </a>
    </p>
  );
}

function SignOutButton() {
  return (
    <button
      onClick={() => supabase?.auth.signOut()}
      className="mt-5 w-full py-2.5 border border-ink-300 dark:border-ink-700 rounded-xl text-sm font-medium text-ink-700 dark:text-ink-300 hover:bg-ink-50 dark:hover:bg-ink-800 transition-colors"
    >
      Sign Out
    </button>
  );
}

interface GateScreenProps {
  userEmail?: string;
  icon: IconName;
  iconClass: string;
  title: string;
  message: string;
}

function GateScreen({ userEmail, icon, iconClass, title, message }: GateScreenProps) {
  return (
    <AccessScreen>
      <div className="flex justify-center mb-4">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center ${iconClass}`}>
          <Icon name={icon} className="w-7 h-7" />
        </div>
      </div>
      <h2 className="font-display text-xl font-semibold text-ink-900 dark:text-ink-100 mb-2">{title}</h2>
      <p className="text-sm text-ink-500 dark:text-ink-400">{message}</p>
      <AdminContactLink userEmail={userEmail} />
      <SignOutButton />
    </AccessScreen>
  );
}

export function PendingScreen({ userEmail }: { userEmail?: string }) {
  return (
    <GateScreen
      userEmail={userEmail}
      icon="clock"
      iconClass="bg-amber-100 dark:bg-amber-900/30 text-amber-500 dark:text-amber-400"
      title="Awaiting Approval"
      message="Your access request has been submitted. The admin will review and approve your account."
    />
  );
}

export function RevokedScreen({ userEmail }: { userEmail?: string }) {
  return (
    <GateScreen
      userEmail={userEmail}
      icon="x"
      iconClass="bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400"
      title="Access Revoked"
      message="Your access to ExamChecker has been revoked. Please contact the admin to restore access."
    />
  );
}

export function ExpiredScreen({ userEmail }: { userEmail?: string }) {
  return (
    <GateScreen
      userEmail={userEmail}
      icon="clock"
      iconClass="bg-orange-100 dark:bg-orange-900/30 text-orange-500 dark:text-orange-400"
      title="Trial Expired"
      message="Your trial period has ended. Please contact the admin to renew your access."
    />
  );
}
