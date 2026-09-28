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
  const activeAlt =
    photos.length > 1 ? `${alt} รูปที่ ${activePhoto + 1} จาก ${photos.length}` : alt;

  return (
    <GlassCard className={`overflow-hidden ${animationClassName}`}>
      <div className={`relative ${aspectRatio} w-full overflow-hidden bg-neutral-100`}>
        <img
          src={photos[activePhoto]}
          alt={activeAlt}
          className="h-full w-full object-cover"
        />
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 p-3" role="group" aria-label={`เลือกรูปภาพ ${alt}`}>
          {photos.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActivePhoto(i)}
              aria-label={`ดูรูปที่ ${i + 1} จาก ${photos.length}: ${alt}`}
              aria-pressed={activePhoto === i}
              className={`h-14 w-14 overflow-hidden rounded-xl ring-2 transition-all motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
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
