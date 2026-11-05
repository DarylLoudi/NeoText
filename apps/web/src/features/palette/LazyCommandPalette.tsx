import { Component, lazy, type ReactNode, Suspense, useState } from 'react';
import { translate } from '../../lib/i18n';
import { toast } from '../../ui';
import type { CommandPaletteProps } from './CommandPalette';

const load = () => import('./CommandPalette').then((m) => ({ default: m.CommandPalette }));
let CommandPalette = lazy(load);

interface BoundaryProps {
  children: ReactNode;
  onError: () => void;
}

/** Keeps a failed chunk load from taking the shell down with it. */
class LoadBoundary extends Component<BoundaryProps, { failed: boolean }> {
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

/** Loads the palette's code the first time it is opened, then keeps it. */
export function LazyCommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  if (!wanted) return null;
  const failed = () => {
    // A rejected lazy component stays rejected; the next opening needs a fresh one.
    CommandPalette = lazy(load);
    toast({ message: translate('shell.palette.loadFailed'), tone: 'danger' });
    onOpenChange(false);
    setWanted(false);
  };
  return (
    <LoadBoundary onError={failed}>
      <Suspense fallback={null}>
        <CommandPalette open={open} onOpenChange={onOpenChange} />
      </Suspense>
    </LoadBoundary>
  );
}
