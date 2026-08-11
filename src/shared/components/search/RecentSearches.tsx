import { History } from 'lucide-react';

export function RecentSearches({
  searches,
  onSelect,
}: {
  searches: string[];
  onSelect: (term: string) => void;
}) {
  if (searches.length === 0) return null;

  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-500">
        <History className="h-4 w-4" />
        การค้นหาล่าสุด
      </h3>
      <div className="flex flex-wrap gap-2">
        {searches.map((term) => (
          <button
            key={term}
            type="button"
            onClick={() => onSelect(term)}
            className="rounded-full bg-white/70 px-4 py-2 text-sm font-medium text-neutral-600 ring-1 ring-black/5 backdrop-blur transition-all hover:bg-white"
          >
            {term}
          </button>
        ))}
      </div>
    </div>
  );
}
