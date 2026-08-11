import { useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { FormSection } from '../../../shared/components';
import { RECOMMENDED_PHOTO_CHECKLIST } from '../../../constants';
import type { PhotoEvidence } from '../../../types';

// Reads every selected/dropped file in parallel and resolves once, as a
// single array — appending photos one-by-one from separate FileReader
// callbacks would race against a stale `photos` closure and drop all but
// the last file when multiple are selected at once.
function readFilesAsPhotos(fileList: FileList): Promise<PhotoEvidence[]> {
  return Promise.all(
    Array.from(fileList).map(
      (file) =>
        new Promise<PhotoEvidence | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve(
              typeof reader.result === 'string'
                ? { id: crypto.randomUUID(), dataUrl: reader.result, fileName: file.name }
                : null
            );
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        })
    )
  ).then((results) => results.filter((photo): photo is PhotoEvidence => photo !== null));
}

export function PhotoEvidenceSection({
  photos,
  onChange,
}: {
  photos: PhotoEvidence[];
  onChange: (photos: PhotoEvidence[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const newPhotos = await readFilesAsPhotos(fileList);
    onChange([...photos, ...newPhotos]);
  };

  const removePhoto = (id: string) => {
    onChange(photos.filter((photo) => photo.id !== id));
  };

  return (
    <FormSection
      icon={Camera}
      title="รูปถ่ายหลักฐาน"
      subtitle="ไม่บังคับ แต่แนะนำให้เพิ่ม"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium uppercase tracking-wide text-neutral-400">
          แนะนำ:
        </span>
        {RECOMMENDED_PHOTO_CHECKLIST.map((item) => (
          <span
            key={item}
            className="rounded-full bg-neutral-100 px-2.5 py-1 font-medium text-neutral-500"
          >
            {item}
          </span>
        ))}
      </div>

      {photos.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            void addFiles(e.dataTransfer.files);
          }}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
            isDragging
              ? 'border-brand-400 bg-brand-50/50 text-brand-500'
              : 'border-neutral-300 text-neutral-400 hover:border-brand-400 hover:text-brand-500'
          }`}
        >
          <Camera className="h-8 w-8" />
          <span className="font-medium">คลิกเพื่อเพิ่มรูป หรือกดลากมาวาง</span>
          <span className="text-sm text-neutral-400">เลือกหลายรูปพร้อมกันได้</span>
        </button>
      ) : (
        <div className="flex flex-wrap gap-3">
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="relative h-24 w-24 overflow-hidden rounded-2xl ring-1 ring-black/10"
            >
              <img
                src={photo.dataUrl}
                alt={photo.fileName}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-brand-400 hover:text-brand-500"
          >
            <Camera className="h-6 w-6" />
            <span className="text-xs">เพิ่ม</span>
          </button>
        </div>
      )}
    </FormSection>
  );
}
