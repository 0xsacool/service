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
        <h1 className="text-xl font-semibold text-ink">
          Application configuration unavailable
        </h1>
        <p className="mt-3 text-sm text-neutral-600">{configuration.error}</p>
      </main>
    );
  }
  return <>{children}</>;
}
