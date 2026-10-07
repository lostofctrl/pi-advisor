import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  advisorEffortRef,
  advisorFallbackModelRef,
  advisorRef,
  getPersistedModelRefs,
  setAdvisorEffortRef,
  setAdvisorFallbackModelRef,
  setAdvisorRef,
} from "../config/state.ts";
import { loadConfig } from "../config/storage.ts";
import {
  getAvailableModelRefs,
  getExplicitModelError,
  planActivationModels,
} from "./model-options.ts";
import { selectAdvisorModels } from "./model-picker.ts";
import { notify } from "./runtime.ts";

export interface PreparedActivationModels {
  pendingExecutor?: string;
  pickedModels: boolean;
}

export const loadCommandConfig = (ctx: ExtensionContext) => {
  try {
    loadConfig(ctx);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notify(
      ctx,
      `Advisor command could not load configuration: ${message} Fix advisor.json and retry.`,
      "error"
    );
    return false;
  }
};

export const prepareActivationModels = async (
  ctx: ExtensionContext,
  announce: boolean,
  advisorOverride: boolean
): Promise<PreparedActivationModels | undefined> => {
  const currentModelRef = ctx.model
    ? `${ctx.model.provider}/${ctx.model.id}`
    : undefined;
  if (!currentModelRef) {
    notify(ctx, "Select a chat model before enabling Advisor flow", "error");
    return;
  }
  const storedRefs = getPersistedModelRefs();
  const persisted = { ...storedRefs, executor: currentModelRef };
  const availableRefs = getAvailableModelRefs(ctx);
  const availableRefSet = availableRefs ? new Set(availableRefs) : undefined;
  const explicitError = getExplicitModelError(
    ctx,
    advisorRef,
    "Advisor",
    advisorOverride,
    availableRefSet
  );
  if (explicitError) {
    notify(ctx, explicitError, "error");
    return;
  }

  const plan = planActivationModels(
    ctx,
    currentModelRef,
    advisorRef,
    undefined,
    persisted,
    false,
    advisorOverride,
    availableRefSet
  );
  if (!plan.selectAdvisor) {
    return { pendingExecutor: plan.pendingExecutor, pickedModels: false };
  }

  // Always-on startup cannot open an interactive picker, so it leaves the
  // flow disabled until the user selects both models with `/advisor`.
  if (!announce) {
    notify(
      ctx,
      "Advisor model is not configured or available. Run /advisor to choose it.",
      "error"
    );
    return;
  }
  const selection = await selectAdvisorModels(ctx, {
    advisor: advisorOverride || persisted.advisor ? advisorRef : "",
    advisorEffort: advisorEffortRef,
    advisorFallbackModel: advisorFallbackModelRef,
    executor: currentModelRef,
    executorEffort: undefined,
    selectAdvisor: plan.selectAdvisor,
    selectExecutor: false,
  });
  if (!selection) {
    return;
  }
  setAdvisorRef(selection.advisor);
  setAdvisorFallbackModelRef(selection.advisorFallbackModel);
  setAdvisorEffortRef(selection.advisorEffort);
  return { pendingExecutor: plan.pendingExecutor, pickedModels: true };
};
