Okay, solo with a fresh scaffold and ~6 hours left. Here's the full plan, ordered to protect the demo moment above everything else.

---

## The Golden Rule

Build the loop first, UI second. A working agent with an ugly dashboard beats a beautiful dashboard with a broken agent.

---

## Phase 1 — Foundation (11:00–12:00)

**Convex schema first** (`convex/schema.ts`). Three tables:

```ts
episodic_log: {
  (timestamp, observations, reasoning, action, outcome);
}
task_queue: {
  (priority, title, status, createdAt);
}
agent_status: {
  (isRunning, lastRun, currentThought);
}
```

Then write the mutations and queries you'll call from the agent:

- `insertLog(entry)` — append to episodic log
- `upsertTaskQueue(tasks[])` — Gemini rewrites the whole queue each loop
- `getLast20Logs()` — fed into every Gemini prompt
- `setAgentStatus(thought)` — powers the live reasoning display

Also create `lib/company.json` — one fake company, two fake services (`auth-service`, `payments-service`), one owner per service, one escalation policy. This is what makes Gemini feel like a real employee rather than a fresh context window every loop.

---

## Phase 2 — The Agent Loop (12:00–13:15)

One API route: `app/api/agent/loop/route.ts`

The loop does five things in sequence:

**PERCEIVE** — poll your fake service endpoint and return an observations string. Keep it simple: `"auth-service: healthy. payments-service: returning 500."`

**REFLECT** — pull the last 20 episodic log entries from Convex + current task queue, merge with `company.json`, and assemble the full Gemini system prompt. This is the memory layer. The prompt should feel like a briefing: _"You are an ops employee at Acme. Here is what you know about the company. Here is everything you have done in the last 20 shifts. Here is what you are currently watching."_

**STRATEGIZE** — call Gemini via `generateObject` with a Zod schema:

```ts
z.object({
  reasoning: z.string(),
  tasks: z.array(
    z.object({ priority: z.enum(["P0", "P1", "P2"]), title: z.string() }),
  ),
  action: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("RUN_SCRIPT"),
      script: z.string(),
      rationale: z.string(),
    }),
    z.object({ type: z.literal("SEND_SLACK"), message: z.string() }),
    z.object({ type: z.literal("MONITOR"), note: z.string() }),
  ]),
});
```

**EXECUTE** — branch on action type. For `RUN_SCRIPT`, call E2B. If E2B causes friction, swap to a fake executor that returns `"exit 0: connection pool restarted"` — don't lose 30 minutes here. For `SEND_SLACK`, hit your webhook.

**LOG** — write everything to Convex. The Convex real-time subscription in the UI picks it up automatically — no polling needed.

---

## Phase 3 — Fake Infrastructure (13:15–13:45)

Two routes:

- `app/api/fake-service/route.ts` — reads a Convex flag, returns `{ status: "healthy" }` or `{ status: "error", code: 500 }`
- `app/api/admin/break/route.ts` — flips the flag

The agent's perception step polls the first route. Your hidden demo trigger calls the second. This is the entire demo mechanic — it needs to be bulletproof.

Also hardcode in `company.json` exactly what Gemini should do when `payments-service` breaks: _"Run: curl -X POST internal.acme.com/payments/restart-pool"_. Gemini will feel eerily specific because you told it to be.

---

## Phase 4 — Lunch (13:45–14:15)

Actual break. Don't skip it.

---

## Phase 5 — Dashboard UI (14:15–15:30)

Four panels, all driven by Convex `useQuery` hooks so they update themselves:

**Left column (narrower):**

- Task queue — P0 in red with a pulsing dot, P1 amber, P2 gray. This is the dramatic visual judges remember.
- Agent status pill — "Monitoring" / "Thinking" / "Executing"

**Right column (wider):**

- Live reasoning stream — Gemini's `reasoning` string from the last loop, displayed in a scrolling card. Label it _"What the employee is thinking"_
- Episodic memory feed — scrolling log of past actions with timestamps. Label it _"Shift history"_
- Last execution output — E2B stdout or the fake output string

Clerk's `<UserButton />` in the top right. One login gate. Looks polished, takes 5 minutes.

Don't over-design. Dark background, clean monospace font for the logs, big red P0 badge. That's enough.

---

## Phase 6 — End-to-End Test (15:30–16:15)

Run the full loop manually first. Then run it 3 times consecutively. You're checking:

- Loop completes in under 30 seconds
- Convex updates reach the UI in real time
- The break trigger reliably produces a P0 task
- Slack message arrives and looks clean
- E2B (or fake executor) returns and gets logged

If anything is flaky, fix it now. This phase is not optional.

---

## Phase 7 — Rehearse + Record (16:15–17:00)

**The exact demo script:**

1. Dashboard on screen, agent idle, memory feed showing a few routine "all clear" entries
2. Say: _"Every AI tool today needs a human to drive it. I want to show you what happens when it doesn't."_
3. Click the break trigger offscreen (or alt-tab to a terminal). Say nothing.
4. Wait. Let the judges watch the P0 appear by itself.
5. Walk through the reasoning stream out loud as it populates.
6. E2B runs. Slack pings. Queue clears.
7. Say: _"It read its own history, understood the system, prioritized correctly, fixed it, and reported to the team. I haven't touched anything since step 2."_
8. One sentence on the three memory layers. Done.

Record a 1-min Loom of this exact flow for the submission video.

---

## Fallbacks (in order of likelihood you'll need them)

| Problem                      | Fix                                                         |
| ---------------------------- | ----------------------------------------------------------- |
| E2B sandbox slow/broken      | Fake executor returning hardcoded stdout                    |
| Vercel Cron not working      | `setInterval` inside the loop route on first load           |
| Streamdown streaming complex | Just display `reasoning` string statically after each loop  |
| Loop taking >30s             | Cut GitHub polling, perception is just the one fake service |

---

## Right Now

Start with `convex/schema.ts`. Want me to write the full schema + mutations/queries file you can paste straight in?
