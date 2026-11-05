import { lazy, Suspense } from 'react';
import { LoadBoundary } from '../../lib/LoadBoundary';
import type { ComparePickerProps } from './ComparePicker';

const load = () => import('./ComparePicker').then((m) => ({ default: m.ComparePicker }));
let ComparePicker = lazy(load);

/** Loads the compare picker's code the first time compare is turned on. */
export function LazyComparePicker(props: ComparePickerProps) {
  return (
    // A rejected lazy component stays rejected; turning compare on again tries a fresh one.
    <LoadBoundary
      onError={() => {
        ComparePicker = lazy(load);
      }}
    >
      <Suspense fallback={null}>
        <ComparePicker {...props} />
      </Suspense>
    </LoadBoundary>
  );
}
