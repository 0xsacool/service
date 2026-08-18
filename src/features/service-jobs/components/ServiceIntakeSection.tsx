import type { ServiceIntakeData } from '../../../types';
import { isValidCalendarDate } from '../../../utils/serviceEventValidation';
import { ProblemSection } from './ProblemSection';
import { AccessoriesSection } from './AccessoriesSection';
import { InternalNotesSection } from './InternalNotesSection';
import { PhotoEvidenceSection } from './PhotoEvidenceSection';
import { ContactOrderMetadataSection } from './ContactOrderMetadataSection';
import { ExternalEvidenceSection } from './ExternalEvidenceSection';

export interface ServiceIntakeSectionProps {
  value: ServiceIntakeData;
  onChange: (value: ServiceIntakeData) => void;
}

// Purely compositional — owns no state and no completeness rules itself.
// The parent page owns `value`/`onChange` and decides what "complete"
// means (see validation/serviceIntakeValidation.ts) so that rule lives in
// one place, not scattered across section components.
export function ServiceIntakeSection({ value, onChange }: ServiceIntakeSectionProps) {
  return (
    <div className="space-y-6">
      <ContactOrderMetadataSection
        value={{
          contactChannel: value.contactChannel,
          contactChannelIdentity: value.contactChannelIdentity,
          orderNumber: value.orderNumber,
          purchaseDate: value.purchaseDate,
          orderDeliveredDate: value.orderDeliveredDate,
        }}
        onChange={(next) => onChange({ ...value, ...next })}
        purchaseDateError={
          value.purchaseDate !== '' && !isValidCalendarDate(value.purchaseDate)
            ? 'วันที่ไม่ถูกต้อง'
            : null
        }
        orderDeliveredDateError={
          value.orderDeliveredDate !== '' && !isValidCalendarDate(value.orderDeliveredDate)
            ? 'วันที่ไม่ถูกต้อง'
            : null
        }
      />
      <ProblemSection
        description={value.problemDescription}
        chips={value.problemChips}
        onDescriptionChange={(problemDescription) =>
          onChange({ ...value, problemDescription })
        }
        onChipsChange={(problemChips) => onChange({ ...value, problemChips })}
      />
      <AccessoriesSection
        accessories={value.accessories}
        onChange={(accessories) => onChange({ ...value, accessories })}
      />
      <InternalNotesSection
        notes={value.internalNotes}
        onChange={(internalNotes) => onChange({ ...value, internalNotes })}
      />
      <PhotoEvidenceSection
        photos={value.photos}
        onChange={(photos) => onChange({ ...value, photos })}
      />
      <ExternalEvidenceSection
        url={value.externalEvidenceUrl}
        note={value.externalEvidenceNote}
        onUrlChange={(externalEvidenceUrl) => onChange({ ...value, externalEvidenceUrl })}
        onNoteChange={(externalEvidenceNote) => onChange({ ...value, externalEvidenceNote })}
      />
    </div>
  );
}
