import { ExternalLink } from 'lucide-react';
import {
  CHANNEL_IDS,
  ORDER_VERIFICATIONS,
  type ChannelId,
  type OrderVerification,
} from '../../../types';
import { Field, GlassCard, inputClass } from '../../../shared/components';
import { channelLabel, orderVerificationLabel } from '../../../services/serviceJobPresentation';
import { isValidCalendarDate, isValidHttpsUrl } from '../../../utils/serviceEventValidation';

const IDENTITY_LABEL: Partial<Record<ChannelId, string>> = {
  shopee: 'ชื่อผู้ใช้ / บัญชี Shopee',
  lazada: 'ชื่อผู้ใช้ / บัญชี Lazada',
  line: 'LINE ID',
  store: 'ชื่อสาขา / หน้าร้าน',
  website: 'ชื่อผู้ใช้ (ถ้ามี)',
  other: 'รายละเอียดช่องทางติดต่อ',
};

export interface ServiceEventMetadataEditValue {
  contactChannel: ChannelId | null;
  contactChannelIdentity: string;
  orderNumber: string;
  orderVerification: OrderVerification | null;
  purchaseDate: string;
  orderDeliveredDate: string;
  externalEvidenceUrl: string;
  externalEvidenceNote: string;
}

// F5d-69 / DECISIONS.md #041 — the Service Job Details counterpart to
// ContactOrderMetadataSection (New Service Job intake). The two are
// deliberately separate components rather than one shared one: this is the
// only surface where orderVerification is directly staff-editable (never
// during intake — see ServiceIntakeData's own comment), and it also renders
// the saved external evidence URL as a real clickable link, which intake
// never does (nothing is persisted yet at that point). Client-side
// enforcement of the same cross-field invariants Rules enforce server-side —
// this is UX only; Rules remain the actual protection (see
// firestore.rules / DECISIONS.md #041).
export function ServiceEventMetadataEditSection({
  value,
  onChange,
}: {
  value: ServiceEventMetadataEditValue;
  onChange: (value: ServiceEventMetadataEditValue) => void;
}) {
  const setChannel = (channel: ChannelId | null) => {
    onChange({
      ...value,
      contactChannel: channel,
      contactChannelIdentity:
        channel === null || channel === 'phone' ? '' : value.contactChannelIdentity,
    });
  };

  const setOrderNumber = (orderNumber: string) => {
    onChange({
      ...value,
      orderNumber,
      orderVerification:
        orderNumber.trim() === '' ? null : (value.orderVerification ?? 'unverified'),
    });
  };

  const showIdentity = value.contactChannel !== null && value.contactChannel !== 'phone';
  const showVerification = value.orderNumber.trim() !== '';
  const purchaseDateError = value.purchaseDate !== '' && !isValidCalendarDate(value.purchaseDate);
  const orderDeliveredDateError =
    value.orderDeliveredDate !== '' && !isValidCalendarDate(value.orderDeliveredDate);
  const trimmedUrl = value.externalEvidenceUrl.trim();
  const urlError = trimmedUrl !== '' && !isValidHttpsUrl(trimmedUrl);
  const canPreviewUrl = trimmedUrl !== '' && !urlError;

  return (
    <GlassCard className="p-6 animate-[rise_0.55s_cubic-bezier(0.22,1,0.36,1)_both]">
      <h2 className="mb-4 text-lg font-semibold tracking-tight text-ink">
        ช่องทางติดต่อและคำสั่งซื้อ
      </h2>
      <div className="space-y-4">
        <div>
          <span className="mb-2 block text-sm font-medium text-neutral-700">ช่องทางติดต่อ</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="ช่องทางติดต่อ">
            {CHANNEL_IDS.map((channel) => {
              const isSelected = value.contactChannel === channel;
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => setChannel(isSelected ? null : channel)}
                  aria-pressed={isSelected}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                    isSelected
                      ? 'bg-brand-500 text-white shadow-sm'
                      : 'bg-white/80 text-neutral-600 ring-1 ring-black/10 hover:bg-white'
                  }`}
                >
                  {channelLabel(channel)}
                </button>
              );
            })}
          </div>
        </div>

        {showIdentity && value.contactChannel && (
          <Field label={IDENTITY_LABEL[value.contactChannel] ?? 'รายละเอียดช่องทางติดต่อ'}>
            <input
              value={value.contactChannelIdentity}
              onChange={(e) => onChange({ ...value, contactChannelIdentity: e.target.value })}
              maxLength={120}
              className={inputClass()}
            />
          </Field>
        )}

        <Field label="เลขที่คำสั่งซื้อ">
          <input
            value={value.orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            maxLength={64}
            className={inputClass()}
          />
        </Field>

        {showVerification && (
          <div>
            <span className="mb-2 block text-sm font-medium text-neutral-700">
              สถานะการตรวจสอบคำสั่งซื้อ
            </span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="สถานะการตรวจสอบคำสั่งซื้อ">
              {ORDER_VERIFICATIONS.map((verification) => {
                const isSelected = value.orderVerification === verification;
                return (
                  <button
                    key={verification}
                    type="button"
                    onClick={() => onChange({ ...value, orderVerification: verification })}
                    aria-pressed={isSelected}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                      isSelected
                        ? 'bg-brand-500 text-white shadow-sm'
                        : 'bg-white/80 text-neutral-600 ring-1 ring-black/10 hover:bg-white'
                    }`}
                  >
                    {orderVerificationLabel(verification)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="วันที่ซื้อ">
            <input
              type="date"
              value={value.purchaseDate}
              onChange={(e) => onChange({ ...value, purchaseDate: e.target.value })}
              className={inputClass()}
            />
            {purchaseDateError && (
              <span role="alert" className="mt-1.5 block text-xs text-danger-600">
                วันที่ไม่ถูกต้อง
              </span>
            )}
          </Field>
          <Field label="วันที่ลูกค้าได้รับสินค้า">
            <input
              type="date"
              value={value.orderDeliveredDate}
              onChange={(e) => onChange({ ...value, orderDeliveredDate: e.target.value })}
              className={inputClass()}
            />
            {orderDeliveredDateError && (
              <span role="alert" className="mt-1.5 block text-xs text-danger-600">
                วันที่ไม่ถูกต้อง
              </span>
            )}
          </Field>
        </div>

        <Field label="ลิงก์หลักฐานเพิ่มเติม" hint="เฉพาะลิงก์ https:// เท่านั้น">
          <input
            type="url"
            inputMode="url"
            value={value.externalEvidenceUrl}
            onChange={(e) => onChange({ ...value, externalEvidenceUrl: e.target.value })}
            maxLength={2048}
            aria-invalid={urlError}
            className={inputClass()}
          />
          {urlError && (
            <span role="alert" className="mt-1.5 block text-xs text-danger-600">
              ลิงก์ต้องเป็น https:// ที่ถูกต้อง
            </span>
          )}
          {canPreviewUrl && (
            <a
              href={trimmedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              เปิดลิงก์หลักฐาน
            </a>
          )}
        </Field>

        <Field label="รายละเอียดเพิ่มเติม">
          <textarea
            value={value.externalEvidenceNote}
            onChange={(e) => onChange({ ...value, externalEvidenceNote: e.target.value })}
            maxLength={1000}
            rows={2}
            className={inputClass('resize-none')}
          />
        </Field>
      </div>
    </GlassCard>
  );
}
