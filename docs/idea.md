**Vercel AI SDK, Gemini 3.5 Flash, Convex, Clerk, E2B, Streamdown, Next.js**

> **Pitch:** "Co-pilots need a human to prompt them. We built a digital employee. It clocks in, remembers everything it has ever done, manages its own priorities, and resolves issues before anyone even notices."
>
> ⭐ Primary targets: **Best managed agents ($5k)** + top 3.

---

## The Idea

A **Digital Employee** that runs a continuous cognitive loop with no human prompting it. It watches your company's tools and infrastructure, thinks using memory of everything it has ever done, writes and executes real fix scripts in a secure sandbox, and reports back like a human teammate would.

The employee can play any operational role depending on how you configure its semantic memory. For the demo, frame it as a general ops employee handling whatever goes wrong: broken services, open GitHub issues nobody assigned, a Slack message that needs a response. It is not an SRE tool, it is a replacement for a human being who sits at a computer and does work.

What makes it feel like a real employee rather than a chatbot is the **Contextual Memory Layer**. Three types of memory get assembled and handed to Gemini 3.5 Flash on every single loop:

- **Working memory**: what it is actively focused on right now (current task queue, live observations)
- **Episodic memory**: a log of everything it has done, why, and what happened (stored in Convex, last 20 entries injected per loop)
- **Semantic memory**: hardcoded institutional knowledge committed to the repo: which services exist, who owns them, what the company's incident policy is, what tools the employee has access to

Gemini reasons like someone who has been at the company for months.

---

## Tech Stack

| Tool                   | Role                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| **Next.js + Tailwind** | Dashboard UI and API routes                                                       |
| **Vercel AI SDK**      | Gemini integration, structured outputs, tool calling                              |
| **Gemini 3.5 Flash**   | The agent brain, fast and cheap, great at structured JSON                         |
| **Convex**             | Episodic memory, task queue, event log, real-time dashboard sync built in         |
| **Clerk**              | One-line auth on the dashboard, looks polished for judges                         |
| **E2B**                | Secure sandboxed code execution, agent writes a fix script and E2B runs it safely |
| **Streamdown**         | Streams Gemini's reasoning live into the dashboard as it thinks                   |
| **Slack webhook**      | Structured work summaries posted after every action                               |

---

## Architecture

```
Agent Loop (Next.js API route, triggered every 30s via Vercel Cron)
    |
    |-- PERCEIVE    Poll health endpoints, GitHub, Slack, any configured source
    |
    |-- REFLECT     Pull episodic memory + task queue from Convex
    |               Assemble full context, send to Gemini 3.5 Flash via Vercel AI SDK
    |               Stream reasoning live via Streamdown
    |
    |-- STRATEGIZE  Gemini returns structured JSON:
    |               updated task queue + next action with type and payload
    |
    |-- EXECUTE     RUN_SCRIPT  -> E2B sandbox, capture stdout
    |               SEND_SLACK  -> Slack webhook, Block Kit message
    |               ESCALATE    -> Slack urgent alert
    |               MONITOR     -> log and continue
    |
    |-- LOG         Write full outcome to Convex episodic memory
                    Convex pushes update to dashboard in real time
```

**Convex tables:**

- `episodic_log` every loop recorded: observations, Gemini decision, outcome
- `task_queue` current priority list (P0/P1/P2), rewritten each loop by Gemini
- `agent_events` raw stream powering the live dashboard feed

---

## The Semantic Memory (company.json)

A single JSON file in the repo injected into every Gemini prompt. Defines the company's services, repos, owners, dependency relationships, criticality levels, what tools the employee can use, and what the escalation policy is. About 50 lines. No database needed for this layer. This is what makes Gemini feel like it has been working at the company for months rather than seeing everything for the first time.

---

## Hour by Hour Plan

### 10:30 to 11:00 | Scaffold

Create the Next.js app with Tailwind, install the full dependency list, set up Clerk with one provider wrap, deploy Convex and define the three tables, write company.json with two fake services and their relationships, add all environment variables.

### 11:00 to 12:00 | Memory and Perception

Write Convex mutations and queries for the episodic log and task queue. Write the perception functions: health endpoint poller and GitHub commits poller. Write the context assembler that pulls episodic memory and task queue from Convex, merges with company.json, and formats everything into the Gemini system prompt.

