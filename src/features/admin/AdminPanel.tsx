import { useState, useEffect, useCallback } from 'react';
import { getAllAccess, approveUser, revokeUser, extendTrial, type UserAccess } from '../../services/data/access';
import { loadAllStats, type UserStats } from '../../services/data/stats';
import { Badge, Card, EmptyState, Spinner } from '../../components/ui';

interface AdminPanelProps {
  adminEmail: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_STYLES: Record<UserAccess['status'], string> = {
  pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700',
  approved: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700',
  revoked: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-700',
};

export function AdminPanel({ adminEmail }: AdminPanelProps) {
  const [users, setUsers] = useState<UserAccess[]>([]);
  const [stats, setStats] = useState<Map<string, UserStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const [data, statsMap] = await Promise.all([getAllAccess(), loadAllStats()]);
    setUsers(data.filter(u => u.email !== adminEmail));
    setStats(statsMap);
    setLoading(false);
  }, [adminEmail]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  async function runAction(key: string, action: () => Promise<unknown>) {
    setActionLoading(key);
    await action();
    await loadUsers();
    setActionLoading(null);
  }

  const pendingCount = users.filter(u => u.status === 'pending').length;

  const th = 'text-left px-5 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider';
  const thRight = 'text-right px-3 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap';

  return (
    <div className="max-w-6xl mx-auto space-y-4 animate-fade-in">
      <Card className="p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">Access Control</h2>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
              Manage user access requests for ExamChecker.
              Logged in as <span className="font-medium">{adminEmail}</span>.
            </p>
          </div>
          {pendingCount > 0 && (
            <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-700 px-3 py-1.5 text-sm">
              {pendingCount} pending approval
            </Badge>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-400 dark:text-zinc-500 text-sm gap-2">
            <Spinner className="w-5 h-5" />
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <EmptyState icon="users" title="No access requests yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
                  <th className={th}>Email</th>
                  <th className={th}>Status</th>
                  <th className={th}>Trial Ends</th>
                  <th className={th}>Requested</th>
                  <th className={thRight}>Reports</th>
                  <th className={thRight}>Pages</th>
                  <th className={thRight}>Words</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {users.map(u => (
                  <tr key={u.user_id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors">
                    <td className="px-5 py-4 text-zinc-800 dark:text-zinc-200 font-medium truncate max-w-[200px]">
                      {u.email}
                    </td>
                    <td className="px-5 py-4">
                      <Badge className={STATUS_STYLES[u.status]}>
                        {u.status.charAt(0).toUpperCase() + u.status.slice(1)}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-zinc-500 dark:text-zinc-400">{formatDate(u.trial_ends_at)}</td>
                    <td className="px-5 py-4 text-zinc-500 dark:text-zinc-400">{formatDate(u.requested_at)}</td>
                    <td className="px-3 py-4 text-right font-semibold text-zinc-800 dark:text-zinc-200">
                      {stats.get(u.user_id)?.reports_generated ?? 0}
                    </td>
                    <td className="px-3 py-4 text-right text-zinc-500 dark:text-zinc-400">
                      {stats.get(u.user_id)?.pages_scanned ?? 0}
                    </td>
                    <td className="px-3 py-4 text-right text-zinc-500 dark:text-zinc-400">
                      {(stats.get(u.user_id)?.words_extracted ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        {(u.status === 'pending' || u.status === 'revoked') && (
                          <button
                            onClick={() => runAction(u.user_id + '-approve', () => approveUser(u.user_id, 30))}
                            disabled={actionLoading === u.user_id + '-approve'}
                            className="px-3 py-1.5 rounded-lg bg-purple-700 text-white text-xs font-medium hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actionLoading === u.user_id + '-approve' ? 'Approving…' : u.status === 'pending' ? 'Approve (30 days)' : 'Re-approve (30 days)'}
                          </button>
                        )}
                        {u.status === 'approved' && (
                          <>
                            <button
                              onClick={() => runAction(u.user_id + '-extend', () => extendTrial(u.user_id, 30))}
                              disabled={actionLoading === u.user_id + '-extend'}
                              className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {actionLoading === u.user_id + '-extend' ? 'Extending…' : 'Extend +30d'}
                            </button>
                            <button
                              onClick={() => runAction(u.user_id + '-revoke', () => revokeUser(u.user_id))}
                              disabled={actionLoading === u.user_id + '-revoke'}
                              className="px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {actionLoading === u.user_id + '-revoke' ? 'Revoking…' : 'Revoke'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
