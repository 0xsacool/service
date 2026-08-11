import type { ServiceJobStatus, Priority } from '../types';

export function statusColor(status: ServiceJobStatus): {
  text: string;
  bg: string;
  dot: string;
  ring: string;
} {
  switch (status) {
    case 'Received':
      return {
        text: 'text-brand-700',
        bg: 'bg-brand-50',
        dot: 'bg-brand-500',
        ring: 'ring-brand-200',
      };
    case 'Diagnosing':
      return {
        text: 'text-violet-700',
        bg: 'bg-violet-50',
        dot: 'bg-violet-500',
        ring: 'ring-violet-200',
      };
    case 'Awaiting Parts':
      return {
        text: 'text-amber-700',
        bg: 'bg-amber-50',
        dot: 'bg-amber-500',
        ring: 'ring-amber-200',
      };
    case 'In Repair':
      return {
        text: 'text-blue-700',
        bg: 'bg-blue-50',
        dot: 'bg-blue-500',
        ring: 'ring-blue-200',
      };
    case 'Quality Check':
      return {
        text: 'text-cyan-700',
        bg: 'bg-cyan-50',
        dot: 'bg-cyan-500',
        ring: 'ring-cyan-200',
      };
    case 'Ready for Pickup':
      return {
        text: 'text-success-700',
        bg: 'bg-success-50',
        dot: 'bg-success-500',
        ring: 'ring-success-200',
      };
    case 'Completed':
      return {
        text: 'text-neutral-600',
        bg: 'bg-neutral-100',
        dot: 'bg-neutral-400',
        ring: 'ring-neutral-200',
      };
    // F5c: Cancelled/Rejected added to ServiceJobStatus as a data-model
    // prerequisite for file retention. Colors follow UI_GUIDELINES.md's own
    // pre-existing suggestion ("danger tones for both") — the mechanical
    // minimum needed for statusColor() to stay exhaustive now that the
    // union is wider, not a new UI feature. Full icon-based differentiation
    // (rather than color/shade alone) is still the flagged, unaddressed
    // accessibility gap noted there.
    case 'Cancelled':
      return {
        text: 'text-danger-600',
        bg: 'bg-danger-50',
        dot: 'bg-danger-400',
        ring: 'ring-danger-200',
      };
    case 'Rejected':
      return {
        text: 'text-danger-700',
        bg: 'bg-danger-50',
        dot: 'bg-danger-600',
        ring: 'ring-danger-200',
      };
  }
}

export function priorityColor(priority: Priority): string {
  switch (priority) {
    case 'Urgent':
      return 'text-danger-700 bg-danger-50 ring-danger-200';
    case 'High':
      return 'text-amber-700 bg-amber-50 ring-amber-200';
    case 'Normal':
      return 'text-brand-700 bg-brand-50 ring-brand-200';
    case 'Low':
      return 'text-neutral-600 bg-neutral-100 ring-neutral-200';
  }
}

export function statusLabel(status: ServiceJobStatus): string {
  switch (status) {
    case 'Received':
      return 'รับสินค้าแล้ว';
    case 'Diagnosing':
      return 'กำลังตรวจสอบ';
    case 'Awaiting Parts':
      return 'รออะไหล่';
    case 'In Repair':
      return 'กำลังดำเนินการซ่อม';
    case 'Quality Check':
      return 'ตรวจสอบคุณภาพ';
    case 'Ready for Pickup':
      return 'พร้อมรับสินค้า';
    case 'Completed':
      return 'เสร็จสิ้น';
    case 'Cancelled':
      return 'ยกเลิก';
    case 'Rejected':
      return 'ไม่รับดำเนินการ';
  }
}

export function priorityLabel(priority: Priority): string {
  switch (priority) {
    case 'Low':
      return 'ต่ำ';
    case 'Normal':
      return 'ปกติ';
    case 'High':
      return 'สูง';
    case 'Urgent':
      return 'เร่งด่วน';
  }
}

const TIMELINE_TEXT: Record<string, { title: string; description: string }> = {
  'Claim received': {
    title: 'รับสินค้าแล้ว',
    description: 'บันทึกสินค้าเข้าที่เคาน์เตอร์รับบริการแล้ว',
  },
  'Diagnosis pending': {
    title: 'กำลังตรวจสอบ',
    description: 'กำลังจัดช่างเพื่อตรวจสอบสินค้า',
  },
  'In repair': {
    title: 'กำลังดำเนินการซ่อม',
    description: 'การซ่อมจะเริ่มหลังการตรวจสอบเสร็จสิ้น',
  },
  'Ready for pickup': {
    title: 'พร้อมรับสินค้า',
    description: 'ระบบจะแจ้งลูกค้าเมื่อสินค้าพร้อมรับ',
  },
};

export function timelineTitle(title: string): string {
  return TIMELINE_TEXT[title]?.title ?? title;
}

export function timelineDescription(title: string, description: string): string {
  return TIMELINE_TEXT[title]?.description ?? description;
}
