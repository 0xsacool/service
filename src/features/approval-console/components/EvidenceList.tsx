import { Paperclip } from 'lucide-react';
import type { CanonicalAttachmentKey } from '../../../types';
import { useServiceJobAttachments } from '../../../hooks/useServiceJobAttachments';
import { PhotoGallery, SecondaryButton, AsyncErrorAlert } from '../../../shared/components';
import { useEvidencePreview } from '../hooks/useEvidencePreview';

// Phase 6R-B — renders documentary evidence for an ApprovalReviewV1. Never
// renders a raw R2 key/path: names come from useServiceJobAttachments (or a
// generic Thai fallback), and viewing goes through useEvidencePreview's
// lazy, per-click getDownloadUrl resolution — no new endpoint, no invented
// public URL.
//
// Phase 6R-B.2 (SF-2) — reportId is here only to identify which review the
// resolved object URLs belong to. This component is reused, not remounted,
// when the approver moves from one report to the next, so the preview
// controller needs the review identity (the same `${serviceJobId}\0${reportId}`
// shape useApprovalReview keys its own snapshot by) to release the previous
// review's URLs and refuse a late resolution from it.
export function EvidenceList({
  evidenceAttachmentIds,
  serviceJobId,
  reportId,
}: {
  evidenceAttachmentIds: readonly CanonicalAttachmentKey[];
  serviceJobId: string;
  reportId: string;
}) {
  const { attachments } = useServiceJobAttachments(serviceJobId);
  const preview = useEvidencePreview(`${serviceJobId}\0${reportId}`);
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));

  if (evidenceAttachmentIds.length === 0) {
    return <p className="text-sm text-neutral-400">ยังไม่มีหลักฐานแนบ</p>;
  }

  return (
    <div className="space-y-3">
      {evidenceAttachmentIds.map((key) => {
        const attachment = byId.get(key);
        const state = preview.stateFor(key);
        const isImage = attachment?.contentType?.startsWith('image/') ?? false;
        return (
          <div key={key} className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-black/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Paperclip className="h-4 w-4 shrink-0 text-neutral-400" />
                <span className="truncate text-sm text-ink">
                  {attachment?.name ?? 'ไฟล์แนบไม่พร้อมใช้งาน'}
                </span>
                {attachment ? (
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-neutral-500 ring-1 ring-black/5">
                    {attachment.category}
                  </span>
                ) : null}
              </div>
              {attachment && state.status !== 'ready' ? (
                <SecondaryButton
                  onClick={() => preview.resolve(key)}
                  disabled={state.status === 'loading'}
                  className="px-4 py-2 text-xs"
                >
                  {state.status === 'loading' ? 'กำลังโหลด…' : 'ดูหลักฐาน'}
                </SecondaryButton>
              ) : null}
            </div>
            {state.status === 'error' ? (
              <AsyncErrorAlert message={state.errorMessage} className="mt-2" />
            ) : null}
            {state.status === 'ready' && state.url ? (
              isImage ? (
                <div className="mt-3">
                  <PhotoGallery photos={[state.url]} alt={attachment?.name ?? 'หลักฐาน'} />
                </div>
              ) : (
                <a
                  href={state.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline"
                >
                  เปิดไฟล์หลักฐาน
                </a>
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
