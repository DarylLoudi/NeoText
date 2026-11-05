import type { JsonObject } from '@neotext/shared';
import { useT } from '../../../lib/i18n';
import { updateSettings, useSettings } from '../../../state/settings';
import { Select, Switch } from '../../../ui';
import { ChoiceGroup } from '../../sidebar/ChoiceGroup';
import { DraftTextArea } from '../DraftTextArea';
import { ModelChoice } from '../ModelChoice';
import { NumberField } from '../NumberField';
import { Group, Row, SectionHeader } from '../SettingsParts';
import styles from './GeneralSettings.module.css';

const EFFORTS = ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export function GeneralSettings() {
  const t = useT();
  const locale = useSettings((s) => s.settings.locale);
  const chat = useSettings((s) => s.settings.chat);
  const saveChat = (patch: JsonObject) => updateSettings({ chat: patch });

  return (
    <>
      <SectionHeader title={t('settings.sections.general')} intro={t('settings.general.intro')} />

      <Group title={t('settings.language.title')}>
        <ChoiceGroup
          legend={t('settings.language.label')}
          value={locale}
          onChange={(next) => updateSettings({ locale: next })}
          options={[
            { value: 'auto', label: t('settings.language.auto') },
            { value: 'en', label: t('settings.language.en') },
            { value: 'id', label: t('settings.language.id') },
          ]}
        />
      </Group>

      <Group title={t('settings.general.sending')}>
        <ChoiceGroup
          legend={t('settings.general.sendKey')}
          value={chat.sendKey}
          onChange={(sendKey) => saveChat({ sendKey })}
          options={[
            { value: 'enter', label: t('settings.general.sendEnter') },
            { value: 'mod-enter', label: t('settings.general.sendMod') },
          ]}
        />
      </Group>

      <Group title={t('settings.general.chats')}>
        <ModelChoice
          label={t('settings.general.defaultModel')}
          value={chat.defaultModel}
          onChange={(defaultModel) => saveChat({ defaultModel })}
          emptyText={t('settings.general.defaultModelNone')}
          clearLabel={t('settings.general.clearDefaultModel')}
        />
        <DraftTextArea
          label={t('settings.general.systemPrompt')}
          hint={t('settings.general.systemPromptHint')}
          value={chat.defaultSystemPrompt}
          onCommit={(defaultSystemPrompt) => saveChat({ defaultSystemPrompt })}
          maxLength={20000}
          minRows={4}
          maxRows={12}
        />
        <Switch
          label={t('settings.general.includeDate')}
          hint={t('settings.general.includeDateHint')}
          checked={chat.includeDate}
          onChange={(includeDate) => saveChat({ includeDate })}
        />
        <Switch
          label={t('settings.general.background')}
          hint={t('settings.general.backgroundHint')}
          checked={chat.continueInBackground}
          onChange={(continueInBackground) => saveChat({ continueInBackground })}
        />
      </Group>

      <Group title={t('settings.general.titles')}>
        <Switch
          label={t('settings.general.autoTitle')}
          checked={chat.autoTitle}
          onChange={(autoTitle) => saveChat({ autoTitle })}
        />
        <ModelChoice
          label={t('settings.general.titleModel')}
          value={chat.titleModel}
          onChange={(titleModel) => saveChat({ titleModel })}
          emptyText={t('settings.general.titleModelNone')}
          clearLabel={t('settings.general.clearTitleModel')}
        />
      </Group>

      <Group title={t('settings.general.answers')}>
        <div className={styles.select}>
          <Select
            label={t('settings.general.reasoning')}
            value={chat.reasoningEffort}
            onChange={(reasoningEffort) => saveChat({ reasoningEffort })}
            options={EFFORTS.map((e) => ({ value: e, label: t(`chat.composer.effort.${e}`) }))}
          />
        </div>
        <Row>
          <NumberField
            label={t('settings.general.temperature')}
            hint={t('settings.general.temperatureHint')}
            error={t('settings.general.temperatureRange')}
            value={chat.temperature}
            onCommit={(temperature) => saveChat({ temperature })}
            min={0}
            max={2}
            step={0.1}
          />
          <NumberField
            label={t('settings.general.maxOutput')}
            hint={t('settings.general.maxOutputHint')}
            error={t('settings.general.maxOutputRange')}
            value={chat.maxOutputTokens}
            onCommit={(maxOutputTokens) => saveChat({ maxOutputTokens })}
            min={1}
            max={10_000_000}
            integer
          />
        </Row>
        <ChoiceGroup
          legend={t('settings.general.contextStrategy')}
          value={chat.contextStrategy}
          onChange={(contextStrategy) => saveChat({ contextStrategy })}
          options={[
            { value: 'trim-oldest', label: t('settings.general.trimOldest') },
            { value: 'none', label: t('settings.general.contextNone') },
          ]}
        />
      </Group>
    </>
  );
}
