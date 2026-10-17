import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..");

// A Responses API answer, as the openai SDK reads it (the shape of providers.test.ts's fixture).
const ANSWER = {
  id: "resp_test",
  object: "response",
  created_at: 0,
  status: "completed",
  model: "smoke-model",
  output: [
    {
      type: "message",
      id: "msg_test",
      status: "completed",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: '{"nudge":"Everything rides on the next delivery."}',
          annotations: [],
        },
      ],
    },
  ],
  usage: {
    input_tokens: 400,
    output_tokens: 20,
    total_tokens: 420,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
};

describe("pnpm ai:smoke", () => {
  // The real script against a stand-in for an OpenAI-compatible endpoint on loopback: no key, no
  // spend (Constraint 26). Variables set here beat .env, so a developer's keys are never used. The
  // repository's data/ai-replay holds a recorded answer for the moment the smoke picks (Task 11's
  // recording), which a cache look-up would serve without asking the provider.
  it("asks the provider even when the moment it picks has a recorded answer", async () => {
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(ANSWER));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const run = await promisify(execFile)(
        process.execPath,
        [join(REPO, "scripts", "ai-smoke.ts")],
        {
          env: {
            PATH: process.env.PATH,
            SIDELINE_AI_PROVIDER: "openai",
            OPENAI_API_KEY: "sk-test",
            OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
            SIDELINE_MODEL_FAST: "smoke-model",
            SIDELINE_MODEL_SMART: "smoke-model",
          },
        },
      ).catch((error: { stdout: string; stderr: string }) => error);
      expect(requests).toEqual(["POST /v1/responses"]);
      expect(run.stdout).toContain(
        'ai-smoke: nudge "Everything rides on the next delivery."\n' +
          "ai-smoke: outcome ok, provenance live, provider openai, model smoke-model,",
      );
      expect(run.stdout).toContain("ai-smoke: OK\n");
    } finally {
      server.close();
    }
  }, 30_000);
});
