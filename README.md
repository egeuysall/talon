# Talon

Talon is an autonomous engineering ops teammate.

Most AI developer tools wait for a prompt. Talon clocks in, watches engineering work surfaces, remembers context, chooses a next action, and moves work forward through approved tools.

It is designed for the work senior engineers constantly lose time to: stale PRs, untriaged issues, failing checks, vague Slack alerts, repeated incidents, and forgotten follow-ups.

## What It Does

Talon monitors:

- GitHub issues and pull requests
- CI and repository signals
- Slack intake and outbound updates
- health check URLs
- deployment configuration signals
- its own prior actions and follow-ups

Talon can:

- inspect GitHub work
- comment on issues and PRs
- open GitHub issues
- label issues
- request PR review
- run approved E2B diagnostics
- post Slack updates
- create approval requests for riskier actions
- schedule follow-ups
- log every decision and outcome

The goal is not to spam more notifications. The goal is fewer loose ends.

## Why It Matters

Engineering teams already have tools that show work. They have fewer tools that take responsibility for moving work forward.

Talon is built around a managed agent loop:

```text
perceive -> remember -> decide -> act -> log -> follow up
```

The important product idea is not "an LLM runs every minute." The scheduler is just a heartbeat. The useful part is that Talon watches real work surfaces, uses memory, acts through bounded tools, and asks for approval when risk crosses a boundary.

## Architecture

- **Next.js**: dashboard and operator UI
- **Convex**: durable state, live subscriptions, cron, task queue, episodic memory
- **Clerk**: authenticated dashboard access
- **Gemini 3.5 Flash via Vercel AI SDK**: structured agent decisions
- **E2B**: sandboxed diagnostics through approved runbooks
- **GitHub App**: issue, PR, comment, label, and review workflows
- **Slack**: status updates and optional inbound channel signals
- **Streamdown**: rendering work summaries in the dashboard

## Memory Model

Talon uses three memory layers:

- **Working memory**: current objective and observations
- **Episodic memory**: recent actions, outcomes, tool runs, and decisions
- **Semantic memory**: company context such as runbooks, surfaces, policies, owners, and communication style

It also tracks approvals, follow-ups, repeated failures, and memory insights so the agent can continue work instead of treating each run as a fresh prompt.

## Safety Model

Talon does not treat the model as a security boundary.

The model returns a structured action. Application policy then decides whether the action is allowed, needs approval, or should be blocked.

Default risk split:

- **Low risk, automatic**: monitor, inspect, comment, label, open issue, request review, run approved diagnostics
- **Medium risk, approval required**: open PR, close issue, Slack outbound
- **High risk, approval required**: merge PR, production mutation, delete, dependency upgrade, credential change

This keeps the demo useful without pretending an autonomous agent should blindly mutate production.

## Demo Agent

Use this for the hackathon video:

```text
Agent name: Talon GitHub Operator
Role: Autonomous Engineering Ops Teammate
Task goal: Watch all open GitHub issues and PRs, identify stale or risky work, inspect failing checks, comment clear next steps, label or open issues when useful, run approved diagnostics when safe, prepare PR actions for approval, and schedule follow-ups until each loose end is resolved.
```

## Local Development

Install dependencies:

```bash
bun install
```

Run the app:

```bash
bun dev
```

Run Convex locally or against the configured deployment:

```bash
npx convex dev
```

Open:

```text
http://localhost:3000
```

## Environment Variables

Required for the full demo:

```text
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_JWT_ISSUER_DOMAIN=
GOOGLE_GENERATIVE_AI_API_KEY=
```

Recommended integrations:

```text
E2B_API_KEY=
SLACK_WEBHOOK_URL=
SLACK_BOT_TOKEN=
SLACK_CHANNEL_IDS=
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_APP_INSTALLATION_ID=
HEALTHCHECK_URLS=
```

`HEALTHCHECK_URLS` should be a comma-separated list of URLs.

## Verification

Useful checks:

```bash
bun test src/lib/agent/policy.test.ts
bun run lint
bun run build
npx convex dev --once
```

Current known lint noise: generated Convex files may report unused eslint-disable warnings. Application code should build successfully.

## 3 Minute Demo Structure

### 0:00-0:25: Problem

"Most AI developer tools are copilots. They wait for a prompt. But engineering work does not arrive as prompts. It shows up as stale PRs, failing checks, untriaged issues, Slack pings, and follow-ups nobody owns."

### 0:25-0:50: Product

"Talon is an autonomous engineering ops teammate. It clocks in, watches real work surfaces, remembers context, decides what needs attention, and acts through approved tools."

Show the dashboard: agent status, current objective, task queue, signals, approvals, follow-ups.

### 0:50-1:35: Live Agent Run

Create or select:

```text
Talon GitHub Operator
Autonomous Engineering Ops Teammate
```

Use the task goal from the Demo Agent section.

Click **Create and Start**. The first loop runs immediately.

Narrate:

"It is collecting GitHub, Slack, health, deployment, and memory context. Gemini returns a structured decision. Then policy decides whether the action is safe to run automatically or needs approval."

### 1:35-2:20: Show The Work

Point to:

- signals discovered
- latest outcome
- tool runs
- approval request, if one exists
- follow-up scheduled
- memory/activity timeline

Say:

"This is the part that matters. Talon is not just generating text. It is creating accountable work records: what it saw, what it decided, what it did, what is blocked, and what needs approval."

### 2:20-2:50: Differentiation

"The scheduler is not the product. The product is the managed agent loop: memory, tools, policy, approvals, and follow-up. Low-risk actions can run automatically. Riskier actions, like PRs, issue closure, and merges, go through approval."

### 2:50-3:00: Close

"Talon reduces engineering drag by watching the work surfaces engineers already use and closing loops that usually get forgotten. It is not another chatbot. It is a teammate with memory, tools, and accountability."

## Q&A Talking Points

**Does it use managed agents?**

Yes. Talon runs a managed autonomous loop with memory, scheduling, structured model decisions, policy checks, tool execution, approvals, and follow-ups. It is not a one-shot prompt workflow.

**Why is this useful beyond a hackathon?**

Every engineering team has stale PRs, vague issues, failing checks, and forgotten follow-ups. Talon can reduce that operational drag by continuously watching and moving work forward.

**What makes it creative?**

Most AI dev tools are reactive copilots. Talon is proactive. It combines memory, GitHub workflows, Slack, health checks, sandboxed diagnostics, risk policy, and follow-up tracking into one autonomous teammate.

**How do you keep it safe?**

The model does not get unrestricted execution. It returns a structured action. The app enforces policy. Low-risk actions can run automatically; medium and high-risk actions require approval.

**Why not just use cron or an automation tool?**

Cron only wakes it up. The agent decides what matters, uses memory, chooses actions, handles failures, asks for approval, and schedules follow-up.

**What would you build next?**

GitHub webhooks, richer issue/PR editing, better long-term memory retrieval, PR creation from small safe diffs, owner learning, and event-driven wakeups so it relies less on polling.
