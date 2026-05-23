import type { TalonNextAction } from "./decision-schema";

export type AutonomyMode = "autonomous" | "supervised" | "paused";
export type ActionRisk = "low" | "medium" | "high";

export type ActionPolicyDecision = {
  allowed: boolean;
  requiresApproval: boolean;
  risk: ActionRisk;
  reason: string;
};

export type SignalFingerprintInput = {
  source?: string;
  severity?: string;
  title?: string;
  summary?: string;
  url?: string;
  createdAt?: number;
};

const LOW_RISK_ACTIONS = new Set<TalonNextAction["type"]>([
  "MONITOR",
  "RUN_RUNBOOK",
  "INSPECT_GITHUB",
  "COMMENT_GITHUB",
  "LABEL_GITHUB_ISSUE",
  "OPEN_GITHUB_ISSUE",
  "REQUEST_GITHUB_REVIEW",
]);

const MEDIUM_RISK_ACTIONS = new Set<TalonNextAction["type"]>([
  "OPEN_GITHUB_PR",
  "CLOSE_GITHUB_ISSUE",
  "SEND_SLACK",
]);

const HIGH_RISK_ACTIONS = new Set<TalonNextAction["type"]>([
  "MERGE_GITHUB_PR",
]);

export function riskForAction(action: TalonNextAction): ActionRisk {
  if (HIGH_RISK_ACTIONS.has(action.type)) return "high";
  if (MEDIUM_RISK_ACTIONS.has(action.type)) return "medium";
  return "low";
}

export function decideActionPolicy(
  action: TalonNextAction,
  autonomyMode: AutonomyMode,
): ActionPolicyDecision {
  const risk = riskForAction(action);

  if (autonomyMode === "paused") {
    return {
      allowed: false,
      requiresApproval: false,
      risk,
      reason: "Agent is paused.",
    };
  }

  if (!LOW_RISK_ACTIONS.has(action.type) && !MEDIUM_RISK_ACTIONS.has(action.type) && !HIGH_RISK_ACTIONS.has(action.type)) {
    return {
      allowed: false,
      requiresApproval: true,
      risk: "high",
      reason: `Unknown action ${action.type} requires approval.`,
    };
  }

  if (risk === "high" || risk === "medium") {
    return {
      allowed: false,
      requiresApproval: true,
      risk,
      reason:
        risk === "high"
          ? "High-risk action requires explicit approval."
          : "Medium-risk external action requires approval.",
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
    risk,
    reason: "Action is within current autonomy boundary.",
  };
}

function clean(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

export function fingerprintSignals(signals: SignalFingerprintInput[]) {
  return signals
    .map((signal) =>
      [
        clean(signal.source),
        clean(signal.severity),
        clean(signal.title),
        clean(signal.summary),
        clean(signal.url),
      ].join("|"),
    )
    .sort()
    .join("\n")
    .slice(0, 12000);
}

export function shouldSkipModel(args: {
  previousDigest?: string | null;
  nextDigest: string;
  dueFollowUps: number;
  openFailures: number;
  pendingApprovals: number;
}) {
  return (
    Boolean(args.previousDigest) &&
    args.previousDigest === args.nextDigest &&
    args.dueFollowUps === 0 &&
    args.openFailures === 0 &&
    args.pendingApprovals === 0
  );
}
