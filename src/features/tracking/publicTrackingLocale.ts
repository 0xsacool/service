import type { ServiceJobStatus } from '../../types';

export const PUBLIC_TRACKING_LOCALES = ['th', 'en', 'ja', 'zh-CN'] as const;
export type PublicTrackingLocale = (typeof PUBLIC_TRACKING_LOCALES)[number];

export function publicTrackingDocumentLanguage(locale: PublicTrackingLocale): string {
  return locale;
}

export const PUBLIC_TRACKING_LOCALE_STORAGE_KEY = 'publicTrackingLocale';

const LOCALE_TAGS: Record<PublicTrackingLocale, string> = {
  th: 'th-TH',
  en: 'en-US',
  ja: 'ja-JP',
  'zh-CN': 'zh-CN',
};

export interface PublicTrackingMessages {
  localeName: string;
  languageSelectorLabel: string;
  languageOptions: Record<PublicTrackingLocale, string>;
  staffSignIn: string;
  landing: {
    eyebrow: string;
    title: string;
    titleAccent: string;
    description: string;
    secureTitle: string;
    secureDescription: string;
    manualTitle: string;
    manualLabel: string;
    manualPlaceholder: string;
    manualSubmit: string;
    manualHelp: string;
    manualPrivate: string;
    manualInvalid: string;
    features: Array<{ title: string; text: string }>;
    footer: string;
  };
  result: {
    loading: string;
    unavailableTitle: string;
    unavailableDescription: string;
    backToSearch: string;
    backToTracking: string;
    trackingReference: string;
    product: string;
    modelOrSku: string;
    serial: string;
    lastUpdated: string;
    statusUpdates: string;
    currentStatusShown: string;
  };
  statusLabels: Record<ServiceJobStatus, string>;
}

const STATUS_KEYS: Record<
  ServiceJobStatus,
  keyof PublicTrackingMessages['statusLabels']
> = {
  Received: 'Received',
  Diagnosing: 'Diagnosing',
  'Awaiting Parts': 'Awaiting Parts',
  'In Repair': 'In Repair',
  'Quality Check': 'Quality Check',
  'Ready for Pickup': 'Ready for Pickup',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Rejected: 'Rejected',
};

const STATUS_LABELS: Record<PublicTrackingLocale, Record<ServiceJobStatus, string>> = {
  th: {
    Received: 'รับสินค้าแล้ว',
    Diagnosing: 'กำลังตรวจสอบ',
    'Awaiting Parts': 'รออะไหล่',
    'In Repair': 'กำลังดำเนินการซ่อม',
    'Quality Check': 'ตรวจสอบคุณภาพ',
    'Ready for Pickup': 'พร้อมรับสินค้า',
    Completed: 'เสร็จสิ้น',
    Cancelled: 'ยกเลิก',
    Rejected: 'ไม่รับดำเนินการ',
  },
  en: {
    Received: 'Received',
    Diagnosing: 'Under inspection',
    'Awaiting Parts': 'Awaiting parts',
    'In Repair': 'In repair',
    'Quality Check': 'Quality check',
    'Ready for Pickup': 'Ready for pickup',
    Completed: 'Completed',
    Cancelled: 'Cancelled',
    Rejected: 'Not accepted',
  },
  ja: {
    Received: '受付済み',
    Diagnosing: '点検中',
    'Awaiting Parts': '部品待ち',
    'In Repair': '修理中',
    'Quality Check': '品質確認中',
    'Ready for Pickup': 'お受け取りいただけます',
    Completed: '完了',
    Cancelled: 'キャンセル',
    Rejected: '受付不可',
  },
  'zh-CN': {
    Received: '已收件',
    Diagnosing: '检测中',
    'Awaiting Parts': '等待配件',
    'In Repair': '维修中',
    'Quality Check': '质量检查',
    'Ready for Pickup': '可以取件',
    Completed: '已完成',
    Cancelled: '已取消',
    Rejected: '无法受理',
  },
};

export const publicTrackingMessages: Record<
  PublicTrackingLocale,
  PublicTrackingMessages
