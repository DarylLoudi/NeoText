import { ProjectPanelView, type ProjectPanelViewProps } from './ProjectPanelView';
import { useThrottled } from './use-throttled';

/** While answers stream, the panel takes a new path at most this often. */
const LIVE_INTERVAL_MS = 500;

/**
 * The project panel of a chat, given the branch to show by the chat view. It takes a new path at
 * most every 500 ms while answers stream. Everything it needs from the first page's modules
 * comes in as props, so its lazy chunk splits nothing out of them.
 */
export default function ProjectPanel({
  generating,
  path,
  ...rest
}: ProjectPanelViewProps & { generating: boolean }) {
  const shown = useThrottled(path, generating ? LIVE_INTERVAL_MS : 0);
  return <ProjectPanelView path={shown} {...rest} />;
}
