import { useState } from 'react';
import { repositories } from '../repositories/repositoryProvider';

export interface ServiceJobAttachmentOption {
  id: string;
  name: string;
  category: string;
  size: number;
  contentType: string;
}

export function useServiceJobAttachments(serviceJobId: string): {
  attachments: ServiceJobAttachmentOption[];
  refresh: () => void;
} {
  const [, setRevision] = useState(0);
  const attachments = repositories.attachments
    .getForJob(serviceJobId)
    .map(({ id, name, category, size, contentType }) => ({
      id,
      name,
      category,
      size,
      contentType,
    }));

  return { attachments, refresh: () => setRevision((value) => value + 1) };
}
