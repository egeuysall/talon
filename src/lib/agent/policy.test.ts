import { describe, expect, test } from "bun:test";
import {
  decideActionPolicy,
  fingerprintSignals,
  shouldSkipModel,
} from "./policy";

describe("agent policy", () => {
  test("requires approval for high-risk GitHub merges", () => {
    const result = decideActionPolicy(
      {
        type: "MERGE_GITHUB_PR",
        issueOrPrNumber: 42,
        args: { repoFullName: "acme/web" },
      },
      "autonomous",
    );

    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.risk).toBe("high");
  });

  test("allows low-risk monitoring without approval", () => {
    const result = decideActionPolicy(
      { type: "MONITOR", note: "No change." },
      "autonomous",
    );

    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.risk).toBe("low");
  });

  test("supervised mode asks approval for PR creation", () => {
    const result = decideActionPolicy(
      {
        type: "OPEN_GITHUB_PR",
        args: { repoFullName: "acme/web", head: "talon/fix", title: "fix" },
      },
      "supervised",
    );

    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.risk).toBe("medium");
  });

  test("autonomous mode asks approval for medium-risk external actions", () => {
    const result = decideActionPolicy(
      {
        type: "CLOSE_GITHUB_ISSUE",
        issueOrPrNumber: 12,
        args: { repoFullName: "acme/web" },
      },
      "autonomous",
    );

    expect(result.allowed).toBe(false);
    expect(result.requiresApproval).toBe(true);
    expect(result.risk).toBe("medium");
  });
});

describe("signal digest", () => {
  test("stable across ordering and noisy timestamps", () => {
    const first = fingerprintSignals([
      {
        source: "github",
        severity: "warning",
        title: "acme/web stale PR #7",
        summary: "updated 3 days ago",
        createdAt: 1,
      },
      {
        source: "slack",
        severity: "info",
        title: "Slack inbound C1",
        summary: "login broken",
        createdAt: 2,
      },
    ]);
    const second = fingerprintSignals([
      {
        source: "slack",
        severity: "info",
        title: "Slack inbound C1",
        summary: "login broken",
        createdAt: 999,
      },
      {
        source: "github",
        severity: "warning",
        title: "acme/web stale PR #7",
        summary: "updated 3 days ago",
        createdAt: 888,
      },
    ]);

    expect(first).toBe(second);
  });

  test("skips model when digest unchanged and no due work exists", () => {
    expect(
      shouldSkipModel({
        previousDigest: "abc",
        nextDigest: "abc",
        dueFollowUps: 0,
        openFailures: 0,
        pendingApprovals: 0,
      }),
    ).toBe(true);
  });
});
