import { X } from '@phosphor-icons/react';
import { useSyncExternalStore } from 'react';
import { useT } from '../../lib/i18n';
import styles from './Toast.module.css';
import { dismissToast, getToasts, pauseToast, resumeToast, subscribeToasts } from './toastStore';

export type { ToastInput } from './toastStore';
export { dismissToast, toast } from './toastStore';

export function ToastHost({ dismissLabel }: { dismissLabel?: string }) {
  const tr = useT();
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  return (
    <div className={styles.host} aria-live="polite">
      {toasts.map((t) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: handlers only pause the timer; no action lives on the wrapper
        <div
          key={t.id}
          className={`${styles.toast} ${styles[t.tone]}`}
          onPointerEnter={() => pauseToast(t.id)}
          onFocus={() => pauseToast(t.id)}
          onPointerLeave={() => resumeToast(t.id)}
          onBlur={() => resumeToast(t.id)}
        >
          <p className={styles.message}>{t.message}</p>
          {t.action ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                t.action?.onClick();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.close}
            aria-label={dismissLabel ?? tr('common.dismissToast')}
            onClick={() => dismissToast(t.id)}
          >
            <X aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
