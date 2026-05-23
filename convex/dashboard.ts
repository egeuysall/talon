"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

function claimString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function orgScope(identity: { tokenIdentifier: string; org_id?: string; orgId?: string; organization_id?: string }) {
  return (
    claimString(identity.org_id) ??
    claimString(identity.orgId) ??
    claimString(identity.organization_id) ??
    `user:${identity.tokenIdentifier}`
  );
}

function isAdminRole(orgRole: string | null) {
  return orgRole === "org:admin" || orgRole === "admin";
}

export const runOneLoopNow = action({
  args: { employeeId: v.string() },
  handler: async (
    ctx, args,
  ): Promise<{ skipped: string } | { loopId: string; outcome: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    const orgId = orgScope(identity);
    const orgRole = claimString(identity.org_role) ?? claimString(identity.orgRole);
    const inPersonalScope = orgId.startsWith("user:");
    if (!inPersonalScope && !isAdminRole(orgRole)) {
      throw new Error("Admin access required.");
    }

    const context = await ctx.runQuery(internal.records.getAgentContext, {
      orgId,
      employeeId: args.employeeId,
    });
    if (!context.state) {
      throw new Error("Agent not found.");
    }

    return await ctx.runAction(internal.agentLoop.run, {
      orgId,
      employeeId: args.employeeId,
    });
  },
});

export const runApprovedAction = action({
  args: {
    employeeId: v.string(),
    approvalId: v.id("approvalRequests"),
  },
  handler: async (ctx, args): Promise<{ outcome: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }
    const orgId = orgScope(identity);
    const orgRole = claimString(identity.org_role) ?? claimString(identity.orgRole);
    const inPersonalScope = orgId.startsWith("user:");
    if (!inPersonalScope && !isAdminRole(orgRole)) {
      throw new Error("Admin access required.");
    }

    const approval = await ctx.runMutation(
      internal.records.takeApprovalForExecution,
      {
        orgId,
        employeeId: args.employeeId,
        approvalId: args.approvalId,
        decidedBy: identity.tokenIdentifier,
        now: Date.now(),
      },
    );

    try {
      const outcome: string = await ctx.runAction(internal.tools.execute, {
        orgId,
        employeeId: args.employeeId,
        loopId: approval.loopId,
        action: JSON.parse(approval.action),
      });
      const status = /^[^:]+:\s*(error|skipped)\b/i.test(outcome)
        ? "rejected"
        : "executed";
      await ctx.runMutation(internal.records.markApprovalExecuted, {
        orgId,
        employeeId: args.employeeId,
        approvalId: args.approvalId,
        result: outcome,
        status,
        now: Date.now(),
      });
      return { outcome };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Approved action failed.";
      await ctx.runMutation(internal.records.markApprovalExecuted, {
        orgId,
        employeeId: args.employeeId,
        approvalId: args.approvalId,
        result: message,
        status: "rejected",
        now: Date.now(),
      });
      throw error;
    }
  },
});

export const runTestRunbookNow = action({
  args: {
    employeeId: v.string(),
    runbookId: v.union(
      v.literal("diagnose_failed_ci"),
      v.literal("summarize_github_queue"),
      v.literal("repo_typescript_checks"),
    ),
  },
  handler: async (ctx, args): Promise<{ outcome: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const orgId = orgScope(identity);
    const orgRole = claimString(identity.org_role) ?? claimString(identity.orgRole);
    const inPersonalScope = orgId.startsWith("user:");
    if (!inPersonalScope && !isAdminRole(orgRole)) {
      throw new Error("Admin access required.");
    }

    const outcome = await ctx.runAction(internal.tools.execute, {
      orgId,
      employeeId: args.employeeId,
      loopId: crypto.randomUUID(),
      action: {
        type: "RUN_RUNBOOK",
        runbookId: args.runbookId,
        args:
          args.runbookId === "diagnose_failed_ci"
            ? {
                issueOrPrNumber: "9999",
                title: "Synthetic test incident",
                sha: "local-test",
              }
            : args.runbookId === "summarize_github_queue"
              ? {
                summary: "Synthetic queue summary request for local verification.",
              }
              : {
                repoFullName: "vercel/ai",
                ref: "main",
              },
      },
    });

    return { outcome };
  },
});
