export type ServiceReportV2ClientMode = 'disabled' | 'compatibility' | 'v2-active';

export function getServiceReportV2ClientMode(): ServiceReportV2ClientMode {
  const value = import.meta.env.VITE_SERVICE_REPORT_V2_MODE;
  return value === 'compatibility' || value === 'v2-active' ? value : 'disabled';
}

export function isServiceReportV2ClientEnabled(): boolean {
  return getServiceReportV2ClientMode() !== 'disabled';
}
