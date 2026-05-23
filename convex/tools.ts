"use node";

import { createSign } from "node:crypto";
import { Sandbox } from "@e2b/code-interpreter";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const actionType = v.union(
  v.literal("RUN_RUNBOOK"),
  v.literal("INSPECT_GITHUB"),
  v.literal("COMMENT_GITHUB"),
  v.literal("OPEN_GITHUB_ISSUE"),
  v.literal("LABEL_GITHUB_ISSUE"),
  v.literal("CLOSE_GITHUB_ISSUE"),
  v.literal("OPEN_GITHUB_PR"),
  v.literal("REQUEST_GITHUB_REVIEW"),
  v.literal("MERGE_GITHUB_PR"),
  v.literal("SEND_SLACK"),
  v.literal("ESCALATE"),
  v.literal("MONITOR"),
);

const nextAction = v.object({
  type: actionType,
  runbookId: v.optional(v.string()),
  args: v.optional(v.record(v.string(), v.string())),
  issueOrPrNumber: v.optional(v.number()),
  body: v.optional(v.string()),
  channel: v.optional(v.string()),
  message: v.optional(v.string()),
  reason: v.optional(v.string()),
  recommendedOwner: v.optional(v.string()),
  note: v.optional(v.string()),
});

type ToolStatus = "success" | "skipped" | "error";
type GitHubRepo = { full_name?: string };
type GitHubIssueDetail = {
  number?: number;
  title?: string;
  state?: string;
  html_url?: string;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string }>;
};
type GitHubPullDetail = GitHubIssueDetail & {
  mergeable?: boolean | null;
  draft?: boolean;
  head?: { ref?: string; sha?: string };
  base?: { ref?: string };
};

const GITHUB_API_VERSION = "2022-11-28";
const USER_AGENT = "talon-autonomous-employee";
const REPO_FULL_NAME_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GIT_REF_RE = /^[A-Za-z0-9._/@-]{1,120}$/;
const GITHUB_NAME_RE = /^[A-Za-z0-9-]{1,39}$/;

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function requireRepoFullName(repoFullName: string) {
  if (!REPO_FULL_NAME_RE.test(repoFullName)) {
    throw new Error("Invalid GitHub repo full name.");
  }
  return repoFullName;
}

function requireGitRef(ref: string) {
  if (!GIT_REF_RE.test(ref) || ref.startsWith("-")) {
    throw new Error("Invalid Git ref.");
  }
  return ref;
}

function parseCsv(value: string | undefined, limit: number) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function githubPrivateKey() {
  return env("GITHUB_APP_PRIVATE_KEY")?.replace(/\\n/g, "\n") ?? null;
}

function createGitHubAppJwt() {
  const appId = env("GITHUB_APP_ID");
  const privateKey = githubPrivateKey();
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY is not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    }),
  );
  const data = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(data).sign(privateKey);
  return `${data}.${base64Url(signature)}`;
}

async function resolveInstallationId(appJwt: string) {
  const explicit = env("GITHUB_APP_INSTALLATION_ID");
  if (explicit) {
    return explicit;
  }
  const res = await fetch("https://api.github.com/app/installations?per_page=100", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${appJwt}`,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub App installations ${res.status} ${res.statusText}`);
  }
  const payload = (await res.json()) as Array<{ id?: number }>;
  const firstId = payload.find((row) => typeof row.id === "number")?.id;
  if (!firstId) {
    throw new Error("GitHub App has no installations. Install it on a repo/org first.");
  }
  return String(firstId);
}

async function createInstallationToken() {
  const appJwt = createGitHubAppJwt();
  const installationId = await resolveInstallationId(appJwt);

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt}`,
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub App token ${res.status} ${res.statusText}`);
  }
  const payload = (await res.json()) as { token?: string };
  if (!payload.token) {
    throw new Error("GitHub App installation token response was empty");
  }
  return payload.token;
}

async function githubJson(path: string, token: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as unknown;
}

async function defaultInstalledRepo(token: string) {
  const payload = (await githubJson(
    "/installation/repositories?per_page=1",
    token,
  )) as { repositories?: GitHubRepo[] };
  return payload.repositories?.[0]?.full_name ?? null;
}

function summarizeInput(input: unknown) {
  return JSON.stringify(input).slice(0, 800);
}

