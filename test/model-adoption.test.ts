import { describe, expect, test } from "bun:test";

import { registerCommands } from "../src/commands.ts";
import { savedConfig, withAgentDir } from "./helpers/config-fixture.ts";
import { activationContext, activationHarness } from "./helpers/harness.ts";

describe("Executor model adoption", () => {
  test("follows every model selection without writing an Executor setting", async () => {
    await withAgentDir(
      { executor: "configured/executor" },
      async (agentDir) => {
        const { events, pi } = activationHarness();
        registerCommands(pi);
        const ctx = activationContext(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        for (const source of ["restore", "cycle", "set"] as const) {
          events.get("model_select")?.(
            { model: { id: "other", provider: "vendor" }, source },
            ctx
          );
          expect(savedConfig(agentDir).executor).toBe("configured/executor");
        }
      }
    );
  });

  test("uses the current chat model on activation and keeps legacy settings", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "configured/executor" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        setActiveTools([]);
        const notices: string[] = [];
        const ctx = activationContext(agentDir, notices);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        events.get("model_select")?.(
          { model: { id: "luna", provider: "provider" }, source: "set" },
          ctx
        );
        await commands.get("advisor").handler("", ctx);

        expect(notices.join("\n")).toContain("Executor: provider/executor");
        expect(savedConfig(agentDir)).toMatchObject({
          advisor: "provider/advisor",
          executor: "configured/executor",
        });
        expect(pi.getActiveTools()).toContain("ask_advisor");
      }
    );
  });

  test("ignores a legacy Executor override argument", async () => {
    await withAgentDir(
      { advisor: "provider/advisor", executor: "configured/executor" },
      async (agentDir) => {
        const { commands, events, pi, setActiveTools } = activationHarness();
        registerCommands(pi);
        setActiveTools([]);
        const ctx = activationContext(agentDir);
        await events.get("session_start")?.({ reason: "startup" }, ctx);

        await commands
          .get("advisor")
          .handler("executor=provider/explicit", ctx);

        expect(savedConfig(agentDir).executor).toBe("configured/executor");
      }
    );
  });

  test("keeps flow activation working when no Executor is configured", async () => {
    await withAgentDir({ advisor: "provider/advisor" }, async (agentDir) => {
      const { commands, pi, setActiveTools } = activationHarness();
      registerCommands(pi);
      setActiveTools([]);
      const ctx = activationContext(agentDir);

      await commands.get("advisor").handler("", ctx);

      expect(pi.getActiveTools()).toContain("ask_advisor");
      expect(savedConfig(agentDir)).not.toHaveProperty("executor");
    });
  });
});
