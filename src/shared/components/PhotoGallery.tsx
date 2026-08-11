import { useState } from 'react';
import type { ReactNode } from 'react';
import { GlassCard } from './GlassCard';

export function PhotoGallery({
  photos,
  alt,
  aspectRatio = 'aspect-[4/3]',
  animationClassName = '',
  children,
}: {
  photos: string[];
  alt: string;
  aspectRatio?: string;
  animationClassName?: string;
  children?: ReactNode;
}) {
  const [activePhoto, setActivePhoto] = useState(0);

  return (
    <GlassCard className={`overflow-hidden ${animationClassName}`}>
      <div className={`relative ${aspectRatio} w-full overflow-hidden bg-neutral-100`}>
        <img src={photos[activePhoto]} alt={alt} className="h-full w-full object-cover" />
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 p-3">
          {photos.map((p, i) => (
            <button
              key={i}
              onClick={() => setActivePhoto(i)}
              className={`h-14 w-14 overflow-hidden rounded-xl ring-2 transition-all ${
                activePhoto === i ? 'ring-brand-500' : 'ring-transparent'
              }`}
            >
              <img src={p} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {children}
    </GlassCard>
  );
}
