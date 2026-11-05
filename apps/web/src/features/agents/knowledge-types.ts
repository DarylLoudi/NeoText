// The knowledge contract comes from @neotext/shared; the accepted extensions are a web check only.
export {
  AGENT_FILE_MAX_BYTES as KNOWLEDGE_MAX_BYTES,
  AGENT_FILES_MAX as KNOWLEDGE_MAX_FILES,
  type AgentFile,
  AgentFileSchema,
  AgentFilesListSchema,
} from '@neotext/shared';

export const KNOWLEDGE_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'csv', 'html', 'htm'] as const;
