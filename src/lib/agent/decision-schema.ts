import { z } from "zod";

export const TALON_EMPLOYEE_ID = "ops-generalist";
export const TALON_MODEL = "gemini-3.5-flash";

export const taskPrioritySchema = z.enum(["P0", "P1", "P2"]);
export const taskStatusSchema = z.enum([
  "queued",
  "in_progress",
  "blocked",
  "done",
]);
export const signalSourceSchema = z.enum([
  "github",
  "deployment",
  "slack",
  "self",
]);

export const nextActionSchema = z.object({
  type: z.enum([
    "RUN_RUNBOOK",
    "COMMENT_GITHUB",
    "OPEN_GITHUB_PR",
    "MERGE_GITHUB_PR",
    "SEND_SLACK",
    "ESCALATE",
    "MONITOR",
  ]),
  runbookId: z.string().optional(),
  args: z.record(z.string(), z.string()).optional(),
  issueOrPrNumber: z.number().int().positive().optional(),
  body: z.string().optional(),
  channel: z.string().optional(),
  message: z.string().optional(),
  reason: z.string().optional(),
  recommendedOwner: z.string().optional(),
  note: z.string().optional(),
});

export const talonDecisionSchema = z.object({
  reasoningSummary: z.string().min(1),
  updatedWorkingMemory: z.object({
    activeObjective: z.string().min(1),
    currentObservations: z.array(z.string()).max(12),
  }),
  tasks: z
    .array(
      z.object({
        priority: taskPrioritySchema,
        title: z.string().min(1).max(160),
        status: taskStatusSchema,
        source: signalSourceSchema,
        rationale: z.string().min(1).max(600),
      }),
    )
    .max(12),
  nextAction: nextActionSchema,
});

export type TalonDecision = z.infer<typeof talonDecisionSchema>;
export type TalonNextAction = z.infer<typeof nextActionSchema>;
