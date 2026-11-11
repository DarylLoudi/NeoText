/** The most a chat's web project may hold; the file tools and replay enforce the same limits. */
export const PROJECT_LIMITS = {
  files: 50,
  fileBytes: 512 * 1024,
  projectBytes: 2 * 1024 * 1024,
} as const;

/** The app tools that change or read the project. */
export const PROJECT_TOOLS = {
  write: 'write_file',
  edit: 'edit_file',
  remove: 'delete_file',
  read: 'read_file',
} as const;

/** Path → content. Paths are normalized (`normalizeProjectPath`). */
export type ProjectFiles = ReadonlyMap<string, string>;

export type ProjectOp =
  | { kind: 'write'; path: string; content: string }
  | { kind: 'edit'; path: string; oldText: string; newText: string }
  | { kind: 'delete'; path: string };

export interface FileChange {
  path: string;
  kind: 'created' | 'edited' | 'deleted';
}

/** The project after one assistant message that changed it. Numbers start at 1 on a path. */
export interface ProjectVersion {
  messageId: string;
  number: number;
  changes: FileChange[];
  files: ProjectFiles;
}

export interface ReplayedProject {
  /** After the last message of the path. */
  files: ProjectFiles;
  versions: ProjectVersion[];
  /** Operations that could not be applied (bad arguments, limits, text not found). */
  skipped: number;
}
