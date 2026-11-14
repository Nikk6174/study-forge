import { Component, type ReactNode } from 'react';

/**
 * Last line of defence. Data is validated before it reaches components, so
 * this should never trigger – but if it does, the user gets a way out
 * instead of a blank page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[ui] render error', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="panel error" role="alert" style={{ margin: '2rem auto', maxWidth: 520 }}>
        <div>
          <strong>Something broke while displaying this page.</strong>
          <p>Your saved sets are safe. Reloading usually fixes it.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