function redactSecrets(value: string, secrets: string[]) {
  let output = value;
  for (const secret of secrets) {
    if (!secret) continue;
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

async function logToolRun(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  tool: string,
  input: unknown,
  status: ToolStatus,
  stdout: string,
  stderr: string,
  startedAt: number,
) {
  await ctx.runMutation(internal.records.insertToolRun, {
    orgId,
    employeeId,
    loopId,
    tool,
    inputSummary: summarizeInput(input),
    stdout,
    stderr,
    status,
    durationMs: Date.now() - startedAt,
    createdAt: Date.now(),
  });
  return `${tool}: ${status}${stdout ? ` - ${stdout.slice(0, 400)}` : ""}`;
}

function codeForRunbook(runbookId: string, args: Record<string, string>) {
  switch (runbookId) {
    case "diagnose_failed_ci": {
      return `
issue = ${JSON.stringify(args.issueOrPrNumber ?? "unknown")}
title = ${JSON.stringify(args.title ?? "unknown")}
sha = ${JSON.stringify(args.sha ?? "unknown")}
print({
  "runbook": "diagnose_failed_ci",
  "issueOrPrNumber": issue,
  "sha": sha,
  "next": "Review failing check logs in GitHub and comment with owner-safe next step.",
  "note": f"CI triage requested for {title}"
})
`;
    }
    case "summarize_github_queue": {
      return `
summary = ${JSON.stringify(args.summary ?? "")}
print({
  "runbook": "summarize_github_queue",
  "queue_summary": summary[:500],
  "next": "Prioritize talon-test, failed checks, stale reviews, then monitor."
})
`;
    }
    case "repo_typescript_checks": {
      const repoFullName = requireRepoFullName(args.repoFullName ?? "");
      if (!repoFullName) {
        throw new Error("repo_typescript_checks requires args.repoFullName");
      }
      const ref = requireGitRef(args.ref && args.ref.length > 0 ? args.ref : "main");
      const cloneUrl = args.cloneUrl;
      if (!cloneUrl) {
        throw new Error("repo_typescript_checks requires args.cloneUrl");
      }
      return `
import json
import os
import pathlib
import subprocess
import tempfile

repo = ${JSON.stringify(repoFullName)}
ref = ${JSON.stringify(ref)}
clone_url = ${JSON.stringify(cloneUrl)}

def run(cmd, cwd=None):
  p = subprocess.run(cmd, cwd=cwd, shell=False, capture_output=True, text=True)
  return {
    "cmd": " ".join(cmd),
    "code": p.returncode,
    "stdout": (p.stdout or "")[-3000:],
    "stderr": (p.stderr or "")[-3000:],
  }

def script_exists(scripts, name):
  return isinstance(scripts, dict) and isinstance(scripts.get(name), str) and len(scripts.get(name)) > 0

work = tempfile.mkdtemp(prefix="talon-repo-")
target = os.path.join(work, "repo")
steps = []
steps.append(run(["git", "clone", "--depth", "1", "--branch", ref, clone_url, target]))

if steps[-1]["code"] != 0:
  print(json.dumps({"repo": repo, "ref": ref, "status": "clone_failed", "steps": steps}))
  raise SystemExit(0)

pkg = pathlib.Path(target) / "package.json"
if not pkg.exists():
  print(json.dumps({"repo": repo, "ref": ref, "status": "no_package_json", "steps": steps}))
  raise SystemExit(0)

steps.append(run(["node", "-v"], cwd=target))
steps.append(run(["npm", "-v"], cwd=target))
steps.append(run(["npm", "ci", "--ignore-scripts"], cwd=target))

if steps[-1]["code"] == 0:
  steps.append(run(["npm", "run", "-s", "typecheck"], cwd=target))
  steps.append(run(["npm", "run", "-s", "lint"], cwd=target))
  steps.append(run(["npm", "run", "-s", "test"], cwd=target))

print(json.dumps({"repo": repo, "ref": ref, "status": "completed", "steps": steps}))
`;
    }
    default:
      throw new Error(`Runbook ${runbookId} is not approved`);
  }
}

function normalizeRunbookOutput(execution: {
  text?: string;
  results?: unknown[];
  logs?: { stdout?: string[]; stderr?: string[] };
  error?: { value?: string };
}) {
  const stdout = execution.logs?.stdout?.join("").trim() ?? "";
  const stderr = execution.logs?.stderr?.join("").trim() ?? "";
  const text = execution.text?.trim() ?? "";
  const results =
    Array.isArray(execution.results) && execution.results.length > 0
      ? JSON.stringify(execution.results)
      : "";
  return {
    stdout: stdout || text || results || "Runbook executed without textual output.",
    stderr: stderr || execution.error?.value || "",
  };
}

async function executeRunbook(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  runbookId: string,
  args: Record<string, string>,
) {
  const startedAt = Date.now();
  if (!env("E2B_API_KEY")) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "E2B",
      { runbookId, args },
      "skipped",
      "E2B_API_KEY missing. Diagnostic skipped safely.",
      "",
      startedAt,
    );
  }

  try {
    const secretsToRedact: string[] = [];
    const nextArgs = { ...args };
    if (runbookId === "repo_typescript_checks") {
      const token = await createInstallationToken();
      const repoFullName = requireRepoFullName(args.repoFullName ?? "");
      nextArgs.repoFullName = repoFullName;
      nextArgs.ref = requireGitRef(
        args.ref && args.ref.length > 0 ? args.ref : "main",
      );
      const cloneUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
      nextArgs.cloneUrl = cloneUrl;
      secretsToRedact.push(token, cloneUrl);
    }
    const code = codeForRunbook(runbookId, nextArgs);
    const sandbox = await Sandbox.create();
    const execution = await sandbox.runCode(code, { language: "python" });
    const normalized = normalizeRunbookOutput(execution);
    const stdout = redactSecrets(normalized.stdout, secretsToRedact);
    const stderr = redactSecrets(normalized.stderr, secretsToRedact);
    const safeArgs: Record<string, string> = { ...nextArgs };
    if (safeArgs.cloneUrl) {
      safeArgs.cloneUrl = "[REDACTED]";
    }
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "E2B",
      { runbookId, args: safeArgs },
      "success",
      stdout,
      stderr,
      startedAt,
    );
  } catch (error) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "E2B",
      { runbookId, args },
      "error",
      "",
      safeMessage(error),
      startedAt,
    );
  }
}

