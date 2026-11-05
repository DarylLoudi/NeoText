import { z } from 'zod';

export const ExportFormatSchema = z.enum(['neotext', 'markdown', 'json']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const EXPORT_PASSPHRASE_MIN = 10;

export const ExportBodySchema = z
  .object({
    format: ExportFormatSchema,
    /** Markdown only: export this one chat instead of all of them. */
    conversationId: z.string().min(1).max(64).optional(),
    passphrase: z.string().min(EXPORT_PASSPHRASE_MIN).max(1024).optional(),
    includeProviderKeys: z.boolean().optional(),
    confirmPlaintext: z.boolean().optional(),
  })
  .refine((b) => b.format !== 'neotext' || b.passphrase !== undefined, {
    message: 'A NeoText export needs a passphrase.',
    path: ['passphrase'],
  })
  .refine((b) => b.format !== 'json' || b.confirmPlaintext === true, {
    message: 'Confirm that a plain JSON export is not encrypted.',
    path: ['confirmPlaintext'],
  })
  .refine((b) => !b.includeProviderKeys || b.format === 'neotext', {
    message: 'Provider keys can only go into an encrypted NeoText export.',
    path: ['includeProviderKeys'],
  });
export type ExportBody = z.infer<typeof ExportBodySchema>;

export const ImportSourceSchema = z.enum(['neotext', 'chatgpt', 'claude']);
export type ImportSource = z.infer<typeof ImportSourceSchema>;

/** Why one item of an import was left out; the web shows these in the user's language. */
export const ImportFailureCodeSchema = z.enum([
  'not_a_conversation',
  'missing_id',
  'missing_messages',
  'no_messages',
  'unreadable',
  'invalid_conversation',
  'duplicate_conversation',
  'invalid_message',
  'broken_thread',
  'save_failed',
  'invalid_folder',
  'invalid_preset',
  'invalid_provider',
  'provider_rejected',
  'invalid_settings',
]);
export type ImportFailureCode = z.infer<typeof ImportFailureCodeSchema>;

export const ImportFailureSchema = z.object({
  title: z.string().nullable(),
  /**
   * Absent for reasons only the server can word, such as an endpoint check. A code this build
   * does not know (a tab older than the server) is dropped, so `reason` is shown instead.
   */
  code: ImportFailureCodeSchema.optional().catch(undefined),
  /** English; the fallback when there is no code or the client does not know it. */
  reason: z.string(),
});
export type ImportFailure = z.infer<typeof ImportFailureSchema>;

export const ImportResultSchema = z.object({
  imported: z.number().int().min(0),
  skipped: z.number().int().min(0),
  failed: z.array(ImportFailureSchema),
  /** Attached files that are not in the file, each kept as a short note in its message. */
  attachmentNotes: z.number().int().min(0).optional(),
});
export type ImportResult = z.infer<typeof ImportResultSchema>;

/**
 * `details.reason` on import errors, so the web can word them in the user's language.
 * The HTTP error code stays the generic one (`bad_request`, `payload_too_large`, ...).
 */
export const ImportErrorReasonSchema = z.enum([
  'wrong_passphrase',
  'not_neotext',
  'passphrase_required',
  'not_export',
  'zip_without_entry',
  'zip_duplicate_entry',
  'too_large',
  'import_busy',
  'import_running',
]);
export type ImportErrorReason = z.infer<typeof ImportErrorReasonSchema>;

/** `details.reason` on export errors, worded on the web like the import ones. */
export const ExportErrorReasonSchema = z.enum(['export_too_large']);
export type ExportErrorReason = z.infer<typeof ExportErrorReasonSchema>;
