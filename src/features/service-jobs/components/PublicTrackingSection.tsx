import { useLayoutEffect, useRef, useState } from 'react';
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
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOutcomeUnconfirmed, setIsOutcomeUnconfirmed] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'code' | 'link' | null>(null);

  // F5d-70 Phase 5B.1 — entity boundary: no reset effect here. Both real
  // call sites now guarantee job.id can never change within one mounted
  // instance of this component: ServiceJobDetails.tsx renders its
  // ServiceJobDetailsView parent with key={claim.id}, so a different job
  // always arrives via a fresh mount of this whole subtree (fresh
  // useState(null) for issuedCode, not a reset effect racing the paint);
  // NewServiceJob.tsx only ever swaps to a different job's id by first
  // passing through savedJob === null (which unmounts this component
  // entirely, since it only renders inside the `savedJob ? (...) : (...)`
  // branch) before a new job can ever be set. An in-flight issue()
  // promise from a since-unmounted instance resolving late is a no-op —
  // React 18+ silently drops a state update targeting an unmounted
  // function component's own closure; it cannot reach a different,
  // separately-mounted instance's state, because there is no shared
  // mutable reference between them. A passive same-component reset effect
  // was removed rather than kept as inert defense-in-depth: independent
  // review's point stands generally — a passive effect cannot be the
  // entity-isolation mechanism, since it only runs after a render (and,
  // for useEffect, after paint) has already committed with mismatched
  // state — so the actual boundary must be (and now is) the mount/unmount
  // lifecycle itself, not an effect layered on top of it.

  // F5d-70 Phase 5B.2/5B.3 — a mount-LIFETIME guard for the async issue()/
  // rotate() continuation only. This is NOT an entity-boundary or
  // reconciliation mechanism (Phase 5B.1 correctly removed those, and
  // job.id still cannot change within one mounted instance — see the
  // comment above). It exists because a request this component started
  // can outlive this specific mounted instance: e.g. NewServiceJob's
  // startNewServiceJob() unmounts this component while an issue()/
  // rotate() promise is still in flight for the OLD job, and that promise
  // resolving afterward must not call the parent's onIssued(...) — doing
  // so would repopulate the parent's transient plaintext state with the
  // old job's credential just before a new job is created, letting it
  // leak into the new job's UI.
  //
  // Lifecycle semantics (Phase 5B.3 correction — the Phase 5B.2 version
  // only ever set the ref to false in cleanup and never re-armed it in
  // setup, which is wrong under StrictMode): setup unconditionally
  // establishes current ownership (mountedRef.current = true); cleanup
  // revokes it (mountedRef.current = false). In development, React
  // StrictMode deliberately exercises setup -> cleanup -> setup once for
  // every effect on a component that stays mounted, specifically to
  // surface effects whose cleanup doesn't correctly undo their own setup —
  // the previous cleanup-only version failed exactly that check, since the
  // simulated cleanup left the ref false with no second setup to flip it
  // back, permanently misclassifying a still-mounted component's own
  // legitimate in-flight issuance as stale. With setup re-arming the ref
  // every time it runs, the sequence ends with mountedRef.current === true
  // whenever the component is actually still mounted (StrictMode's extra
  // pair included), and only a REAL unmount — one whose cleanup is not
  // followed by another setup — leaves it false.
  //
  // useLayoutEffect (not useEffect): this control ref has no rendering/
  // layout output of its own, but a layout effect's setup/cleanup pair
  // runs synchronously as part of the same commit that mounts/unmounts the
  // component, before the browser paints or any further scheduling can
  // happen — removing any ambiguity about exactly when ownership flips,
  // consistent with the same reasoning already applied to
  // ServiceJobDetailsView's reconciliation effect. The dependency array
  // stays empty — ownership must never be re-armed or revoked by a
  // same-job re-render (a fresh `job` prop, a dataVersion bump, a status
  // change, or anything else that doesn't destroy this component leaves
  // mountedRef.current === true throughout, and any in-flight issuance is
  // still allowed to complete normally).
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // F5d-70 Phase 5B — derived, not stored: "active" is true whenever EITHER
  // the persisted hash says so (monotonic external activation — issue and
  // rotate are the only writers of this field; there is no revoke path) OR
  // this session issued/rotated a code itself (visible immediately, before
  // the fresh hash has round-tripped back through the repository). Deriving
  // this — rather than an independent `isActive` state that only ever got
  // updated from this component's OWN actions — eliminates the P1 defect
  // where a mounted page could remain stuck showing "inactive" (and its
  // first-issuance action) after the job had already become active
  // elsewhere in the same session; it can never drift from either source
  // of truth, because it is never its own source of truth.
  const isActive = job.publicTrackingCodeHash !== null || issuedCode !== null;

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
      // F5d-70 Phase 5B.2 — stale-continuation guard, checked immediately
      // after the await, before any state write or parent callback. The
      // backend issuance may have already completed successfully — that is
      // never undone here (see below) — this only stops the now-stale UI
      // continuation from writing local state or, critically, calling the
      // parent's onIssued(...) with a credential belonging to whatever job
      // this component used to represent.
      if (!mountedRef.current) return;
      setIssuedCode(result.code);
      setConfirmingRotate(false);
      onIssued?.(result.code);
    } catch (issuanceError) {
      if (!mountedRef.current) return;
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
        // Re-read the job's real persisted state so a fresh repository row
        // is available immediately. `isActive` above is derived from the
        // `job` prop, so once the parent re-renders with that fresh row
        // (F5d-70 dataVersion reactivity), "still inactive" vs "active but
        // the code was never delivered" resolves itself with no separate
        // flag to keep in sync here.
        onRefreshJob?.(job.id);
      }
      setConfirmingRotate(false);
    } finally {
      // Same guard: a stale continuation must not write even this
      // purely-local flag once its owning instance is gone.
      if (mountedRef.current) setIsIssuing(false);
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
