import { createRoute } from '@tanstack/react-router';
import { ChatView } from '../../features/chat/ChatView';
import { PresetStarters } from '../../features/presets/PresetStarters';
import { rootRoute } from './root';

/** A new chat: no messages yet; the first send creates the chat and moves to its page. */
function ChatNewPage() {
  return <ChatView conversationId={null} presets={<PresetStarters />} />;
}

export const chatNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ChatNewPage,
});
