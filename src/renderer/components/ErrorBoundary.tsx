import React, { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const msg = `React render error: ${error.message}\n${error.stack ?? ''}\nComponent stack:${info.componentStack}`;
    window.api.log.error(msg);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', color: '#c00' }}>
          <strong>Something went wrong.</strong>
          <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          {/*
            "Try again" only clears the boundary's own error state — it doesn't
            reset the child component's state. If the underlying bug is
            deterministic in props, the same error will fire again immediately.
            Acceptable for now: the user can always reload via ⌘R; this button
            is meant for transient (e.g. network) failures.
          */}
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 8 }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
