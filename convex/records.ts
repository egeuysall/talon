import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { seedSemanticMemory } from "../src/lib/company/semantic-memory";
import { TALON_EMPLOYEE_ID } from "../src/lib/agent/decision-schema";

const priority = v.union(v.literal("P0"), v.literal("P1"), v.literal("P2"));
const taskStatus = v.union(
  v.literal("queued"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("pending_approval"),
  v.literal("waiting_external"),
  v.literal("follow_up_scheduled"),
  v.literal("action_failed"),
  v.literal("confidence_low"),
  v.literal("done"),
);
const signalSource = v.union(
  v.literal("github"),
  v.literal("deployment"),
  v.literal("slack"),
  v.literal("health"),
  v.literal("self"),
);
const approvalStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("executed"),
  v.literal("expired"),
);
const autonomyMode = v.union(
  v.literal("supervised"),
  v.literal("autonomous"),
  v.literal("paused"),
);

type AuthCtx = QueryCtx | MutationCtx;
type AuthInfo = {
  orgId: string;
  tokenIdentifier: string;
  orgRole: string;
};

function claimString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function getAuthInfo(ctx: AuthCtx): Promise<AuthInfo | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  const orgId =
    claimString(identity.org_id) ??
    claimString(identity.orgId) ??
    claimString(identity.organization_id);
  const orgRole =
    claimString(identity.org_role) ?? claimString(identity.orgRole) ?? "";
  const scopedOrgId = orgId ?? `user:${identity.tokenIdentifier}`;
  const scopedRole = orgId ? orgRole : "org:admin";

  return {
    orgId: scopedOrgId,
    tokenIdentifier: identity.tokenIdentifier,
    orgRole: scopedRole,
  };
}

async function requireOrg(ctx: AuthCtx) {
  const auth = await getAuthInfo(ctx);
  if (!auth) {
    throw new Error("Choose an organization first.");
  }
  return auth;
}

async function requireOrgAdmin(ctx: AuthCtx) {
  const auth = await requireOrg(ctx);
  if (auth.orgRole !== "org:admin" && auth.orgRole !== "admin") {
    throw new Error("Admin access required.");
  }
  return auth;
}

async function getFirstAgent(ctx: QueryCtx, orgId: string) {
  return await ctx.db
    .query("employeeState")
    .withIndex("by_orgId_and_status", (q) => q.eq("orgId", orgId))
    .order("desc")
    .take(1)
    .then((rows) => rows[0] ?? null);
}

async function getAgentById(ctx: QueryCtx, orgId: string, employeeId: string) {
  return await ctx.db
    .query("employeeState")
    .withIndex("by_orgId_and_employeeId", (q) =>
      q.eq("orgId", orgId).eq("employeeId", employeeId),
    )
    .unique();
}

async function getTasksByStatus(
  ctx: QueryCtx,
  orgId: string,
  employeeId: string,
  status:
    | "queued"
    | "in_progress"
    | "blocked"
    | "pending_approval"
    | "waiting_external"
    | "follow_up_scheduled"
    | "action_failed"
    | "confidence_low"
    | "done",
  limit: number,
) {
  return await ctx.db
    .query("tasks")
    .withIndex("by_orgId_and_employeeId_and_status", (q) =>
      q.eq("orgId", orgId).eq("employeeId", employeeId).eq("status", status),
    )
    .order("desc")
    .take(limit);
}