async function githubRequest(
  path: string,
  token: string,
  init?: { method?: string; body?: unknown },
) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`GitHub ${res.status} ${res.statusText} on ${path}`);
  }
  return await res.json();
}

async function resolveRepoFullName(token: string, actionArgs: Record<string, string>) {
  const fullName =
    actionArgs.repoFullName ||
    (actionArgs.owner && actionArgs.repo
      ? `${actionArgs.owner}/${actionArgs.repo}`
      : "") ||
    (await defaultInstalledRepo(token));
  return fullName ? requireRepoFullName(fullName) : null;
}

async function postGitHubComment(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  issueOrPrNumber: number,
  body: string,
  actionArgs: Record<string, string>,
) {
  const startedAt = Date.now();
  const token = await createInstallationToken().catch(() => null);
  if (!token) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { issueOrPrNumber },
      "skipped",
      "GitHub comment skipped because GitHub App env is missing.",
      "",
      startedAt,
    );
  }
  const fullName = await resolveRepoFullName(token, actionArgs);
  if (!fullName) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { issueOrPrNumber },
      "skipped",
      "GitHub comment skipped because no installed repository was found.",
      "",
      startedAt,
    );
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${fullName}/issues/${issueOrPrNumber}/comments`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        body: JSON.stringify({ body: body.slice(0, 6000) }),
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub ${res.status} ${res.statusText}`);
    }
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { repoFullName: fullName, issueOrPrNumber },
      "success",
      `Posted comment on ${fullName}#${issueOrPrNumber}.`,
      "",
      startedAt,
    );
  } catch (error) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { repoFullName: fullName, issueOrPrNumber },
      "error",
      "",
      safeMessage(error),
      startedAt,
    );
  }
}

