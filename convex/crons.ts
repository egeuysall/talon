import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "talon employee loop",
  { minutes: 1 },
  internal.agentLoop.runDueAgents,
  {},
);

crons.interval(
  "talon deep context collection",
  { minutes: 10 },
  internal.agentLoop.collectDeepContext,
  {},
);

export default crons;
