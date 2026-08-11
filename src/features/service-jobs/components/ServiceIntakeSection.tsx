import type { ServiceIntakeData } from '../../../types';
import { ProblemSection } from './ProblemSection';
import { AccessoriesSection } from './AccessoriesSection';
import { InternalNotesSection } from './InternalNotesSection';
import { PhotoEvidenceSection } from './PhotoEvidenceSection';

export interface ServiceIntakeSectionProps {
  value: ServiceIntakeData;
  onChange: (value: ServiceIntakeData) => void;
}

// Purely compositional — owns no state and no completeness rules itself.
// The parent page owns `value`/`onChange` and decides what "complete"
// means (see validation/serviceIntakeValidation.ts) so that rule lives in
// one place, not scattered across four section components.
export function ServiceIntakeSection({ value, onChange }: ServiceIntakeSectionProps) {
  return (
    <div className="space-y-6">
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
    </div>
  );
}