async function loadAgentContext(
  ctx: QueryCtx,
  orgId: string,
  requestedEmployeeId?: string,
) {
  const state = requestedEmployeeId
    ? await getAgentById(ctx, orgId, requestedEmployeeId)
    : await getFirstAgent(ctx, orgId);
  const employeeId = state?.employeeId ?? "";
  const agents = await ctx.db
    .query("employeeState")
    .withIndex("by_orgId_and_status", (q) => q.eq("orgId", orgId))
    .order("desc")
    .take(50);

  if (!state) {
    return {
      needsOrganization: false,
      agents,
      state: null,
      workingMemory: null,
      episodicLogs: [],
      tasks: [],
      signals: [],
      semanticMemory: [],
      approvalRequests: [],
      followUps: [],
      memoryInsights: [],
    };
  }

  const workingMemory = await ctx.db
    .query("workingMemory")
    .withIndex("by_orgId_and_employeeId", (q) =>
      q.eq("orgId", orgId).eq("employeeId", employeeId),
    )
    .unique();
  const episodicLogs = await ctx.db
    .query("episodicLogs")
    .withIndex("by_orgId_and_employeeId_and_createdAt", (q) =>
      q.eq("orgId", orgId).eq("employeeId", employeeId),
    )
    .order("desc")
    .take(20);
  const [
    inProgress,
    pendingApprovalTasks,
    actionFailed,
    blocked,
    waitingExternal,
    followUpScheduled,
    confidenceLow,
    queued,
  ] = await Promise.all([
    getTasksByStatus(ctx, orgId, employeeId, "in_progress", 10),
    getTasksByStatus(ctx, orgId, employeeId, "pending_approval", 10),
    getTasksByStatus(ctx, orgId, employeeId, "action_failed", 10),
    getTasksByStatus(ctx, orgId, employeeId, "blocked", 10),
    getTasksByStatus(ctx, orgId, employeeId, "waiting_external", 10),
    getTasksByStatus(ctx, orgId, employeeId, "follow_up_scheduled", 10),
    getTasksByStatus(ctx, orgId, employeeId, "confidence_low", 10),
    getTasksByStatus(ctx, orgId, employeeId, "queued", 20),
  ]);
  const signals = await ctx.db
    .query("signals")
    .withIndex("by_orgId_and_employeeId_and_createdAt", (q) =>
      q.eq("orgId", orgId).eq("employeeId", employeeId),
    )
    .order("desc")
    .take(30);
  const semanticMemory = await ctx.db
    .query("semanticMemory")
    .withIndex("by_orgId_and_kind_and_key", (q) => q.eq("orgId", orgId))
    .take(50);
  const approvalRequests = await ctx.db
    .query("approvalRequests")
    .withIndex("by_orgId_and_employeeId_and_status", (q) =>
      q.eq("orgId", orgId).eq("employeeId", employeeId).eq("status", "pending"),
    )
    .order("desc")
    .take(20);
  const followUps = await ctx.db
    .query("followUps")
    .withIndex("by_orgId_and_employeeId_and_status_and_dueAt", (q) =>
      q.eq("orgId", orgId).eq("employeeId", employeeId).eq("status", "scheduled"),
    )
    .take(20);
  const memoryInsights = await ctx.db
    .query("memoryInsights")
    .withIndex("by_orgId_and_employeeId_and_createdAt", (q) =>
      q.eq("orgId", orgId).eq("employeeId", employeeId),
    )
    .order("desc")
    .take(20);

  return {
    needsOrganization: false,
    agents,
    state,
    workingMemory,
    episodicLogs,
    tasks: [
      ...inProgress,
      ...pendingApprovalTasks,
      ...actionFailed,
      ...blocked,
      ...waitingExternal,
      ...followUpScheduled,
      ...confidenceLow,
      ...queued,
    ],
    signals,
    semanticMemory,
    approvalRequests,
    followUps,
    memoryInsights,
  };
}

async function seedMemory(ctx: MutationCtx, orgId: string, now: number) {
  for (const memory of seedSemanticMemory) {
    const existing = await ctx.db
      .query("semanticMemory")
      .withIndex("by_orgId_and_kind_and_key", (q) =>
        q.eq("orgId", orgId).eq("kind", memory.kind).eq("key", memory.key),
      )
      .unique();
    const row = {
      ...memory,
      orgId,
      source: "seed",
      verifiedAt: existing?.verifiedAt ?? now,
      staleAfter: existing?.staleAfter ?? now + 30 * 24 * 60 * 60 * 1000,
      confidence: "medium" as const,
      updatedAt: existing?.updatedAt ?? now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, {
        source: existing.source ?? row.source,
        verifiedAt: existing.verifiedAt ?? row.verifiedAt,
        staleAfter: existing.staleAfter ?? row.staleAfter,
        confidence: existing.confidence ?? row.confidence,
      });
    } else {
      await ctx.db.insert("semanticMemory", row);
    }
  }
}

export const getAgentContext = internalQuery({
  args: { orgId: v.string(), employeeId: v.string() },
  handler: async (ctx, args) => {
    return await loadAgentContext(ctx, args.orgId, args.employeeId);
  },
});

