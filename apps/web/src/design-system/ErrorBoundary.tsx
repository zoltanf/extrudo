import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  /** What to draw instead of the children once one of them threw. */
  fallback(error: unknown, reset: () => void): ReactNode;
  /** Called once per caught error (logging, saving). */
  onError?(error: unknown, info: ErrorInfo): void;
  children?: ReactNode;
}

interface State {
  error?: { value: unknown };
}

/**
 * React drops the whole tree when a render throws and nothing catches it
 * (a blank page, ADR-0076). Boundaries sit around the 3D view and at the root.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = {};

  static getDerivedStateFromError(error: unknown): State {
    return { error: { value: error } };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error);
    this.props.onError?.(error, info);
  }

  reset = (): void => this.setState({ error: undefined });

  override render(): ReactNode {
    const { error } = this.state;
    return error ? this.props.fallback(error.value, this.reset) : this.props.children;
  }
}

/** The text of whatever was thrown. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message || error.name : String(error);
}
