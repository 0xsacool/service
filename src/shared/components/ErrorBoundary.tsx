import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { GlassCard } from './GlassCard';
import { PrimaryButton } from './Button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Application-wide render-error safety net. Catches errors thrown during
// render/lifecycle anywhere below it and shows a fallback instead of a blank
// page. Distinct from ErrorState (shared/components/ErrorState.tsx), which is
// for handling a *data-fetch* failure inside a normally-rendering page.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error caught by ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center px-6">
          <GlassCard className="flex max-w-md flex-col items-center gap-3 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-50 text-danger-500">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              Something went wrong
            </h1>
            <p className="text-sm text-neutral-500">
              An unexpected error occurred. Try reloading the page.
            </p>
            <PrimaryButton className="mt-2" onClick={() => window.location.reload()}>
              Reload page
            </PrimaryButton>
          </GlassCard>
        </div>
      );
    }

    return this.props.children;
  }
}
