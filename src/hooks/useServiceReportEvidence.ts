import { useEffect, useRef, useState } from 'react';
import { repositories } from '../repositories/repositoryProvider';
import type { ServiceJobAttachmentOption } from './useServiceJobAttachments';

export interface ServiceReportEvidencePreview {
  id: string;
  name: string;
  category: string;
  contentType: string;
  url: string | null;
  status: 'ready' | 'unavailable';
}

// Phase 6R-B.4 (Phase 4R.6R2 SHOULD FIX) — getDownloadUrl() hands back a
// caller-owned disposable object URL (AttachmentsRepository in
// repositories/types.ts, DECISIONS.md #047), so every URL this hook receives
// needs exactly one owner that will revoke it.
//
// Cleanup alone cannot be that owner. A download in flight when the component
// unmounts, or when the selected evidence changes, settles AFTER cleanup has
// already run: the URL would be registered into a dead request and never
// revoked. `generation` is therefore invalidated first and rechecked after
// every await, so a resolution that no longer owns the hook disposes of its
// own URL instead of becoming ownerless.
export function useServiceReportEvidence(
  attachmentIds: string[],
  attachments: ServiceJobAttachmentOption[]
): { evidence: ServiceReportEvidencePreview[]; isLoading: boolean } {
  const attachmentKey = attachments
    .map((attachment) => `${attachment.id}:${attachment.contentType}`)
    .join('|');
  const requestKey = `${attachmentIds.join('|')}::${attachmentKey}`;
  const [resolvedKey, setResolvedKey] = useState('');
  const [evidence, setEvidence] = useState<ServiceReportEvidencePreview[]>([]);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const run = generation.current;
    const owns = (): boolean => generation.current === run;
    const owned = new Set<string>();
    const resolveEvidence = async (): Promise<void> => {
      const resolved = await Promise.all(
        attachmentIds.map(async (id): Promise<ServiceReportEvidencePreview> => {
          const metadata = attachments.find((attachment) => attachment.id === id);
          if (!metadata || !metadata.contentType.startsWith('image/')) {
            return {
              id,
              name: metadata?.name ?? 'Evidence unavailable',
              category: metadata?.category ?? 'unknown',
              contentType: metadata?.contentType ?? 'unknown',
              url: null,
              status: 'unavailable',
            };
          }

          try {
            const url = await repositories.attachments.getDownloadUrl(id);
            if (!owns()) {
              URL.revokeObjectURL(url);
              return {
                id,
                name: metadata.name,
                category: metadata.category,
                contentType: metadata.contentType,
                url: null,
                status: 'unavailable',
              };
            }
            owned.add(url);
            return {
              id,
              name: metadata.name,
              category: metadata.category,
              contentType: metadata.contentType,
              url,
              status: 'ready',
            };
          } catch {
            return {
              id,
              name: metadata.name,
              category: metadata.category,
              contentType: metadata.contentType,
              url: null,
              status: 'unavailable',
            };
          }
        })
      );

      if (!owns()) return;
      setEvidence(resolved);
      setResolvedKey(requestKey);
    };

    void resolveEvidence();
    return () => {
      generation.current += 1;
      owned.forEach((url) => URL.revokeObjectURL(url));
      owned.clear();
    };
    // requestKey serializes both arrays so the effect can avoid rerunning for
    // new array identities when the selected evidence has not changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return { evidence, isLoading: requestKey !== resolvedKey };
}
