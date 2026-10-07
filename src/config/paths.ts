import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Advisor configuration lives next to the Pi agent state. Pi CLI's official
 * package keeps using the shared `<agentDir>/advisor.json`, while this fork's
 * bundle (loaded by Pi Web) resolves the namespaced `<agentDir>/pi-web/advisor.json`
 * by default so web sessions do not share their Advisor configuration with the CLI.
 *
 * Resolution order:
 * 1. `PI_ADVISOR_CONFIG_PATH` — an explicit absolute path. A relative or empty
 *    value is rejected with an error instead of silently falling back, so a
 *    mistyped override can never divert configuration to the shared file.
 * 2. `<agentDir>/pi-web/advisor.json` — the namespaced default.
 * 3. `<agentDir>/advisor.json` — first-run fallback: only while the namespaced
 *    file does not exist yet and the legacy shared file does, so existing
 *    installations keep reading and writing their current file unchanged.
 */
export const ADVISOR_CONFIG_PATH_ENV = "PI_ADVISOR_CONFIG_PATH";

const NAMESPACED_CONFIG_DIR = "pi-web";
const CONFIG_FILENAME = "advisor.json";

/** The default namespaced location, regardless of an existing legacy file. */
export const defaultAdvisorConfigPath = (): string =>
  join(getAgentDir(), NAMESPACED_CONFIG_DIR, CONFIG_FILENAME);

/** The legacy shared location used by Pi CLI's official package. */
export const legacyAdvisorConfigPath = (): string =>
  join(getAgentDir(), CONFIG_FILENAME);

/**
 * Resolves the advisor.json path this installation reads and writes. Throws on
 * a malformed explicit override; every caller must surface that error rather
 * than retrying against the shared file.
 */
export const resolveAdvisorConfigPath = (): string => {
  const override = process.env[ADVISOR_CONFIG_PATH_ENV]?.trim();
  if (override) {
    if (!isAbsolute(override)) {
      throw new Error(
        `${ADVISOR_CONFIG_PATH_ENV} must be an absolute path; got ${JSON.stringify(override)}.`
      );
    }
    return override;
  }
  const namespaced = defaultAdvisorConfigPath();
  if (!existsSync(namespaced) && existsSync(legacyAdvisorConfigPath())) {
    return legacyAdvisorConfigPath();
  }
  return namespaced;
};
