import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import {
  ApprovalDecisionGuardError,
  type ApprovalReviewState,
} from '../../../hooks/useApprovalConsoleReads';
import { Modal, PrimaryButton, SecondaryButton, Field, inputClass, AsyncErrorAlert } from '../../../shared/components';
import { GUARD_REASON_MESSAGES } from '../approvalConsoleUi';

// Phase 6R-B — decisionEnabled/isDeciding are read directly from the D25
// hook and never re-derived; decide() (via evaluateApprovalDecisionGuard)
// remains the sole authoritative boundary. Disabling buttons here is UX
// only, matching the hook's own comment ("A disabled button is a
// convenience, not the boundary").
//
// Phase 6R-B.3 (Phase 4R.6R finding R6R-SF5) — a modal belongs to the exact
// review identity it was opened under. `review` is a prop and the confirm
// handler is rebuilt on every render, so open-modal state that outlived a prop
// change to another review would show A's confirmation and dispatch B's
// decision. Modal state therefore carries its owning {serviceJobId, reportId},
// and everything that could otherwise cross identities — the rejection reason
// and the pending error — lives inside that same owned object, so none of it
// can survive into another review.
//
// Ownership is checked while rendering, never in an effect: a modal whose
// owner is no longer the current review is not rendered at all, in the same
// commit as the change, so no confirm control survives to be actuated and zero
// mutations can be dispatched. Identity is the exact id pair — never the report
// number or any display text.
interface OwnedModal {
  kind: 'approve' | 'reject';
  serviceJobId: string;
  reportId: string;
  reason: string;
  error: string | null;
}

export function ApprovalDecisionControls({ review }: { review: ApprovalReviewState }) {
  const [modal, setModal] = useState<OwnedModal | null>(null);

  const currentServiceJobId = review.review?.serviceJobId ?? null;
  const currentReportId = review.review?.reportId ?? null;
  const ownedByCurrentReview = (candidate: OwnedModal): boolean =>
    currentServiceJobId !== null &&
    currentReportId !== null &&
    candidate.serviceJobId === currentServiceJobId &&
    candidate.reportId === currentReportId;

  // The only value anything below reads. Deliberately a render-time derivation
  // rather than an effect-driven reset: an effect would run only after the
  // offending render had already committed, and would buy a cascading render to
  // reach a state this comparison already reaches synchronously. Modal state
  // belonging to another review is simply never readable, so it can neither be
  // shown nor confirmed; ApprovalReviewPanel's identity key is what actually
  // discards it, which is React's own answer to resetting state on identity
  // change.
  const activeModal = modal !== null && ownedByCurrentReview(modal) ? modal : null;

  const openModal = (kind: OwnedModal['kind']) => {
    if (currentServiceJobId === null || currentReportId === null) return;
    setModal({
      kind,
      serviceJobId: currentServiceJobId,
      reportId: currentReportId,
      reason: '',
      error: null,
    });
  };

  const updateOwned = (
    owner: OwnedModal,
    next: (current: OwnedModal) => OwnedModal | null
  ) => {
    setModal((current) => {
      if (current === null) return null;
      if (
        current.kind !== owner.kind ||
        current.serviceJobId !== owner.serviceJobId ||
        current.reportId !== owner.reportId
      ) {
        return current;
      }
      return next(current);
    });
  };

  const handleDecide = async (owner: OwnedModal, rejectionReason: string | null) => {
    // Re-checked at dispatch time as well as at render time: the render gate is
    // what makes a superseded confirm control unreachable, this is what makes a
    // dispatch impossible even if one were somehow reached.
    if (!ownedByCurrentReview(owner)) {
      setModal((current) => (current === owner ? null : current));
      return;
    }
    updateOwned(owner, (current) => ({ ...current, error: null }));
    try {
      await review.decide(owner.kind === 'approve' ? 'approved' : 'rejected', rejectionReason);
      updateOwned(owner, () => null);
    } catch (error) {
      const message =
        error instanceof ApprovalDecisionGuardError
          ? GUARD_REASON_MESSAGES[error.reason]
          : error instanceof Error
            ? error.message
            : 'ไม่สามารถดำเนินการได้';
      // Ownership-checked so a decision that settles after the reviewer has
      // moved on cannot surface A's failure inside B's modal.
      updateOwned(owner, (current) => ({ ...current, error: message }));
    }
  };

  const trimmedReason = activeModal === null ? '' : activeModal.reason.trim();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PrimaryButton
        onClick={() => openModal('approve')}
        disabled={!review.decisionEnabled || review.isDeciding}
        className="px-4 py-2.5 text-sm"
      >
        <CheckCircle2 className="h-4 w-4" />
        {review.isDeciding ? 'กำลังดำเนินการ…' : 'อนุมัติ'}
      </PrimaryButton>
      <SecondaryButton
        onClick={() => openModal('reject')}
        disabled={!review.decisionEnabled || review.isDeciding}
        className="px-4 py-2.5 text-sm text-danger-600 ring-danger-200"
      >
        <XCircle className="h-4 w-4" />
        ปฏิเสธ
      </SecondaryButton>

      {activeModal !== null && activeModal.kind === 'approve' ? (
        <Modal
          title="ยืนยันการอนุมัติใบรายงาน"
          onClose={() => setModal(null)}
          preventClose={review.isDeciding}
        >
          <div className="space-y-4">
            <p className="text-sm leading-6 text-neutral-600">
              ยืนยันว่าใบรายงานฉบับนี้ผ่านการตรวจสอบและอนุมัติ การอนุมัติถือเป็นที่สิ้นสุด
              ไม่สามารถย้อนกลับได้
            </p>
            <AsyncErrorAlert message={activeModal.error} />
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setModal(null)} disabled={review.isDeciding}>
                ยกเลิก
              </SecondaryButton>
              <PrimaryButton
                onClick={() => void handleDecide(activeModal, null)}
                disabled={review.isDeciding}
              >
                {review.isDeciding ? 'กำลังอนุมัติ…' : 'ยืนยันการอนุมัติ'}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      ) : null}

      {activeModal !== null && activeModal.kind === 'reject' ? (
        <Modal
          title="ปฏิเสธใบรายงาน"
          onClose={() => setModal(null)}
          preventClose={review.isDeciding}
        >
          <div className="space-y-4">
            <Field label="เหตุผลในการปฏิเสธ (จำเป็นต้องระบุ)">
              <textarea
                value={activeModal.reason}
                onChange={(event) => {
                  const reason = event.target.value;
                  updateOwned(activeModal, (current) => ({ ...current, reason }));
                }}
                className={inputClass('min-h-[7rem] resize-none')}
                placeholder="ระบุเหตุผลที่ปฏิเสธใบรายงานนี้"
              />
            </Field>
            <AsyncErrorAlert message={activeModal.error} />
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setModal(null)} disabled={review.isDeciding}>
                ยกเลิก
              </SecondaryButton>
              <PrimaryButton
                onClick={() => void handleDecide(activeModal, trimmedReason)}
                disabled={review.isDeciding || trimmedReason.length === 0}
                className="bg-danger-600 hover:bg-danger-700"
              >
                {review.isDeciding ? 'กำลังปฏิเสธ…' : 'ยืนยันการปฏิเสธ'}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