async function inspectGitHub(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  issueOrPrNumber: number | undefined,
  actionArgs: Record<string, string>,
) {
  const startedAt = Date.now();
  const token = await createInstallationToken().catch(() => null);
  if (!token) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { issueOrPrNumber, ...actionArgs },
      "skipped",
      "GitHub inspect skipped because GitHub App env is missing.",
      "",
      startedAt,
    );
  }
  const fullName = await resolveRepoFullName(token, actionArgs);
  if (!fullName) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { issueOrPrNumber, ...actionArgs },
      "skipped",
      "GitHub inspect skipped because no installed repository was found.",
      "",
      startedAt,
    );
  }

  try {
    if (issueOrPrNumber) {
      let detail: GitHubIssueDetail | GitHubPullDetail;
      let kind = "issue";
      try {
        detail = (await githubRequest(
          `/repos/${fullName}/pulls/${issueOrPrNumber}`,
          token,
        )) as GitHubPullDetail;
        kind = "pull_request";
      } catch {
        detail = (await githubRequest(
          `/repos/${fullName}/issues/${issueOrPrNumber}`,
          token,
        )) as GitHubIssueDetail;
      }
      return await logToolRun(
        ctx,
        orgId,
        employeeId,
        loopId,
        "GitHub",
        { repoFullName: fullName, issueOrPrNumber },
        "success",
        JSON.stringify({
          kind,
          number: detail.number,
          title: detail.title,
          state: detail.state,
          url: detail.html_url,
          labels: detail.labels?.map((label) => label.name).filter(Boolean),
          assignees: detail.assignees
            ?.map((assignee) => assignee.login)
            .filter(Boolean),
          mergeable:
            "mergeable" in detail ? detail.mergeable : undefined,
          draft: "draft" in detail ? detail.draft : undefined,
        }),
        "",
        startedAt,
      );
    }

    const [issues, pulls] = await Promise.all([
      githubRequest(`/repos/${fullName}/issues?state=open&per_page=10`, token),
      githubRequest(`/repos/${fullName}/pulls?state=open&per_page=10`, token),
    ]);
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { repoFullName: fullName },
      "success",
      JSON.stringify({
        repo: fullName,
        openIssues: Array.isArray(issues) ? issues.length : 0,
        openPulls: Array.isArray(pulls) ? pulls.length : 0,
      }),
      "",
      startedAt,
    );
  } catch (error) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { repoFullName: fullName, issueOrPrNumber },
      "error",
      "",
      safeMessage(error),
      startedAt,
    );
  }
}

async function openGitHubIssue(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  actionArgs: Record<string, string>,
) {
  const startedAt = Date.now();
  const token = await createInstallationToken().catch(() => null);
  if (!token) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", actionArgs, "skipped", "GitHub issue open skipped because GitHub App env is missing.", "", startedAt);
  }
  const fullName = await resolveRepoFullName(token, actionArgs);
  const title = actionArgs.title?.trim();
  if (!fullName || !title) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", actionArgs, "skipped", "OPEN_GITHUB_ISSUE requires repoFullName and args.title.", "", startedAt);
  }

  try {
    const payload = await githubRequest(`/repos/${fullName}/issues`, token, {
      method: "POST",
      body: {
        title: title.slice(0, 240),
        body: (actionArgs.body ?? "Opened by Talon autonomous employee.").slice(0, 6000),
        labels: parseCsv(actionArgs.labels, 10).map((label) => label.slice(0, 80)),
      },
    });
    const number = (payload as { number?: number }).number ?? "unknown";
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", actionArgs, "success", `Opened issue #${number} on ${fullName}.`, "", startedAt);
  } catch (error) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", actionArgs, "error", "", safeMessage(error), startedAt);
  }
}

async function labelGitHubIssue(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  issueOrPrNumber: number | undefined,
  actionArgs: Record<string, string>,
) {
  const startedAt = Date.now();
  const token = await createInstallationToken().catch(() => null);
  if (!token) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "skipped", "GitHub label skipped because GitHub App env is missing.", "", startedAt);
  }
  const fullName = await resolveRepoFullName(token, actionArgs);
  const labels = parseCsv(actionArgs.labels, 10).map((label) => label.slice(0, 80));
  if (!fullName || !issueOrPrNumber || labels.length === 0) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "skipped", "LABEL_GITHUB_ISSUE requires issueOrPrNumber and args.labels.", "", startedAt);
  }

  try {
    await githubRequest(`/repos/${fullName}/issues/${issueOrPrNumber}/labels`, token, {
      method: "POST",
      body: { labels },
    });
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "success", `Added labels to ${fullName}#${issueOrPrNumber}: ${labels.join(", ")}.`, "", startedAt);
  } catch (error) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "error", "", safeMessage(error), startedAt);
  }
}

