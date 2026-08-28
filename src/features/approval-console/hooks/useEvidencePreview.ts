import { useCallback, useEffect, useRef, useState } from 'react';
import { repositories } from '../../../repositories/repositoryProvider';
import { safeEvidenceErrorMessage } from '../approvalConsoleUi';

export type EvidencePreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface EvidencePreviewState {
  status: EvidencePreviewStatus;
  url: string | null;
  errorMessage: string | null;
}

export interface EvidencePreviewController {
  stateFor(attachmentKey: string): EvidencePreviewState;
  resolve(attachmentKey: string): void;
}

const IDLE_STATE: EvidencePreviewState = { status: 'idle', url: null, errorMessage: null };

type EvidencePreviewStore = Record<string, EvidencePreviewState>;

const EMPTY_STORE: EvidencePreviewStore = {};

// Phase 6R-B — evidence keys (ApprovalReviewV1.content.evidenceAttachmentIds)
// are canonical R2 keys, not viewable URLs. Resolution goes through the
// already-accepted AttachmentsRepository.getDownloadUrl(id) (Worker-token
// gated, no new endpoint, no raw R2 URL). Resolution is lazy — only on
// resolve(), i.e. the approver clicking "view" on a specific item — not
// eager for every evidence item on page load.
//
// Phase 6R-B.2 (SF-2) — ownerKey is the review this controller's URLs belong
// to. ApprovalReviewPanel does NOT remount between selections (React reuses
// the EvidenceList instance and only swaps its props), so unmount cleanup
// alone left A's object URLs alive under B and let a late A resolution
// publish into B's store. Three fences replace it:
//
//   * derivation — a store stamped with a different owner reads as empty, so
//     A's evidence can never render under B (the same key/identity
//     derivation useApprovalConsoleReads uses for queue and review state);
//   * ownership — {owner, generation}, re-stamped on every owner change and
//     cleared to a null owner on unmount, captured when a resolution starts,
//     so a late completion knows it no longer owns the controller and revokes
//     its URL instead of publishing it;
//   * ownedUrls — the one URL currently held per key, revoked when it is
//     replaced (retry) and when the owner changes or the hook unmounts.
//
// inFlight is a synchronous ref claim, not derived from status: two clicks in
// the same tick share one render closure and would both read an idle status,
// dispatching two downloads of which only one could ever be displayed (the
// same reason the D25 decision latch is a ref — see useApprovalConsoleReads).
export function useEvidencePreview(ownerKey: string): EvidencePreviewController {
  const [store, setStore] = useState<{ owner: string; byKey: EvidencePreviewStore }>(() => ({
    owner: ownerKey,
    byKey: EMPTY_STORE,
  }));
  const ownedUrls = useRef<Map<string, string>>(new Map());
  const inFlight = useRef<Set<string>>(new Set());
  const ownership = useRef<{ owner: string | null; generation: number }>({
    owner: ownerKey,
    generation: 0,
  });

  const releaseOwnedUrls = useCallback(() => {
    ownedUrls.current.forEach((url) => URL.revokeObjectURL(url));
    ownedUrls.current.clear();
    inFlight.current.clear();
  }, []);

  useEffect(() => {
    ownership.current = { owner: ownerKey, generation: ownership.current.generation + 1 };
    return () => {
      ownership.current = { owner: null, generation: ownership.current.generation + 1 };
      releaseOwnedUrls();
    };
  }, [ownerKey, releaseOwnedUrls]);

  const resolve = useCallback(
    (attachmentKey: string) => {
      if (inFlight.current.has(attachmentKey)) return;
      inFlight.current.add(attachmentKey);
      const owner = ownerKey;
      const run = ownership.current.generation;
      const owns = () =>
        ownership.current.owner === owner && ownership.current.generation === run;
      const publish = (next: EvidencePreviewState) => {
        setStore((current) => {
          const byKey = current.owner === owner ? current.byKey : EMPTY_STORE;
          return { owner, byKey: { ...byKey, [attachmentKey]: next } };
        });
      };

      publish({ status: 'loading', url: null, errorMessage: null });

      void (async () => {
        try {
          const url = await repositories.attachments.getDownloadUrl(attachmentKey);
          if (!owns()) {
            URL.revokeObjectURL(url);
            return;
          }
          const previous = ownedUrls.current.get(attachmentKey);
          if (previous && previous !== url) URL.revokeObjectURL(previous);
          ownedUrls.current.set(attachmentKey, url);
          inFlight.current.delete(attachmentKey);
          publish({ status: 'ready', url, errorMessage: null });
        } catch (error) {
          if (!owns()) return;
          inFlight.current.delete(attachmentKey);
          publish({
            status: 'error',
            url: null,
            errorMessage: safeEvidenceErrorMessage(error),
          });
        }
      })();
    },
    [ownerKey]
  );

  const visible = store.owner === ownerKey ? store.byKey : EMPTY_STORE;

  const stateFor = useCallback(
    (attachmentKey: string): EvidencePreviewState => visible[attachmentKey] ?? IDLE_STATE,
    [visible]
  );

  return { stateFor, resolve };
}
