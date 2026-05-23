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
    updatedAt: v.number(),
  })
    .index("by_kind_and_key", ["kind", "key"])
    .index("by_orgId_and_kind_and_key", ["orgId", "kind", "key"]),
});
