import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  employeeState: defineTable({
    orgId: v.optional(v.string()),
    employeeId: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    goal: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    status: v.union(
      v.literal("idle"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("error"),
    ),
    currentFocus: v.string(),
    lastLoopStartedAt: v.optional(v.number()),
    lastLoopFinishedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    nextRunAt: v.optional(v.number()),
    lastSignalDigest: v.optional(v.string()),
    leaseId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    failureCount: v.optional(v.number()),
    autonomyMode: v.union(
      v.literal("supervised"),
      v.literal("autonomous"),
      v.literal("paused"),
    ),
  })
    .index("by_employeeId", ["employeeId"])
    .index("by_orgId_and_employeeId", ["orgId", "employeeId"])
    .index("by_orgId_and_status", ["orgId", "status"]),

  workingMemory: defineTable({
    orgId: v.optional(v.string()),
    employeeId: v.string(),
    activeObjective: v.string(),
    currentObservations: v.array(v.string()),
    updatedAt: v.number(),
  })
    .index("by_employeeId", ["employeeId"])
    .index("by_orgId_and_employeeId", ["orgId", "employeeId"]),

  episodicLogs: defineTable({
    orgId: v.optional(v.string()),
    employeeId: v.string(),
    loopId: v.string(),
    observations: v.array(v.string()),
    reasoningSummary: v.string(),
    action: v.string(),
    outcome: v.string(),
    createdAt: v.number(),
  })
    .index("by_employeeId_and_createdAt", ["employeeId", "createdAt"])
    .index("by_orgId_and_employeeId_and_createdAt", [
      "orgId",
      "employeeId",
      "createdAt",
    ]),

  tasks: defineTable({
    orgId: v.optional(v.string()),
    employeeId: v.string(),
    priority: v.union(v.literal("P0"), v.literal("P1"), v.literal("P2")),
    title: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("in_progress"),
      v.literal("blocked"),
      v.literal("pending_approval"),
      v.literal("waiting_external"),
      v.literal("follow_up_scheduled"),
      v.literal("action_failed"),
      v.literal("confidence_low"),
      v.literal("done"),
    ),
    source: v.union(
      v.literal("github"),
      v.literal("deployment"),
      v.literal("slack"),
      v.literal("health"),
      v.literal("self"),
    ),
    rationale: v.string(),
    nextAttemptAt: v.optional(v.number()),
    retryCount: v.optional(v.number()),
    lastError: v.optional(v.string()),
    externalUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_employeeId_and_status", ["employeeId", "status"])
    .index("by_employeeId_and_title", ["employeeId", "title"])
    .index("by_orgId_and_employeeId_and_status", [
      "orgId",
      "employeeId",
      "status",
    ])
    .index("by_orgId_and_employeeId_and_title", [
      "orgId",
      "employeeId",
      "title",
    ]),

  toolRuns: defineTable({
    orgId: v.optional(v.string()),
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
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_employeeId_and_createdAt", ["employeeId", "createdAt"])
    .index("by_orgId_and_employeeId_and_createdAt", [
      "orgId",
      "employeeId",
      "createdAt",
    ]),

  signals: defineTable({
    orgId: v.optional(v.string()),
    employeeId: v.string(),
    source: v.union(
      v.literal("github"),
      v.literal("deployment"),
      v.literal("slack"),
      v.literal("health"),
      v.literal("self"),
    ),
    severity: v.union(
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    title: v.string(),
    summary: v.string(),
    url: v.optional(v.string()),
    fingerprint: v.optional(v.string()),
    lastSeenAt: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("new"),
        v.literal("seen"),
        v.literal("acted"),
        v.literal("ignored"),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_source_and_createdAt", ["source", "createdAt"])
    .index("by_employeeId_and_createdAt", ["employeeId", "createdAt"])
    .index("by_orgId_and_employeeId_and_createdAt", [
      "orgId",
      "employeeId",
      "createdAt",
    ]),

  semanticMemory: defineTable({
    orgId: v.optional(v.string()),
    kind: v.union(
      v.literal("mission"),
      v.literal("surface"),
      v.literal("runbook"),
      v.literal("policy"),
      v.literal("style"),
    ),
    key: v.string(),
    content: v.string(),
    source: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    staleAfter: v.optional(v.number()),
    confidence: v.optional(
      v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    ),
    updatedAt: v.number(),
  })
    .index("by_kind_and_key", ["kind", "key"])
    .index("by_orgId_and_kind_and_key", ["orgId", "kind", "key"]),

  approvalRequests: defineTable({
    orgId: v.string(),
    employeeId: v.string(),
    loopId: v.string(),
    actionType: v.string(),
    action: v.string(),
    risk: v.union(v.literal("medium"), v.literal("high")),
    reason: v.string(),
    evidence: v.array(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("executed"),
      v.literal("expired"),
    ),
    requestedAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.string()),
    result: v.optional(v.string()),
  })
    .index("by_orgId_and_employeeId_and_status", [
      "orgId",
      "employeeId",
      "status",
    ])
    .index("by_orgId_and_status", ["orgId", "status"]),

  followUps: defineTable({
    orgId: v.string(),
    employeeId: v.string(),
    taskTitle: v.string(),
    reason: v.string(),
    dueAt: v.number(),
    status: v.union(
      v.literal("scheduled"),
      v.literal("running"),
      v.literal("done"),
      v.literal("blocked"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId_and_employeeId_and_status_and_dueAt", [
      "orgId",
      "employeeId",
      "status",
      "dueAt",
    ])
    .index("by_orgId_and_status_and_dueAt", ["orgId", "status", "dueAt"]),

  memoryInsights: defineTable({
    orgId: v.string(),
    employeeId: v.string(),
    kind: v.union(
      v.literal("recurring_failure"),
      v.literal("stale_knowledge"),
      v.literal("successful_fix"),
      v.literal("owner_hint"),
    ),
    title: v.string(),
    detail: v.string(),
    evidence: v.array(v.string()),
    confidence: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    status: v.union(v.literal("proposed"), v.literal("accepted"), v.literal("dismissed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_orgId_and_employeeId_and_createdAt", [
      "orgId",
      "employeeId",
      "createdAt",
    ])
    .index("by_orgId_and_employeeId_and_status", [
      "orgId",
      "employeeId",
      "status",
    ]),
});