### 12:00 to 13:00 | Gemini Brain

Use `generateObject` from the Vercel AI SDK with a Zod schema defining the exact response shape: reasoning string, updated task queue array, next action type and payload. Wire the full reflect and strategize step. Gemini reads all three memory layers and returns a structured decision. Write the new task queue back to Convex.

### 13:00 to 13:30 | Lunch

### 13:30 to 14:15 | Execute Layer

Wire E2B: when Gemini returns RUN_SCRIPT, spin up a sandbox, run the generated bash command, capture stdout and stderr, close the sandbox, write the result to the episodic log. Wire Slack: when Gemini returns SEND_SLACK or ESCALATE, post a structured Block Kit message covering what was detected, what was done, and what the outcome was including Gemini's reasoning.

### 14:15 to 15:15 | Dashboard UI

Four panel layout, all data from Convex real-time subscriptions so it updates itself with no polling code needed. Task queue panel with P0 in red, P1 in amber, P2 in gray. Episodic memory feed as a scrolling log. Reasoning stream via Streamdown rendering Gemini's live thinking in markdown. Last execution panel showing E2B stdout from the most recent script run. Clerk handles the login gate with one hook.

### 15:15 to 16:00 | Demo Setup and Controllable Fake Infrastructure

Build the controllable fake service as a Next.js API route that returns healthy or broken based on a Convex flag. Build a hidden admin button that flips the flag. Wire Gemini's system prompt so it knows exactly what script to run when that service breaks. Run a full end to end test and make sure the whole loop completes in under 30 seconds.

### 16:00 to 16:30 | Rehearse and Polish

Two full hands-free runs timed under 3 minutes. Make the P0 alert state visually dramatic in the dashboard. Clean up layout spacing. Lock the pitch lines.

### 16:30 to 17:00 | Record and Submit

1 minute Loom showing the idle agent, the break trigger, the detection, the reasoning stream, E2B execution, Slack post, and resolution. Submit with public repo and live demo link before the 17:00 hard cutoff.

---

## The Demo Moment

1. Dashboard open on screen, agent idle, task queue empty, memory feed showing recent routine checks
2. You click one button or run one command offscreen. Say nothing.
3. Within 30 seconds a P0 task appears in the queue. The reasoning stream starts flowing: "Service is returning errors. Checking episodic memory for similar past incidents. Last occurrence was 2 hours ago and was resolved by restarting the connection pool. Attempting the same fix."
4. E2B sandbox spins up, script runs, stdout confirms recovery
5. Slack channel receives a formatted incident report
6. Task queue clears. Agent logs the resolution. Continues monitoring.
7. You have not touched the keyboard since step 2.

---

## Pitch Structure (3 minutes)

- **0:00** "Every AI tool today is a co-pilot. You still have to drive." Demo already running on screen.
- **0:20** Trigger the break silently. "I just broke a production service. I am not going to touch anything else."
- **0:40** Walk through the dashboard as the agent reacts live.
- **1:30** E2B script runs. Slack message appears. Service recovers.
- **2:00** "It read its own history, understood the system, prioritised correctly, fixed it, and reported to the team. Zero human prompts."
- **2:20** One architecture slide showing the three memory layers and the cognitive loop.
- **2:50** Questions.

---

## Shortcuts If You Fall Behind

| Cut this               | Replace with                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| Vercel Cron            | `setInterval` in a long-running API route                         |
| GitHub polling         | Static JSON of fake recent commits with one intentionally bad one |
| Two services           | One service is enough for the demo                                |
| E2B                    | `child_process.exec` in a Next.js API route                       |
| Streamdown live stream | Static display of last Gemini response                            |

---

## Why This Wins

| Criterion                | Angle                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Impact (20%)**         | Replaces a human operational employee entirely. Not a tool, not an assistant. A hire.                                  |
| **Live Demo (45%)**      | Self-resolves on stage with zero keyboard input. Real E2B execution, real Slack post, real dashboard update.           |
| **Creativity (35%)**     | Three-layer memory architecture making autonomous decisions is genuinely novel. Not a chatbot, not RAG, not a wrapper. |
| **Managed agents ($5k)** | Autonomous, persistent memory, multi-step reasoning, self-correcting execution loop. Canonical definition.             |
