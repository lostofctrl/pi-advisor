import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type {
  AgentBeforeSettleEvent,
  BoundaryResult,
} from "@earendil-works/pi-coding-agent";

import {
  setAdvisorForceSettleReviewRef,
  setAdvisorMaxCallsPerSessionRef,
  setSimpleModeRef,
} from "../src/config/state.ts";
import { resetConfigCache } from "../src/config/storage.ts";
import { AdvisorSessionState } from "../src/session-state.ts";
import { hasSoundVerdict } from "../src/tools/render-common.ts";
import type { SettleReviewRegistration } from "../src/tools/settle-review.ts";
import {
  createSettleReview,
  isSoundVerdict,
  resetSettleReviewNotification,
} from "../src/tools/settle-review.ts";
import type { AdvisorConsultationResult } from "../src/tools/types.ts";
import { asExtensionContext } from "./helpers/extension-context.ts";

interface Harness {
  consultedTriggers: string[];
  registration: SettleReviewRegistration;
  session: AdvisorSessionState;
}

const harness = (
  options: {
    activeTools?: () => string[];
    consultResult?: () => Promise<AdvisorConsultationResult>;
    questions?: (string | undefined)[];
  } = {}
): Harness => {
  const session = new AdvisorSessionState();
  const consultedTriggers: string[] = [];

  const registration: SettleReviewRegistration = {
    activeTools: options.activeTools ?? (() => ["ask_advisor"]),
    consult: async (_ctx, question, _signal, _onChunk, trigger) => {
      consultedTriggers.push(trigger ?? "");
      options.questions?.push(question);

      return (
        (await options.consultResult?.()) ?? {
          adviceId: "id",
          markdown: "Verdict: sound\n\nNothing material.",
          model: "test/advisor",
          thinkingText: "",
          trigger: "settle-review" as const,
          usage: { cost: { total: 0.081 }, input: 5000, output: 900 },
        }
      );
    },
    session,
  };

  return { consultedTriggers, registration, session };
};

const ctxWith = (notifications: string[] = []) =>
  asExtensionContext({
    cwd: "/",
    hasUI: true,
    signal: new AbortController().signal,
    ui: {
      notify: (message: string) => notifications.push(message),
      setStatus: () => {},
    },
  });

/** Narrows the handler's drafted entry to the custom message it always adds. */
const settleReviewDetails = (result: BoundaryResult | undefined) => {
  const [entry] = result?.entries ?? [];

  if (entry?.type !== "custom_message") {
    return;
  }

  // SAFETY: the settle-review handler always sets this details shape.
  const details = entry.details as { verdict?: string };

  return { ...entry, verdict: details.verdict };
};

const settleEvent = (
  outcome: AgentBeforeSettleEvent["outcome"] = "completed"
) =>
  // SAFETY: mock supplies the BoundaryState subset the handler consumes.
  ({ outcome, type: "agent_before_settle" }) as AgentBeforeSettleEvent;

beforeEach(() => {
  setAdvisorForceSettleReviewRef(true);
  resetSettleReviewNotification();
});

afterEach(() => {
  setAdvisorForceSettleReviewRef(true);
  setAdvisorMaxCallsPerSessionRef(undefined);
  setSimpleModeRef(false);
  resetConfigCache();
});

