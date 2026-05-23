# Talon Autonomous Employee MVP Technical Plan

## Summary

Build Talon from `docs/idea.md` and `docs/hour.md` as a real autonomous digital employee, not a triggered demo. The MVP clocks in on a schedule, pulls live company context, maintains working/episodic/semantic memory, decides priorities with Gemini 3.5 Flash, executes approved work through secure tools, reports outcomes, and keeps running without a human prompt.

The first employee role should be “Ops Generalist”: it watches GitHub, deployments/health, Slack intake, and prior history; then it triages, fixes, reports, or escalates. The demo should show a real loop already running, not a user-triggered incident.

References: [Google Gemini 3.5](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-5/), [Google I/O developer highlights](https://blog.google/innovation-and-ai/technology/developers-tools/google-io-2026-developer-highlights/), [AI SDK Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai), [E2B JS docs](https://e2b.dev/docs/code-interpreting/supported-languages/javascript).

## Architecture

Use Convex as the employee’s durable brain and scheduler, not just a dashboard store.

- Convex cron runs the employee loop every 60 seconds through `convex/crons.ts`.
- Convex internal actions perform perception, reasoning, execution, and logging.
- Next.js only renders the dashboard and authenticated operator surfaces.
- Gemini 3.5 Flash is the decision engine through Vercel AI SDK / Google provider.
- E2B runs diagnostics and bounded remediation scripts in an isolated sandbox.
- Slack and GitHub are real work outputs: reports, comments, issue creation, assignment suggestions, and escalation.
- Clerk gates the dashboard; Convex auth uses Clerk JWTs so user-specific admin actions are authorized.

Core loop:

```text
CLOCK IN
  Convex cron invokes internal.agentLoop.run

PERCEIVE
  Pull GitHub issues/PRs/checks, Vercel/deployment health, Slack intake, and app health URLs

REMEMBER
  Load current task queue, last 20 episodic logs, active incidents, semantic company memory

REASON
  Gemini 3.5 Flash returns structured plan, updated queue, and one next action

ACT
  Execute through approved tools only: E2B runbook, Slack post, GitHub comment/issue, escalation, monitor

LEARN
  Store observation, reasoning summary, action, result, errors, and next focus in Convex

REPEAT
  Cron runs again without human input
```

## Implementation Changes

### Foundation And Dependencies

Install:

```bash
bun add ai @ai-sdk/google zod streamdown @e2b/code-interpreter @clerk/ui @clerk/themes
```

Use env vars:

```text
GOOGLE_GENERATIVE_AI_API_KEY
E2B_API_KEY
SLACK_WEBHOOK_URL
GITHUB_TOKEN
GITHUB_REPO_OWNER
GITHUB_REPO_NAME
VERCEL_OIDC_TOKEN
NEXT_PUBLIC_CONVEX_URL
```

Do not print or expose secret env vars. Client code only reads `NEXT_PUBLIC_*`.

### Convex Data Model

Create `convex/schema.ts` with these tables:

- `employeeState`: one row per employee with `employeeId`, `status`, `currentFocus`, `lastLoopStartedAt`, `lastLoopFinishedAt`, `lastError`, `autonomyMode`.
- `workingMemory`: compact current context with `employeeId`, `activeObjective`, `currentObservations`, `updatedAt`.
- `episodicLogs`: append-only memory with `employeeId`, `loopId`, `observations`, `reasoningSummary`, `action`, `outcome`, `createdAt`.
- `tasks`: durable queue with `employeeId`, `priority`, `title`, `status`, `source`, `rationale`, `createdAt`, `updatedAt`.
- `toolRuns`: execution records with `tool`, `inputSummary`, `stdout`, `stderr`, `status`, `durationMs`, `createdAt`.
- `signals`: normalized live inputs from GitHub, Slack, Vercel, and health checks.
- `semanticMemory`: company knowledge records with `kind`, `key`, `content`, `updatedAt`.

Indexes:

- `employeeState.by_employeeId`
- `episodicLogs.by_employeeId_and_createdAt`
- `tasks.by_employeeId_and_status`
- `signals.by_source_and_createdAt`
- `toolRuns.by_createdAt`
- `semanticMemory.by_kind_and_key`

All Convex functions must use validators, bounded queries, internal functions for private agent operations, and Clerk-backed auth for public dashboard/admin functions.

### Semantic Memory

Create `src/lib/company/semantic-memory.ts` as the seed source, then write it into Convex on setup.

Include real operating context:

- Company mission and role: “Talon is an autonomous ops employee.”
- Repos to watch, owners, deployment surfaces, escalation channels.
- Runbooks with IDs, preconditions, allowed inputs, and expected outputs.
- Tool policy: what the employee may do automatically vs. what requires escalation.
- Communication style: concise, accountable, outcome-first.

Example runbook policy:

```ts
{
  id: "diagnose_failed_ci",
  allowedAutonomous: true,
  tool: "E2B",
  description: "Fetch failing GitHub check logs, summarize root cause, propose or comment next step.",
}
```

Do not let Gemini invent arbitrary shell commands. Gemini selects approved runbook IDs and arguments.

### Perception Layer

Create `convex/perception.ts` with internal actions:

- `collectGitHubSignals`: fetch open issues, assigned issues, recent PRs, failing checks, stale requested reviews.
- `collectDeploymentSignals`: fetch Vercel project/deployment status and configured health URLs.
- `collectSlackSignals`: optional Slack webhook/event intake for messages mentioning the employee or alert channel summaries.
- `normalizeSignals`: convert raw provider responses into durable `signals`.

For MVP, require GitHub and health URLs. Vercel and Slack are enabled when env vars are present. Missing optional integrations should produce a `signals` row saying the source is unconfigured, not crash the loop.

### Gemini Reasoning

Create `convex/agentLoop.ts` as the orchestrator and `src/lib/agent/decision-schema.ts` for shared schemas.

Use Gemini 3.5 Flash as the model constant:

```ts
export const TALON_MODEL = "gemini-3.5-flash";
```

Structured decision schema:

```ts
{
  reasoningSummary: string,
  updatedWorkingMemory: {
    activeObjective: string,
    currentObservations: string[]
  },
  tasks: Array<{
    priority: "P0" | "P1" | "P2",
    title: string,
    status: "queued" | "in_progress" | "blocked" | "done",
    source: "github" | "deployment" | "slack" | "health" | "self"
  }>,
  nextAction:
    | { type: "RUN_RUNBOOK", runbookId: string, args: Record<string, string> }
    | { type: "COMMENT_GITHUB", issueOrPrNumber: number, body: string }
    | { type: "SEND_SLACK", channel: string, message: string }
    | { type: "ESCALATE", reason: string, recommendedOwner: string }
    | { type: "MONITOR", note: string }
}
```

Prompt assembly must include:

- Employee identity and autonomy mandate.
- Current working memory.
- Last 20 episodic logs.
- Active tasks.
- New signals since last loop.
- Semantic memory and runbook catalog.
- Safety policy: use approved tools, avoid destructive actions, escalate on uncertainty.

### Execution Layer

Create `convex/tools.ts` with internal actions for tool execution.

Runbook execution:

- `RUN_RUNBOOK` uses E2B for diagnostics and non-destructive remediation.
- Scripts are selected by runbook ID from local code, not generated raw by Gemini.
- Each tool run writes `toolRuns` with status, stdout, stderr, duration, and linked `loopId`.

GitHub execution:

- `COMMENT_GITHUB` posts a real GitHub issue/PR comment.
- Future extension can open PRs, but MVP should not write code autonomously unless explicitly approved.

Slack execution:

- `SEND_SLACK` posts a real structured message.
- `ESCALATE` posts a higher-urgency message with owner, context, and why autonomy stopped.

Autonomy boundary:

- Safe actions run automatically: monitoring, issue comments, Slack status reports, diagnostics.
- Risky actions escalate: production mutations, credential changes, deletes, dependency upgrades, PR merges.
- This keeps the “employee replacement” claim credible without pretending unsafe write access is acceptable.

### Scheduling

Create `convex/crons.ts`:

- Run `internal.agentLoop.run` every 1 minute with `crons.interval`.
- Add a second slower `collectDeepContext` job every 10 minutes for slower sources like repo inventory or stale issue review.

Create public dashboard mutations:

- `pauseEmployee`
- `resumeEmployee`
- `setAutonomyMode`
- `seedSemanticMemory`

These are operator controls, not demo triggers. The normal path is autonomous clock-in.

### Dashboard

Replace starter page with an authenticated employee console.

Views:

- Header: employee name, autonomy mode, loop status, last clock-in, `UserButton`.
- Current Focus: active objective and latest reasoning summary.
- Task Queue: P0/P1/P2 queue with source and status.
- Signals Feed: live GitHub/deployment/Slack/health observations.
- Episodic Memory: chronological “shift history.”
- Tool Runs: E2B/GitHub/Slack actions and results.
- Control Strip: pause/resume, run one loop now for debugging, seed memory.

The “run one loop now” button is for development and judging fallback only; the pitch should show the cron-created history proving the employee acts without prompts.

Use Streamdown to render reasoning summaries and event reports. Do not stream private chain-of-thought; show concise work summaries.

## End-To-End Demo Plan

Before judging, seed semantic memory and let the employee run for several loops.

Demo story:

1. Open dashboard showing Talon already clocked in and monitoring.
2. Show recent episodic logs: it checked repo health, reviewed issues, and updated its own task queue.
3. A real signal appears from GitHub, healthcheck, failed deployment, or Slack alert.
4. Talon prioritizes it as P0/P1 without a prompt.
5. Gemini 3.5 Flash explains the decision in a work-summary format.
6. Talon runs an approved E2B diagnostic runbook or comments on the GitHub issue.
7. Talon posts a Slack update with context, action taken, and next step.
8. Dashboard updates in real time from Convex.

For local reliability, use a real GitHub issue labeled `talon-test` or a real healthcheck URL returning a controlled failure from an external service. Do not use a hidden in-app break trigger as the main demo mechanic.

## Test Plan

Run static checks:

```bash
bun lint
bun run build
npx convex dev --once
```

Manual integration checks:

- Clerk sign-in works and unauthenticated dashboard access redirects to `/sign-in`.
- Convex auth returns a non-null identity in public dashboard mutations.
- Cron inserts loop records without pressing any UI button.
- GitHub signal collection reads live repo data.
- Healthcheck signal collection records reachable and failing URLs.
- Gemini returns schema-valid actions with `gemini-3.5-flash`.
- E2B runbook execution writes `toolRuns`.
- Slack posts are sent when `SLACK_WEBHOOK_URL` exists and logged as skipped when missing.
- Dashboard updates via Convex subscriptions without polling.

Security checks:

- No secret env vars in client bundle.
- Public mutations derive user identity from Clerk, never from client-passed user IDs.
- Gemini cannot execute arbitrary shell.
- Destructive or high-risk actions become `ESCALATE`, not automatic execution.
- All external provider failures are logged and do not stop future cron loops.

Acceptance criteria:

- The employee completes at least 5 autonomous loops in a row.
- Each loop creates or updates working memory, episodic memory, and task queue.
- At least one real external signal changes task priority.
- At least one approved tool action executes and is logged.
- The dashboard can explain what Talon saw, why it acted, what it did, and what it will watch next.
- The demo can be presented as “it clocks in and works without prompts,” with evidence in Convex history.

## Assumptions

- MVP employee role is “Ops Generalist” because it best matches `docs/idea.md`: broken services, open GitHub issues, Slack messages, and operational reporting.
- Real integrations should be GitHub plus health URLs first; Vercel and Slack add polish when credentials are available.
- Gemini 3.5 Flash is mandatory for the Google I/O framing.
- Convex cron is the primary autonomy mechanism; Next.js route triggers are secondary debugging controls.
- The MVP replaces a narrow operational employee workflow, not every human job function on day one.
