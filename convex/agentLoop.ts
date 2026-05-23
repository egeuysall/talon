"use node";

import { google, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { generateText } from "ai";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  TALON_MODEL,
  talonDecisionSchema,
  type TalonDecision,
  type TalonNextAction,
} from "../src/lib/agent/decision-schema";

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function serializeAction(action: TalonNextAction) {
  return JSON.stringify(action);
}

type SignalLike = {
  source?: string;
  severity?: string;
  title?: string;
  summary?: string;
};

function summarizeSignals(signals: unknown[]) {
  return signals
    .slice(0, 20)
    .map((signal) => {
      const row = signal as SignalLike;
      return `${row.source ?? "unknown"}/${row.severity ?? "info"}: ${row.title ?? "untitled"} - ${row.summary ?? ""}`;
    })
    .join("\n");
}

function fallbackDecision(signals: unknown[], reason: string): TalonDecision {
  const signalSummary = summarizeSignals(signals) || "No fresh signals.";
  return {
    reasoningSummary: `Fallback decision used because ${reason}. ${signalSummary}`,
    updatedWorkingMemory: {
      activeObjective: "Keep monitoring configured operational surfaces.",
      currentObservations: signalSummary.split("\n").slice(0, 8),
    },
    tasks: [
      {
        priority: "P2",
        title: "Continue autonomous ops monitoring",
        status: "queued",
        source: "self",
        rationale: "No higher-priority actionable signal was found.",
      },
    ],
    nextAction: { type: "MONITOR", note: "No safe autonomous action required." },
  };
}

function parseDecisionJson(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Gemini did not return a JSON object");
  }
  return talonDecisionSchema.parse(JSON.parse(candidate.slice(start, end + 1)));
}

async function decide(context: unknown, signals: unknown[]) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return fallbackDecision(signals, "GOOGLE_GENERATIVE_AI_API_KEY is missing");
  }

  const prompt = `
You are Talon, an autonomous Ops Generalist employee.

Mandate:
- Clock in, perceive operational state, remember context, choose priorities, act through approved tools, report outcome.
- Use approved runbook IDs only: diagnose_failed_ci, summarize_github_queue, repo_typescript_checks.
- Never invent shell commands. Never request credentials. Never perform destructive operations.
- Escalate production mutations, credential changes, deletes, dependency upgrades, PR merges, or uncertainty.
- Show concise work summaries only, not private chain-of-thought.
- For GitHub comments, include args.repoFullName like "owner/repo" when known.

Context JSON:
${JSON.stringify(context).slice(0, 18000)}

Fresh signals:
${summarizeSignals(signals)}

Return one schema-valid decision. Prefer MONITOR when no safe action exists.
Return only JSON. No markdown.
Shape:
{
  "reasoningSummary": "brief work-summary, no chain of thought",
  "updatedWorkingMemory": {
    "activeObjective": "current objective",
    "currentObservations": ["bounded observation"]
  },
  "tasks": [
    {
      "priority": "P0|P1|P2",
      "title": "task title",
      "status": "queued|in_progress|blocked|done",
    "source": "github|deployment|slack|self",
      "rationale": "why this task exists"
    }
  ],
  "nextAction": {
    "type": "RUN_RUNBOOK|COMMENT_GITHUB|OPEN_GITHUB_PR|MERGE_GITHUB_PR|SEND_SLACK|ESCALATE|MONITOR",
    "runbookId": "diagnose_failed_ci|summarize_github_queue|repo_typescript_checks",
    "args": {"repoFullName": "owner/repo", "ref": "main", "head": "talon/fix-branch", "base": "main", "title": "fix: ...", "mergeMethod": "merge|squash|rebase"},
    "issueOrPrNumber": 1,
    "body": "github comment body",
    "channel": "ops",
    "message": "slack message",
    "reason": "escalation reason",
    "recommendedOwner": "owner",
    "note": "monitor note"
  }
}
`;

  try {
    const result = await generateText({
      model: google(TALON_MODEL),
      providerOptions: {
        google: {
          safetySettings: [
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE",
            },
          ],
        } satisfies GoogleLanguageModelOptions,
      },
      prompt,
    });

    return parseDecisionJson(result.text);
  } catch (error) {
    return fallbackDecision(signals, safeMessage(error));
  }
}

