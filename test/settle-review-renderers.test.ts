import { describe, expect, test } from "bun:test";

import { initTheme } from "@earendil-works/pi-coding-agent";

import { setShowUsageDetailsRef } from "../src/config/state.ts";
import { registerToolRenderers } from "../src/tools/register-renderers.ts";
import { mockPi } from "./helpers/mock-pi.ts";
import { plainThemeMock } from "./helpers/theme.ts";

initTheme();

const ESC = String.fromCodePoint(27);
const SGR_CODE = new RegExp(`${ESC}\\[[0-9;]*m`, "gu");

const CUSTOM_TYPE = "advisor-settle-review-result";

interface SettleReviewMessage {
  content: string;
  customType: string;
  details?: {
    advisor?: string;
    text?: string;
    usage?: unknown;
    verdict?: "sound" | "concern";
  };
}

const renderResult = (message: SettleReviewMessage) => {
  const messageRenderers = new Map<string, any>();
  registerToolRenderers(mockPi({ messageRenderers }));
  const renderer = messageRenderers.get(CUSTOM_TYPE);
  expect(renderer).toBeDefined();

  return renderer(message, { expanded: false }, plainThemeMock)
    .render(100)
    .map((line: string) => line.replace(SGR_CODE, ""))
    .join("\n");
};

describe("settle-review renderer", () => {
  test("is registered for the settle-review result type", () => {
    const messageRenderers = new Map<string, any>();
    registerToolRenderers(mockPi({ messageRenderers }));
    expect(messageRenderers.has(CUSTOM_TYPE)).toBe(true);
  });

  test("shows the settle-review header, advisor, usage, and advice", () => {
    setShowUsageDetailsRef(true);

    const output = renderResult({
      content: "Verdict: sound\n\nNothing material.",
      customType: CUSTOM_TYPE,
      details: {
        advisor: "test/advisor",
        text: "Verdict: sound\n\nNothing material.",
        usage: { cost: { total: 0.01 }, input: 1000, output: 100 },
        verdict: "sound",
      },
    });

    expect(output).toContain("ADVISOR · SETTLE REVIEW");
    expect(output).toContain("test/advisor");
    expect(output).toContain("Usage:");
    expect(output).toContain("Nothing material.");
  });

  test("falls back to the message content when no advice text exists", () => {
    const output = renderResult({
      content: "Advisor settle review failed (network); settling.",
      customType: CUSTOM_TYPE,
      details: { verdict: "concern" },
    });

    expect(output).toContain("settling");
  });
});
