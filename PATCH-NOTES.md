# Local patches to the pi-managed checkout

This directory is a pi-managed git checkout (`pi` package contains it). A `pi` update can replace tracked files. Anything listed here must be re-applied or re-verified after such an update.

Reapply with:

```bash
cd /home/plugi/.pi/agent/git/github.com/lostofctrl/pi-advisor
git log --oneline -1     # confirm the base before re-applying
bunx tsc --noEmit && bun test && bun run lint && bun run build && bun run package:check
```

## `advisorForceSettleReview` (automatic settle review)

Brings `src/tools/settle-review.ts` and its wiring into 0.14.1.

Files touched:

- `src/tools/settle-review.ts` (new) — `createSettleReview`, `registerSettleReview`, `isSoundVerdict`, `SETTLE_REVIEW_RESULT`.
- `src/tools/registration.ts` — registers the settle review alongside the turn gate.
- `src/tools/register-renderers.ts` — `◆ ADVISOR · SETTLE REVIEW` renderer for `advisor-settle-review-result`.
- `src/session-state.ts` — `settle-review` trigger; `consultedSinceInput` / `settleReviewed` flags with `beginUserInput()`.
- `src/outcomes.ts` — `settle-review` in `OutcomeTrigger` and `OUTCOME_TRIGGERS`.
- `src/config/state.ts`, `src/config/types.ts`, `src/config/schema.ts`, `src/config.ts`, `src/config/defaults.ts` — the `advisorForceSettleReview` setting (default `true`).
- `src/ui/types.ts`, `src/ui/settings-items.ts`, `src/ui/settings-mutations.ts`, `src/commands/settings-persistence.ts` — `/advisor-settings` toggle.
- `src/tools/prompts.ts` — invocation guidance.
- `src/tools/render-common.ts` — `hasSoundVerdict` now also tolerates markdown emphasis, heading and quote wrappers around the verdict (`**Verdict: sound**`, `### Verdict: sound`), and requires the _first non-blank line_ to contain nothing after `sound` (trailing punctuation aside): `Verdict: sound, but X should be checked` is a concern. Only that first line is examined — concerns written in the body under a clean `Verdict: sound` line are still treated as sound, which is why the system prompt forbids the sound verdict whenever uncertainty remains. This is user-visible beyond the settle review: every caller (ask-advisor, turn gate, loop gate, manual consultation) shows `◆ ADVISOR · SOUND` or `◆ ADVISOR RESPONSE` from this one parser, and `src/tools/settle-review.ts` shares it so the displayed headline and the continuation decision cannot disagree.
- `scripts/check-package.mjs`, `test/config-storage.test.ts`, `test/facade-exports.test.ts`, `test/outcome-stats.test.ts` — pinned lists.
- `docs/configuration.md`, `CHANGELOG.md`.

Verification that must hold after re-applying: `advisor-settle-review-result` appears in a real `pi -p` session JSONL, and a review with a non-sound verdict produces exactly one assistant continuation.
