import { Component, lazy, type ReactNode, Suspense, useState } from 'react';
import { translate } from '../../lib/i18n';
import { toast } from '../../ui';
import type { SearchDialogProps } from './SearchDialog';

const load = () => import('./SearchDialog').then((m) => ({ default: m.SearchDialog }));
let SearchDialog = lazy(load);

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

/** Loads the search dialog's code the first time it is opened, then keeps it. */
export function LazySearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  if (!wanted) return null;
  const failed = () => {
    // A rejected lazy component stays rejected; the next opening needs a fresh one.
    SearchDialog = lazy(load);
    toast({ message: translate('shell.search.loadFailed'), tone: 'danger' });
    onOpenChange(false);
    setWanted(false);
  };
  return (
    <LoadBoundary onError={failed}>
      <Suspense fallback={null}>
        <SearchDialog open={open} onOpenChange={onOpenChange} />
      </Suspense>
    </LoadBoundary>
  );
}
