import { useState, useEffect } from 'react';
import { getAllAccess, approveUser, revokeUser, extendTrial, type UserAccess } from '../lib/access';

interface AdminPanelProps {
  adminEmail: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }: { status: UserAccess['status'] }) {
  const styles = {
    pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-700',
    approved: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700',
    revoked: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function AdminPanel({ adminEmail }: AdminPanelProps) {
  const [users, setUsers] = useState<UserAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    const data = await getAllAccess();
    setUsers(data);
    setLoading(false);
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleApprove(userId: string) {
    setActionLoading(userId + '-approve');
    await approveUser(userId, 30);
    await loadUsers();
    setActionLoading(null);
  }

  async function handleRevoke(userId: string) {
    setActionLoading(userId + '-revoke');
    await revokeUser(userId);
    await loadUsers();
    setActionLoading(null);
  }

  async function handleExtend(userId: string) {
    setActionLoading(userId + '-extend');
    await extendTrial(userId, 30);
    await loadUsers();
    setActionLoading(null);
  }

  const pendingCount = users.filter(u => u.status === 'pending').length;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Access Control</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Manage user access requests for ExamChecker.
              Logged in as <span className="font-medium">{adminEmail}</span>.
            </p>
          </div>
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-700 px-3 py-1.5 rounded-full text-sm font-medium">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {pendingCount} pending approval
            </span>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500 text-sm">
            <svg className="w-5 h-5 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
            <svg className="w-10 h-10 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm">No access requests yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Email</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Trial Ends</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Requested</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {users.map(u => (
                  <tr key={u.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-4 text-gray-800 dark:text-gray-200 font-medium truncate max-w-[200px]">
                      {u.email}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-5 py-4 text-gray-500 dark:text-gray-400">
                      {formatDate(u.trial_ends_at)}
                    </td>
                    <td className="px-5 py-4 text-gray-500 dark:text-gray-400">
                      {formatDate(u.requested_at)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        {u.status === 'pending' && (
                          <button
                            onClick={() => handleApprove(u.user_id)}
                            disabled={actionLoading === u.user_id + '-approve'}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actionLoading === u.user_id + '-approve' ? 'Approving…' : 'Approve (30 days)'}
                          </button>
                        )}
                        {u.status === 'approved' && (
                          <>
                            <button
                              onClick={() => handleExtend(u.user_id)}
                              disabled={actionLoading === u.user_id + '-extend'}
                              className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {actionLoading === u.user_id + '-extend' ? 'Extending…' : 'Extend +30d'}
                            </button>
                            <button
                              onClick={() => handleRevoke(u.user_id)}
                              disabled={actionLoading === u.user_id + '-revoke'}
                              className="px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {actionLoading === u.user_id + '-revoke' ? 'Revoking…' : 'Revoke'}
                            </button>
                          </>
                        )}
                        {u.status === 'revoked' && (
                          <button
                            onClick={() => handleApprove(u.user_id)}
                            disabled={actionLoading === u.user_id + '-approve'}
                            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actionLoading === u.user_id + '-approve' ? 'Approving…' : 'Re-approve (30 days)'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
