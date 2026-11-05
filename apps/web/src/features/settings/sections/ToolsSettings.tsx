import type { JsonObject, ToolInfo, ToolPolicy } from '@neotext/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { toolsApi } from '../../../lib/api/tools';
import { useT } from '../../../lib/i18n';
import { qk } from '../../../lib/query';
import { flushSettings, updateSettings, useSettings } from '../../../state/settings';
import { Button, Select, Spinner } from '../../../ui';
import { toolName } from '../../chat/tools/tool-names';
import { NumberField } from '../NumberField';
import { Group, Row, SectionHeader } from '../SettingsParts';
import { providersQuery } from '../use-providers';
import styles from './ToolsSettings.module.css';
import {
  ENGINE_ORDER,
  engineHint,
  priceText,
  validMode,
  WEB_SEARCH_ENGINES,
  type WebSearchEngine,
} from './web-search-engines';

const POLICIES: readonly ToolPolicy[] = ['auto', 'ask', 'off'];
const CONTEXT_SIZES = ['default', 'low', 'medium', 'high'] as const;
const NO_BACKEND = 'none';
/**
 * The tool servers (MCP) settings section. Like the nav's links, it is a `$section` id, so it
 * needs no route of its own; until that section exists the settings page opens General.
 */
const TOOL_SERVERS_SECTION = 'mcp';