export const getRunnableAgents = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const autonomous = await ctx.db
      .query("employeeState")
      .withIndex("by_orgId_and_status")
      .take(100);
    return autonomous.filter(
      (agent) =>
        agent.orgId &&
        agent.status !== "paused" &&
        agent.autonomyMode === "autonomous" &&
        (agent.nextRunAt ?? 0) <= args.now &&
        (!agent.leaseExpiresAt || agent.leaseExpiresAt <= args.now),
    );
  },
});

export const getDashboard = query({
  args: { employeeId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await getAuthInfo(ctx);
    if (!auth) {
      return {
        needsOrganization: true,
        agents: [],
        state: null,
        workingMemory: null,
        episodicLogs: [],
        tasks: [],
        signals: [],
        semanticMemory: [],
        approvalRequests: [],
        followUps: [],
        memoryInsights: [],
        toolRuns: [],
      };
    }

    const context = await loadAgentContext(ctx, auth.orgId, args.employeeId);
    const employeeId = context.state?.employeeId ?? "";
    const toolRuns = employeeId
      ? await ctx.db
          .query("toolRuns")
          .withIndex("by_orgId_and_employeeId_and_createdAt", (q) =>
            q.eq("orgId", auth.orgId).eq("employeeId", employeeId),
          )
          .order("desc")
          .take(20)
      : [];

    return { ...context, toolRuns };
  },
});

export const launchEmployee = mutation({
  args: {
    name: v.string(),
    role: v.string(),
    goal: v.string(),
    autonomyMode,
  },
  handler: async (ctx, args) => {
    const auth = await requireOrgAdmin(ctx);
    const now = Date.now();
    const employeeId = crypto.randomUUID();
    await seedMemory(ctx, auth.orgId, now);
    await ctx.db.insert("employeeState", {
      orgId: auth.orgId,
      employeeId,
      name: args.name.slice(0, 80),
      role: args.role.slice(0, 80),
      goal: args.goal.slice(0, 800),
      createdBy: auth.tokenIdentifier,
      status: args.autonomyMode === "paused" ? "paused" : "idle",
      currentFocus: args.goal.slice(0, 500),
      nextRunAt: now,
      failureCount: 0,
      autonomyMode: args.autonomyMode,
    });
    await ctx.db.insert("workingMemory", {
      orgId: auth.orgId,
      employeeId,
      activeObjective: args.goal.slice(0, 500),
      currentObservations: ["Agent launched. Waiting for first clock-in."],
      updatedAt: now,
    });
    return { employeeId };
  },
});

export const markLoopStarted = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    loopId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const leaseExpiresAt = args.now + 15 * 60 * 1000;
    const existing = await ctx.db
      .query("employeeState")
      .withIndex("by_orgId_and_employeeId", (q) =>
        q.eq("orgId", args.orgId).eq("employeeId", args.employeeId),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("employeeState", {
        orgId: args.orgId,
        employeeId: args.employeeId,
        name: "Talon Ops Generalist",
        role: "Ops Generalist",
        goal: "Monitor operations and act safely.",
        status: "running",
        currentFocus: "Clocking in and collecting operational signals.",
        lastLoopStartedAt: args.now,
        nextRunAt: args.now + 5 * 60 * 1000,
        leaseId: args.loopId,
        leaseExpiresAt,
        failureCount: 0,
        autonomyMode: "autonomous",
      });
      return { acquired: true };
    }

    if (existing.status === "paused" || existing.autonomyMode === "paused") {
      return { acquired: false, reason: "paused" };
    }

    if (existing.leaseExpiresAt && existing.leaseExpiresAt > args.now) {
      return { acquired: false, reason: "leased" };
    }

    await ctx.db.patch(existing._id, {
      status: "running",
      lastLoopStartedAt: args.now,
      leaseId: args.loopId,
      leaseExpiresAt,
      lastError: "",
    });
    return { acquired: true };
  },
});

