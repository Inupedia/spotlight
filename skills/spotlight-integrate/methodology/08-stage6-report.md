# Stage 6 — Integration report

Write `.spotlight-integrate/INTEGRATION_REPORT.md`. This is the final acceptance artifact for the host app.

## Required sections

```md
# Spotlight integration report

## Compatibility

- status: READY | UPGRADE_REQUIRED | BUILD_MIGRATION_REQUIRED | UNSUPPORTED_AUTOMATION
- host versions: ...
- Spotlight version: ...
- blockers: ...

## Capability coverage

| class | discovered | wrapped | remaining |
| DIRECT | | | |
| REFACTOR | | | |
| GATED | | | |
| REJECT | | | |

Discovery coverage: X/Y
Direct exposure coverage: X/Y

## Generated adapter

- Client Tools: N
- Skills: N (+ skill.knowledge)
- uiContext fields: ...
- projectId: ...

## Static integrity

- tool/allowlist alignment: PASS/FAIL
- projectId alignment: PASS/FAIL
- JSDoc/schema/safety metadata: PASS/FAIL
- build/typecheck/test: PASS/FAIL/BLOCKED

## Runtime lifecycle

- initialize/thread/turn: PASS/FAIL/BLOCKED
- SSE resume/order: PASS/FAIL/BLOCKED
- host Tool acknowledgement + trace: PASS/FAIL/BLOCKED
- post-action UI context: PASS/FAIL/BLOCKED

## Live benchmark

- status: RUN / NOT RUN
- target model: ...
- Route Accuracy: ...
- Skill Accuracy: ...
- Tool Accuracy: ...
- Argument Accuracy: ...
- E2E Success Rate: ...
- Clarification Accuracy: ...
- Unsafe Execution Rate: ...
- dev/prod repeated parity: PASS/FAIL/BLOCKED
- Server version/image + frontend build id + model id: ...

## Safety / gated capabilities

- ...

## Leftovers

- REFACTOR: ...
- GATED: ...
- blockers: ...

## Runbook

- env keys: ...
- boot order: ...
- smoke command/prompts: ...
- rollback procedure: ...
```

## Percentage rules

- Do not combine `GATED`/`REJECT` with missing implementation and call the result “incomplete”. They are deliberate architecture classes.
- Do not use a single completion percentage when compatibility, static wiring, and runtime benchmark status differ.
- If runtime was not executed, leave accuracy metrics `N/A` and state the exact reason.

## Final message to user

Summarize the report, not just changed files. The user should know whether the host is:

1. statically agent-ready;
2. runnable with current dependencies;
3. live-benchmark validated;
4. carrying intentional refactor/gated leftovers.
