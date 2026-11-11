import type { FileChange } from '@neotext/shared';
import type { TFunction } from 'i18next';

/** "created style.css, edited index.html": one version's change list as a sentence. */
export function changesText(changes: FileChange[], t: TFunction): string {
  return changes.map((c) => t(`chat.project.changes.${c.kind}`, { path: c.path })).join(', ');
}

/** Sizes as the panel shows them, in KB with one decimal. */
export function sizeText(content: string, t: TFunction): string {
  const size = (new TextEncoder().encode(content).length / 1024).toFixed(1);
  return t('chat.project.size', { size });
}
