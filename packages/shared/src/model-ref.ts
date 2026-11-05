import { z } from 'zod';

export const ModelRefSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

/** `<providerId>|<modelId>`; provider ids never contain `|`, model ids may. */
export function modelKey(ref: ModelRef): string {
  return `${ref.providerId}|${ref.modelId}`;
}

export function parseModelKey(key: string): ModelRef | null {
  const i = key.indexOf('|');
  if (i <= 0 || i === key.length - 1) return null;
  return { providerId: key.slice(0, i), modelId: key.slice(i + 1) };
}
