import type { ModelInfo, ReasoningEffort } from '@neotext/shared';

/** `auto` leaves the choice to the model; anything else is sent as the effort. */
export type EffortChoice = 'auto' | ReasoningEffort;

/** The choice to use for a model: `wanted` if the model offers it, else `auto`. */
export function effortFor(reasoning: ModelInfo['reasoning'], wanted: EffortChoice): EffortChoice {
  return reasoning && wanted !== 'auto' && reasoning.efforts.includes(wanted) ? wanted : 'auto';
}
