import { type RefObject, useEffect } from 'react';

/**
 * After a failed submit (`failures` went up) focus the first invalid field, or the form-level
 * alert when the error is not tied to a field.
 */
export function useFocusFirstError(form: RefObject<HTMLElement | null>, failures: number): void {
  useEffect(() => {
    if (failures === 0) return;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus();
  }, [failures, form]);
}
