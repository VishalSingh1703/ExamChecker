import type { HistoryRecord } from '../../types';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Opens a print window with a clean serif report for the given record.
 * Used by both the Report tab and History.
 */
export function printReport(r: HistoryRecord): void {
  const questionsHtml = r.questions.map((q, idx) => {
    const result = r.results.find(res => res.questionId === q.id);
    const marksText = result
      ? `${result.marksAwarded} / ${q.marks} marks${result.status === 'skipped' ? ' — skipped' : ''}`
      : `0 / ${q.marks} marks — skipped`;
    const studentAnswer = result?.extractedText
      ? `<p style="font-size:10pt;margin:2pt 0 0;">${escapeHtml(result.extractedText)}</p>`
      : `<p style="font-size:10pt;color:#999;font-style:italic;margin:2pt 0 0;">No answer provided.</p>`;
    return `
      <div style="margin-bottom:16pt;page-break-inside:avoid;">
        <p style="font-size:11pt;font-weight:bold;margin:0 0 3pt;">
          Q${idx + 1}. ${escapeHtml(q.question)}
          <span style="font-weight:normal;color:#555;margin-left:8pt;">[${marksText}]</span>
        </p>
        <p style="font-size:9pt;text-transform:uppercase;color:#666;letter-spacing:0.05em;margin:4pt 0 1pt;">Student's Answer:</p>
        ${studentAnswer}
        <p style="font-size:9pt;text-transform:uppercase;color:#666;letter-spacing:0.05em;margin:6pt 0 1pt;">Expected Answer:</p>
        <p style="font-size:10pt;color:#333;margin:2pt 0 0;">${escapeHtml(q.expectedAnswer)}</p>
      </div>`;
  }).join('');

  const details = [
    r.studentName && `Student: ${r.studentName}`,
    r.studentId && `ID: ${r.studentId}`,
    r.studentSection && `Section: ${r.studentSection}`,
    r.term && `Term: ${r.term}`,
    r.savedAt && `Date: ${new Date(r.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`,
  ].filter(Boolean).map(d => escapeHtml(d as string)).join('  ·  ');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(r.examTitle)}</title>
<style>body{font-family:serif;color:#000;margin:2cm;}@media print{body{margin:1.5cm;}}</style>
</head><body>
  <h1 style="font-size:20pt;font-weight:bold;margin:0 0 4pt;">${escapeHtml(r.examTitle)}${r.examClass ? ` — ${escapeHtml(r.examClass)}` : ''}</h1>
  <p style="font-size:11pt;margin:0 0 3pt;color:#333;">${details}</p>
  <p style="font-size:12pt;font-weight:bold;margin:0 0 10pt;">Marks: ${r.scored} / ${r.total} (${r.percentage}%)  —  Grade: ${escapeHtml(r.grade)}</p>
  ${r.subject ? `<p style="font-size:13pt;font-weight:bold;border-bottom:1px solid #999;padding-bottom:4pt;margin:0 0 12pt;">${escapeHtml(r.subject)}</p>` : ''}
  ${questionsHtml}
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 300);
}
