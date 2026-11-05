export interface AuthContext {
  userId: string;
  username: string;
  role: 'admin' | 'member';
  sessionId: string;
  dek: Buffer;
}

export type AppEnv = { Variables: { requestId: string; auth: AuthContext | null } };
