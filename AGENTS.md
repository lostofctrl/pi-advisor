# AGENTS.md — pi-advisor

Pi extension providing an Executor/Advisor flow and optional Herdr integration.

## Stack

| Layer         | Tool                                   |
| ------------- | -------------------------------------- |
| Runtime       | Bun + TypeScript (ESM, strict)         |
| Extension API | `@earendil-works/pi-coding-agent`      |
| UI            | `@earendil-works/pi-tui`               |
| Tests         | `bun test`                             |
| Release       | GitHub Actions manages tags/publishing |

## Development

```bash
bun test
bun run typecheck
bun run lint
bun run format:check
```

## Source organization

- Keep source files under roughly 300 lines where practical; split responsibilities into cohesive modules. Soft guidance, not a gate.

## Rules

- Comment only when 100% needed; never more than one line.
- The `src/*.ts` facades (`config.ts`, `ui.ts`, `tools.ts`, `commands.ts`) are a frozen compatibility surface, pinned by name in `test/facade-exports.test.ts`: no new public symbols without extending that test, no removals or moves without a breaking-release decision.
- MUST read Pi extension docs before changing lifecycle hooks, tool blocking, messages, or renderers.
- Tool-action blocking and session blocking are different controls; never silently escalate one into the other.
- MUST reuse existing Advisor renderers; Advisor output never goes in a raw tool-block reason.
- MUST verify runtime-flow and UI changes in the reloaded TUI; unit tests alone are insufficient.
- Use the right surface: custom message for Advisor activity, tool result for tool outcomes, notification for brief status/errors.
- MUST keep session summaries local and ephemeral; never send them to Herdr or persist them.
- MUST document released user-facing behavior in README and CHANGELOG — delivered outcomes, not internal iterations, reversions, or unreleased defects.
- MUST preserve public and unknown `advisor.json` fields when saving.
- ALL commits MUST follow the Conventional Commits standard (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, ...).
- MUST commit completed, validated increments often; never commit partial or failing work.
- MUST run all checks before reporting completion. MUST NOT push unless asked; MUST NOT create or push release tags — CI manages them from `package.json`.
- If a release fails before npm publication: confirm the version is absent from npm, remove the failed local and remote tag, fix without bumping the version, push, recreate and push the same tag, and re-dispatch the publish workflow. Never substitute an alternate patch version.
- Published npm versions are immutable: never remove, replace, or republish. Corrections require an explicitly approved new semver release.
- MUST document release incidents in `CHANGELOG.md` and this file: failed release identity, observed failure, recovery outcome. Never hide an incident as an internal test-only change.

## Common pitfalls

- Any new Advisor invocation MUST visually match an Executor `ask_advisor` call exactly — call box, streaming state, response renderer, error treatment. A toast or raw tool-block text is not equivalent UI.

## Load when needed

| What | Where | When |
| --- | --- | --- |
| Pi extension API | [Pi extension docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) | Hooks, tools, UI, sessions, messages |
| Herdr protocol | [project guide](docs/herdr.md), [`src/herdr.ts`](src/herdr.ts), and [upstream stable API](https://herdr.dev/docs/socket-api/) | Herdr state/reporting changes |
| Release workflow | [`.github/workflows/publish.yml`](.github/workflows/publish.yml) | Versioning, publishing, tags |
