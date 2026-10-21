import type {
  AgentBeforeSettleEvent,
  BoundaryResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  advisorForceSettleReviewRef,
  advisorRequireExecutorResponseRef,
  getAdvisorMaxCallsPerSession,
  isSimpleMode,
} from "../config/state.ts";
import { herdrAdvisorActivity } from "../herdr.ts";
import type { HerdrAdvisorActivityScope } from "../herdr.ts";
import type { AdvisorSessionState } from "../session-state.ts";
import { advisorUsageCost } from "../usage.ts";
import type { consultAdvisor } from "./consultation.ts";
import { updateAdvisorUsageStatus } from "./gate-policy.ts";
import { advisorModelIsAllowed } from "./model-access.ts";
import { createOutageNotifier } from "./outage-notifier.ts";
import { hasSoundVerdict } from "./render-common.ts";

export const SETTLE_REVIEW_RESULT = "advisor-settle-review-result";

export const SETTLE_REVIEW_QUESTION =
  "Review the work the executor just finished. Name any material concern, unvalidated claim, or missing step it should fix before settling.";

export interface SettleReviewResultDetails {
  advisor: string;
  agentRulesBytes?: number;
  text: string;
  usage?: unknown;
  verdict: "sound" | "concern";
}

export interface SettleReviewRegistration {
  activeTools: () => string[];
  consult: typeof consultAdvisor;
  herdrActivity?: HerdrAdvisorActivityScope;
  session: AdvisorSessionState;
}

export interface SettleReview {
  handle: (
    event: AgentBeforeSettleEvent,
    ctx: ExtensionContext
  ) => Promise<BoundaryResult | undefined>;
  noteUserInput: () => void;
}

const outageNotifier = createOutageNotifier(
  (category, message) =>
    `Advisor settle review failed (${category}); settling without an automatic review. ${message}`
);

const notifyFailureOnce = outageNotifier.notify;

/** Test-only: re-arms the once-per-outage notification. */
export const resetSettleReviewNotification = outageNotifier.reset;

/**
 * Whether a review needs the executor to keep working. Shares the verdict
 * parser with the renderers so the displayed headline and the continuation
 * decision can never disagree.
 */
export const isSoundVerdict = (markdown: string): boolean =>
  hasSoundVerdict(markdown);

const reviewContent = (markdown: string): string =>
  [
    "An Advisor review ran automatically when you finished; you did not request it.",
    "Address any material concern it raises before you finish. If the verdict is sound, finish normally without repeating the review.",
    "",
    markdown,
  ].join("\n");

/**
 * `agent_before_settle` handler: consults the Advisor once per run, before the
 * run settles, so finished work always gets one independent look. A sound
 * verdict only displays; a concerned verdict drafts a custom message and asks
 * for one continuation so the executor can act on it.
 */
export const createSettleReview = (
  registration: SettleReviewRegistration
): SettleReview => {
  const shouldReview = (
    event: AgentBeforeSettleEvent,
    ctx: ExtensionContext
  ) => {
    const { session } = registration;

    return (
      event.outcome === "completed" &&
      !session.settleReviewed &&
      advisorForceSettleReviewRef &&
      !isSimpleMode() &&
      !session.blocked &&
      !session.consultedSinceInput &&
      registration.activeTools().includes("ask_advisor") &&
      advisorModelIsAllowed(ctx) &&
      session.canConsult(getAdvisorMaxCallsPerSession())
    );
  };

  return {
    handle: async (event, ctx) => {
      if (!shouldReview(event, ctx)) {
        return;
      }

      // Armed before the await so a failed review does not retry on the same run.
      registration.session.markSettleReviewed();
      const { consult, herdrActivity, session } = registration;

      const finishHerdrActivity = (
        herdrActivity ?? herdrAdvisorActivity.createScope()
      ).start();

      try {
        session.consumeCall();

        const consulted = await consult(
          ctx,
          SETTLE_REVIEW_QUESTION,
          ctx.signal,
          undefined,
          "settle-review"
        );

        session.resetTurnsSinceConsultation();
        session.recordInvocation({
          cost: advisorUsageCost(consulted.usage),
          executionEffect: "continued",
          kind: "markdown",
          model: consulted.model,
          trigger: "settle-review",
          usage: consulted.usage,
        });
        updateAdvisorUsageStatus(ctx, session);
        const sound = isSoundVerdict(consulted.markdown);

        return {
          // Continue concerns only when executor responses are enabled.
          continue: advisorRequireExecutorResponseRef && !sound,
          entries: [
            {
              content: reviewContent(consulted.markdown),
              customType: SETTLE_REVIEW_RESULT,
              details: {
                advisor: consulted.model,
                agentRulesBytes: consulted.agentRulesBytes,
                text: consulted.markdown,
                usage: consulted.usage,
                verdict: sound ? "sound" : "concern",
              } satisfies SettleReviewResultDetails,
              display: true,
              type: "custom_message",
            },
          ],
        };
      } catch (error) {
        if (!ctx.signal?.aborted) {
          notifyFailureOnce(
            ctx,
            "error",
            error instanceof Error ? error.message : String(error)
          );
        }
      } finally {
        finishHerdrActivity();
      }
    },
    // A new user input starts a fresh run: eligible for exactly one automatic
    // review again, and no longer deduped against an earlier consultation.
    noteUserInput: () => {
      registration.session.beginUserInput();
    },
  };
};

/** Wires the settle-review handlers on an ExtensionAPI-like surface. */
export const registerSettleReview = (
  pi: ExtensionAPI,
  registration: SettleReviewRegistration
): SettleReview => {
  const review = createSettleReview(registration);
  pi.on("input", () => {
    review.noteUserInput();
  });
  pi.on("agent_before_settle", (event, ctx) => review.handle(event, ctx));

  return review;
};
