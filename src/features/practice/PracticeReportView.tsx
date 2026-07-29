import { usePractice, usePracticeDispatch, clearPersistedPractice } from '../../context/PracticeContext';
import { RecordDetail } from '../history/RecordDetail';
import { printReport } from '../report/printReport';
import { Alert, Button, Card } from '../../components/ui';

export function PracticeReportView({ userId }: { userId: string }) {
  const { record } = usePractice();
  const dispatch = usePracticeDispatch();

  if (!record) {
    return <Alert tone="error">That attempt could not be loaded. Start a new practice test.</Alert>;
  }

  function startNew() {
    clearPersistedPractice(userId);
    dispatch({ type: 'RESET' });
  }

  return (
    <div className="space-y-4">
      <Alert tone="success">
        Saved to <strong>History → Practice</strong>. Your graded exams are untouched.
      </Alert>

      <RecordDetail record={record} />

      <Card className="px-5 py-4 flex gap-2 flex-wrap">
        <Button variant="secondary" icon="print" onClick={() => printReport(record)}>
          Print / Save PDF
        </Button>
        <Button icon="refresh" onClick={startNew}>
          New Practice Test
        </Button>
      </Card>
    </div>
  );
}
