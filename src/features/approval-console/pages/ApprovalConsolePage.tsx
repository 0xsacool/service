import { useState } from 'react';
import { PageContainer, PageHeader } from '../../../shared/components';
import { useApprovalQueue, useApprovalReview } from '../../../hooks/useApprovalConsoleReads';
import type {
  ApprovalQueueItemV1,
  ApprovalQueueRequest,
} from '../../../types/serviceReportWorkerReads';
import { ApprovalQueueSearchControls } from '../components/ApprovalQueueSearchControls';
import { ApprovalQueueList } from '../components/ApprovalQueueList';
import { ApprovalReviewPanel } from '../components/ApprovalReviewPanel';

interface Selection {
  serviceJobId: string;
  reportId: string;
}

// Only mounted while a queue item is selected, so useApprovalReview (and the
// fetch it starts on mount) exists only for the duration of an actual
// selection — no request is ever issued with an empty/placeholder identity.
// onDecisionCommitted is queue.refresh passed straight through from the
// parent: the entire "refresh the queue after a decision" wiring.
function SelectedReview({
  serviceJobId,
  reportId,
  onDecisionCommitted,
  onBack,
}: Selection & { onDecisionCommitted: () => void; onBack: () => void }) {
  const review = useApprovalReview(serviceJobId, reportId, onDecisionCommitted);
  return <ApprovalReviewPanel review={review} onBack={onBack} />;
}

export function ApprovalConsolePage() {
  const [request, setRequest] = useState<ApprovalQueueRequest>({ mode: 'queue', pageSize: 25 });
  const [selected, setSelected] = useState<Selection | null>(null);

  const queue = useApprovalQueue(request);

  if (selected) {
    return (
      <PageContainer maxWidthClassName="max-w-5xl">
        <SelectedReview
          serviceJobId={selected.serviceJobId}
          reportId={selected.reportId}
          onDecisionCommitted={queue.refresh}
          onBack={() => setSelected(null)}
        />
      </PageContainer>
    );
  }

  const handleSelect = (item: ApprovalQueueItemV1) => {
    setSelected({ serviceJobId: item.serviceJobId, reportId: item.reportId });
  };

  return (
    <PageContainer maxWidthClassName="max-w-6xl">
      <PageHeader
        title="ศูนย์อนุมัติใบรายงาน"
        subtitle="ตรวจสอบและอนุมัติใบรายงานที่รอการพิจารณา"
      />
      <ApprovalQueueSearchControls onRequestChange={setRequest} />
      <ApprovalQueueList queue={queue} onSelect={handleSelect} />
    </PageContainer>
  );
}
