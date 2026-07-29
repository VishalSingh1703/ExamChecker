import { useState, useMemo, useEffect } from 'react';
import type { HistoryRecord } from '../../types';
import { loadReports } from '../../services/data/reports';
import { seedDemoData } from '../../services/data/demo';
import { getCurrentUserId, supabase } from '../../services/data/supabase';
import { readJson, storageKeys } from '../../services/storage';
import { StudentChart } from './StudentChart';
import { Button, Card, Caret, EmptyState, Icon, Spinner } from '../../components/ui';

interface StudentEntry {
  name: string;
  studentId: string;
  records: HistoryRecord[];
}

// class → section → compositeKey → StudentEntry
type AnalyticsTree = Map<string, Map<string, Map<string, StudentEntry>>>;

function buildAnalyticsTree(records: HistoryRecord[]): AnalyticsTree {
  const tree: AnalyticsTree = new Map();
  for (const r of records) {
    const cls = r.examClass || 'Unclassified';
    const sec = r.studentSection || 'Unclassified';
    const studentKey = r.studentId || r.studentName || 'Unknown';
    const compositeKey = `${cls}||${sec}||${studentKey}`;
    if (!tree.has(cls)) tree.set(cls, new Map());
    const classMap = tree.get(cls)!;
    if (!classMap.has(sec)) classMap.set(sec, new Map());
    const secMap = classMap.get(sec)!;
    if (!secMap.has(compositeKey)) {
      secMap.set(compositeKey, { name: r.studentName || 'Unknown', studentId: r.studentId || '', records: [] });
    }
    secMap.get(compositeKey)!.records.push(r);
  }
  return tree;
}

function toggleSet<T>(set: Set<T>, val: T): Set<T> {
  const next = new Set(set);
  if (next.has(val)) next.delete(val); else next.add(val);
  return next;
}

export function AnalyticsView({ userId = '' }: { userId?: string }) {
  const histKey = storageKeys.history(userId);

  const [records, setRecords] = useState<HistoryRecord[]>(() => readJson<HistoryRecord[]>(histKey, []));
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMsg, setDemoMsg] = useState('');

  useEffect(() => {
    if (!supabase) return;
    getCurrentUserId().then(async uid => {
      if (!uid) return;
      // Practice attempts share the `reports` table but must never appear here —
      // they would inject a phantom student into the teacher's analytics.
      const remote = (await loadReports(uid)).filter(r => r.kind !== 'practice');
      if (remote.length === 0) return;
      setRecords(prev => {
        const localById = new Map(prev.map(r => [r.id, r]));
        for (const r of remote) localById.set(r.id, r);
        return [...localById.values()].sort(
          (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime(),
        );
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLoadDemo() {
    setDemoLoading(true);
    const added = await seedDemoData(userId);
    setRecords(readJson<HistoryRecord[]>(histKey, []));
    setDemoMsg(added > 0 ? `${added} demo records added.` : 'Demo data already loaded.');
    setTimeout(() => setDemoMsg(''), 3000);
    setDemoLoading(false);
  }

  const [openClasses, setOpenClasses] = useState<Set<string>>(new Set());
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const tree = useMemo(() => buildAnalyticsTree(records), [records]);

  const selectedStudent = useMemo((): StudentEntry | null => {
    if (!selectedKey) return null;
    for (const classMap of tree.values())
      for (const secMap of classMap.values())
        if (secMap.has(selectedKey)) return secMap.get(selectedKey)!;
    return null;
  }, [selectedKey, tree]);

  if (records.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="chart"
          title="No analytics yet"
          message="Grade some students first — their reports will appear here."
          action={
            <Button onClick={handleLoadDemo} loading={demoLoading} icon={demoLoading ? undefined : 'plus'}>
              Load Demo Data
            </Button>
          }
        />
        {demoMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400 text-center pb-6 -mt-8">{demoMsg}</p>}
      </Card>
    );
  }

  const sortedClasses = [...tree.keys()].sort();

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      <div className="flex items-center justify-end gap-3 mb-3">
        {demoMsg && <span className="text-xs text-emerald-600 dark:text-emerald-400">{demoMsg}</span>}
        <button
          onClick={handleLoadDemo}
          disabled={demoLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink-100 dark:bg-ink-800 hover:bg-ink-200 dark:hover:bg-ink-700 text-ink-600 dark:text-ink-400 rounded-lg text-xs font-medium disabled:opacity-60"
        >
          {demoLoading ? <Spinner className="w-3.5 h-3.5" /> : <Icon name="plus" className="w-3.5 h-3.5" />}
          Load Demo Data
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 items-start">
        {/* Student tree */}
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-100 dark:border-ink-800">
            <h3 className="text-sm font-semibold text-ink-800 dark:text-ink-200">Students</h3>
            <p className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">{records.length} report{records.length !== 1 ? 's' : ''}</p>
          </div>

          <div className="py-1">
            {sortedClasses.map(cls => {
              const sectionMap = tree.get(cls)!;
              const clsOpen = openClasses.has(cls);
              return (
                <div key={cls}>
                  <button
                    onClick={() => setOpenClasses(toggleSet(openClasses, cls))}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm font-semibold text-ink-700 dark:text-ink-300 hover:bg-ink-50 dark:hover:bg-ink-800"
                  >
                    <Caret open={clsOpen} />
                    {cls}
                  </button>

                  {clsOpen && [...sectionMap.keys()].sort().map(sec => {
                    const studentMap = sectionMap.get(sec)!;
                    const secToggleKey = `${cls}||${sec}`;
                    const secOpen = openSections.has(secToggleKey);
                    return (
                      <div key={sec}>
                        <button
                          onClick={() => setOpenSections(toggleSet(openSections, secToggleKey))}
                          className="w-full flex items-center gap-2 pl-8 pr-4 py-1.5 text-sm text-ink-600 dark:text-ink-400 hover:bg-ink-50 dark:hover:bg-ink-800"
                        >
                          <Caret open={secOpen} />
                          Section {sec}
                          <span className="ml-auto text-xs text-ink-400">{studentMap.size}</span>
                        </button>

                        {secOpen && [...studentMap.entries()]
                          .sort((a, b) => a[1].name.localeCompare(b[1].name))
                          .map(([key, student]) => (
                            <button
                              key={key}
                              onClick={() => setSelectedKey(key)}
                              className={`w-full text-left pl-12 pr-4 py-2 transition-colors ${
                                selectedKey === key
                                  ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                                  : 'text-ink-600 dark:text-ink-400 hover:bg-ink-50 dark:hover:bg-ink-800'
                              }`}
                            >
                              <p className="text-xs font-medium truncate">{student.name}</p>
                              <p className="text-xs text-ink-400 dark:text-ink-500 truncate">
                                {student.studentId || 'No ID'} · {student.records.length} report{student.records.length !== 1 ? 's' : ''}
                              </p>
                            </button>
                          ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Chart panel */}
        <div>
          {selectedStudent ? (
            <Card className="p-5 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-ink-900 dark:text-ink-100">{selectedStudent.name}</h3>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-ink-400 dark:text-ink-500">
                  {selectedStudent.studentId && <span>ID: {selectedStudent.studentId}</span>}
                  <span>{selectedStudent.records.length} exam report{selectedStudent.records.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
              <StudentChart records={selectedStudent.records} />
            </Card>
          ) : (
            <Card>
              <EmptyState icon="chart" title="Select a student" message="Pick a student from the list to view their performance graph." />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
