import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  effectiveExecutorEffort,
  effectiveExecutorRef,
} from "../child-session.ts";
import { parseArgs } from "../config/args.ts";
import {
  advisorEffortRef,
  advisorRef,
  contextMaxCharsRef,
  setAdvisorEffortRef,
  setAdvisorRef,
  setContextMaxCharsRef,
} from "../config/state.ts";
import { saveConfig } from "../config/storage.ts";
import { sameModelAdvisorDisabled } from "../tools/model-access.ts";
import {
  loadCommandConfig,
  prepareActivationModels,
} from "./activation-preparation.ts";
import {
  ADVISOR_ACTIVATION_EXPLANATION,
  findConfiguredModel,
  hasAdvisorOverride,
} from "./model-options.ts";
import { notify } from "./runtime.ts";
import type { CommandRuntime } from "./types.ts";

const resolveActivationModels = async (ctx: ExtensionContext) => {
  const executor = ctx.model;
  if (!executor) {
    return { error: "Select a chat model before enabling Advisor flow" };
  }
  const advisor = findConfiguredModel(ctx, advisorRef);
  if (!advisor) {
    return {
      error: advisorRef
        ? `Advisor model not found: ${advisorRef}`
        : "Advisor model not configured",
    };
  }
  const advisorAuth = await ctx.modelRegistry.getApiKeyAndHeaders(advisor);
  if (!(advisorAuth.ok && advisorAuth.apiKey)) {
    return { error: `No API key for Advisor ${advisorRef}` };
  }
  return {};
};

export const activateAdvisor = async (
  runtime: CommandRuntime,
  args: string,
  ctx: ExtensionContext,
  announce = true
) => {
  if (!loadCommandConfig(ctx)) {
    return;
  }
  const previous = {
    advisor: advisorRef,
    advisorEffort: advisorEffortRef,
    contextMaxChars: contextMaxCharsRef,
  };
  const restoreRefs = () => {
    setAdvisorRef(previous.advisor);
    setAdvisorEffortRef(previous.advisorEffort);
    setContextMaxCharsRef(previous.contextMaxChars);
  };
  const advisorOverride = hasAdvisorOverride(args);
  const argumentError = parseArgs(args);
  if (argumentError) {
    restoreRefs();
    notify(ctx, argumentError, "error");
    return;
  }

  const prepared = await prepareActivationModels(
    ctx,
    announce,
    advisorOverride
  );
  if (!prepared) {
    restoreRefs();
    return;
  }
  const { error } = await resolveActivationModels(ctx);
  if (error) {
    restoreRefs();
    notify(ctx, error, "error");
    return;
  }
  // Persist only the Advisor configuration; the Executor is always the active
  // chat model and must not be pinned to advisor.json.
  if (args.trim() || prepared.pickedModels) {
    saveConfig(ctx, { persistAdvisor: true, persistExecutor: false });
  }
  if (!runtime.flowEnabled()) {
    runtime.pi.setActiveTools([
      ...runtime.pi.getActiveTools(),
      "ask_advisor",
      "record_advisor_outcome",
    ]);
  }
  const activeModel = ctx.model;
  runtime.updateSameModelNotice(ctx, activeModel);
  if (announce) {
    const activeExecutorRef = effectiveExecutorRef(ctx);
    const activeExecutorEffort = effectiveExecutorEffort(ctx);
    notify(
      ctx,
      `${ADVISOR_ACTIVATION_EXPLANATION}\n\nAdvisor flow ${sameModelAdvisorDisabled(ctx, activeModel) ? "configured" : "ready"} — Executor: ${activeExecutorRef} (thinking: ${activeExecutorEffort || "default"}) · Advisor: ${advisorRef} (thinking: ${advisorEffortRef || "default"})`,
      "info"
    );
  }
};
