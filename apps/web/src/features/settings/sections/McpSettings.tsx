import type { McpServerPublic, McpTestResult } from '@neotext/shared';
import { PencilSimple, Plus } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import { useT } from '../../../lib/i18n';
import { Button, Dialog, IconButton, Spinner, Switch, toast } from '../../../ui';
import { SectionHeader } from '../SettingsParts';
import { mcpServersQuery, useMcpMutations } from '../use-mcp';
import { McpServerForm } from './McpServerForm';
import styles from './McpSettings.module.css';

type Editing = { mode: 'add' } | { mode: 'edit'; server: McpServerPublic } | null;

function Row({ server, onEdit }: { server: McpServerPublic; onEdit: () => void }) {
  const t = useT();
  const { update, test } = useMcpMutations();
  const [result, setResult] = useState<McpTestResult | null>(null);

  async function toggle(enabled: boolean) {
    try {
      await update.mutateAsync({ id: server.id, body: { enabled } });
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : t('common.genericError'),
        tone: 'danger',
      });
    }
  }

  async function run() {
    setResult(null);
    let found: McpTestResult;
    try {
      found = await test.mutateAsync(server.id);
    } catch (err) {
      found = {
        ok: false,
        message: err instanceof ApiError ? err.message : t('settings.mcp.testFailed'),
      };
    }
    setResult(found);
    if (found.ok) {
      toast({
        message: t('settings.mcp.testToast', { name: server.name, count: found.tools.length }),
        tone: 'success',
      });
    }
  }

  return (
    <li className={styles.row}>
      <div className={styles.toggle}>
        <Switch
          label={server.name}
          checked={server.enabled}
          disabled={update.isPending}
          onChange={(enabled) => void toggle(enabled)}
        />
      </div>
      <div className={styles.actions}>
        <Button
          size="sm"
          loading={test.isPending}
          aria-label={t('settings.mcp.testLabel', { name: server.name })}
          onClick={() => void run()}
        >
          {t('settings.mcp.test')}
        </Button>
        <IconButton
          label={t('settings.mcp.edit', { name: server.name })}
          icon={<PencilSimple />}
          onClick={onEdit}
        />
      </div>
      <p className={styles.url}>
        {server.url}
        {server.hasHeaders ? (
          <span className={styles.headers}>{t('settings.mcp.headersSavedShort')}</span>
        ) : null}
      </p>
      <div role="status" className={styles.result}>
        {result?.ok === true ? (
          result.tools.length > 0 ? (
            <>
              <p className={styles.ok}>
                {t('settings.mcp.testOk', { count: result.tools.length })}
              </p>
              <ul className={styles.tools} aria-label={t('settings.mcp.toolList')}>
                {result.tools.map((tool) => (
                  <li key={tool.name} className={styles.tool} title={tool.description || undefined}>
                    {tool.name}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.muted}>{t('settings.mcp.testNone')}</p>
          )
        ) : result ? (
          <p className={styles.fail}>{result.message}</p>
        ) : null}
      </div>
    </li>
  );
}

export function McpSettings() {
  const t = useT();
  const servers = useQuery(mcpServersQuery);
  const { remove } = useMcpMutations();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<McpServerPublic | null>(null);

  const close = () => setEditing(null);

  async function confirmDelete(server: McpServerPublic) {
    try {
      await remove.mutateAsync(server.id);
      toast({ message: t('settings.mcp.deleted'), tone: 'success' });
      setDeleting(null);
      close();
    } catch (err) {
      toast({
        message: err instanceof ApiError ? err.message : t('common.genericError'),
        tone: 'danger',
      });
      // The editor stays open behind the confirmation so nothing the person typed is lost.
      setDeleting(null);
    }
  }

  return (
    <>
      <SectionHeader title={t('settings.sections.mcp')} intro={t('settings.mcp.intro')} />
      <div className={styles.body}>
        {servers.isPending ? (
          <Spinner />
        ) : servers.isError ? (
          <div className={styles.failed}>
            <p>{t('settings.mcp.loadFailed')}</p>
            <Button size="sm" onClick={() => void servers.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : servers.data.length === 0 ? (
          <p className={styles.empty}>{t('settings.mcp.empty')}</p>
        ) : (
          <ul className={styles.list} aria-label={t('settings.mcp.list')}>
            {servers.data.map((s) => (
              <Row key={s.id} server={s} onEdit={() => setEditing({ mode: 'edit', server: s })} />
            ))}
          </ul>
        )}
        <Button className={styles.add} onClick={() => setEditing({ mode: 'add' })}>
          <Plus aria-hidden />
          {t('settings.mcp.add')}
        </Button>
      </div>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && close()}
        size="md"
        title={editing?.mode === 'edit' ? t('settings.mcp.editTitle') : t('settings.mcp.add')}
      >
        {editing ? (
          <McpServerForm
            key={editing.mode === 'edit' ? editing.server.id : 'new'}
            onDone={close}
            {...(editing.mode === 'edit'
              ? { server: editing.server, onDelete: () => setDeleting(editing.server) }
              : {})}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        size="sm"
        title={t('settings.mcp.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('settings.mcp.deleteBody')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => deleting && void confirmDelete(deleting)}
            >
              {t('settings.mcp.delete')}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}