> = {
  th: {
    localeName: 'ไทย',
    languageSelectorLabel: 'ภาษา',
    languageOptions: { th: 'ไทย', en: 'English', ja: '日本語', 'zh-CN': '简体中文' },
    staffSignIn: 'เข้าสู่ระบบสำหรับเจ้าหน้าที่',
    landing: {
      eyebrow: 'ติดตามงานบริการแบบเรียลไทม์',
      title: 'ติดตามสถานะงานบริการ',
      titleAccent: 'ของคุณ',
      description: 'ดูสถานะล่าสุดของสินค้าผ่านลิงก์ติดตามที่เจ้าหน้าที่ส่งให้คุณ',
      secureTitle: 'ใช้ลิงก์ติดตามที่ปลอดภัย',
      secureDescription:
        'กรอกรหัสติดตามที่ได้รับจากเจ้าหน้าที่เพื่อดูข้อมูลสถานะงานบริการแบบจำกัด',
      manualTitle: 'ติดตามสถานะงานบริการ',
      manualLabel: 'กรอกรหัสติดตามงานบริการ',
      manualPlaceholder: 'SRV-2026-0810-K7M2QX',
      manualSubmit: 'ตรวจสอบสถานะ',
      manualHelp:
        'กรอกรหัสติดตามรูปแบบ SRV-... ที่ระบุในเอกสารหรือลิงก์ที่ได้รับจากเจ้าหน้าที่ (ไม่ใช่เลขที่งานบริการที่ขึ้นต้นด้วย BRN)',
      manualPrivate: 'โปรดเก็บรหัสนี้ไว้เป็นส่วนตัว',
      manualInvalid: 'ไม่พบข้อมูลหรือรหัสไม่ถูกต้อง',
      features: [
        { title: 'อัปเดตล่าสุด', text: 'ทราบสถานะเมื่อมีการเปลี่ยนแปลง' },
        { title: 'ปลอดภัย', text: 'ใช้รหัสเข้าถึงจากลิงก์ที่ได้รับอนุมัติ' },
        { title: 'พร้อมรับสินค้า', text: 'ทราบเวลาที่สามารถมารับสินค้าได้' },
      ],
      footer: 'Service Tech · ศูนย์บริการ · จันทร์–เสาร์ 9:00–19:00 น.',
    },
    result: {
      loading: 'กำลังตรวจสอบข้อมูลการติดตาม…',
      unavailableTitle: 'ไม่พบลิงก์ติดตาม',
      unavailableDescription: 'กรุณาใช้ลิงก์ติดตามที่ปลอดภัยฉบับเต็มจากเจ้าหน้าที่',
      backToSearch: 'กลับหน้าหลัก',
      backToTracking: 'กลับไปหน้าติดตาม',
      trackingReference: 'เลขที่งานบริการ',
      product: 'สินค้า',
      modelOrSku: 'รุ่น / SKU',
      serial: 'หมายเลขเครื่อง',
      lastUpdated: 'อัปเดตล่าสุด',
      statusUpdates: 'ประวัติสถานะ',
      currentStatusShown: 'สถานะปัจจุบันแสดงอยู่ด้านบน',
    },
    statusLabels: STATUS_LABELS.th,
  },
  en: {
    localeName: 'English',
    languageSelectorLabel: 'Language',
    languageOptions: { th: 'ไทย', en: 'English', ja: '日本語', 'zh-CN': '简体中文' },
    staffSignIn: 'Staff sign in',
    landing: {
      eyebrow: 'Track your service status in real time',
      title: 'Track your service',
      titleAccent: 'status',
      description:
        'View the latest status of your product using the secure tracking link provided by our staff.',
      secureTitle: 'Use your secure tracking link',
      secureDescription:
        'Enter the tracking code provided by our staff to view the limited service status.',
      manualTitle: 'Track your service status',
      manualLabel: 'Enter your service tracking code',
      manualPlaceholder: 'SRV-2026-0810-K7M2QX',
      manualSubmit: 'Check status',
      manualHelp:
        'The tracking code is in the document or message provided by our staff.',
      manualPrivate: 'Keep this code private.',
      manualInvalid: 'The code is invalid or unavailable',
      features: [
        { title: 'Live updates', text: 'See status changes as they happen' },
        { title: 'Secure', text: 'Uses an approved tracking access code' },
        { title: 'Pickup ready', text: 'Know when your product is ready' },
      ],
      footer: 'Service Tech · Service Center · Mon–Sat 9:00–19:00',
    },
    result: {
      loading: 'Looking up tracking information…',
      unavailableTitle: 'Tracking link unavailable',
      unavailableDescription:
        'Use the complete secure tracking link provided by our staff.',
      backToSearch: 'Back to home',
      backToTracking: 'Back to tracking',
      trackingReference: 'Tracking reference',
      product: 'Product',
      modelOrSku: 'Model / SKU',
      serial: 'Serial',
      lastUpdated: 'Last updated',
      statusUpdates: 'Status updates',
      currentStatusShown: 'Current status is shown above.',
    },
    statusLabels: STATUS_LABELS.en,
  },
  ja: {
    localeName: '日本語',
    languageSelectorLabel: '言語',
    languageOptions: { th: 'ไทย', en: 'English', ja: '日本語', 'zh-CN': '简体中文' },
    staffSignIn: 'スタッフログイン',
    landing: {
      eyebrow: 'サービス状況をリアルタイムで確認',
      title: 'サービス状況を',
      titleAccent: '確認する',
      description:
        'スタッフから届いた安全な追跡リンクで、商品の最新状況をご確認いただけます。',
      secureTitle: '安全な追跡リンクを使用してください',
      secureDescription:
        'スタッフから届いた追跡コードを入力すると、限定されたサービス状況を確認できます。',
      manualTitle: 'サービス状況を確認',
      manualLabel: 'サービス追跡コードを入力',
      manualPlaceholder: 'SRV-2026-0810-K7M2QX',
      manualSubmit: '状況を確認',
      manualHelp:
        '追跡コードはスタッフから届いた書類またはメッセージに記載されています。',
      manualPrivate: 'このコードは安全に保管してください。',
      manualInvalid: 'コードが正しくないか、現在ご利用いただけません',
      features: [
        { title: '最新情報', text: '状況の変化をすぐに確認' },
        { title: '安全', text: '承認されたアクセスコードを使用' },
        { title: '受け取り準備完了', text: '受け取り可能な時期を確認' },
      ],
      footer: 'Service Tech · サービスセンター · 月–土 9:00–19:00',
    },
    result: {
      loading: '追跡情報を確認しています…',
      unavailableTitle: '追跡リンクを利用できません',
      unavailableDescription: 'スタッフから届いた完全な安全リンクをご利用ください。',
      backToSearch: 'ホームに戻る',
      backToTracking: '追跡画面に戻る',
      trackingReference: '追跡番号',
      product: '商品',
      modelOrSku: 'モデル / SKU',
      serial: 'シリアル番号',
      lastUpdated: '最終更新',
      statusUpdates: '状況の履歴',
      currentStatusShown: '現在の状況は上に表示されています。',
    },
    statusLabels: STATUS_LABELS.ja,
  },
  'zh-CN': {
    localeName: '简体中文',
    languageSelectorLabel: '语言',
    languageOptions: { th: 'ไทย', en: 'English', ja: '日本語', 'zh-CN': '简体中文' },
    staffSignIn: '工作人员登录',
    landing: {
      eyebrow: '实时跟踪服务状态',
      title: '查看您的服务',
      titleAccent: '状态',
      description: '使用工作人员提供的安全跟踪链接查看产品的最新状态。',
      secureTitle: '使用安全跟踪链接',
      secureDescription: '输入工作人员提供的查询码，即可查看有限的服务状态信息。',
      manualTitle: '跟踪服务状态',
      manualLabel: '输入服务查询码',
      manualPlaceholder: 'SRV-2026-0810-K7M2QX',
      manualSubmit: '查询状态',
      manualHelp: '查询码位于工作人员提供的文件或消息中。',
      manualPrivate: '请妥善保管此查询码。',
      manualInvalid: '查询码无效或当前不可用',
      features: [
        { title: '实时更新', text: '及时了解状态变化' },
        { title: '安全', text: '使用经过授权的访问码' },
        { title: '可取件', text: '了解产品何时可以取件' },
      ],
      footer: 'Service Tech · 服务中心 · 周一至周六 9:00–19:00',
    },
    result: {
      loading: '正在查询跟踪信息…',
      unavailableTitle: '跟踪链接不可用',
      unavailableDescription: '请使用工作人员提供的完整安全跟踪链接。',
      backToSearch: '返回首页',
      backToTracking: '返回跟踪页面',
      trackingReference: '跟踪编号',
      product: '产品',
      modelOrSku: '型号 / SKU',
      serial: '序列号',
      lastUpdated: '最后更新',
      statusUpdates: '状态更新',
      currentStatusShown: '当前状态显示在上方。',
    },
    statusLabels: STATUS_LABELS['zh-CN'],
  },
};

