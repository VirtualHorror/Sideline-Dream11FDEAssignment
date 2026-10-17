/**
 * The scripted provider: a stand-in model for tests, so no test needs a key or the network.
 *
 * Callers: apps/server/test, and scripts/lib/record.ts for `pnpm ai:record --provider scripted`,
 * whose rows never go to data/ai-replay (config never selects it). Each request is recorded; the script
 * decides the answer from the skill, moment key and prompts: return an output, return a promise
 * (resolve late, or never), or throw (a ProviderRefusalError, any Error). Usage is fixed per
 * provider so costs in tests are exact.
 */
import type { Effort, LlmProvider, ProviderRequest } from "./types.ts";

export interface ScriptedRequest {
  skill: string;
  key: string;
  system: string;
  user: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  jsonSchema: Record<string, unknown>;
}

export type Script = (req: ScriptedRequest, signal: AbortSignal) => unknown;

export function createScriptedProvider(
  script: Script,
  usage: { tokensIn?: number; tokensOut?: number } = {},
): LlmProvider & { readonly requests: ScriptedRequest[] } {
  const requests: ScriptedRequest[] = [];
  return {
    name: "scripted",
    requests,
    async complete(req: ProviderRequest) {
      const recorded: ScriptedRequest = {
        skill: req.meta.skill,
        key: req.meta.key,
        system: req.system,
        user: req.user,
        model: req.model,
        effort: req.effort,
        maxTokens: req.maxTokens,
        jsonSchema: req.jsonSchema,
      };
      requests.push(recorded);
      const output = await script(recorded, req.signal);
      return {
        output,
        tokensIn: usage.tokensIn ?? 1000,
        tokensOut: usage.tokensOut ?? 100,
        model: req.model,
      };
    },
  };
}
