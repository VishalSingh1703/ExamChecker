import { useState, useMemo, useEffect } from 'react';
import type { HistoryRecord } from '../types';
import { loadReports } from '../services/reports';
import { seedDemoData } from '../services/demoData';
import { supabase } from '../lib/supabase';

// ── Constants ─────────────────────────────────────────────────────────────────

const COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
  '#84cc16', // lime
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toggle<T>(set: Set<T>, val: T): Set<T> {
  const next = new Set(set);
  next.has(val) ? next.delete(val) : next.add(val);
  return next;
}

// ── Tree ─────────────────────────────────────────────────────────────────────

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

// ── Chart ─────────────────────────────────────────────────────────────────────

interface SubjectSeries {
  subject: string;
  color: string;
  totalScored: number;
  totalPossible: number;
  // one point per term (averaged if multiple records for same subject+term)
  points: { term: string; pct: number; scored: number; total: number; title: string }[];
}

interface TooltipState {
  cx: number; cy: number;
  subject: string;
  term: string;
  title: string;
  pct: number;
  marks: string;
}

const W = 460;
const H = 240;
const PAD = { top: 20, right: 15, bottom: 40, left: 48 };
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top - PAD.bottom;

function StudentChart({ records }: { records: HistoryRecord[] }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  function handleFocus(subject: string) {
    setFocused(prev => (prev === subject ? null : subject));
    setTooltip(null);
  }

  const { series, allTerms } = useMemo(() => {
    // Determine ordered unique terms by earliest savedAt within each term
    const termFirstSeen = new Map<string, number>();
    for (const r of records) {
      const t = r.term || 'Unknown';
      const ts = new Date(r.savedAt).getTime();
      if (!termFirstSeen.has(t) || ts < termFirstSeen.get(t)!) termFirstSeen.set(t, ts);
    }
    const allTerms = [...termFirstSeen.keys()].sort(
      (a, b) => termFirstSeen.get(a)! - termFirstSeen.get(b)!
    );

    // Group records by subject
    const subjectMap = new Map<string, HistoryRecord[]>();
    for (const r of records) {
      const sub = r.subject || 'General';
      if (!subjectMap.has(sub)) subjectMap.set(sub, []);
      subjectMap.get(sub)!.push(r);
    }

    const rawSeries = [...subjectMap.entries()].map(([subject, recs]) => {
      // Aggregate per term (average pct if multiple records for same subject+term)
      const termGroups = new Map<string, HistoryRecord[]>();
      for (const r of recs) {
        const t = r.term || 'Unknown';
        if (!termGroups.has(t)) termGroups.set(t, []);
        termGroups.get(t)!.push(r);
      }
      const points = allTerms
        .filter(t => termGroups.has(t))
        .map(t => {
          const group = termGroups.get(t)!;
          const scored = group.reduce((s, r) => s + r.scored, 0);
          const total = group.reduce((s, r) => s + r.total, 0);
          const pct = total > 0 ? Math.round((scored / total) * 100) : 0;
          // Use latest record's title for the term
          const latest = group.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())[0];
          return { term: t, pct, scored, total, title: latest.examTitle };
        });

      return {
        subject,
        color: '',
        totalScored: recs.reduce((s, r) => s + r.scored, 0),
        totalPossible: recs.reduce((s, r) => s + r.total, 0),
        points,
      };
    });

    const series: SubjectSeries[] = rawSeries
      .sort((a, b) => b.totalScored - a.totalScored)
      .map((s, i) => ({ ...s, color: COLORS[i % COLORS.length] }));

    return { series, allTerms };
  }, [records]);

  const xPos = (term: string): number => {
    if (allTerms.length <= 1) return PAD.left + IW / 2;
    const idx = allTerms.indexOf(term);
    return PAD.left + (idx / (allTerms.length - 1)) * IW;
  };

  const yPos = (pct: number): number => PAD.top + IH - (pct / 100) * IH;

  function tooltipBox(cx: number, cy: number) {
    const tipW = 160, tipH = 44;
    let tx = cx + 14;
    let ty = cy - tipH / 2;
    if (tx + tipW > W - 5) tx = cx - tipW - 14;
    if (ty < 4) ty = 4;
    if (ty + tipH > H - 4) ty = H - tipH - 4;
    return { tx, ty, tipW, tipH };
  }

  if (records.length === 0) {
    return <div className="flex items-center justify-center h-48 text-slate-400 dark:text-zinc-500 text-sm">No records found.</div>;
  }

  return (
    <div className="flex gap-5 items-start">
      {/* SVG Chart */}
      <div className="flex-1 min-w-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-xl border border-slate-100 dark:border-zinc-800 bg-white dark:bg-zinc-900" style={{ cursor: focused ? 'pointer' : 'default' }}>
          {/* Invisible full-area click target to clear focus */}
          <rect x={0} y={0} width={W} height={H} fill="transparent" onClick={() => setFocused(null)} />

          {/* Y gridlines + labels */}
          {[0, 20, 40, 60, 80, 100].map(pct => (
            <g key={pct}>
              <line
                x1={PAD.left} y1={yPos(pct)} x2={W - PAD.right} y2={yPos(pct)}
                stroke={pct === 0 ? '#9ca3af' : '#e5e7eb'}
                strokeWidth={pct === 0 ? 1 : 0.5}
                strokeDasharray={pct === 0 ? '' : '4 4'}
              />
              <text x={PAD.left - 6} y={yPos(pct) + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{pct}</text>
            </g>
          ))}

          {/* Y axis title */}
          <text
            x={11} y={PAD.top + IH / 2}
            textAnchor="middle" fontSize={9} fill="#9ca3af"
            transform={`rotate(-90, 11, ${PAD.top + IH / 2})`}
          >% Score</text>

          {/* X axis */}
          <line x1={PAD.left} y1={yPos(0)} x2={W - PAD.right} y2={yPos(0)} stroke="#9ca3af" strokeWidth={1} />

          {/* X labels (term names) */}
          {allTerms.map(term => {
            const x = xPos(term);
            return (
              <text
                key={term}
                x={x} y={yPos(0) + 14}
                textAnchor="middle" fontSize={9} fill="#9ca3af"
              >
                {term}
              </text>
            );
          })}

          {/* Vertical tick marks at each term */}
          {allTerms.map(term => {
            const x = xPos(term);
            return (
              <line key={`tick-${term}`} x1={x} y1={yPos(0)} x2={x} y2={yPos(0) + 4} stroke="#9ca3af" strokeWidth={1} />
            );
          })}

          {/* Series lines + dots */}
          {series.map(sub => {
            if (sub.points.length === 0) return null;
            const isFaded = focused !== null && focused !== sub.subject;
            const isFocused = focused === sub.subject;
            const pathD = sub.points.map((p, i) =>
              `${i === 0 ? 'M' : 'L'}${xPos(p.term)},${yPos(p.pct)}`
            ).join(' ');

            return (
              <g key={sub.subject} opacity={isFaded ? 0.12 : 1} style={{ transition: 'opacity 0.2s' }}>
                {sub.points.length > 1 && (
                  <path
                    d={pathD} fill="none" stroke={sub.color}
                    strokeWidth={isFocused ? 3 : 2}
                    strokeLinejoin="round" strokeLinecap="round"
                    style={{ cursor: 'pointer' }}
                    onClick={e => { e.stopPropagation(); handleFocus(sub.subject); }}
                  />
                )}
                {/* Wide invisible hit area for the line */}
                {sub.points.length > 1 && (
                  <path
                    d={pathD} fill="none" stroke="transparent" strokeWidth={14}
                    style={{ cursor: 'pointer' }}
                    onClick={e => { e.stopPropagation(); handleFocus(sub.subject); }}
                  />
                )}
                {sub.points.map(p => {
                  const cx = xPos(p.term);
                  const cy = yPos(p.pct);
                  return (
                    <circle
                      key={`${sub.subject}-${p.term}`}
                      cx={cx} cy={cy} r={isFocused ? 6 : 5}
                      fill={sub.color} stroke="white" strokeWidth={1.5}
                      style={{ cursor: 'pointer' }}
                      onClick={e => { e.stopPropagation(); handleFocus(sub.subject); }}
                      onMouseEnter={() => !isFaded && setTooltip({
                        cx, cy,
                        subject: sub.subject,
                        term: p.term,
                        title: p.title,
                        pct: p.pct,
                        marks: `${p.scored}/${p.total}`,
                      })}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Tooltip */}
          {tooltip && (() => {
            const { tx, ty, tipW, tipH } = tooltipBox(tooltip.cx, tooltip.cy);
            return (
              <g style={{ pointerEvents: 'none' }}>
                <rect x={tx} y={ty} width={tipW} height={tipH} rx={5} fill="#111827" opacity={0.92} />
                <text x={tx + 8} y={ty + 13} fontSize={9} fill="#d1d5db">{tooltip.subject} · {tooltip.term}</text>
                <text x={tx + 8} y={ty + 25} fontSize={8.5} fill="#9ca3af" fontStyle="italic">{tooltip.title}</text>
                <text x={tx + 8} y={ty + 38} fontSize={10} fill="white" fontWeight="bold">{tooltip.marks} marks · {tooltip.pct}%</text>
              </g>
            );
          })()}
        </svg>
      </div>

      {/* Subject rankings sidebar */}
      <div className="w-44 shrink-0">
        <p className="text-xs font-semibold text-slate-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
          Subjects by Marks
        </p>
        <div className="space-y-1">
          {series.map((sub, i) => {
            const isFaded = focused !== null && focused !== sub.subject;
            const isFocused = focused === sub.subject;
            return (
              <button
                key={sub.subject}
                onClick={() => handleFocus(sub.subject)}
                className={`w-full text-left flex items-start gap-2 px-2 py-2 rounded-lg transition-all ${
                  isFocused
                    ? 'bg-slate-100 dark:bg-zinc-800 ring-1 ring-slate-200 dark:ring-zinc-700'
                    : 'hover:bg-slate-50 dark:hover:bg-zinc-800/50'
                }`}
                style={{ opacity: isFaded ? 0.3 : 1, transition: 'opacity 0.2s' }}
              >
                <div className="w-3 h-3 rounded-full mt-0.5 shrink-0" style={{ backgroundColor: sub.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-zinc-200 truncate">{sub.subject}</p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    {sub.totalScored} / {sub.totalPossible} marks
                  </p>
                  <p className="text-xs text-slate-400 dark:text-zinc-500">
                    {sub.totalPossible > 0 ? Math.round((sub.totalScored / sub.totalPossible) * 100) : 0}% avg
                  </p>
                </div>
                <span className="text-xs font-bold text-slate-400 dark:text-zinc-500 shrink-0">#{i + 1}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function AnalyticsView({ userId = '' }: { userId?: string }) {
  const histKey = userId ? `exam-history-${userId}` : 'exam-history';

  function loadFromStorage(): HistoryRecord[] {
    try { return JSON.parse(localStorage.getItem(histKey) ?? '[]'); }
    catch { return []; }
  }

  const [records, setRecords] = useState<HistoryRecord[]>(loadFromStorage);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMsg, setDemoMsg] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      const remote = await loadReports(uid);
      if (remote.length === 0) return;
      setRecords(prev => {
        const localById = new Map(prev.map(r => [r.id, r]));
        for (const r of remote) localById.set(r.id, r);
        return [...localById.values()].sort(
          (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
        );
      });
    });
  }, []);

  async function handleLoadDemo() {
    setDemoLoading(true);
    const added = await seedDemoData(userId);
    setRecords(loadFromStorage());
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
      <div className="max-w-5xl mx-auto py-20 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-slate-700 dark:text-zinc-300 mb-1">No analytics yet</h3>
        <p className="text-sm text-slate-400 dark:text-zinc-500 mb-5">Grade some students first — their reports will appear here.</p>
        <button
          onClick={handleLoadDemo}
          disabled={demoLoading}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-sm font-medium disabled:opacity-60"
        >
          {demoLoading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          )}
          Load Demo Data
        </button>
        {demoMsg && <p className="text-xs text-green-600 dark:text-green-400 mt-3">{demoMsg}</p>}
      </div>
    );
  }

  const sortedClasses = [...tree.keys()].sort();

  return (
    <div className="max-w-5xl mx-auto">
      {/* Demo data loader bar */}
      <div className="flex items-center justify-end gap-3 mb-3">
        {demoMsg && <span className="text-xs text-green-600 dark:text-green-400">{demoMsg}</span>}
        <button
          onClick={handleLoadDemo}
          disabled={demoLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-400 rounded-lg text-xs font-medium disabled:opacity-60"
        >
          {demoLoading ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          )}
          Load Demo Data
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 items-start">

        {/* Left: student tree */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-zinc-200">Students</h3>
            <p className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">{records.length} report{records.length !== 1 ? 's' : ''}</p>
          </div>

          <div className="py-1">
            {sortedClasses.map(cls => {
              const sectionMap = tree.get(cls)!;
              const clsOpen = openClasses.has(cls);
              return (
                <div key={cls}>
                  <button
                    onClick={() => setOpenClasses(toggle(openClasses, cls))}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800"
                  >
                    <svg className={`w-3 h-3 transition-transform shrink-0 ${clsOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 6 10">
                      <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {cls}
                  </button>

                  {clsOpen && [...sectionMap.keys()].sort().map(sec => {
                    const studentMap = sectionMap.get(sec)!;
                    const secToggleKey = `${cls}||${sec}`;
                    const secOpen = openSections.has(secToggleKey);
                    return (
                      <div key={sec}>
                        <button
                          onClick={() => setOpenSections(toggle(openSections, secToggleKey))}
                          className="w-full flex items-center gap-2 pl-8 pr-4 py-1.5 text-sm text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800"
                        >
                          <svg className={`w-3 h-3 transition-transform shrink-0 ${secOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 6 10">
                            <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          Section {sec}
                          <span className="ml-auto text-xs text-slate-400">{studentMap.size}</span>
                        </button>

                        {secOpen && [...studentMap.entries()]
                          .sort((a, b) => a[1].name.localeCompare(b[1].name))
                          .map(([key, student]) => (
                            <button
                              key={key}
                              onClick={() => setSelectedKey(key)}
                              className={`w-full text-left pl-12 pr-4 py-2 transition-colors ${
                                selectedKey === key
                                  ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400'
                                  : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800'
                              }`}
                            >
                              <p className="text-xs font-medium truncate">{student.name}</p>
                              <p className="text-xs text-slate-400 dark:text-zinc-500 truncate">
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
        </div>

        {/* Right: chart panel */}
        <div>
          {selectedStudent ? (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 p-5 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-zinc-100">{selectedStudent.name}</h3>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-slate-400 dark:text-zinc-500">
                  {selectedStudent.studentId && <span>ID: {selectedStudent.studentId}</span>}
                  <span>{selectedStudent.records.length} exam report{selectedStudent.records.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
              <StudentChart records={selectedStudent.records} />
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 py-24 text-center">
              <svg className="w-10 h-10 text-slate-300 dark:text-zinc-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
              <p className="text-sm text-slate-400 dark:text-zinc-500">Select a student to view their performance graph.</p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