export const run = internalAction({
  args: { orgId: v.string(), employeeId: v.string() },
  handler: async (
    ctx, args,
  ): Promise<{ skipped: string } | { loopId: string; outcome: string }> => {
    const loopId = crypto.randomUUID();
    const startedAt = Date.now();
    const initialContext = await ctx.runQuery(internal.records.getAgentContext, args);

    if (initialContext.state?.status === "paused") {
      return { skipped: "paused" };
    }

    await ctx.runMutation(internal.records.seedMemoryInternal, {
      orgId: args.orgId,
      now: startedAt,
    });
    await ctx.runMutation(internal.records.markLoopStarted, {
      orgId: args.orgId,
      employeeId: args.employeeId,
      loopId,
      now: startedAt,
    });

    try {
      const signals = await ctx.runAction(internal.perception.collectAll, args);
      const context = await ctx.runQuery(internal.records.getAgentContext, args);
      const decision = await decide(context, signals);

      await ctx.runMutation(internal.records.setWorkingMemory, {
        orgId: args.orgId,
        employeeId: args.employeeId,
        activeObjective: decision.updatedWorkingMemory.activeObjective,
        currentObservations: decision.updatedWorkingMemory.currentObservations,
        updatedAt: Date.now(),
      });
      await ctx.runMutation(internal.records.upsertTasks, {
        orgId: args.orgId,
        employeeId: args.employeeId,
        tasks: decision.tasks,
        now: Date.now(),
      });

      const outcome: string = await ctx.runAction(internal.tools.execute, {
        orgId: args.orgId,
        employeeId: args.employeeId,
        loopId,
        action: JSON.parse(JSON.stringify(decision.nextAction)),
      });
      await ctx.runMutation(internal.records.appendEpisodicLog, {
        orgId: args.orgId,
        employeeId: args.employeeId,
        loopId,
        observations: [
          ...decision.updatedWorkingMemory.currentObservations,
          summarizeSignals(signals),
        ].filter(Boolean),
        reasoningSummary: decision.reasoningSummary,
        action: serializeAction(decision.nextAction),
        outcome,
        createdAt: Date.now(),
      });
      await ctx.runMutation(internal.records.finishLoop, {
        orgId: args.orgId,
        employeeId: args.employeeId,
        status: "idle",
        currentFocus: decision.updatedWorkingMemory.activeObjective,
        now: Date.now(),
      });

      return { loopId, outcome };
    } catch (error) {
      const message = safeMessage(error);
      await ctx.runMutation(internal.records.appendEpisodicLog, {
        orgId: args.orgId,
        employeeId: args.employeeId,
        loopId,
        observations: ["Loop failed before completion."],
        reasoningSummary: message,
        action: "ERROR",
        outcome: message,
        createdAt: Date.now(),
      });
      await ctx.runMutation(internal.records.finishLoop, {
        orgId: args.orgId,
        employeeId: args.employeeId,
        status: "error",
        currentFocus: "Loop failed. Operator review required.",
        lastError: message,
        now: Date.now(),
      });
      throw error;
    }
  },
});

export const runDueAgents = internalAction({
  args: {},
  handler: async (ctx): Promise<Array<{ employeeId: string; outcome: string }>> => {
    const agents = await ctx.runQuery(internal.records.getRunnableAgents, {});
    const results: Array<{ employeeId: string; outcome: string }> = [];
    for (const agent of agents) {
      if (!agent.orgId) continue;
      const result = await ctx.runAction(internal.agentLoop.run, {
        orgId: agent.orgId,
        employeeId: agent.employeeId,
      });
      results.push({
        employeeId: agent.employeeId,
        outcome: "outcome" in result ? result.outcome : result.skipped,
      });
    }
    return results;
  },
});

export const collectDeepContext = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown[]> => {
    const agents = await ctx.runQuery(internal.records.getRunnableAgents, {});
    const results: unknown[] = [];
    for (const agent of agents.slice(0, 50)) {
      if (!agent.orgId) continue;
      await ctx.runMutation(internal.records.seedMemoryInternal, {
        orgId: agent.orgId,
        now: Date.now(),
      });
      results.push(
        await ctx.runAction(internal.perception.normalizeSignals, {
          orgId: agent.orgId,
          employeeId: agent.employeeId,
          source: "deep-context",
          summary: "Seeded semantic memory and refreshed slow context.",
        }),
      );
    }
    return results;
  },
});