/** Which search provider models outside OpenRouter use. It never guesses while it cannot tell. */
function BackendSelect({ value }: { value: string | null }) {
  const t = useT();
  const queryClient = useQueryClient();
  const providers = useQuery(providersQuery);
  const hint = <p className={styles.hint}>{t('settings.tools.backendHint')}</p>;

  const choose = (id: string) => {
    updateSettings({ webSearch: { backendProviderId: id === NO_BACKEND ? null : id } });
    // Whether a backend is set decides if the Web button shows for models outside OpenRouter.
    // Asked only once the choice has reached the server, or the old answer would be cached.
    void flushSettings()
      .catch(() => undefined)
      .then(() => queryClient.invalidateQueries({ queryKey: qk.tools }));
  };

  if (!providers.data) {
    const failed = providers.isError;
    return (
      <div className={styles.select}>
        <Select
          label={t('settings.tools.backend')}
          value="unknown"
          onChange={() => {}}
          disabled
          options={[
            {
              value: 'unknown',
              label: failed ? t('settings.tools.backendUnknown') : t('common.loading'),
            },
          ]}
        />
        {failed ? (
          <div className={styles.failed}>
            <p>{t('settings.tools.backendLoadFailed')}</p>
            <Button size="sm" onClick={() => void providers.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          hint
        )}
      </div>
    );
  }

  const search = providers.data.filter((p) => p.category === 'search');
  const chosen = search.find((p) => p.id === value);
  const options = [
    { value: NO_BACKEND, label: t('settings.tools.backendNone') },
    // A chosen provider that was turned off stays visible, because it is still the setting.
    ...search
      .filter((p) => p.enabled || p.id === value)
      .map((p) => ({
        value: p.id,
        label: p.enabled ? p.name : t('settings.tools.backendOff', { name: p.name }),
        hint: t(`settings.providers.kind.${p.kind}`),
      })),
  ];
  return (
    <div className={styles.select}>
      <Select
        label={t('settings.tools.backend')}
        value={chosen?.id ?? NO_BACKEND}
        onChange={choose}
        options={options}
      />
      {hint}
    </div>
  );
}

function WebSearchGroup() {
  const t = useT();
  const web = useSettings((s) => s.settings.webSearch);
  const save = (patch: JsonObject) => updateSettings({ webSearch: patch });

  const mode = validMode(web.engine, web.mode);
  const { modes } = WEB_SEARCH_ENGINES[web.engine];

  // An engine without modes saves none: a merge patch cannot store "no mode", and the server
  // sends only a mode the engine has, so whatever stays saved does no harm.
  const chooseEngine = (engine: string) => {
    const next = engine as WebSearchEngine;
    const nextMode = validMode(next, null);
    save(nextMode === null ? { engine: next } : { engine: next, mode: nextMode });
  };

  return (
    <Group title={t('settings.tools.webSearch')} intro={t('settings.tools.webSearchIntro')}>
      <Row>
        <div className={styles.select}>
          <Select
            label={t('settings.tools.engine')}
            value={web.engine}
            onChange={chooseEngine}
            options={ENGINE_ORDER.map((id) => ({
              value: id,
              label: t(`settings.tools.engines.${id}`),
              hint: engineHint(id),
            }))}
          />
        </div>
        {mode !== null ? (
          <div className={styles.select}>
            <Select
              label={t('settings.tools.mode')}
              value={mode}
              onChange={(next) => save({ mode: next })}
              options={modes.map((m) => ({
                value: m.id,
                label: t(`settings.tools.modes.${m.id}`),
                hint: priceText(m.price),
              }))}
            />
          </div>
        ) : null}
      </Row>
      <Row>
        <NumberField
          label={t('settings.tools.maxResults')}
          error={t('settings.tools.oneToTen')}
          required
          value={web.maxResults}
          onCommit={(maxResults) => maxResults !== null && save({ maxResults })}
          min={1}
          max={10}
          integer
        />
        <NumberField
          label={t('settings.tools.maxSearches')}
          error={t('settings.tools.oneToTen')}
          required
          value={web.maxSearchesPerTurn}
          onCommit={(maxSearchesPerTurn) =>
            maxSearchesPerTurn !== null && save({ maxSearchesPerTurn })
          }
          min={1}
          max={10}
          integer
        />
      </Row>
      <div className={styles.select}>
        <Select
          label={t('settings.tools.contextSize')}
          value={web.contextSize ?? 'default'}
          onChange={(size) => save({ contextSize: size === 'default' ? null : size })}
          options={CONTEXT_SIZES.map((size) => ({
            value: size,
            label: t(`settings.tools.context.${size}`),
          }))}
        />
        <p className={styles.hint}>{t('settings.tools.contextSizeHint')}</p>
      </div>
      <BackendSelect value={web.backendProviderId} />
    </Group>
  );
}

function ToolRow({ tool, policy }: { tool: ToolInfo; policy: ToolPolicy }) {
  const t = useT();
  const title = toolName(tool.name, tool.mcp);
  const description =
    tool.source === 'app' && (tool.name === 'fetch_url' || tool.name === 'web_search')
      ? t(`settings.tools.descriptions.${tool.name}`)
      : tool.description;
  return (
    <li className={styles.tool}>
      <div className={styles.toolMain}>
        <span className={styles.toolName} dir="auto">
          {title}
        </span>
        {description ? (
          <span className={styles.toolText} dir="auto">
            {description}
          </span>
        ) : null}
        {tool.source === 'mcp' ? (
          <span className={styles.toolText}>{t('settings.tools.fromServer')}</span>
        ) : null}
      </div>
      <Select
        aria-label={title}
        value={policy}
        onChange={(next) => updateSettings({ tools: { policies: { [tool.name]: next } } })}
        options={POLICIES.map((p) => ({ value: p, label: t(`settings.tools.policy.${p}`) }))}
        triggerClassName={styles.policy}
      />
    </li>
  );
}

function ToolsGroup() {
  const t = useT();
  const tools = useQuery({ queryKey: qk.tools, queryFn: toolsApi.list });
  const { policies, maxSteps } = useSettings((s) => s.settings.tools);

  let list: ReactNode;
  if (tools.isPending) list = <Spinner label={t('common.loading')} />;
  else if (tools.isError) {
    list = (
      <div className={styles.failed}>
        <p>{t('settings.tools.loadFailed')}</p>
        <Button size="sm" onClick={() => void tools.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  } else if (tools.data.tools.length === 0) {
    list = <p className={styles.hint}>{t('settings.tools.empty')}</p>;
  } else {
    list = (
      <ul className={styles.list} aria-label={t('settings.tools.list')}>
        {tools.data.tools.map((tool) => (
          <ToolRow
            key={tool.name}
            tool={tool}
            // The saved choice shows at once; the server's view catches up on the next load.
            policy={policies[tool.name] ?? tool.policy}
          />
        ))}
      </ul>
    );
  }

  return (
    <Group title={t('settings.tools.toolsTitle')} intro={t('settings.tools.toolsIntro')}>
      {list}
      <Row>
        <NumberField
          label={t('settings.tools.maxSteps')}
          hint={t('settings.tools.maxStepsHint')}
          error={t('settings.tools.maxStepsRange')}
          required
          value={maxSteps}
          onCommit={(next) => next !== null && updateSettings({ tools: { maxSteps: next } })}
          min={1}
          max={20}
          integer
        />
      </Row>
      <p className={styles.servers}>
        {t('settings.tools.servers')}{' '}
        <Link
          to="/settings/$section"
          params={{ section: TOOL_SERVERS_SECTION }}
          className={styles.link}
        >
          {t('settings.tools.serversLink')}
        </Link>
      </p>
    </Group>
  );
}

export function ToolsSettings() {
  const t = useT();
  return (
    <>
      <SectionHeader title={t('settings.sections.tools')} intro={t('settings.tools.intro')} />
      <WebSearchGroup />
      <ToolsGroup />
    </>
  );
}
