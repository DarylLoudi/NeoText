import {
  type AgentCreate,
  AgentDataSchema,
  type AgentPublic,
  type ModelRef,
} from '@neotext/shared';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { useT } from '../../lib/i18n';
import { Button, Dialog, Switch, TextArea, TextField } from '../../ui';
import { ModelChoice } from '../settings/ModelChoice';
import styles from './AgentEditor.module.css';
import { KnowledgeSection } from './KnowledgeSection';
import { useAgentMutations } from './use-agents';

export const MAX_INSTRUCTIONS = 50_000;
export const MAX_IMPORT_BYTES = 200 * 1024;

interface Draft {
  name: string;
  description: string;
  instructions: string;
  model: ModelRef | null;
  webSearch: boolean;
  fetchUrl: boolean;
  autoDelegate: boolean;
}

const blank: Draft = {
  name: '',
  description: '',
  instructions: '',
  model: null,
  webSearch: true,
  fetchUrl: true,
  autoDelegate: false,
};

const draftOf = (a: AgentPublic | null): Draft =>
  a
    ? {
        name: a.name,
        description: a.data.description,
        instructions: a.data.instructions,
        model: a.data.model,
        webSearch: a.data.tools.webSearch,
        fetchUrl: a.data.tools.fetchUrl,
        autoDelegate: a.data.autoDelegate,
      }
    : blank;

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function AgentForm({ agent, onClose }: { agent: AgentPublic | null; onClose: () => void }) {
  const t = useT();
  const mutations = useAgentMutations();
  const [draft, setDraft] = useState<Draft>(() => draftOf(agent));
  const [nameError, setNameError] = useState<string | undefined>();
  const [instructionsError, setInstructionsError] = useState<string | undefined>();
  const [importError, setImportError] = useState<string | null>(null);
  const [cut, setCut] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    setCut(false);
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(t('settings.agents.editor.importTooBig'));
      return;
    }
    try {
      const text = await readText(file);
      if (text.length > MAX_INSTRUCTIONS) setCut(true);
      set('instructions', text.slice(0, MAX_INSTRUCTIONS));
      setInstructionsError(undefined);
    } catch {
      setImportError(t('settings.agents.editor.importFailed'));
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const name = draft.name.trim();
    let nameProblem: string | undefined;
    if (name === '') nameProblem = t('settings.agents.editor.nameRequired');
    else if (name.length > 60) nameProblem = t('settings.agents.editor.nameTooLong');
    let instructionsProblem: string | undefined;
    if (draft.instructions.trim() === '') {
      instructionsProblem = t('settings.agents.editor.instructionsRequired');
    } else if (draft.instructions.length > MAX_INSTRUCTIONS) {
      instructionsProblem = t('settings.agents.editor.instructionsTooLong');
    }
    setNameError(nameProblem);
    setInstructionsError(instructionsProblem);
    if (nameProblem || instructionsProblem) return;

    const parsed = AgentDataSchema.safeParse({
      description: draft.description.trim(),
      instructions: draft.instructions,
      model: draft.model,
      tools: { webSearch: draft.webSearch, fetchUrl: draft.fetchUrl },
      autoDelegate: draft.autoDelegate,
      enabled: agent?.data.enabled ?? true,
    });
    if (!parsed.success) {
      setNameError(t('settings.agents.editor.invalid'));
      return;
    }
    const body: AgentCreate = { name, data: parsed.data };
    setSaving(true);
    const ok = agent ? await mutations.update(agent.id, body) : await mutations.create(body);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <form className={styles.form} onSubmit={(e) => void save(e)}>
      <TextField
        label={t('settings.agents.editor.name')}
        value={draft.name}
        onChange={(e) => set('name', e.target.value)}
        error={nameError}
        autoComplete="off"
        dir="auto"
      />
      <TextField
        label={t('settings.agents.editor.description')}
        hint={t('settings.agents.editor.descriptionHint')}
        value={draft.description}
        onChange={(e) => set('description', e.target.value)}
        maxLength={500}
        autoComplete="off"
        dir="auto"
      />
      <div className={styles.instructions}>
        <TextArea
          label={t('settings.agents.editor.instructions')}
          value={draft.instructions}
          onChange={(e) => {
            set('instructions', e.target.value);
            setCut(false);
          }}
          error={instructionsError}
          minRows={8}
          maxRows={16}
          dir="auto"
          spellCheck={false}
        />
      </div>
      <div className={styles.meta}>
        <input
          ref={fileInput}
          className={styles.hidden}
          type="file"
          accept=".md,.txt,text/markdown,text/plain"
          aria-label={t('settings.agents.editor.importFile')}
          onChange={(e) => void importFile(e)}
        />
        <Button type="button" size="sm" onClick={() => fileInput.current?.click()}>
          {t('settings.agents.editor.import')}
        </Button>
        <span className={styles.count}>
          {t('settings.agents.editor.count', {
            count: draft.instructions.length,
            max: MAX_INSTRUCTIONS,
          })}
        </span>
      </div>
      {importError ? (
        <p className={styles.error} role="alert">
          {importError}
        </p>
      ) : null}
      {cut ? (
        <p className={styles.warn} role="status">
          {t('settings.agents.editor.importCut', { max: MAX_INSTRUCTIONS })}
        </p>
      ) : null}
      <ModelChoice
        label={t('settings.agents.editor.model')}
        value={draft.model}
        onChange={(model) => set('model', model)}
        emptyText={t('settings.agents.sameModel')}
        clearLabel={t('settings.agents.editor.clearModel')}
      />
      <Switch
        label={t('settings.agents.editor.webSearch')}
        checked={draft.webSearch}
        onChange={(v) => set('webSearch', v)}
      />
      <Switch
        label={t('settings.agents.editor.fetchUrl')}
        checked={draft.fetchUrl}
        onChange={(v) => set('fetchUrl', v)}
      />
      <Switch
        label={t('settings.agents.editor.autoDelegate')}
        checked={draft.autoDelegate}
        onChange={(v) => set('autoDelegate', v)}
      />
      <KnowledgeSection agentId={agent?.id ?? null} />
      <div className={styles.footer}>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

export interface AgentEditorProps {
  open: boolean;
  /** Null for a new agent. */
  agent: AgentPublic | null;
  onOpenChange: (open: boolean) => void;
}

export function AgentEditor({ open, agent, onOpenChange }: AgentEditorProps) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={agent ? t('settings.agents.editor.editTitle') : t('settings.agents.editor.newTitle')}
    >
      <AgentForm agent={agent} onClose={() => onOpenChange(false)} />
    </Dialog>
  );
}
