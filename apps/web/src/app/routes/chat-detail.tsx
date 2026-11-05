import { createRoute } from '@tanstack/react-router';
import { ChatView } from '../../features/chat/ChatView';
import { rootRoute } from './root';

function ChatDetailPage() {
  const { conversationId } = chatDetailRoute.useParams();
  const { m } = chatDetailRoute.useSearch();
  // A fresh view per chat: scroll position and editors never carry over.
  return <ChatView key={conversationId} conversationId={conversationId} focusMessageId={m} />;
}

export const chatDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/c/$conversationId',
  // `?m=<messageId>`: search results open the chat scrolled to that message.
  validateSearch: (search: Record<string, unknown>): { m?: string } =>
    typeof search.m === 'string' && search.m ? { m: search.m } : {},
  component: ChatDetailPage,
});
