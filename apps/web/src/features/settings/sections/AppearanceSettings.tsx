import { useId } from 'react';
import { useT } from '../../../lib/i18n';
import { updateSettings, useSettings } from '../../../state/settings';
import { Switch } from '../../../ui/Switch/Switch';
import { ChoiceGroup } from '../../sidebar/ChoiceGroup';
import { AccentSwatches } from '../AccentSwatches';
import { Group, Row, SectionHeader } from '../SettingsParts';
import styles from './AppearanceSettings.module.css';

const MIN_SCALE = 0.875;
const MAX_SCALE = 1.25;

export function AppearanceSettings() {
  const t = useT();
  const a = useSettings((s) => s.settings.appearance);
  const set = (patch: Record<string, string | number | boolean>) =>
    updateSettings({ appearance: patch });
  const sizeId = useId();

  return (
    <>
      <SectionHeader
        title={t('settings.sections.appearance')}
        intro={t('settings.appearance.intro')}
      />

      <Group title={t('settings.appearance.colors')}>
        <ChoiceGroup
          legend={t('settings.appearance.theme')}
          value={a.theme}
          onChange={(theme) => set({ theme })}
          options={[
            { value: 'system', label: t('settings.appearance.themeSystem') },
            { value: 'light', label: t('settings.appearance.themeLight') },
            { value: 'dark', label: t('settings.appearance.themeDark') },
          ]}
        />
        <AccentSwatches value={a.accent} onChange={(accent) => set({ accent })} />
      </Group>

      <Group title={t('settings.appearance.fonts')}>
        <div className={styles.sample} data-testid="font-sample">
          <p className={styles.sampleTitle}>{t('settings.appearance.preview')}</p>
          <p className={styles.sampleText} dir="auto">
            {t('settings.appearance.sample')}
          </p>
          <pre className={styles.sampleCode}>
            <code>{t('settings.appearance.sampleCode')}</code>
          </pre>
        </div>
        <Row>
          <ChoiceGroup
            legend={t('settings.appearance.uiFont')}
            value={a.uiFont}
            onChange={(uiFont) => set({ uiFont })}
            options={[
              { value: 'atkinson', label: t('settings.appearance.fontAtkinson') },
              { value: 'system', label: t('settings.appearance.fontSystem') },
            ]}
          />
          <ChoiceGroup
            legend={t('settings.appearance.readingFont')}
            value={a.readingFont}
            onChange={(readingFont) => set({ readingFont })}
            options={[
              { value: 'atkinson', label: t('settings.appearance.fontAtkinson') },
              { value: 'literata', label: t('settings.appearance.fontLiterata') },
              { value: 'system', label: t('settings.appearance.fontSystem') },
            ]}
          />
          <ChoiceGroup
            legend={t('settings.appearance.codeFont')}
            value={a.codeFont}
            onChange={(codeFont) => set({ codeFont })}
            options={[
              { value: 'atkinson-mono', label: t('settings.appearance.fontAtkinsonMono') },
              { value: 'system-mono', label: t('settings.appearance.fontSystemMono') },
            ]}
          />
        </Row>
        <div className={styles.size}>
          <label htmlFor={sizeId} className={styles.sizeLabel}>
            {t('settings.appearance.textSize')}
          </label>
          <input
            id={sizeId}
            className={styles.range}
            type="range"
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.025}
            value={a.fontScale}
            onChange={(e) => set({ fontScale: Number(e.target.value) })}
          />
          <output htmlFor={sizeId} className={styles.sizeValue}>
            {t('settings.appearance.textSizeValue', { percent: Math.round(a.fontScale * 100) })}
          </output>
        </div>
      </Group>

      <Group title={t('settings.appearance.layout')}>
        <Row>
          <ChoiceGroup
            legend={t('settings.appearance.messageWidth')}
            value={a.messageWidth}
            onChange={(messageWidth) => set({ messageWidth })}
            options={[
              { value: 'narrow', label: t('settings.appearance.narrow') },
              { value: 'normal', label: t('settings.appearance.normal') },
              { value: 'wide', label: t('settings.appearance.wide') },
            ]}
          />
          <ChoiceGroup
            legend={t('settings.appearance.density')}
            value={a.density}
            onChange={(density) => set({ density })}
            options={[
              { value: 'comfortable', label: t('settings.appearance.comfortable') },
              { value: 'compact', label: t('settings.appearance.compact') },
            ]}
          />
          <ChoiceGroup
            legend={t('settings.appearance.motion')}
            value={a.reduceMotion}
            onChange={(reduceMotion) => set({ reduceMotion })}
            options={[
              { value: 'system', label: t('settings.appearance.motionSystem') },
              { value: 'on', label: t('settings.appearance.motionReduce') },
              { value: 'off', label: t('settings.appearance.motionKeep') },
            ]}
          />
        </Row>
      </Group>

      <Group title={t('settings.appearance.details')}>
        <Switch
          label={t('settings.appearance.showCost')}
          checked={a.showCost}
          onChange={(showCost) => set({ showCost })}
        />
        <ChoiceGroup
          legend={t('settings.appearance.codeTheme')}
          value={a.codeTheme}
          onChange={(codeTheme) => set({ codeTheme })}
          options={[
            { value: 'auto', label: t('settings.appearance.codeAuto') },
            { value: 'vitesse', label: t('settings.appearance.codeVitesse') },
            { value: 'min', label: t('settings.appearance.codeMin') },
          ]}
        />
      </Group>
    </>
  );
}
