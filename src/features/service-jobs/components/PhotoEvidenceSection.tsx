import { useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { AsyncErrorAlert, FormSection } from '../../../shared/components';
import { RECOMMENDED_PHOTO_CHECKLIST } from '../../../constants';
import type { PhotoEvidence } from '../../../types';
import {
  computePerPhotoTargetBytes,
  MAX_PHOTO_ITEMS,
  PHOTO_PROCESSING_CONCURRENCY,
  processInBatches,
  processPhotoFile,
  wouldExceedAggregate,
} from '../../../services/imageEvidenceProcessing';
import { photoProcessingErrorMessage, photoValidationErrorMessage } from '../photoEvidenceErrorMessages';

// Processes every selected/dropped file through a small bounded-concurrency
// pool (decode -> resize -> compress, see imageEvidenceProcessing.ts) rather
// than decoding all of them at once — a full-resolution camera photo can use
// tens of MB per image while decoding, and up to MAX_PHOTO_ITEMS (10) of
// those at once was never safe on mobile memory. Every file in the batch
// shares the same per-photo target (computePerPhotoTargetBytes), sized
// against `existingCount` already-accepted photos plus this whole batch, so
// the target is correct regardless of which file in the pool finishes
// first. A per-file failure never drops the others — each settles
// independently and only the successes are kept.
async function processFilesAsPhotos(
  fileList: FileList,
  existingCount: number
): Promise<{ photos: PhotoEvidence[]; errors: string[] }> {
  const files = Array.from(fileList);
  const targetBytes = computePerPhotoTargetBytes(existingCount, files.length);
  const settled = await processInBatches(
    files,
    async (file) => {
      const { dataUrl, fileName } = await processPhotoFile(file, targetBytes);
      return { id: crypto.randomUUID(), dataUrl, fileName };
    },
    PHOTO_PROCESSING_CONCURRENCY
  );
  const photos: PhotoEvidence[] = [];
  const errors: string[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      photos.push(result.value);
    } else {
      errors.push(photoProcessingErrorMessage(result.reason));
    }
  }
  return { photos, errors };
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setIsProcessing(true);
    try {
      const { photos: processed, errors } = await processFilesAsPhotos(fileList, photos.length);
      const accepted: PhotoEvidence[] = [];
      const rejections: string[] = [...errors];
      let working = photos;
      for (const photo of processed) {
        if (working.length + accepted.length >= MAX_PHOTO_ITEMS) {
          rejections.push(photoValidationErrorMessage('too-many-photos'));
          break;
        }
        if (wouldExceedAggregate([...working, ...accepted], photo.dataUrl)) {
          rejections.push(photoValidationErrorMessage('aggregate-too-large'));
          continue;
        }
        accepted.push(photo);
      }
      if (accepted.length > 0) {
        working = [...working, ...accepted];
        onChange(working);
      }
      if (rejections.length > 0) {
        setError(rejections[0] ?? null);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // F5d-67 Phase 2R2 — removal is blocked outright while an add operation
  // is in flight, not merely hidden behind a disabled control: addFiles()
  // above snapshots `photos` at the start of its async work and only calls
  // onChange() once every file in the batch has settled, so a removal that
  // executed mid-processing would be silently reverted when that stale
  // snapshot is written back. The disabled button prevents the click in the
  // first place; this guard is defense-in-depth against any other caller.
  const removePhoto = (id: string) => {
    if (isProcessing) return;
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
          disabled={isProcessing}
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
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            isDragging
              ? 'border-brand-400 bg-brand-50/50 text-brand-500'
              : 'border-neutral-300 text-neutral-400 hover:border-brand-400 hover:text-brand-500'
          }`}
        >
          <Camera className="h-8 w-8" />
          <span className="font-medium">
            {isProcessing ? 'กำลังประมวลผลรูปภาพ…' : 'คลิกเพื่อเพิ่มรูป หรือกดลากมาวาง'}
          </span>
          <span className="text-sm text-neutral-400">เลือกหลายรูปพร้อมกันได้</span>
        </button>
      ) : (
        <div className="flex flex-wrap gap-3">
          {photos.map((photo, index) => (
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
                disabled={isProcessing}
                aria-disabled={isProcessing}
                onClick={() => removePhoto(photo.id)}
                aria-label={`ลบรูป ${photo.fileName} รูปที่ ${index + 1}`}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-neutral-300 text-neutral-400 transition-colors hover:border-brand-400 hover:text-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Camera className="h-6 w-6" />
            <span className="text-xs">{isProcessing ? 'กำลังประมวลผล…' : 'เพิ่ม'}</span>
          </button>
        </div>
      )}

      <AsyncErrorAlert message={error} />
    </FormSection>
  );
}
