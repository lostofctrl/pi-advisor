import {
  advisorEffortRef,
  advisorFallbackModelRef,
  advisorRef,
  setAdvisorEffortRef,
  setAdvisorFallbackModelRef,
  setAdvisorRef,
} from "../config/state.ts";
import { saveConfig } from "../config/storage.ts";
import { loadCommandConfig } from "./activation-preparation.ts";
import { activateAdvisor } from "./activation.ts";
import { selectAdvisorModels } from "./model-picker.ts";
import type { CommandRuntime } from "./types.ts";

export const registerModelCommands = (runtime: CommandRuntime) => {
  runtime.pi.registerCommand("advisor", {
    description:
      "Enable Advisor flow using the current chat model as Executor; accepts contextMaxChars=N",
    handler: (args, ctx) => activateAdvisor(runtime, args, ctx),
  });

  runtime.pi.registerCommand("advisor-models", {
    description:
      "Select and persist the Advisor and optional fallback model with reasoning levels",
    handler: async (_args, ctx) => {
      if (!(loadCommandConfig(ctx) && ctx.hasUI)) {
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify(
          "Select a chat model before configuring Advisor",
          "error"
        );
        return;
      }
      const currentModelRef = `${ctx.model.provider}/${ctx.model.id}`;
      const selection = await selectAdvisorModels(ctx, {
        advisor: advisorRef,
        advisorEffort: advisorEffortRef,
        advisorFallbackModel: advisorFallbackModelRef,
        executor: currentModelRef,
        executorEffort: undefined,
        selectAdvisor: true,
        selectExecutor: false,
      });
      if (!selection) {
        return;
      }

      setAdvisorRef(selection.advisor);
      setAdvisorFallbackModelRef(selection.advisorFallbackModel);
      setAdvisorEffortRef(selection.advisorEffort);

      const path = saveConfig(ctx, {
        persistAdvisor: true,
        persistExecutor: false,
      });
      runtime.updateSameModelNotice(ctx);
      ctx.ui.notify(`Saved Advisor configuration to ${path}`, "info");
    },
  });
};