async function closeGitHubIssue(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  issueOrPrNumber: number | undefined,
  actionArgs: Record<string, string>,
) {
  const startedAt = Date.now();
  const token = await createInstallationToken().catch(() => null);
  if (!token) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "skipped", "GitHub close skipped because GitHub App env is missing.", "", startedAt);
  }
  const fullName = await resolveRepoFullName(token, actionArgs);
  if (!fullName || !issueOrPrNumber) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "skipped", "CLOSE_GITHUB_ISSUE requires issueOrPrNumber.", "", startedAt);
  }

  try {
    await githubRequest(`/repos/${fullName}/issues/${issueOrPrNumber}`, token, {
      method: "PATCH",
      body: {
        state: "closed",
        state_reason: actionArgs.stateReason === "not_planned" ? "not_planned" : "completed",
      },
    });
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "success", `Closed ${fullName}#${issueOrPrNumber}.`, "", startedAt);
  } catch (error) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "error", "", safeMessage(error), startedAt);
  }
}

async function requestGitHubReview(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  issueOrPrNumber: number | undefined,
  actionArgs: Record<string, string>,
) {
  const startedAt = Date.now();
  const token = await createInstallationToken().catch(() => null);
  if (!token) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "skipped", "GitHub review request skipped because GitHub App env is missing.", "", startedAt);
  }
  const fullName = await resolveRepoFullName(token, actionArgs);
  const reviewers = parseCsv(actionArgs.reviewers, 10).filter((reviewer) =>
    GITHUB_NAME_RE.test(reviewer),
  );
  if (!fullName || !issueOrPrNumber || reviewers.length === 0) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "skipped", "REQUEST_GITHUB_REVIEW requires issueOrPrNumber and args.reviewers.", "", startedAt);
  }

  try {
    await githubRequest(
      `/repos/${fullName}/pulls/${issueOrPrNumber}/requested_reviewers`,
      token,
      {
        method: "POST",
        body: { reviewers },
      },
    );
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "success", `Requested review on ${fullName}#${issueOrPrNumber}: ${reviewers.join(", ")}.`, "", startedAt);
  } catch (error) {
    return await logToolRun(ctx, orgId, employeeId, loopId, "GitHub", { issueOrPrNumber, ...actionArgs }, "error", "", safeMessage(error), startedAt);
  }
}

async function openGitHubPr(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  actionArgs: Record<string, string>,
) {
  const startedAt = Date.now();
  const token = await createInstallationToken().catch(() => null);
  if (!token) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      actionArgs,
      "skipped",
      "GitHub PR open skipped because GitHub App env is missing.",
      "",
      startedAt,
    );
  }
  const fullName = await resolveRepoFullName(token, actionArgs);
  if (!fullName) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      actionArgs,
      "skipped",
      "GitHub PR open skipped because no installed repository was found.",
      "",
      startedAt,
    );
  }
  const head = actionArgs.head;
  const base = actionArgs.base ?? "main";
  const title = actionArgs.title;
  if (!head || !title) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      actionArgs,
      "skipped",
      "OPEN_GITHUB_PR requires args.head and args.title.",
      "",
      startedAt,
    );
  }

  try {
    const payload = await githubRequest(`/repos/${fullName}/pulls`, token, {
      method: "POST",
      body: {
        title: title.slice(0, 240),
        head,
        base,
        body: (actionArgs.body ?? "Opened by Talon autonomous employee.").slice(0, 6000),
      },
    });
    const prNumber = (payload as { number?: number }).number ?? "unknown";
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      actionArgs,
      "success",
      `Opened PR #${prNumber} on ${fullName}.`,
      "",
      startedAt,
    );
  } catch (error) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      actionArgs,
      "error",
      "",
      safeMessage(error),
      startedAt,
    );
  }
}

async function mergeGitHubPr(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  issueOrPrNumber: number | undefined,
  actionArgs: Record<string, string>,
) {
  const startedAt = Date.now();
  const token = await createInstallationToken().catch(() => null);
  if (!token) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { issueOrPrNumber, ...actionArgs },
      "skipped",
      "GitHub PR merge skipped because GitHub App env is missing.",
      "",
      startedAt,
    );
  }
  const fullName = await resolveRepoFullName(token, actionArgs);
  if (!fullName) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { issueOrPrNumber, ...actionArgs },
      "skipped",
      "GitHub PR merge skipped because no installed repository was found.",
      "",
      startedAt,
    );
  }
  if (!issueOrPrNumber) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      actionArgs,
      "skipped",
      "MERGE_GITHUB_PR requires issueOrPrNumber.",
      "",
      startedAt,
    );
  }

  try {
    const mergeMethod =
      actionArgs.mergeMethod === "squash" || actionArgs.mergeMethod === "rebase"
        ? actionArgs.mergeMethod
        : "merge";
    const payload = await githubRequest(
      `/repos/${fullName}/pulls/${issueOrPrNumber}/merge`,
      token,
      {
        method: "PUT",
        body: {
          commit_title: (actionArgs.commitTitle ?? `Merge PR #${issueOrPrNumber}`).slice(0, 240),
          merge_method: mergeMethod,
        },
      },
    );
    const merged = Boolean((payload as { merged?: boolean }).merged);
    if (!merged) {
      throw new Error(`GitHub refused merge for ${fullName}#${issueOrPrNumber}`);
    }
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { issueOrPrNumber, ...actionArgs },
      "success",
      `Merged PR #${issueOrPrNumber} on ${fullName} with ${mergeMethod}.`,
      "",
      startedAt,
    );
  } catch (error) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      "GitHub",
      { issueOrPrNumber, ...actionArgs },
      "error",
      "",
      safeMessage(error),
      startedAt,
    );
  }
}

