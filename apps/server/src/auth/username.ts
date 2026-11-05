export const PASSWORD_MIN_CHARS = 10;
export const PASSWORD_MAX_BYTES = 1024;

export function normalizeUsername(input: string): string {
  return input.normalize('NFKC').trim().toLowerCase();
}

export const DISPLAY_NAME_MAX_CHARS = 80;

/** A display name is shown to admins and in lists, so it stays short; empty is allowed. */
export function validateDisplayName(name: string | undefined): string | null {
  return name !== undefined && [...name.trim()].length > DISPLAY_NAME_MAX_CHARS
    ? `Use a display name of at most ${DISPLAY_NAME_MAX_CHARS} characters.`
    : null;
}

/** Takes an already normalized username; returns an error message or null. */
export function validateUsername(normalized: string): string | null {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized)
    ? null
    : 'Use 3–32 letters, digits, dots, dashes or underscores.';
}

export function validatePassword(pw: string): string | null {
  if ([...pw].length < PASSWORD_MIN_CHARS) {
    return `Use at least ${PASSWORD_MIN_CHARS} characters for the password.`;
  }
  if (Buffer.byteLength(pw, 'utf8') > PASSWORD_MAX_BYTES) {
    return `Use a password of at most ${PASSWORD_MAX_BYTES} bytes.`;
  }
  return null;
}
