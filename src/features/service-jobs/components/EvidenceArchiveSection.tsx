import { useEffect, useRef, useState } from 'react';
import { Archive, Download, Eye, File, FileImage, FileVideo, Upload } from 'lucide-react';
import type {
  EvidenceArchiveItem,
  EvidenceArchiveStatus,
  PreparedEvidenceArchiveFile,
} from '../../../types';
import { repositories } from '../../../repositories/repositoryProvider';
import {
  prepareEvidenceArchiveFile,
  type EvidenceCompressionProgress,
} from '../../../services/evidenceArchiveCompression';
import {
  uploadPreparedEvidenceArchiveFile,
  type EvidenceArchiveUploadProgress,
} from '../../../services/evidenceArchiveUpload';
import {
  AsyncErrorAlert,
  FormSection,
  PrimaryButton,
  SecondaryButton,
} from '../../../shared/components';

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}

function formatThaiDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
  }).format(date);
}

function itemIcon(item: EvidenceArchiveItem) {
  if (item.mimeType.startsWith('video/')) return FileVideo;
  if (item.mimeType.startsWith('image/')) return FileImage;
  return File;
}

function compressionLabel(progress: EvidenceCompressionProgress | null): string {
  if (!progress) return '';
  if (progress.stage === 'inspecting') return 'กำลังตรวจสอบไฟล์…';
  if (progress.stage === 'compressing') {
    return `กำลังบีบวิดีโอ… ${Math.round(progress.progress * 100)}%`;
  }
  return 'เตรียมไฟล์เรียบร้อย';
}

function uploadLabel(progress: EvidenceArchiveUploadProgress | null): string {
  if (!progress) return '';
  return `กำลังอัปโหลด Google Drive… ${Math.round(progress.ratio * 100)}%`;
}

