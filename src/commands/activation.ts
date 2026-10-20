import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  effectiveExecutorEffort,
  effectiveExecutorRef,
} from "../child-session.ts";
import { parseArgs } from "../config/args.ts";
import {
  advisorEffortRef,
  advisorRef,
  advisorToolsEnabledRef,
  contextMaxCharsRef,
  setAdvisorEffortRef,
  setAdvisorRef,
  setAdvisorToolsEnabledRef,
  setContextMaxCharsRef,
} from "../config/state.ts";
import { saveConfig } from "../config/storage.ts";
import { sameModelAdvisorDisabled } from "../tools/model-access.ts";
import {
  loadCommandConfig,
  prepareActivationModels,
} from "./activation-preparation.ts";
import { setAdvisorToolsActive } from "./advisor-tools.ts";
import {
  ADVISOR_ACTIVATION_EXPLANATION,
  findConfiguredModel,
  hasAdvisorOverride,
} from "./model-options.ts";
import { notify } from "./runtime.ts";
import type { CommandRuntime } from "./types.ts";

const resolveActivationModels = async (
  ctx: ExtensionContext,
  canContinue: () => boolean
) => {
  if (!canContinue()) {
    return { cancelled: true };
  }

  if (!ctx.model) {
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

  if (!canContinue()) {
    return { cancelled: true };
  }

  if (!(advisorAuth.ok && advisorAuth.apiKey)) {
    return { error: `No API key for Advisor ${advisorRef}` };
  }

  return {};
};

const restoreActivationRefsIfCurrent = (
  canContinue: () => boolean,
  restoreRefs: () => void
) => {
  if (canContinue()) {
    restoreRefs();
  }
};

const liveRefSnapshot = () => ({
  advisor: advisorRef,
  advisorEffort: advisorEffortRef,
  contextMaxChars: contextMaxCharsRef,
});

const persistSuccessfulActivation = (
  ctx: ExtensionContext,
  shouldSave: boolean,
  reenableTools: boolean,
  restoreRefs: () => void
) => {
  if (!shouldSave) {
    return true;
  }

  try {
    saveConfig(ctx, { persistAdvisor: true, persistExecutor: false });
  } catch (saveError) {
    if (!reenableTools) {
      throw saveError;
    }

    setAdvisorToolsEnabledRef(false);
    restoreRefs();

    const message =
      saveError instanceof Error ? saveError.message : String(saveError);

    notify(ctx, `Could not save Advisor activation: ${message}`, "error");

    return false;
  }

  return true;
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

  const { toolAvailabilityRevision } = runtime;

  const canContinue = () =>
    runtime.toolAvailabilityRevision === toolAvailabilityRevision;

  const previous = liveRefSnapshot();

  // Restore only values still owned by this activation, not concurrent saves.
  const restoreRefs = (attempted: ReturnType<typeof liveRefSnapshot>) => {
    if (advisorRef === attempted.advisor) {
      setAdvisorRef(previous.advisor);
    }

    if (advisorEffortRef === attempted.advisorEffort) {
      setAdvisorEffortRef(previous.advisorEffort);
    }

    if (contextMaxCharsRef === attempted.contextMaxChars) {
      setContextMaxCharsRef(previous.contextMaxChars);
    }
  };

  let attempted = liveRefSnapshot();
  const advisorOverride = hasAdvisorOverride(args);
  const argumentError = parseArgs(args);

  if (argumentError) {
    attempted = liveRefSnapshot();
    restoreRefs(attempted);
    notify(ctx, argumentError, "error");

    return;
  }

  const prepared = await prepareActivationModels(
    ctx,
    announce,
    advisorOverride
  );

  attempted = liveRefSnapshot();

  if (!prepared) {
    restoreActivationRefsIfCurrent(canContinue, () => restoreRefs(attempted));

    return;
  }

  const { cancelled, error } = await resolveActivationModels(ctx, canContinue);

  if (cancelled || !canContinue()) {
    return;
  }

  if (error) {
    restoreRefs(attempted);
    notify(ctx, error, "error");

    return;
  }

  const reenableTools = !advisorToolsEnabledRef;

  if (reenableTools) {
    setAdvisorToolsEnabledRef(true);
  }

  const shouldSave = Boolean(
    args.trim() || prepared.pickedModels || reenableTools
  );

  if (
    !persistSuccessfulActivation(ctx, shouldSave, reenableTools, () =>
      restoreRefs(liveRefSnapshot())
    )
  ) {
    return;
  }

  setAdvisorToolsActive(runtime.pi, true);
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
