import {
  type ChatRequestBody,
  type CreatePresetBody,
  newId,
  type Preset,
  type PresetData,
  type UpdatePresetBody,
  type UserSettings,
} from '@neotext/shared';
import type { AuthContext } from '../http/env';
import { AppError } from '../http/errors';
import type { Clock } from '../lib/clock';
import type { PresetsRepo } from './repo';

export interface PresetsService {
  list(auth: AuthContext): Preset[];
  /** 404 when the preset is missing or not the user's. */
  get(auth: AuthContext, id: string): Preset;
  /** The preset, or null when it is gone (a chat outlives its preset). */
  find(auth: AuthContext, id: string): Preset | null;
  create(auth: AuthContext, body: CreatePresetBody): Preset;
  update(auth: AuthContext, id: string, body: UpdatePresetBody): Preset;
  remove(auth: AuthContext, id: string): void;
}

export function createPresetsService(deps: { repo: PresetsRepo; clock: Clock }): PresetsService {
  const { repo, clock } = deps;
  const find = (auth: AuthContext, id: string) => repo.get(auth.userId, id, auth.dek);
  const get = (auth: AuthContext, id: string): Preset => {
    const found = find(auth, id);
    if (!found) throw new AppError('not_found', 'That preset does not exist.', 404);
    return found;
  };
  return {
    list: (auth) => repo.list(auth.userId, auth.dek),
    get,
    find,
    create: (auth, body) => {
      const now = clock.now();
      const preset: Preset = {
        id: newId('pst'),
        name: body.name,
        data: body.data,
        position: body.position,
        createdAt: now,
        updatedAt: now,
      };
      repo.insert({ ...preset, userId: auth.userId }, auth.dek);
      return preset;
    },
    update: (auth, id, body) => {
      get(auth, id);
      repo.update(auth.userId, id, body, clock.now(), auth.dek);
      return get(auth, id);
    },
    remove: (auth, id) => {
      if (!repo.remove(auth.userId, id)) get(auth, id);
    },
  };
}

/**
 * What a preset changes in a turn. Precedence: the request's own options, then the preset,
 * then the user's settings (which `buildTurnRequest` applies to whatever stays null here).
 */
export function applyPreset(
  chat: UserSettings['chat'],
  options: ChatRequestBody['options'],
  preset: PresetData | null,
): { chat: UserSettings['chat']; options: ChatRequestBody['options'] } {
  if (!preset) return { chat, options };
  return {
    chat:
      preset.systemPrompt.trim() === ''
        ? chat
        : { ...chat, defaultSystemPrompt: preset.systemPrompt },
    options: {
      ...options,
      reasoningEffort: options.reasoningEffort ?? preset.reasoningEffort,
      temperature: options.temperature ?? preset.temperature,
      maxOutputTokens: options.maxOutputTokens ?? preset.maxOutputTokens,
    },
  };
}
