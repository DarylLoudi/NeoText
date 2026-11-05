import { z } from 'zod';

/** Whether the runtime knows this IANA time zone. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** An IANA time zone name the server can count days in, such as `Asia/Jakarta`. */
export const TimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, 'Unknown time zone. Send an IANA name such as Asia/Jakarta.');
