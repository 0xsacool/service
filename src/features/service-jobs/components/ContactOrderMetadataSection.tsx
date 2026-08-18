import { ShoppingBag } from 'lucide-react';
import { CHANNEL_IDS, type ChannelId } from '../../../types';
import { Field, inputClass } from '../../../shared/components';
import { FormSection } from '../../../shared/components';
import { channelLabel } from '../../../services/serviceJobPresentation';

// F5d-69 / DECISIONS.md #041 — channel-specific identity label, per the
// locked V1 contract: Shopee/Lazada/LINE ask for a username or account
// handle, store asks for a branch/store name, website's identity is
// optional context, other is a short free description, and phone has no
// separate identity field at all (the customer's own canonical phone
// already is that identity — see CONTACT_CHANNELS_WITHOUT_IDENTITY below).
const IDENTITY_LABEL: Partial<Record<ChannelId, string>> = {
  shopee: 'ชื่อผู้ใช้ / บัญชี Shopee',
  lazada: 'ชื่อผู้ใช้ / บัญชี Lazada',
  line: 'LINE ID',
  store: 'ชื่อสาขา / หน้าร้าน',
  website: 'ชื่อผู้ใช้ (ถ้ามี)',
  other: 'รายละเอียดช่องทางติดต่อ',
};

export interface ContactOrderMetadataValue {
  contactChannel: ChannelId | null;
  contactChannelIdentity: string;
  orderNumber: string;
  purchaseDate: string;
  orderDeliveredDate: string;
}

export function ContactOrderMetadataSection({
  value,
  onChange,
  purchaseDateError,
  orderDeliveredDateError,
}: {
  value: ContactOrderMetadataValue;
  onChange: (value: ContactOrderMetadataValue) => void;
  purchaseDateError?: string | null;
  orderDeliveredDateError?: string | null;
}) {
  const setChannel = (channel: ChannelId | null) => {
    onChange({
      ...value,
      contactChannel: channel,
      // Clears live in client state, not just at payload-build time, so the
      // identity input itself disappears the instant it stops applying —
      // matches the locked contract ("contactChannelIdentity must become
      // null in the client state before save").
      contactChannelIdentity:
        channel === null || channel === 'phone' ? '' : value.contactChannelIdentity,
    });
  };

  const showIdentity = value.contactChannel !== null && value.contactChannel !== 'phone';

  return (
    <FormSection
      icon={ShoppingBag}
      title="ช่องทางติดต่อและคำสั่งซื้อ"
      subtitle="ไม่บังคับ แต่แนะนำให้บันทึก"
      headingId="service-job-contact-order-heading"
    >
      <div>
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-labelledby="service-job-contact-order-heading"
        >
          {CHANNEL_IDS.map((channel) => {
            const isSelected = value.contactChannel === channel;
            return (
              <button
                key={channel}
                type="button"
                onClick={() => setChannel(isSelected ? null : channel)}
                aria-pressed={isSelected}
                className={`rounded-full px-4 py-2.5 text-sm font-medium transition-all ${
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
            placeholder="เช่น @username"
            className={inputClass()}
          />
        </Field>
      )}

      <Field label="เลขที่คำสั่งซื้อ" hint="ไม่บังคับ — เช่น เลขออเดอร์จากแพลตฟอร์ม">
        <input
          value={value.orderNumber}
          onChange={(e) => onChange({ ...value, orderNumber: e.target.value })}
          maxLength={64}
          placeholder="เช่น 250731SHP04821"
          className={inputClass()}
        />
      </Field>

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
              {purchaseDateError}
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
              {orderDeliveredDateError}
            </span>
          )}
        </Field>
      </div>
    </FormSection>
  );
}
