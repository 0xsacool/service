import type { ServiceIntakeData } from '../types';

// Minimum bar for "intake complete enough to move to Save & Print": the
// staff member must have recorded what's wrong, via free text or at least
// one quick-problem chip. Accessories, internal notes, and photos are all
// explicitly optional per Sprint 3's scope, so they don't gate the reveal.
export function isServiceIntakeComplete(intake: ServiceIntakeData): boolean {
  return intake.problemDescription.trim().length > 0 || intake.problemChips.length > 0;
}