describe("isSoundVerdict", () => {
  test("reads the first non-empty line, skipping leading blanks and whitespace", () => {
    expect(isSoundVerdict("Verdict: sound")).toBe(true);
    expect(isSoundVerdict("\nVerdict: sound")).toBe(true);
    expect(isSoundVerdict("\n\n  Verdict: sound\nDetails")).toBe(true);
    expect(isSoundVerdict("   Verdict: sound")).toBe(true);
  });

  test("tolerates emphasis, heading and quote wrappers, and trailing punctuation", () => {
    expect(isSoundVerdict("**Verdict: sound**")).toBe(true);
    expect(isSoundVerdict("### Verdict: sound")).toBe(true);
    expect(isSoundVerdict("**Verdict: sound.**")).toBe(true);
    expect(isSoundVerdict("verdict: SOUND")).toBe(true);
  });

  test("treats any text after the verdict as a concern", () => {
    expect(isSoundVerdict("Verdict: sound, but X should be checked")).toBe(
      false
    );
    expect(isSoundVerdict("Verdict: sound — nothing material")).toBe(false);
  });

  test("rejects near-miss and empty verdicts", () => {
    expect(isSoundVerdict("Verdict: soundness unclear")).toBe(false);
    expect(isSoundVerdict("Verdict: revise the retry logic")).toBe(false);
    expect(isSoundVerdict("**Verdict: minor uncertainty**")).toBe(false);
    expect(isSoundVerdict("")).toBe(false);
  });

  test("agrees with the shared renderer verdict parser", () => {
    const samples = [
      "Verdict: sound",
      "**Verdict: sound**",
      "### Verdict: sound",
      "\n\n  Verdict: sound\nDetails",
      "verdict: SOUND",
      "Verdict: sound, but X should be checked",
      "Verdict: sound — nothing material",
      "Verdict: soundness unclear",
      "**Verdict: minor uncertainty**",
      "",
    ];

    for (const sample of samples) {
      expect(isSoundVerdict(sample)).toBe(hasSoundVerdict(sample));
    }
  });
});

