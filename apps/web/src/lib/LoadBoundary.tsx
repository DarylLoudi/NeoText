import { Component, type ReactNode } from 'react';

interface LoadBoundaryProps {
  children: ReactNode;
  onError: () => void;
}

/** Keeps a code chunk that failed to load from taking the page around it down too. */
export class LoadBoundary extends Component<LoadBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch() {
    this.props.onError();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
