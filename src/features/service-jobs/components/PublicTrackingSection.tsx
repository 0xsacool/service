import { useState } from 'react';
import { Copy, Link as LinkIcon, RotateCw, ShieldCheck } from 'lucide-react';
import type { ServiceJob } from '../../../types';
import { GlassCard, PrimaryButton, SecondaryButton } from '../../../shared/components';
import { buildPublicTrackingUrl } from '../../../services/publicTrackingLink';
import { PublicTrackingIssuanceError } from '../../../repositories/types';

export interface PublicTrackingIssueResult {
  code: string;
  job: ServiceJob;
}

// F5d-69G / DECISIONS.md #041 — the staff-facing control for activating and
// rotating a Service Job's public tracking credential.
//
// Three genuinely distinct states, never collapsed into two:
//   A  inactive                      — publicTrackingCodeHash === null
//   B  active, plaintext known here  — just issued in THIS session
//   C  active, plaintext unknown     — issued earlier, or issued by a request
//                                      whose response never arrived
// State C must never render as State A: the credential really is live for the
// customer, it simply cannot be shown again (the stored value is a one-way
// hash — no recovery read, no collection scan, by design).
export function PublicTrackingSection({
  job,
  onIssue,
  onRefreshJob,
  onIssued,
}: {
  job: ServiceJob;
  onIssue: (id: string) => Promise<PublicTrackingIssueResult>;
  onRefreshJob?: (id: string) => ServiceJob | undefined;
  onIssued?: (code: string) => void;
}) {
  const [isActive, setIsActive] = useState(job.publicTrackingCodeHash !== null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOutcomeUnconfirmed, setIsOutcomeUnconfirmed] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'code' | 'link' | null>(null);

  const trackingUrl = issuedCode
    ? buildPublicTrackingUrl(window.location.origin, job.id, issuedCode)
    : null;

  const issue = async () => {
    setIsIssuing(true);
    setError(null);
    setIsOutcomeUnconfirmed(false);
    setCopyFeedback(null);
    try {
      const result = await onIssue(job.id);
      setIssuedCode(result.code);
      setIsActive(true);
      setConfirmingRotate(false);
      onIssued?.(result.code);
    } catch (issuanceError) {
      // A conclusive rejection (the Worker refused before writing anything)
      // is reported as a definite failure. Anything else is genuinely
      // unknown — the credential may already be live — so it is reported
      // neutrally and NEVER retried automatically, because an automatic
      // retry would silently rotate a credential that may already be in the
      // customer's hands. Recovery is always an explicit staff rotation.
      const conclusive =
        issuanceError instanceof PublicTrackingIssuanceError && issuanceError.isConclusive;
      if (conclusive) {
        setError('ไม่สามารถสร้างรหัสติดตามได้ กรุณาลองอีกครั้ง');
      } else {
        setIsOutcomeUnconfirmed(true);
        // Re-read the job's real persisted state so staff can tell "still
        // inactive" from "active but the code was never delivered".
        const refreshed = onRefreshJob?.(job.id);
        if (refreshed && refreshed.publicTrackingCodeHash !== null) setIsActive(true);
      }
      setConfirmingRotate(false);
    } finally {
      setIsIssuing(false);
    }
  };

  const copy = async (kind: 'code' | 'link', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(kind);
    } catch {
      setError('ไม่สามารถคัดลอกได้ กรุณาคัดลอกด้วยตนเอง');
    }
  };

  return (
    <GlassCard className="p-6 animate-[rise_0.55s_cubic-bezier(0.22,1,0.36,1)_both]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-ink">การติดตามสาธารณะ</h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            isActive
              ? 'bg-success-50 text-success-700 ring-1 ring-success-200'
              : 'bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {isActive ? 'เปิดใช้งานแล้ว' : 'ยังไม่ได้เปิดใช้งาน'}
        </span>
      </div>

      {isOutcomeUnconfirmed && (
        <p
          role="status"
          className="mb-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200"
        >
          ไม่สามารถยืนยันผลการสร้างรหัสติดตามได้
          หากระบบแสดงว่าเปิดใช้งานแล้ว ให้กด “ออกใหม่” เพื่อรับรหัสใหม่
        </p>
      )}

      {issuedCode && trackingUrl ? (
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">
            รหัสติดตามใหม่ — บันทึกหรือคัดลอกไว้ตอนนี้ ระบบจะไม่แสดงรหัสนี้อีก
          </p>
          <div className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-black/5">
            <p className="font-mono text-lg font-semibold text-ink">{issuedCode}</p>
            <p className="mt-1 break-all text-xs text-neutral-500">{trackingUrl}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={() => void copy('code', issuedCode)} className="text-sm">
              <Copy className="h-4 w-4" />
              คัดลอกรหัส
            </SecondaryButton>
            <SecondaryButton onClick={() => void copy('link', trackingUrl)} className="text-sm">
              <LinkIcon className="h-4 w-4" />
              คัดลอกลิงก์
            </SecondaryButton>
          </div>
          {copyFeedback && (
            <p role="status" className="text-xs text-success-700">
              {copyFeedback === 'code' ? 'คัดลอกรหัสแล้ว' : 'คัดลอกลิงก์แล้ว'}
            </p>
          )}
          {confirmingRotate ? (
            <RotateConfirmation
              isIssuing={isIssuing}
              onConfirm={() => void issue()}
              onCancel={() => setConfirmingRotate(false)}
            />
          ) : (
            <SecondaryButton onClick={() => setConfirmingRotate(true)} className="text-sm">
              <RotateCw className="h-4 w-4" />
              ออกใหม่
            </SecondaryButton>
          )}
        </div>
      ) : isActive ? (
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">
            เปิดใช้งานแล้ว — รหัสเดิมไม่สามารถแสดงซ้ำได้ หากต้องการรหัสสำหรับส่งให้ลูกค้าหรือพิมพ์ QR
            กรุณากด “ออกใหม่”
          </p>
          {confirmingRotate ? (
            <RotateConfirmation
              isIssuing={isIssuing}
              onConfirm={() => void issue()}
              onCancel={() => setConfirmingRotate(false)}
            />
          ) : (
            <SecondaryButton onClick={() => setConfirmingRotate(true)} className="text-sm">
              <RotateCw className="h-4 w-4" />
              ออกใหม่ / Rotate tracking code
            </SecondaryButton>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">
            ยังไม่ได้เปิดใช้งานการติดตามสาธารณะสำหรับงานบริการนี้
          </p>
          <PrimaryButton onClick={() => void issue()} disabled={isIssuing} className="text-sm">
            <ShieldCheck className="h-4 w-4" />
            {isIssuing ? 'กำลังสร้างรหัส…' : 'สร้างรหัสติดตาม'}
          </PrimaryButton>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-600">
          {error}
        </p>
      )}
    </GlassCard>
  );
}

function RotateConfirmation({
  isIssuing,
  onConfirm,
  onCancel,
}: {
  isIssuing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <p className="text-sm font-medium text-amber-800">
        ยืนยันออกรหัสใหม่? รหัสเดิมจะใช้งานไม่ได้ทันที
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <PrimaryButton onClick={onConfirm} disabled={isIssuing} className="text-sm">
          <RotateCw className="h-4 w-4" />
          {isIssuing ? 'กำลังออกรหัส…' : 'ยืนยันออกรหัสใหม่'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} className="text-sm">
          ยกเลิก
        </SecondaryButton>
      </div>
    </div>
  );
}
