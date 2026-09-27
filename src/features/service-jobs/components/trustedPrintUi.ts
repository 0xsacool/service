import {
  WorkerServiceReportError,
  type TrustedPrintResult,
} from '../../../repositories/types';

export type TrustedPrintTone = 'neutral' | 'warning' | 'success' | 'danger';

export interface TrustedPrintPresentation {
  title: string;
  description: string;
  tone: TrustedPrintTone;
  canPrint: boolean;
}

export function getTrustedPrintPresentation(
  result: TrustedPrintResult
): TrustedPrintPresentation {
  switch (result.printState) {
    case 'legacy-v1':
      return {
        title: 'รายงานรูปแบบเดิม',
        description:
          'ตรวจสอบสิทธิ์และโหลดข้อมูลล่าสุดจากเซิร์ฟเวอร์แล้ว แต่รายงาน V1 ไม่มีลายเซ็นข้อมูลและขั้นตอนอนุมัติแบบ V2',
        tone: 'neutral',
        canPrint: true,
      };
    case 'v2-draft':
      return {
        title: 'ฉบับร่างที่ตรวจสอบจากเซิร์ฟเวอร์แล้ว',
        description:
          'ยังไม่สรุปผลและยังไม่เข้าสู่ขั้นตอนอนุมัติ เอกสารที่พิมพ์ต้องถือเป็นฉบับร่างเท่านั้น',
        tone: 'warning',
        canPrint: true,
      };
    case 'v2-pending':
      return {
        title: 'รอการอนุมัติ',
        description:
          'ลายเซ็นข้อมูลของรายงานถูกตรวจสอบแล้ว แต่ยังไม่มีผลการอนุมัติ ห้ามตีความเอกสารนี้ว่าได้รับอนุมัติแล้ว',
        tone: 'warning',
        canPrint: true,
      };
    case 'v2-approved':
      return {
        title: 'อนุมัติแล้วและตรวจสอบความถูกต้องแล้ว',
        description:
          'ลายเซ็นข้อมูล ผลการอนุมัติ และหลักฐานที่ต้องเก็บรักษาผ่านการตรวจสอบจากเซิร์ฟเวอร์แล้ว',
        tone: 'success',
        canPrint: true,
      };
    case 'v2-rejected':
      return {
        title: 'ไม่อนุมัติ',
        description:
          'ลายเซ็นข้อมูลและผลการพิจารณาถูกตรวจสอบแล้ว รายงานฉบับนี้ถูกปฏิเสธและไม่ใช่เอกสารอนุมัติ',
        tone: 'danger',
        canPrint: true,
      };
    case 'integrity-incident':
      return {
        title: 'พบปัญหาความครบถ้วนของหลักฐาน',
        description:
          'รายงานผ่านการอนุมัติ แต่หลักฐานที่ต้องเก็บรักษาบางรายการไม่พร้อมใช้งาน ปุ่มพิมพ์ในระบบถูกปิดจนกว่าจะตรวจสอบเหตุการณ์นี้เรียบร้อย',
        tone: 'danger',
        canPrint: false,
      };
  }
}

export function trustedPrintToneClass(tone: TrustedPrintTone): string {
  switch (tone) {
    case 'success':
      return 'border-success-200 bg-success-50 text-success-800';
    case 'warning':
      return 'border-warning-200 bg-warning-50 text-warning-800';
    case 'danger':
      return 'border-red-200 bg-red-50 text-red-800';
    case 'neutral':
      return 'border-neutral-200 bg-neutral-50 text-neutral-700';
  }
}

export function trustedPrintStateLabel(result: TrustedPrintResult): string {
  return getTrustedPrintPresentation(result).title;
}

export type TrustedPrintLoader = (
  reportId: string,
  mode?: 'normal' | 'diagnostic'
) => Promise<TrustedPrintResult>;

export async function loadTrustedPrintForPreview(
  reportId: string,
  load: TrustedPrintLoader
): Promise<TrustedPrintResult> {
  try {
    return await load(reportId, 'normal');
  } catch (error) {
    if (
      !(error instanceof WorkerServiceReportError) ||
      error.code !== 'evidence_integrity_incident'
    ) {
      throw error;
    }

    const diagnostic = await load(reportId, 'diagnostic');
    if (diagnostic.printState !== 'integrity-incident') {
      throw new Error('Trusted-print diagnostic state mismatch', { cause: error });
    }
    return diagnostic;
  }
}

export function trustedPrintErrorMessage(error: unknown): string {
  if (error instanceof WorkerServiceReportError) {
    switch (error.code) {
      case 'integrity_mismatch':
        return 'ข้อมูลใบรายงานไม่ผ่านการตรวจสอบความถูกต้อง ระบบไม่เปิดการพิมพ์ กรุณาให้ผู้ดูแลตรวจสอบ';
      case 'evidence_integrity_incident':
        return 'หลักฐานที่ผูกกับรายงานที่อนุมัติไว้ไม่ครบ ระบบไม่เปิดการพิมพ์จนกว่าจะตรวจสอบเสร็จ';
    }

    switch (error.status) {
      case 401:
        return 'เซสชันหมดอายุหรือยืนยันตัวตนไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง';
      case 403:
        return 'บัญชีนี้ไม่มีสิทธิ์ตรวจสอบข้อมูลสำหรับการพิมพ์';
      case 404:
        return 'ไม่พบใบรายงานหรือข้อมูลงานบริการที่ต้องตรวจสอบ';
      case 409:
      case 412:
        return 'สถานะใบรายงานเปลี่ยนแปลงหรือข้อมูลไม่ตรงกับฉบับล่าสุด กรุณารีเฟรชแล้วลองอีกครั้ง';
    }

    if (error.retryClass === 'operator') {
      return 'ไม่สามารถยืนยันความถูกต้องของใบรายงานได้ กรุณาให้ผู้ดูแลตรวจสอบก่อนพิมพ์';
    }
  }

  return 'ไม่สามารถตรวจสอบข้อมูลก่อนพิมพ์ได้ กรุณาลองใหม่อีกครั้ง';
}
