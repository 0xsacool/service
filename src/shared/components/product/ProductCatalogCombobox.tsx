import { useId, useMemo, useState } from 'react';
import type { ProductMasterEntry } from '../../../types';
import {
  productCatalogOptionLabel,
  searchActiveProductCatalog,
} from '../../../services/productCatalogSearch';
import { inputClass } from '../../../utils/inputClass';

export function ProductCatalogCombobox({
  products,
  selected,
  onSelect,
  onManual,
}: {
  products: readonly ProductMasterEntry[];
  selected: ProductMasterEntry | undefined;
  onSelect: (product: ProductMasterEntry) => void;
  onManual: () => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState(() =>
    selected ? productCatalogOptionLabel(selected) : ''
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(
    () => searchActiveProductCatalog(products, query),
    [products, query]
  );

  const choose = (product: ProductMasterEntry) => {
    setQuery(productCatalogOptionLabel(product));
    setOpen(false);
    setActiveIndex(0);
    onSelect(product);
  };

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && results[activeIndex]
            ? `${listId}-${results[activeIndex]!.id}`
            : undefined
        }
        value={query}
        placeholder="พิมพ์รุ่น / SKU / ชื่อสินค้า / แบรนด์..."
        className={inputClass()}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) =>
              Math.min(index + 1, Math.max(0, results.length - 1))
            );
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(0, index - 1));
          } else if (event.key === 'Enter' && open && results[activeIndex]) {
            event.preventDefault();
            choose(results[activeIndex]!);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-2xl bg-white p-2 shadow-xl ring-1 ring-black/10"
        >
          {results.length > 0 ? (
            results.map((product, index) => (
              <button
                key={product.id}
                id={`${listId}-${product.id}`}
                type="button"
                role="option"
                aria-selected={selected?.id === product.id}
                className={`block w-full rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                  index === activeIndex
                    ? 'bg-brand-50 text-brand-700'
                    : 'hover:bg-neutral-50'
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(product)}
              >
                <span className="block font-medium text-ink">
                  {product.model}
                  {product.sku ? ` · SKU ${product.sku}` : ''}
                </span>
                <span className="block text-xs text-neutral-500">
                  {product.name} · {product.brand}
                </span>
              </button>
            ))
          ) : (
            <p className="px-3 py-3 text-sm text-neutral-500">
              ไม่พบสินค้าใช้งานที่ตรงกับคำค้น
            </p>
          )}
          <button
            type="button"
            className="mt-1 block w-full rounded-xl border-t border-black/5 px-3 py-2 text-left text-sm font-medium text-brand-600 hover:bg-brand-50"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setOpen(false);
              onManual();
            }}
          >
            ไม่พบในรายการ / กรอกเอง
          </button>
        </div>
      )}
    </div>
  );
}