async function postSlack(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  loopId: string,
  kind: "Slack" | "Escalation",
  message: string,
) {
  const startedAt = Date.now();
  const webhook = env("SLACK_WEBHOOK_URL");
  if (!webhook) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      kind,
      { message },
      "skipped",
      "SLACK_WEBHOOK_URL missing. Message logged but not sent.",
      "",
      startedAt,
    );
  }

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message.slice(0, 3000) }),
    });
    if (!res.ok) {
      throw new Error(`Slack ${res.status} ${res.statusText}`);
    }
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      kind,
      { message },
      "success",
      "Slack message sent.",
      "",
      startedAt,
    );
  } catch (error) {
    return await logToolRun(
      ctx,
      orgId,
      employeeId,
      loopId,
      kind,
      { message },
      "error",
      "",
      safeMessage(error),
      startedAt,
    );
  }
}

export const execute = internalAction({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    loopId: v.string(),
    action: nextAction,
  },
  handler: async (ctx, args) => {
    const action = args.action;
    if (action.type === "RUN_RUNBOOK") {
      return await executeRunbook(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        action.runbookId ?? "repo_typescript_checks",
        action.args ?? {},
      );
    }
    if (action.type === "INSPECT_GITHUB") {
      return await inspectGitHub(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        action.issueOrPrNumber,
        action.args ?? {},
      );
    }
    if (action.type === "COMMENT_GITHUB") {
      if (!action.issueOrPrNumber || !action.body) {
        return await logToolRun(
          ctx,
          args.orgId,
          args.employeeId,
          args.loopId,
          "GitHub",
          action,
          "skipped",
          "Missing issueOrPrNumber or body.",
          "",
          Date.now(),
        );
      }
      return await postGitHubComment(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        action.issueOrPrNumber,
        action.body,
        action.args ?? {},
      );
    }
    if (action.type === "OPEN_GITHUB_ISSUE") {
      return await openGitHubIssue(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        action.args ?? {},
      );
    }
    if (action.type === "LABEL_GITHUB_ISSUE") {
      return await labelGitHubIssue(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        action.issueOrPrNumber,
        action.args ?? {},
      );
    }
    if (action.type === "CLOSE_GITHUB_ISSUE") {
      return await closeGitHubIssue(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        action.issueOrPrNumber,
        action.args ?? {},
      );
    }
    if (action.type === "OPEN_GITHUB_PR") {
      return await openGitHubPr(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        action.args ?? {},
      );
    }
    if (action.type === "REQUEST_GITHUB_REVIEW") {
      return await requestGitHubReview(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        action.issueOrPrNumber,
        action.args ?? {},
      );
    }
    if (action.type === "MERGE_GITHUB_PR") {
      return await mergeGitHubPr(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        action.issueOrPrNumber,
        action.args ?? {},
      );
    }
    if (action.type === "SEND_SLACK") {
      return await postSlack(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        "Slack",
        action.message ?? action.note ?? "Talon status update.",
      );
    }
    if (action.type === "ESCALATE") {
      return await postSlack(
        ctx,
        args.orgId,
        args.employeeId,
        args.loopId,
        "Escalation",
        `Talon escalation: ${action.reason ?? "Autonomy boundary reached"}\nOwner: ${action.recommendedOwner ?? "operator"}`,
      );
    }

    return await logToolRun(
      ctx,
      args.orgId,
      args.employeeId,
      args.loopId,
      "Monitor",
      action,
      "success",
      action.note ?? "Monitoring only.",
      "",
      Date.now(),
    );
  },
});