export const finishLoop = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    status: v.union(v.literal("idle"), v.literal("error")),
    currentFocus: v.string(),
    leaseId: v.optional(v.string()),
    nextRunAt: v.optional(v.number()),
    lastSignalDigest: v.optional(v.string()),
    lastError: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("employeeState")
      .withIndex("by_orgId_and_employeeId", (q) =>
        q.eq("orgId", args.orgId).eq("employeeId", args.employeeId),
      )
      .unique();

    if (!existing) {
      return;
    }

    if (args.leaseId && existing.leaseId !== args.leaseId) {
      return;
    }

    await ctx.db.patch(existing._id, {
      status: args.status,
      currentFocus: args.currentFocus,
      lastLoopFinishedAt: args.now,
      nextRunAt: args.nextRunAt ?? args.now + 5 * 60 * 1000,
      lastSignalDigest: args.lastSignalDigest ?? existing.lastSignalDigest,
      leaseId: "",
      leaseExpiresAt: 0,
      failureCount:
        args.status === "error" ? (existing.failureCount ?? 0) + 1 : 0,
      lastError: args.lastError ?? "",
    });
  },
});

export const setWorkingMemory = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    activeObjective: v.string(),
    currentObservations: v.array(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workingMemory")
      .withIndex("by_orgId_and_employeeId", (q) =>
        q.eq("orgId", args.orgId).eq("employeeId", args.employeeId),
      )
      .unique();
    const next = {
      orgId: args.orgId,
      employeeId: args.employeeId,
      activeObjective: args.activeObjective.slice(0, 500),
      currentObservations: args.currentObservations
        .slice(0, 12)
        .map((item) => item.slice(0, 500)),
      updatedAt: args.updatedAt,
    };

    if (existing) {
      await ctx.db.replace(existing._id, next);
      return;
    }

    await ctx.db.insert("workingMemory", next);
  },
});

export const upsertTasks = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    tasks: v.array(
      v.object({
        priority,
        title: v.string(),
        status: taskStatus,
        source: signalSource,
        rationale: v.string(),
      }),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    for (const task of args.tasks.slice(0, 12)) {
      const title = task.title.slice(0, 160);
      const existing = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_and_employeeId_and_title", (q) =>
          q
            .eq("orgId", args.orgId)
            .eq("employeeId", args.employeeId)
            .eq("title", title),
        )
        .unique();
      const row = {
      orgId: args.orgId,
      employeeId: args.employeeId,
      priority: task.priority,
      title,
      status: task.status,
      source: task.source,
      rationale: task.rationale.slice(0, 600),
      nextAttemptAt:
        task.status === "follow_up_scheduled"
          ? args.now + 60 * 60 * 1000
          : existing?.nextAttemptAt,
      retryCount: existing?.retryCount ?? 0,
      lastError: existing?.lastError ?? "",
      externalUrl: existing?.externalUrl ?? "",
      createdAt: existing?.createdAt ?? args.now,
      updatedAt: args.now,
    };

      if (existing) {
        await ctx.db.replace(existing._id, row);
      } else {
        await ctx.db.insert("tasks", row);
      }
    }
  },
});

export const insertSignal = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    source: signalSource,
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    title: v.string(),
    summary: v.string(),
    url: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("signals", {
      orgId: args.orgId,
      employeeId: args.employeeId,
      source: args.source,
      severity: args.severity,
      title: args.title.slice(0, 160),
      summary: args.summary.slice(0, 1200),
      url: args.url ?? "",
      fingerprint: args.fingerprint ?? "",
      lastSeenAt: args.createdAt,
      status: "new",
      createdAt: args.createdAt,
    });
  },
});

export const insertApprovalRequest = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    loopId: v.string(),
    actionType: v.string(),
    action: v.string(),
    risk: v.union(v.literal("medium"), v.literal("high")),
    reason: v.string(),
    evidence: v.array(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("approvalRequests")
      .withIndex("by_orgId_and_employeeId_and_status", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("employeeId", args.employeeId)
          .eq("status", "pending"),
      )
      .take(25);
    const duplicate = existing.find(
      (request) =>
        request.actionType === args.actionType && request.action === args.action,
    );
    if (duplicate) {
      return { approvalId: duplicate._id };
    }

    const approvalId = await ctx.db.insert("approvalRequests", {
      orgId: args.orgId,
      employeeId: args.employeeId,
      loopId: args.loopId,
      actionType: args.actionType.slice(0, 80),
      action: args.action.slice(0, 12000),
      risk: args.risk,
      reason: args.reason.slice(0, 800),
      evidence: args.evidence.slice(0, 12).map((item) => item.slice(0, 800)),
      status: "pending",
      requestedAt: args.now,
    });
    return { approvalId };
  },
});

