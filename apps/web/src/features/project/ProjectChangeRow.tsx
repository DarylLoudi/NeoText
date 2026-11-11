import type { ProjectVersion } from '@neotext/shared';
import { AppWindow } from '@phosphor-icons/react';
import { useT } from '../../lib/i18n';
import { Button, IconButton } from '../../ui';
import styles from './ProjectChangeRow.module.css';
import { openProjectPanel, toggleProjectPanel, useProjectPanel } from './project-panel-state';

/** One line under an answer that changed the project: its version, what changed, and a way in. */
export function ProjectChangeRow({
  conversationId,
  messageId,
  version,
}: {
  conversationId: string;
  messageId: string;
  version: ProjectVersion;
}) {
  const t = useT();
  return (
    <div className={styles.row}>
      <AppWindow className={styles.icon} aria-hidden />
      <span className={styles.text}>
        {t('chat.project.row', {
          n: version.number,
          // As `changesText` in the panel; kept here so this row's chunk stays on its own.
          changes: version.changes
            .map((c) => t(`chat.project.changes.${c.kind}`, { path: c.path }))
            .join(', '),
        })}
      </span>
      <Button size="sm" onClick={() => openProjectPanel(conversationId, messageId)}>
        {t('chat.project.open')}
      </Button>
    </div>
  );
}

/** The top bar's switch for the panel, shown once the chat's branch has a page to preview. */
export function PreviewToggle({
  conversationId,
  hasPage,
}: {
  conversationId: string;
  hasPage: boolean;
}) {
  const t = useT();
  const panel = useProjectPanel();
  if (!hasPage) return null;
  return (
    <IconButton
      label={t('chat.project.toggle')}
      icon={<AppWindow />}
      pressed={panel.open && panel.conversationId === conversationId}
      onClick={() => toggleProjectPanel(conversationId)}
    />
  );
}
