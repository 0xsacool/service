import { Link2 } from 'lucide-react';
import { Field, FormSection, inputClass } from '../../../shared/components';
import { isValidHttpsUrl } from '../../../utils/serviceEventValidation';

// F5d-69 / DECISIONS.md #041 — a compact, optional section for a link to
// evidence hosted elsewhere (Google Drive/Photos, OneDrive, etc.) instead of
// uploading video into Service Tech storage. Placed immediately after
// PhotoEvidenceSection so both "evidence" concepts sit together. The Worker
// never fetches this URL and this component never renders it as a clickable
// link — that only happens on Service Job Details, once the value is a real
// persisted field, using target="_blank" rel="noopener noreferrer" and never
// dangerouslySetInnerHTML.
export function ExternalEvidenceSection({
  url,
  note,
  onUrlChange,
  onNoteChange,
}: {
  url: string;
  note: string;
  onUrlChange: (url: string) => void;
  onNoteChange: (note: string) => void;
}) {
  const urlError = url.trim() !== '' && !isValidHttpsUrl(url.trim());

  return (
    <FormSection
      icon={Link2}
      title="หลักฐานเพิ่มเติมออนไลน์"
      subtitle="ไม่บังคับ — วางลิงก์แทนการอัปโหลดวิดีโอ"
      headingId="service-job-external-evidence-heading"
    >
      <Field label="ลิงก์หลักฐานเพิ่มเติม" hint="เฉพาะลิงก์ https:// เท่านั้น">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          maxLength={2048}
          placeholder="https://drive.google.com/…"
          aria-invalid={urlError}
          className={inputClass()}
        />
        {urlError && (
          <span role="alert" className="mt-1.5 block text-xs text-danger-600">
            ลิงก์ต้องเป็น https:// ที่ถูกต้อง
          </span>
        )}
      </Field>
      <Field label="รายละเอียดเพิ่มเติม">
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="เช่น วิดีโอแสดงอาการเครื่องดับ"
          className={inputClass('resize-none')}
        />
      </Field>
    </FormSection>
  );
}
