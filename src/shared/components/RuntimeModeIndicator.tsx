import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  assertFirestoreWorkerCreatePath,
  getRuntimeDiagnostics,
} from '../../config/runtimeDiagnostics';

// F5d-54, Objectives 1/2/3: a single always-visible indicator of the active
// runtime backend, reusing runtimeDiagnostics.ts (never a second,
// independently-computed check) so this can never drift from what
// useCreateServiceJob.ts actually does. Mock renders a loud, unmistakable
// banner — Gate 7.1's manual rehearsal produced a real-looking
// BRN-2026-000001 while actually running Mock, precisely because nothing
// on screen said so. Firestore renders a small, calm badge that turns into
// a warning state if the create path isn't fully provable (Objective 3),
// rather than presenting a half-configured Firestore session as trustworthy.
export function RuntimeModeIndicator() {
  const diagnostics = getRuntimeDiagnostics();

  if (diagnostics.backendKind !== 'firestore') {
    return (
      <div className="flex items-center gap-2 rounded-full bg-amber-100 px-3.5 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-300">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>โหมดทดสอบ — Mock Data (ไม่ใช่ระบบใช้งานจริง)</span>
      </div>
    );
  }

  const assertion = assertFirestoreWorkerCreatePath();
  if (!assertion.ok) {
    return (
      <div
        className="flex items-center gap-2 rounded-full bg-amber-100 px-3.5 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-300"
        title={assertion.reasons.join('; ')}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>FIRESTORE (ยังไม่พร้อม Worker)</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      <span>FIRESTORE + WORKER</span>
    </div>
  );
}
