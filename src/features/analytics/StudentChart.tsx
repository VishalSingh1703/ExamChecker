import { useState, useMemo } from 'react';
import type { HistoryRecord } from '../../types';

const COLORS = [
  '#8b5cf6', // violet
  '#ef4444', // red
  '#10b981', // emerald
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
  '#84cc16', // lime
];

interface SubjectSeries {
  subject: string;
  color: string;
  totalScored: number;
  totalPossible: number;
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

export function StudentChart({ records }: { records: HistoryRecord[] }) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  function handleFocus(subject: string) {
    setFocused(prev => (prev === subject ? null : subject));
    setTooltip(null);
  }

  const { series, allTerms } = useMemo(() => {
    // Order unique terms by earliest savedAt within each term
    const termFirstSeen = new Map<string, number>();
    for (const r of records) {
      const t = r.term || 'Unknown';
      const ts = new Date(r.savedAt).getTime();
      if (!termFirstSeen.has(t) || ts < termFirstSeen.get(t)!) termFirstSeen.set(t, ts);
    }
    const allTerms = [...termFirstSeen.keys()].sort(
      (a, b) => termFirstSeen.get(a)! - termFirstSeen.get(b)!,
    );

    const subjectMap = new Map<string, HistoryRecord[]>();
    for (const r of records) {
      const sub = r.subject || 'General';
      if (!subjectMap.has(sub)) subjectMap.set(sub, []);
      subjectMap.get(sub)!.push(r);
    }

    const rawSeries = [...subjectMap.entries()].map(([subject, recs]) => {
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
    return <div className="flex items-center justify-center h-48 text-zinc-400 dark:text-zinc-500 text-sm">No records found.</div>;
  }

  return (
    <div className="flex gap-5 items-start flex-col lg:flex-row">
      {/* SVG chart */}
      <div className="flex-1 min-w-0 w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900" style={{ cursor: focused ? 'pointer' : 'default' }}>
          <rect x={0} y={0} width={W} height={H} fill="transparent" onClick={() => setFocused(null)} />

          {[0, 20, 40, 60, 80, 100].map(pct => (
            <g key={pct}>
              <line
                x1={PAD.left} y1={yPos(pct)} x2={W - PAD.right} y2={yPos(pct)}
                stroke={pct === 0 ? '#9ca3af' : '#e5e7eb'}
                strokeWidth={pct === 0 ? 1 : 0.5}
                strokeDasharray={pct === 0 ? '' : '4 4'}
                className={pct === 0 ? '' : 'dark:opacity-20'}
              />
              <text x={PAD.left - 6} y={yPos(pct) + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{pct}</text>
            </g>
          ))}

          <text
            x={11} y={PAD.top + IH / 2}
            textAnchor="middle" fontSize={9} fill="#9ca3af"
            transform={`rotate(-90, 11, ${PAD.top + IH / 2})`}
          >% Score</text>

          <line x1={PAD.left} y1={yPos(0)} x2={W - PAD.right} y2={yPos(0)} stroke="#9ca3af" strokeWidth={1} />

          {allTerms.map(term => (
            <g key={term}>
              <text x={xPos(term)} y={yPos(0) + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">{term}</text>
              <line x1={xPos(term)} y1={yPos(0)} x2={xPos(term)} y2={yPos(0) + 4} stroke="#9ca3af" strokeWidth={1} />
            </g>
          ))}

          {series.map(sub => {
            if (sub.points.length === 0) return null;
            const isFaded = focused !== null && focused !== sub.subject;
            const isFocused = focused === sub.subject;
            const pathD = sub.points.map((p, i) =>
              `${i === 0 ? 'M' : 'L'}${xPos(p.term)},${yPos(p.pct)}`,
            ).join(' ');

            return (
              <g key={sub.subject} opacity={isFaded ? 0.12 : 1} style={{ transition: 'opacity 0.2s' }}>
                {sub.points.length > 1 && (
                  <>
                    <path
                      d={pathD} fill="none" stroke={sub.color}
                      strokeWidth={isFocused ? 3 : 2}
                      strokeLinejoin="round" strokeLinecap="round"
                      style={{ cursor: 'pointer' }}
                      onClick={e => { e.stopPropagation(); handleFocus(sub.subject); }}
                    />
                    <path
                      d={pathD} fill="none" stroke="transparent" strokeWidth={14}
                      style={{ cursor: 'pointer' }}
                      onClick={e => { e.stopPropagation(); handleFocus(sub.subject); }}
                    />
                  </>
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

      {/* Rankings sidebar */}
      <div className="w-full lg:w-44 shrink-0">
        <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
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
                    ? 'bg-zinc-100 dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                }`}
                style={{ opacity: isFaded ? 0.3 : 1, transition: 'opacity 0.2s' }}
              >
                <div className="w-3 h-3 rounded-full mt-0.5 shrink-0" style={{ backgroundColor: sub.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">{sub.subject}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {sub.totalScored} / {sub.totalPossible} marks
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    {sub.totalPossible > 0 ? Math.round((sub.totalScored / sub.totalPossible) * 100) : 0}% avg
                  </p>
                </div>
                <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500 shrink-0">#{i + 1}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
