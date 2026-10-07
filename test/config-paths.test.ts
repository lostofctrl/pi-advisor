import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ADVISOR_CONFIG_PATH_ENV,
  defaultAdvisorConfigPath,
  legacyAdvisorConfigPath,
  resolveAdvisorConfigPath,
} from "../src/config/paths.ts";
import {
  loadConfig,
  resetConfigCache,
  saveConfig,
} from "../src/config/storage.ts";

// SAFETY: mock context exercises only hasUI-aware paths in this suite.
const context = { hasUI: false } as any;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalOverride = process.env[ADVISOR_CONFIG_PATH_ENV];
let agentDir = "";

const setOverride = (value: string | undefined) => {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, ADVISOR_CONFIG_PATH_ENV);
  } else {
    process.env[ADVISOR_CONFIG_PATH_ENV] = value;
  }
};

describe("Advisor configuration path resolution", () => {
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-advisor-flow-paths-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    setOverride(undefined);
  });

  afterEach(() => {
    resetConfigCache();
    rmSync(agentDir, { force: true, recursive: true });
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    if (originalOverride === undefined) {
      setOverride(undefined);
    } else {
      setOverride(originalOverride);
    }
  });

  test("resolves the namespaced default when no file exists yet", () => {
    expect(resolveAdvisorConfigPath()).toBe(
      join(agentDir, "pi-web", "advisor.json")
    );
  });

  test("falls back to the legacy shared file until the namespaced file exists", () => {
    const legacy = join(agentDir, "advisor.json");
    writeFileSync(legacy, "{}");
    expect(resolveAdvisorConfigPath()).toBe(legacy);

    // Creating the namespaced file ends the fallback in both directions.
    mkdirSync(join(agentDir, "pi-web"), { recursive: true });
    writeFileSync(join(agentDir, "pi-web", "advisor.json"), "{}");
    expect(resolveAdvisorConfigPath()).toBe(
      join(agentDir, "pi-web", "advisor.json")
    );
  });

  test("uses an explicit absolute override without falling back", () => {
    const override = join(agentDir, "elsewhere", "advisor.json");
    setOverride(override);
    writeFileSync(join(agentDir, "advisor.json"), "{}");
    expect(resolveAdvisorConfigPath()).toBe(override);
  });

  test("rejects a relative override instead of silently using the shared file", () => {
    setOverride("relative/advisor.json");
    expect(() => resolveAdvisorConfigPath()).toThrow(
      `${ADVISOR_CONFIG_PATH_ENV} must be an absolute path`
    );
  });

  test("ignores a blank override", () => {
    setOverride("   ");
    expect(resolveAdvisorConfigPath()).toBe(
      join(agentDir, "pi-web", "advisor.json")
    );
  });

  test("loadConfig rejects a relative override with a clear error", () => {
    setOverride("relative/advisor.json");
    expect(() => loadConfig(context)).toThrow(
      `${ADVISOR_CONFIG_PATH_ENV} must be an absolute path`
    );
  });

  test("saving creates the namespaced directory and file", () => {
    const namespaced = join(agentDir, "pi-web", "advisor.json");
    expect(existsSync(namespaced)).toBe(false);
    saveConfig(context);
    expect(existsSync(namespaced)).toBe(true);
  });

  test("saving with a legacy file keeps writing the legacy file", () => {
    writeFileSync(join(agentDir, "advisor.json"), "{}");
    const saved = saveConfig(context);
    expect(saved).toBe(legacyAdvisorConfigPath());
    expect(defaultAdvisorConfigPath()).toBe(
      join(agentDir, "pi-web", "advisor.json")
    );
    expect(existsSync(join(agentDir, "pi-web"))).toBe(false);
  });
});
