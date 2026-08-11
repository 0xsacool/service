import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let isCurrent = true;
    const objectUrls: string[] = [];
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
            objectUrls.push(url);
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

      if (!isCurrent) return;
      setEvidence(resolved);
      setResolvedKey(requestKey);
    };

    void resolveEvidence();
    return () => {
      isCurrent = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // requestKey serializes both arrays so the effect can avoid rerunning for
    // new array identities when the selected evidence has not changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return { evidence, isLoading: requestKey !== resolvedKey };
}