describe("settle review", () => {
  test("consults once before settling and continues when the verdict is unsound", async () => {
    const questions: (string | undefined)[] = [];

    const h = harness({
      consultResult: () =>
        Promise.resolve({
          adviceId: "id",
          markdown: "Verdict: revise\n\nThe retry path is untested.",
          model: "test/advisor",
          thinkingText: "",
          trigger: "settle-review",
        }),
      questions,
    });

    const review = createSettleReview(h.registration);

    const result = await review.handle(settleEvent(), ctxWith());

    expect(h.consultedTriggers).toEqual(["settle-review"]);
    expect(questions[0]).toContain(
      "Review the work the executor just finished"
    );
    expect(result?.continue).toBe(true);
    expect(result?.entries).toHaveLength(1);
    const details = settleReviewDetails(result);
    expect(details?.customType).toBe("advisor-settle-review-result");
    expect(details?.display).toBe(true);
    expect(details?.verdict).toBe("concern");
    expect(h.session.consultedSinceInput).toBe(true);
  });

  test("displays a sound verdict without continuing", async () => {
    const h = harness();
    const review = createSettleReview(h.registration);

    const result = await review.handle(settleEvent(), ctxWith());

    expect(result?.continue).toBe(false);
    expect(settleReviewDetails(result)?.verdict).toBe("sound");
  });

  test("armed before the await, so a repeated call during a review is ignored", async () => {
    let release: (() => void) | undefined;

    const h = harness({
      consultResult: () =>
        new Promise<AdvisorConsultationResult>((resolve) => {
          release = () =>
            resolve({
              adviceId: "id",
              markdown: "Verdict: revise\n\nUntested path.",
              model: "test/advisor",
              thinkingText: "",
              trigger: "settle-review",
            });
        }),
    });

    const review = createSettleReview(h.registration);

    const inFlight = review.handle(settleEvent(), ctxWith());

    // Settle fires again while the first review is still running.
    const concurrent = await review.handle(settleEvent(), ctxWith());

    expect(concurrent).toBeUndefined();

    release?.();

    const settled = await inFlight;

    expect(settled?.continue).toBe(true);
    expect(h.consultedTriggers).toHaveLength(1);
  });

  test("reviews at most once per run", async () => {
    const h = harness();
    const review = createSettleReview(h.registration);

    await review.handle(settleEvent(), ctxWith());
    const second = await review.handle(settleEvent(), ctxWith());

    expect(second).toBeUndefined();
    expect(h.consultedTriggers).toHaveLength(1);
  });

  test("a concern continues once and never again on the same run", async () => {
    // A trailing caveat is a concern under the strict verdict rule, so this is
    // the exact shape that could otherwise re-trigger on every settle attempt.
    const h = harness({
      consultResult: () =>
        Promise.resolve({
          adviceId: "id",
          markdown: "Verdict: sound, but X should be checked",
          model: "test/advisor",
          thinkingText: "",
          trigger: "settle-review",
        }),
    });

    const review = createSettleReview(h.registration);

    const first = await review.handle(settleEvent(), ctxWith());
    const second = await review.handle(settleEvent(), ctxWith());
    const third = await review.handle(settleEvent(), ctxWith());

    expect(first?.continue).toBe(true);
    expect(settleReviewDetails(first)?.verdict).toBe("concern");
    expect(second).toBeUndefined();
    expect(third).toBeUndefined();
    expect(h.consultedTriggers).toHaveLength(1);
  });

  test("noteUserInput re-arms exactly one review for the next run", async () => {
    const h = harness();
    const review = createSettleReview(h.registration);

    await review.handle(settleEvent(), ctxWith());
    review.noteUserInput();
    await review.handle(settleEvent(), ctxWith());

    expect(h.consultedTriggers).toHaveLength(2);
  });

  test("skips when the executor already consulted since the last input", async () => {
    const h = harness();
    h.session.recordInvocation({
      executionEffect: "continued",
      kind: "markdown",
      model: "test/advisor",
      trigger: "executor-requested",
    });
    const review = createSettleReview(h.registration);

    expect(await review.handle(settleEvent(), ctxWith())).toBeUndefined();
    expect(h.consultedTriggers).toEqual([]);
  });

  test("still reviews after the executor ran a gate rather than a review", async () => {
    const h = harness();
    h.session.recordInvocation({
      decision: "proceed",
      executionEffect: "continued",
      kind: "gate",
      model: "test/advisor",
      trigger: "repeated-tool-call",
    });
    const review = createSettleReview(h.registration);

    expect(await review.handle(settleEvent(), ctxWith())).toBeDefined();
  });

  test("skips when disabled, inactive, blocked, simple, aborted, or out of budget", async () => {
    const cases: [string, () => Harness, (h: Harness) => void][] = [
      [
        "disabled",
        () => harness(),
        () => setAdvisorForceSettleReviewRef(false),
      ],
      [
        "inactive tool",
        () => harness({ activeTools: () => [] }),
        () => undefined,
      ],
      [
        "blocked session",
        () => harness(),
        (h) => h.session.block("Advisor blocked the session."),
      ],
      ["simple mode", () => harness(), () => setSimpleModeRef(true)],
      [
        "exhausted budget",
        () => harness(),
        (h) => {
          setAdvisorMaxCallsPerSessionRef(1);
          h.session.consumeCall();
        },
      ],
    ];

    for (const [_name, build, arrange] of cases) {
      const h = build();
      arrange(h);
      const review = createSettleReview(h.registration);
      expect(await review.handle(settleEvent(), ctxWith())).toBeUndefined();
      expect(h.consultedTriggers).toEqual([]);
    }
  });

  test("reviews only completed runs, not aborted or errored ones", async () => {
    const h = harness();
    const review = createSettleReview(h.registration);

    expect(
      await review.handle(settleEvent("aborted"), ctxWith())
    ).toBeUndefined();
    expect(h.consultedTriggers).toEqual([]);
    expect(
      await review.handle(settleEvent("error"), ctxWith())
    ).toBeUndefined();
    expect(h.consultedTriggers).toEqual([]);
  });

  test("records the invocation against the settle-review trigger", async () => {
    const h = harness();
    const review = createSettleReview(h.registration);

    await review.handle(settleEvent(), ctxWith());

    expect(h.session.usageTotals.calls).toBe(1);
    expect(h.session.summary(5)).toContain("settle-review");
  });

  test("notifies once and settles on a failed consultation", async () => {
    const notifications: string[] = [];

    const h = harness({
      consultResult: () => Promise.reject(new Error("provider exploded")),
    });

    const review = createSettleReview(h.registration);

    const result = await review.handle(settleEvent(), ctxWith(notifications));

    expect(result).toBeUndefined();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("provider exploded");
  });
});
