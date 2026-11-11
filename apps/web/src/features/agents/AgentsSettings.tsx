import type { AgentPublic } from '@neotext/shared';
import { Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { useT } from '../../lib/i18n';
import { updateSettings, useSettings } from '../../state/settings';
import { Button, Dialog, Spinner } from '../../ui';
import { Switch } from '../../ui/Switch/Switch';
import { ModelChoice } from '../settings/ModelChoice';
import { NumberField } from '../settings/NumberField';
import { Group, SectionHeader } from '../settings/SettingsParts';
import { AgentEditor } from './AgentEditor';
import styles from './AgentsSettings.module.css';
import { useAgentMutations, useAgents } from './use-agents';

function AgentRow({ agent, onEdit }: { agent: AgentPublic; onEdit: () => void }) {
  const t = useT();
  const mutations = useAgentMutations();
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={styles.row}>
      <div className={styles.main}>
        <span className={styles.name} dir="auto">
          {agent.name}
        </span>
        {agent.data.description ? (
          <span className={styles.description} dir="auto">
            {agent.data.description}
          </span>
        ) : null}
      </div>
      <Switch
        label={t('settings.agents.enabled', { name: agent.name })}
        hideLabel
        checked={agent.data.enabled}
        onChange={(enabled) =>
          void mutations.update(agent.id, { data: { ...agent.data, enabled } })
        }
      />
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('settings.agents.editNamed', { name: agent.name })}
          onClick={onEdit}
        >
          {t('settings.agents.edit')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t('settings.agents.deleteNamed', { name: agent.name })}
          onClick={() => setConfirming(true)}
        >
          {t('settings.agents.delete')}
        </Button>
      </div>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        size="sm"
        title={t('settings.agents.deleteTitle', { name: agent.name })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                void mutations.remove(agent.id);
              }}
            >
              {t('settings.agents.delete')}
            </Button>
          </>
        }
      >
        <p>{t('settings.agents.deleteBody')}</p>
      </Dialog>
    </li>
  );
}

function SubagentSettings() {
  const t = useT();
  const tools = useSettings((s) => s.settings.tools);
  return (
    <Group title={t('settings.agents.subagents')}>
      <ModelChoice
        label={t('settings.agents.subagentModel')}
        value={tools.subagentModel}
        onChange={(subagentModel) => updateSettings({ tools: { subagentModel } })}
        emptyText={t('settings.agents.sameModel')}
        clearLabel={t('settings.agents.clearSubagentModel')}
      />
      <div className={styles.field}>
        <NumberField
          label={t('settings.agents.maxSubagents')}
          value={tools.maxSubagents}
          min={2}
          max={6}
          integer
          required
          error={t('settings.agents.maxSubagentsInvalid')}
          onCommit={(n) => {
            if (n !== null) updateSettings({ tools: { maxSubagents: n } });
          }}
        />
      </div>
      <p className={styles.help}>{t('settings.agents.subagentsHelp')}</p>
    </Group>
  );
}

function AgentList() {
  const t = useT();
  const agents = useAgents();
  /** `null` while closed, `'new'` for a blank editor, else the agent being edited. */
  const [editing, setEditing] = useState<AgentPublic | 'new' | null>(null);

  let body: React.ReactNode;
  if (agents.isPending) {
    body = <Spinner label={t('common.loading')} size={14} />;
  } else if (agents.isError) {
    body = (
      <>
        <p className={styles.note}>{t('settings.agents.loadFailed')}</p>
        <Button size="sm" className={styles.add} onClick={() => void agents.refetch()}>
          {t('common.retry')}
        </Button>
      </>
    );
  } else if (agents.data.length === 0) {
    body = <p className={styles.note}>{t('settings.agents.empty')}</p>;
  } else {
    body = (
      <ul className={styles.list} aria-label={t('settings.agents.list')}>
        {agents.data.map((agent) => (
          <AgentRow key={agent.id} agent={agent} onEdit={() => setEditing(agent)} />
        ))}
      </ul>
    );
  }

  return (
    <Group title={t('settings.agents.yours')}>
      {body}
      <Button className={styles.add} onClick={() => setEditing('new')}>
        <Plus aria-hidden /> {t('settings.agents.new')}
      </Button>
      {editing !== null ? (
        <AgentEditor
          open
          agent={editing === 'new' ? null : editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </Group>
  );
}

export function AgentsSettings() {
  const t = useT();
  return (
    <>
      <SectionHeader title={t('settings.sections.agents')} intro={t('settings.agents.intro')} />
      <SubagentSettings />
      <AgentList />
    </>
  );
}