export const scheduleFollowUp = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    taskTitle: v.string(),
    reason: v.string(),
    dueAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("followUps", {
      orgId: args.orgId,
      employeeId: args.employeeId,
      taskTitle: args.taskTitle.slice(0, 160),
      reason: args.reason.slice(0, 800),
      dueAt: args.dueAt,
      status: "scheduled",
      createdAt: args.now,
      updatedAt: args.now,
    });
  },
});

export const recordActionFailure = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    title: v.string(),
    source: signalSource,
    error: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const title = args.title.slice(0, 160);
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_and_employeeId_and_title", (q) =>
        q
          .eq("orgId", args.orgId)
          .eq("employeeId", args.employeeId)
          .eq("title", title),
      )
      .unique();
    const retryCount = (existing?.retryCount ?? 0) + 1;
    const retryDelay = retryCount >= 3 ? 6 * 60 * 60 * 1000 : 10 * 60 * 1000;
    const row = {
      orgId: args.orgId,
      employeeId: args.employeeId,
      priority: retryCount >= 3 ? ("P1" as const) : ("P2" as const),
      title,
      status: retryCount >= 3 ? ("blocked" as const) : ("action_failed" as const),
      source: args.source,
      rationale:
        retryCount >= 3
          ? "Action failed repeatedly and needs operator review."
          : "Tool execution failed. Talon will retry after backoff.",
      nextAttemptAt: args.now + retryDelay,
      retryCount,
      lastError: args.error.slice(0, 1000),
      externalUrl: existing?.externalUrl ?? "",
      createdAt: existing?.createdAt ?? args.now,
      updatedAt: args.now,
    };

    if (existing) {
      await ctx.db.replace(existing._id, row);
    } else {
      await ctx.db.insert("tasks", row);
    }

    if (retryCount >= 2) {
      await ctx.db.insert("memoryInsights", {
        orgId: args.orgId,
        employeeId: args.employeeId,
        kind: "recurring_failure",
        title: `Repeated failure: ${title}`.slice(0, 160),
        detail: args.error.slice(0, 1200),
        evidence: [args.error.slice(0, 800)],
        confidence: retryCount >= 3 ? "high" : "medium",
        status: "proposed",
        createdAt: args.now,
        updatedAt: args.now,
      });
    }
  },
});

export const takeApprovalForExecution = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    approvalId: v.id("approvalRequests"),
    decidedBy: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (
      !approval ||
      approval.orgId !== args.orgId ||
      approval.employeeId !== args.employeeId ||
      approval.status !== "pending"
    ) {
      throw new Error("Approval request is not executable.");
    }

    await ctx.db.patch(approval._id, {
      status: "approved",
      decidedAt: args.now,
      decidedBy: args.decidedBy,
    });
    return {
      loopId: approval.loopId,
      action: approval.action,
      actionType: approval.actionType,
    };
  },
});

export const markApprovalExecuted = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    approvalId: v.id("approvalRequests"),
    result: v.string(),
    status: approvalStatus,
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const approval = await ctx.db.get(args.approvalId);
    if (
      !approval ||
      approval.orgId !== args.orgId ||
      approval.employeeId !== args.employeeId
    ) {
      return;
    }
    await ctx.db.patch(approval._id, {
      status: args.status,
      result: args.result.slice(0, 2000),
      decidedAt: approval.decidedAt ?? args.now,
    });
  },
});

export const rejectApproval = mutation({
  args: { approvalId: v.id("approvalRequests") },
  handler: async (ctx, args) => {
    const auth = await requireOrgAdmin(ctx);
    const approval = await ctx.db.get(args.approvalId);
    if (!approval || approval.orgId !== auth.orgId) {
      throw new Error("Approval request not found.");
    }
    await ctx.db.patch(approval._id, {
      status: "rejected",
      decidedAt: Date.now(),
      decidedBy: auth.tokenIdentifier,
    });
  },
});