export function EvidenceArchiveSection({ jobId }: { jobId: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<EvidenceArchiveStatus | null>(null);
  const [items, setItems] = useState<EvidenceArchiveItem[]>([]);
  const [prepared, setPrepared] = useState<PreparedEvidenceArchiveFile | null>(null);
  const [compressionProgress, setCompressionProgress] =
    useState<EvidenceCompressionProgress | null>(null);
  const [uploadProgress, setUploadProgress] =
    useState<EvidenceArchiveUploadProgress | null>(null);
  const [busyDownloadId, setBusyDownloadId] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    const nextStatus = await repositories.evidenceArchive.getStatus();
    setStatus(nextStatus);
    if (!nextStatus.configured) {
      setItems([]);
      return;
    }
    setItems(await repositories.evidenceArchive.listForJob(jobId));
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const nextStatus = await repositories.evidenceArchive.getStatus();
        if (!active) return;
        setStatus(nextStatus);
        if (nextStatus.configured) {
          const nextItems = await repositories.evidenceArchive.listForJob(jobId);
          if (active) setItems(nextItems);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'ไม่สามารถโหลดคลังหลักฐาน Google Drive ได้'
          );
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [jobId]);

  const chooseFile = async (file: File | null) => {
    if (!file || isPreparing || isUploading) return;
    setError(null);
    setPrepared(null);
    setCompressionProgress(null);
    setUploadProgress(null);
    setIsPreparing(true);
    try {
      const next = await prepareEvidenceArchiveFile(file, setCompressionProgress);
      setPrepared(next);
    } catch (prepareError) {
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : 'ไม่สามารถเตรียมไฟล์หลักฐานได้'
      );
    } finally {
      setIsPreparing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const upload = async () => {
    if (!prepared || isPreparing || isUploading) return;
    setError(null);
    setUploadProgress(null);
    setIsUploading(true);
    try {
      await uploadPreparedEvidenceArchiveFile({
        jobId,
        file: prepared,
        repository: repositories.evidenceArchive,
        onProgress: setUploadProgress,
      });
      await reload();
      setPrepared(null);
      setCompressionProgress(null);
      setUploadProgress(null);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'ไม่สามารถอัปโหลดหลักฐานเข้า Google Drive ได้'
      );
    } finally {
      setIsUploading(false);
    }
  };

  const downloadBlob = async (item: EvidenceArchiveItem): Promise<Blob | null> => {
    if (busyDownloadId) return null;
    setBusyDownloadId(item.archiveId);
    setError(null);
    try {
      return await repositories.evidenceArchive.download(jobId, item.archiveId);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : 'ไม่สามารถดาวน์โหลดหลักฐานได้'
      );
      return null;
    } finally {
      setBusyDownloadId(null);
    }
  };

  const viewItem = async (item: EvidenceArchiveItem) => {
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    const blob = await downloadBlob(item);
    if (!blob) {
      popup?.close();
      return;
    }
    const url = URL.createObjectURL(blob);
    if (!popup) {
      URL.revokeObjectURL(url);
      setError('เบราว์เซอร์บล็อกหน้าต่างดูไฟล์ กรุณาใช้ปุ่มดาวน์โหลดแทน');
      return;
    }
    popup.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  };

  const downloadItem = async (item: EvidenceArchiveItem) => {
    const blob = await downloadBlob(item);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = item.name;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  return (
    <FormSection
      icon={Archive}
      title="คลังหลักฐาน Google Drive"
      subtitle="สำหรับไฟล์หลักฐานภายใน เก็บประมาณ 1 ปี และเปิด/ดาวน์โหลดได้เฉพาะเจ้าหน้าที่ในระบบ"
      headingId="service-job-evidence-archive-heading"
    >
      {status === null && !error && (
        <p className="text-sm text-neutral-500">กำลังตรวจสอบการเชื่อมต่อ Google Drive…</p>
      )}

      {status && !status.configured && (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200">
          Google Drive Archive ยังไม่ได้เชื่อมต่อกับบัญชีจัดเก็บของบริษัท
          ช่องลิงก์หลักฐานเพิ่มเติมเดิมยังใช้งานได้ตามปกติ
        </div>
      )}

      {status?.configured && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,image/*,application/pdf"
            hidden
            onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
          />

          <div className="rounded-2xl bg-neutral-50 p-4 ring-1 ring-black/5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-ink">
                  เพิ่มหลักฐานเข้า Google Drive
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  วิดีโอเกิน 50 MB จะบีบอัดบนเครื่องก่อนอัปโหลด เป้าหมายประมาณ 30–50 MB
                </p>
              </div>
              <SecondaryButton
                onClick={() => fileInputRef.current?.click()}
                disabled={isPreparing || isUploading}
                className="w-full shrink-0 sm:w-auto"
              >
                <Upload className="h-4 w-4" />
                เลือกไฟล์
              </SecondaryButton>
            </div>

            {(isPreparing || compressionProgress) && !prepared && (
              <div className="mt-4">
                <p className="text-sm text-neutral-600">
                  {compressionLabel(compressionProgress) || 'กำลังเตรียมไฟล์…'}
                </p>
                {compressionProgress?.stage === 'compressing' && (
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-[width]"
                      style={{
                        width: `${Math.round(compressionProgress.progress * 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {prepared && (
              <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-black/5">
                <p className="break-all text-sm font-medium text-ink">{prepared.name}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {prepared.compressed
                    ? `บีบอัดแล้ว ${formatBytes(prepared.sourceSizeBytes)} → ${formatBytes(prepared.preparedSizeBytes)}`
                    : `ขนาด ${formatBytes(prepared.preparedSizeBytes)} · ไม่ต้องบีบอัด`}
                </p>
                {uploadProgress && (
                  <div className="mt-3">
                    <p className="text-xs text-neutral-600">
                      {uploadLabel(uploadProgress)}
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200">
                      <div
                        className="h-full rounded-full bg-brand-500 transition-[width]"
                        style={{ width: `${Math.round(uploadProgress.ratio * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <PrimaryButton
                    onClick={() => void upload()}
                    disabled={isUploading}
                    className="w-full px-4 py-2.5 text-sm sm:w-auto"
                  >
                    <Upload className="h-4 w-4" />
                    {isUploading ? 'กำลังอัปโหลด…' : 'อัปโหลดเข้า Google Drive'}
                  </PrimaryButton>
                  {!isUploading && (
                    <SecondaryButton
                      onClick={() => setPrepared(null)}
                      className="w-full px-4 py-2.5 text-sm sm:w-auto"
                    >
                      ยกเลิก
                    </SecondaryButton>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">ไฟล์ที่เก็บไว้</h3>
              <span className="text-xs text-neutral-400">{items.length} ไฟล์</span>
            </div>
            {items.length === 0 ? (
              <p className="rounded-2xl bg-white/60 px-4 py-4 text-sm text-neutral-400 ring-1 ring-black/5">
                ยังไม่มีไฟล์หลักฐานใน Google Drive สำหรับงานนี้
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((item) => {
                  const Icon = itemIcon(item);
                  const busy = busyDownloadId === item.archiveId;
                  return (
                    <div
                      key={item.archiveId}
                      className="rounded-2xl bg-white/70 p-4 ring-1 ring-black/5"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-xl bg-brand-50 p-2 text-brand-600">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="break-all text-sm font-medium text-ink">
                            {item.name}
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {formatBytes(item.sizeBytes)}
                            {item.compressed ? ' · บีบอัดแล้ว' : ''}
                            {' · '}
                            อัปโหลด {formatThaiDate(item.uploadedAt)}
                          </p>
                          <p className="mt-0.5 text-xs text-neutral-400">
                            เก็บถึง {formatThaiDate(item.deleteAfter)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <SecondaryButton
                          onClick={() => void viewItem(item)}
                          disabled={busyDownloadId !== null}
                          className="w-full px-4 py-2 text-sm sm:w-auto"
                        >
                          <Eye className="h-4 w-4" />
                          {busy ? 'กำลังโหลด…' : 'ดู'}
                        </SecondaryButton>
                        <SecondaryButton
                          onClick={() => void downloadItem(item)}
                          disabled={busyDownloadId !== null}
                          className="w-full px-4 py-2 text-sm sm:w-auto"
                        >
                          <Download className="h-4 w-4" />
                          ดาวน์โหลด
                        </SecondaryButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <AsyncErrorAlert message={error} />
    </FormSection>
  );
}