export function isPublicTrackingLocale(value: unknown): value is PublicTrackingLocale {
  return (
    typeof value === 'string' &&
    (PUBLIC_TRACKING_LOCALES as readonly string[]).includes(value)
  );
}

export function readPublicTrackingLocale(storage?: Storage): PublicTrackingLocale {
  try {
    const value = storage?.getItem(PUBLIC_TRACKING_LOCALE_STORAGE_KEY);
    return isPublicTrackingLocale(value) ? value : 'th';
  } catch {
    return 'th';
  }
}

export function persistPublicTrackingLocale(
  locale: PublicTrackingLocale,
  storage?: Storage
): void {
  try {
    storage?.setItem(PUBLIC_TRACKING_LOCALE_STORAGE_KEY, locale);
  } catch {
    // A blocked browser storage policy should not block language switching.
  }
}

export function formatPublicDate(iso: string, locale: PublicTrackingLocale): string {
  if (iso === '—') return '—';
  const date = new Date(iso);
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    dateStyle: 'medium',
  }).format(date);
}

export function getPublicTrackingMessages(
  locale: PublicTrackingLocale
): PublicTrackingMessages {
  return publicTrackingMessages[locale];
}

export function publicStatusLabel(
  status: ServiceJobStatus,
  locale: PublicTrackingLocale
): string {
  return publicTrackingMessages[locale].statusLabels[STATUS_KEYS[status]];
}
