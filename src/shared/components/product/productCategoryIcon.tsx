import { Smartphone, Laptop, Tablet, Watch, Headphones, Package } from 'lucide-react';
import type { ReactNode } from 'react';

// Returns the rendered icon directly (not a component reference) — picking
// a component type dynamically and rendering it as <Chosen /> flags
// react-hooks/static-components, since the linter can't verify it's a
// stable reference across renders. These are all statically-known JSX tags.
export function productCategoryIcon(
  category: string,
  className: string,
  strokeWidth = 1.5
): ReactNode {
  switch (category) {
    case 'Smartphone':
      return <Smartphone className={className} strokeWidth={strokeWidth} />;
    case 'Laptop':
      return <Laptop className={className} strokeWidth={strokeWidth} />;
    case 'Tablet':
      return <Tablet className={className} strokeWidth={strokeWidth} />;
    case 'Smartwatch':
      return <Watch className={className} strokeWidth={strokeWidth} />;
    case 'Headphones':
      return <Headphones className={className} strokeWidth={strokeWidth} />;
    default:
      return <Package className={className} strokeWidth={strokeWidth} />;
  }
}
