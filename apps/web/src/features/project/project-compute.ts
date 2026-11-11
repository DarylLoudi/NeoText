import { type MessagePublic, replayProject } from '@neotext/shared';
import { htmlPages } from './bundle';
import type { ChatProject } from './project-versions';

/**
 * The project of a branch as the transcript shows it. Only versions with a page get a row: files
 * alone (the named code blocks of an ordinary answer) are no project to preview. Loaded lazily
 * (`useChatProject`).
 */
export function chatProject(path: MessagePublic[]): ChatProject {
  const { files, versions } = replayProject(path);
  const withPage = versions.filter((v) => htmlPages(v.files).length > 0);
  return {
    versions: new Map(withPage.map((v) => [v.messageId, v])),
    hasPage: htmlPages(files).length > 0,
  };
}
