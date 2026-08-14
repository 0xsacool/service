import type { BackendConfiguration } from '../config/backend';

export function BackendConfigurationGate({
  configuration,
  children,
}: {
  configuration: BackendConfiguration;
  children: React.ReactNode;
}) {
  if (!configuration.valid) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold text-ink">การตั้งค่าระบบไม่พร้อมใช้งาน</h1>
        <p className="mt-3 text-sm text-neutral-600">
          กรุณาติดต่อผู้ดูแลระบบก่อนดำเนินการต่อ
        </p>
      </main>
    );
  }
  return <>{children}</>;
}
