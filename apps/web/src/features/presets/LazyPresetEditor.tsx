import { lazy, Suspense } from 'react';
import { translate } from '../../lib/i18n';
import { LoadBoundary } from '../../lib/LoadBoundary';
import { toast } from '../../ui';
import type { PresetEditorProps } from './PresetEditor';

const load = () => import('./PresetEditor').then((m) => ({ default: m.PresetEditor }));
let PresetEditor = lazy(load);

/** Loads the preset editor's code the first time it is opened. */
export function LazyPresetEditor(props: PresetEditorProps) {
  const failed = () => {
    // A rejected lazy component stays rejected; the next opening needs a fresh one.
    PresetEditor = lazy(load);
    toast({ message: translate('common.genericError'), tone: 'danger' });
    props.onOpenChange(false);
  };
  return (
    <LoadBoundary onError={failed}>
      <Suspense fallback={null}>
        <PresetEditor {...props} />
      </Suspense>
    </LoadBoundary>
  );
}
