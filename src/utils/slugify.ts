// Shared id-generation building block — used wherever an admin-entered
// label needs a stable, human-readable id (Product Master entries,
// Product Knowledge accessories/common problems).
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
