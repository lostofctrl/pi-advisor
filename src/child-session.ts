import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const isMarkedSubagent = () => process.env.PI_SUBAGENT_CHILD === "1";

export const effectiveExecutorRef = (ctx: ExtensionContext): string =>
  ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";

export const effectiveExecutorEffort = (ctx: ExtensionContext) =>
  ctx.thinkingLevel;
