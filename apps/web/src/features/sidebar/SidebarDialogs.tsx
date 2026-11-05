import { useT } from '../../lib/i18n';
import { useSettings } from '../../state/settings';
import { Button, Dialog } from '../../ui';
import { SmartSectionEditor } from './SmartSectionEditor';
import { addSmartSection } from './section-ops';
import { newSmartId, resetSidebar, saveSections } from './sidebar-actions';

export interface SidebarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Makes a section that lists the chats matching a filter. */
export function AddSmartSectionDialog({ open, onOpenChange }: SidebarDialogProps) {
  const t = useT();
  const sections = useSettings((s) => s.settings.sidebar.sections);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={t('sidebar.smart.title')}
      description={t('sidebar.smart.description')}
    >
      <SmartSectionEditor
        onCancel={() => onOpenChange(false)}
        onSubmit={(input) => {
          saveSections(addSmartSection(sections, input, newSmartId(sections)));
          onOpenChange(false);
        }}
      />
    </Dialog>
  );
}

/** Asks before putting the sidebar back to its defaults. */
export function ResetSidebarDialog({ open, onOpenChange }: SidebarDialogProps) {
  const t = useT();
  const sections = useSettings((s) => s.settings.sidebar.sections);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('sidebar.customizer.resetTitle')}
      description={t('sidebar.customizer.resetBody')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onOpenChange(false);
              resetSidebar(sections);
            }}
          >
            {t('sidebar.customizer.reset')}
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  );
}
