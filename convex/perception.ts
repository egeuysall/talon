"use node";

import { createSign } from "node:crypto";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

type Signal = {
  source: "github" | "deployment" | "slack" | "self";
  severity: "info" | "warning" | "critical";
  title: string;
  summary: string;
  url?: string;
};

type GitHubLabel = { name?: string };
type GitHubIssue = {
  number?: number;
  title?: string;
  labels?: GitHubLabel[];
  html_url?: string;
  updated_at?: string;
};
type GitHubRepo = {
  full_name?: string;
  html_url?: string;
};

const USER_AGENT = "talon-autonomous-employee";
const GITHUB_API_VERSION = "2022-11-28";

function env(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
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

async function listInstalledRepos(token: string) {
  const payload = (await githubJson(
    "/installation/repositories?per_page=100",
    token,
  )) as { repositories?: GitHubRepo[] };
  return Array.isArray(payload.repositories) ? payload.repositories : [];
}

async function writeSignals(
  ctx: ActionCtx,
  orgId: string,
  employeeId: string,
  signals: Signal[],
) {
  const now = Date.now();
  for (const signal of signals.slice(0, 30)) {
    await ctx.runMutation(internal.records.insertSignal, {
      ...signal,
      orgId,
      employeeId,
      createdAt: now,
    });
  }
}

export const collectGitHubSignals = internalAction({
  args: { orgId: v.string(), employeeId: v.string() },
  handler: async (ctx, args) => {
    if (!env("GITHUB_APP_ID") || !githubPrivateKey()) {
      const signals: Signal[] = [
        {
          source: "github",
          severity: "warning",
          title: "GitHub unconfigured",
          summary:
            "GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY is missing.",
        },
      ];
      await writeSignals(ctx, args.orgId, args.employeeId, signals);
      return signals;
    }

    try {
      const token = await createInstallationToken();
      const repos = (await listInstalledRepos(token))
        .filter((repo) => repo.full_name)
        .slice(0, 10);
      if (!repos.length) {
        const signals: Signal[] = [
          {
            source: "github",
            severity: "warning",
            title: "GitHub App has no repositories",
            summary:
              "Install the GitHub App on at least one repository or organization.",
          },
        ];
        await writeSignals(ctx, args.orgId, args.employeeId, signals);
        return signals;
      }

      const signals: Signal[] = [];
      for (const repo of repos) {
        const fullName = repo.full_name as string;
        const [issues, pulls] = await Promise.all([
          githubJson(`/repos/${fullName}/issues?state=open&per_page=20`, token),
          githubJson(`/repos/${fullName}/pulls?state=open&per_page=10`, token),
        ]);
        const issueRows: GitHubIssue[] = Array.isArray(issues) ? issues : [];
        const pullRows: GitHubIssue[] = Array.isArray(pulls) ? pulls : [];
        const labeledTest = issueRows.filter((item) =>
          item.labels?.some((label) => label.name === "talon-test"),
        );
        const stalePulls = pullRows.filter((item) => {
          const updated = Date.parse(item.updated_at ?? "");
          return (
            Number.isFinite(updated) &&
            Date.now() - updated > 3 * 24 * 60 * 60 * 1000
          );
        });

        signals.push({
          source: "github",
          severity: labeledTest.length > 0 ? "warning" : "info",
          title: `${fullName} open queue`,
          summary: `${issueRows.length} open issue-like items, ${pullRows.length} open PRs, ${labeledTest.length} talon-test issues.`,
          url: `https://github.com/${fullName}/issues`,
        });

        for (const issue of labeledTest.slice(0, 5)) {
          signals.push({
            source: "github",
            severity: "warning",
            title: `${fullName} test issue #${issue.number}: ${issue.title}`,
            summary: `Issue is labeled talon-test and ready for autonomous triage.`,
            url: issue.html_url,
          });
        }

        for (const pull of stalePulls.slice(0, 3)) {
          signals.push({
            source: "github",
            severity: "warning",
            title: `${fullName} stale PR #${pull.number}: ${pull.title}`,
            summary: `PR has not updated since ${pull.updated_at}.`,
            url: pull.html_url,
          });
        }
      }

      await writeSignals(ctx, args.orgId, args.employeeId, signals);
      return signals;
    } catch (error) {
      const signals: Signal[] = [
        {
          source: "github",
          severity: "warning",
          title: "GitHub collection failed",
          summary: safeMessage(error),
        },
      ];
      await writeSignals(ctx, args.orgId, args.employeeId, signals);
      return signals;
    }
  },
});

export const collectDeploymentSignals = internalAction({
  args: { orgId: v.string(), employeeId: v.string() },
  handler: async (ctx, args) => {
    const vercelSignal: Signal = env("VERCEL_OIDC_TOKEN")
      ? {
          source: "deployment",
          severity: "info",
          title: "Vercel identity present",
          summary:
            "VERCEL_OIDC_TOKEN is present. Deployment surface is configured for follow-up integration.",
        }
      : {
          source: "deployment",
          severity: "warning",
          title: "Vercel integration unconfigured",
          summary:
            "VERCEL_OIDC_TOKEN is missing. Deployment signal collection is limited.",
        };

    const signals = [vercelSignal];
    await writeSignals(ctx, args.orgId, args.employeeId, signals);
    return signals;
  },
});

export const collectSlackSignals = internalAction({
  args: { orgId: v.string(), employeeId: v.string() },
  handler: async (ctx, args) => {
    const signals: Signal[] = [];
    const webhook = env("SLACK_WEBHOOK_URL");
    const botToken = env("SLACK_BOT_TOKEN");
    const channelIds = (env("SLACK_CHANNEL_IDS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 10);

    if (!webhook) {
      signals.push({
        source: "slack",
        severity: "warning",
        title: "Slack outbound unconfigured",
        summary:
          "SLACK_WEBHOOK_URL is missing. Talon will log Slack actions as skipped.",
      });
    } else {
      signals.push({
        source: "slack",
        severity: "info",
        title: "Slack outbound configured",
        summary: "SLACK_WEBHOOK_URL is present.",
      });
    }

    if (!botToken || channelIds.length === 0) {
      signals.push({
        source: "slack",
        severity: "warning",
        title: "Slack intake limited",
        summary:
          "Set SLACK_BOT_TOKEN and SLACK_CHANNEL_IDS (comma-separated channel IDs) to ingest inbound Slack signals.",
      });
      await writeSignals(ctx, args.orgId, args.employeeId, signals);
      return signals;
    }

    try {
      let inboundCount = 0;
      for (const channelId of channelIds) {
        const res = await fetch(
          `https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&limit=5`,
          {
            headers: {
              Authorization: `Bearer ${botToken}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          },
        );
        if (!res.ok) {
          throw new Error(`Slack history ${res.status} ${res.statusText}`);
        }
        const payload = (await res.json()) as {
          ok?: boolean;
          error?: string;
          messages?: Array<{ text?: string; ts?: string; user?: string }>;
        };
        if (!payload.ok) {
          throw new Error(payload.error ?? "Slack API error");
        }
        const messages = payload.messages ?? [];
        inboundCount += messages.length;
        for (const message of messages.slice(0, 2)) {
          signals.push({
            source: "slack",
            severity: "info",
            title: `Slack inbound ${channelId}`,
            summary: (message.text ?? "No text").slice(0, 300),
          });
        }
      }
      signals.push({
        source: "slack",
        severity: "info",
        title: "Slack intake active",
        summary: `Read ${inboundCount} recent messages across ${channelIds.length} channels.`,
      });
    } catch (error) {
      signals.push({
        source: "slack",
        severity: "warning",
        title: "Slack intake failed",
        summary: safeMessage(error),
      });
    }
    await writeSignals(ctx, args.orgId, args.employeeId, signals);
    return signals;
  },
});

export const collectAll = internalAction({
  args: { orgId: v.string(), employeeId: v.string() },
  handler: async (ctx, args): Promise<Signal[]> => {
    const [github, deployment, slack]: [Signal[], Signal[], Signal[]] = await Promise.all([
      ctx.runAction(internal.perception.collectGitHubSignals, args),
      ctx.runAction(internal.perception.collectDeploymentSignals, args),
      ctx.runAction(internal.perception.collectSlackSignals, args),
    ]);
    return [...github, ...deployment, ...slack];
  },
});

export const normalizeSignals = internalAction({
  args: {
    orgId: v.string(),
    employeeId: v.string(),
    source: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const signal: Signal = {
      source: "self",
      severity: "info",
      title: args.source.slice(0, 80),
      summary: args.summary.slice(0, 1000),
    };
    await writeSignals(ctx, args.orgId, args.employeeId, [signal]);
    return [signal];
  },
});