export const insertToolRun = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    loopId: v.string(),
    tool: v.string(),
    inputSummary: v.string(),
    stdout: v.string(),
    stderr: v.string(),
    status: v.union(
      v.literal("success"),
      v.literal("skipped"),
      v.literal("error"),
    ),
    durationMs: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("toolRuns", {
      orgId: args.orgId,
      employeeId: args.employeeId,
      loopId: args.loopId,
      tool: args.tool,
      inputSummary: args.inputSummary.slice(0, 800),
      stdout: args.stdout.slice(0, 4000),
      stderr: args.stderr.slice(0, 4000),
      status: args.status,
      durationMs: args.durationMs,
      createdAt: args.createdAt,
    });
  },
});

export const appendEpisodicLog = internalMutation({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    loopId: v.string(),
    observations: v.array(v.string()),
    reasoningSummary: v.string(),
    action: v.string(),
    outcome: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("episodicLogs", {
      orgId: args.orgId,
      employeeId: args.employeeId,
      loopId: args.loopId,
      observations: args.observations
        .slice(0, 20)
        .map((item) => item.slice(0, 800)),
      reasoningSummary: args.reasoningSummary.slice(0, 2000),
      action: args.action.slice(0, 1200),
      outcome: args.outcome.slice(0, 2000),
      createdAt: args.createdAt,
    });
  },
});

export const seedMemoryInternal = internalMutation({
  args: { orgId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    await seedMemory(ctx, args.orgId, args.now);
  },
});

export const seedSemanticMemoryPublic = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = await requireOrgAdmin(ctx);
    await seedMemory(ctx, auth.orgId, Date.now());
    return { seeded: seedSemanticMemory.length };
  },
});

export const pauseEmployee = mutation({
  args: { employeeId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireOrgAdmin(ctx);
    const existing = await getAgentById(ctx, auth.orgId, args.employeeId);
    if (!existing) {
      throw new Error("Agent not found.");
    }
    await ctx.db.patch(existing._id, {
      status: "paused",
      autonomyMode: "paused",
      currentFocus: "Paused by operator.",
    });
  },
});

export const resumeEmployee = mutation({
  args: { employeeId: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireOrgAdmin(ctx);
    const existing = await getAgentById(ctx, auth.orgId, args.employeeId);
    if (!existing) {
      throw new Error("Agent not found.");
    }
    await ctx.db.patch(existing._id, {
      status: "idle",
      autonomyMode: "autonomous",
      currentFocus: existing.goal ?? "Ready to clock in on schedule.",
      nextRunAt: Date.now(),
    });
  },
});

export const setAutonomyMode = mutation({
  args: {
    employeeId: v.string(),
    autonomyMode,
  },
  handler: async (ctx, args) => {
    const auth = await requireOrgAdmin(ctx);
    const existing = await getAgentById(ctx, auth.orgId, args.employeeId);
    if (!existing) {
      throw new Error("Agent not found.");
    }
    const status = args.autonomyMode === "paused" ? "paused" : "idle";
    await ctx.db.patch(existing._id, {
      status,
      autonomyMode: args.autonomyMode,
      currentFocus: existing.goal ?? "Autonomy mode updated by operator.",
      nextRunAt: args.autonomyMode === "paused" ? existing.nextRunAt : Date.now(),
    });
  },
});

export const ensureDefaultEmployeeForOrg = mutation({
  args: {},
  handler: async (ctx) => {
    const auth = await requireOrgAdmin(ctx);
    const existing = await getFirstAgent(ctx, auth.orgId);
    if (existing) {
      return { employeeId: existing.employeeId };
    }
    const now = Date.now();
    await seedMemory(ctx, auth.orgId, now);
    await ctx.db.insert("employeeState", {
      orgId: auth.orgId,
      employeeId: TALON_EMPLOYEE_ID,
      name: "Talon Ops Generalist",
      role: "Ops Generalist",
      goal: "Watch GitHub, deployments, Slack intake, and act through safe tools.",
      createdBy: auth.tokenIdentifier,
      status: "idle",
      currentFocus: "Ready to clock in on schedule.",
      nextRunAt: now,
      failureCount: 0,
      autonomyMode: "autonomous",
    });
    return { employeeId: TALON_EMPLOYEE_ID };
  },
});
