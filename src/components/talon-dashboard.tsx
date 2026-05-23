"use client";

import {
  OrganizationSwitcher,
  UserButton,
  useAuth,
  useOrganizationList,
} from "@clerk/nextjs";
import {
  AlertTriangleIcon,
  BrainIcon,
  CheckCircleIcon,
  ClockIcon,
  GaugeIcon,
  PlusIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from "lucide-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Streamdown } from "streamdown";
import { api } from "../../convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function timeAgo(value?: number) {
  if (!value) return "Never";
  const seconds = Math.max(1, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return new Date(value).toLocaleString();
}

function formatDue(value?: number, now = Date.now()) {
  if (!value) return "Not scheduled";
  const delta = value - now;
  if (Math.abs(delta) < 60_000) return "now";
  const minutes = Math.round(Math.abs(delta) / 60_000);
  const label =
    minutes < 60
      ? `${minutes}m`
      : minutes < 48 * 60
        ? `${Math.round(minutes / 60)}h`
        : `${Math.round(minutes / 1440)}d`;
  return delta > 0 ? `in ${label}` : `${label} overdue`;
}

function formatGraphLabel(key: string) {
  return key
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusTone(status?: string) {
  if (status === "error") return "destructive";
  if (status === "running") return "default";
  if (status === "paused") return "secondary";
  return "outline";
}

function LoadingDashboard() {
  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 md:p-6">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export function TalonDashboard() {
  const { isLoaded: authLoaded, orgId: rawOrgId, orgRole } = useAuth();
  const orgId = rawOrgId ?? null;
  const [selection, setSelection] = useState<{
    orgId: string | null;
    employeeId: string | null;
  }>({ orgId: null, employeeId: null });
  const [activeTab, setActiveTab] = useState<
    "activity" | "approvals" | "signals" | "memory" | "tools"
  >("activity");
  const [activePage, setActivePage] = useState<"overview" | "agents">(
    "overview",
  );
  const [selectedGraphKey, setSelectedGraphKey] = useState<string | null>(null);
  const toolsSectionRef = useRef<HTMLDivElement | null>(null);
  const memorySectionRef = useRef<HTMLDivElement | null>(null);
  const activatingOrgId = useRef<string | null>(null);
  const ensuredScopeId = useRef<string | null>(null);
  const { setActive, userMemberships } = useOrganizationList({
    userMemberships: true,
  });
  const selectedEmployeeId =
    selection.orgId === orgId ? selection.employeeId : null;

  const data = useQuery(api.records.getDashboard, {
    employeeId: selectedEmployeeId ?? undefined,
  });
  const launchEmployee = useMutation(api.records.launchEmployee);
  const rejectApproval = useMutation(api.records.rejectApproval);
  const runApprovedAction = useAction(api.dashboard.runApprovedAction);
  const ensureDefaultEmployee = useMutation(
    api.records.ensureDefaultEmployeeForOrg,
  );
  const [isPending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentRole, setNewAgentRole] = useState("Ops Generalist");
  const [newAgentGoal, setNewAgentGoal] = useState("");
  const [renderNow] = useState(() => Date.now());

  useEffect(() => {
    if (!authLoaded || orgId || activatingOrgId.current) return;
    const firstOrganizationId = userMemberships.data?.[0]?.organization.id;
    if (!firstOrganizationId || !setActive) return;
    activatingOrgId.current = firstOrganizationId;
    void setActive({ organization: firstOrganizationId }).finally(() => {
      activatingOrgId.current = null;
    });
  }, [authLoaded, orgId, setActive, userMemberships.data]);

  useEffect(() => {
    if (
      !orgId ||
      !data ||
      data.needsOrganization ||
      (data.agents?.length ?? 0) > 0
    ) {
      return;
    }
    const scopeId = orgId ?? "user-scope";
    if (ensuredScopeId.current === scopeId) return;
    ensuredScopeId.current = scopeId;
    void ensureDefaultEmployee()
      .then((result) => {
        setSelection({ orgId, employeeId: result.employeeId });
      })
      .catch(() => {
        ensuredScopeId.current = null;
      });
  }, [data, ensureDefaultEmployee, orgId]);

  if (data === undefined || !authLoaded) return <LoadingDashboard />;

  const state = data.state;
  const agents = data.agents ?? [];
  const episodicLogs = data.episodicLogs ?? [];
  const tasks = data.tasks ?? [];
  const signals = data.signals ?? [];
  const semanticMemory = data.semanticMemory ?? [];
  const toolRuns = data.toolRuns ?? [];
  const approvalRequests = data.approvalRequests ?? [];
  const followUps = data.followUps ?? [];
  const memoryInsights = data.memoryInsights ?? [];
  const latestLog = episodicLogs[0];
  const canAdmin = orgRole === "org:admin" || orgRole === "admin";
  const excludedGraphKeys = new Set([
    "employee_role",
    "autonomy_boundary",
    "tool_policy",
    "watched_systems",
  ]);
  const graphEntries = semanticMemory
    .filter((entry) => !excludedGraphKeys.has(entry.key))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, 16);
  const failedTasks = tasks.filter((task) => task.status === "action_failed");
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const pendingApprovalCount = approvalRequests.length;
  const dueFollowUps = followUps.filter(
    (followUp) => followUp.dueAt <= renderNow,
  );

  const activityItems = (() => {
    const items: Array<{
      id: string;
      time: number;
      type: "signal" | "tool" | "memory";
      title: string;
      body: string;
      meta: string;
    }> = [];

    for (const signal of signals.slice(0, 50)) {
      items.push({
        id: `signal:${signal._id}`,
        time: signal.createdAt,
        type: "signal",
        title: signal.title,
        body: signal.summary,
        meta: `${signal.source} · ${signal.severity}`,
      });
    }

    for (const runRow of toolRuns.slice(0, 50)) {
      items.push({
        id: `tool:${runRow._id}`,
        time: runRow.createdAt,
        type: "tool",
        title: `${runRow.tool} ${runRow.status}`,
        body: runRow.stdout || runRow.stderr || "No output",
        meta: `${runRow.durationMs}ms`,
      });
    }

    for (const log of episodicLogs.slice(0, 50)) {
      items.push({
        id: `memory:${log._id}`,
        time: log.createdAt,
        type: "memory",
        title: "Decision",
        body: log.reasoningSummary,
        meta: log.loopId.slice(0, 8),
      });
    }

    return items.sort((a, b) => b.time - a.time).slice(0, 120);
  })();

  function run(label: string, fn: () => Promise<unknown>) {
    setPendingLabel(label);
    startTransition(async () => {
      try {
        await fn();
      } finally {
        setPendingLabel(null);
      }
    });
  }

  if (data.needsOrganization) {
    return (
      <main className="min-h-screen bg-background">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
          <div className="flex items-center justify-between border-b pb-3">
            <h1 className="text-xl font-semibold">Talon</h1>
            <div className="flex items-center gap-2">
              <OrganizationSwitcher
                hidePersonal
                afterSelectOrganizationUrl="/"
              />
              <UserButton />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Select workspace to continue.
          </p>
        </div>
      </main>
    );
  }

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Talon</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={activePage === "overview"}
                    tooltip="Overview"
                    onClick={() => setActivePage("overview")}
                  >
                    <GaugeIcon />
                    <span>Overview</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={activePage === "agents"}
                    tooltip="Agents"
                    onClick={() => setActivePage("agents")}
                  >
                    <PlusIcon />
                    <span>Agents</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Company Graph</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {graphEntries.length ? (
                  graphEntries.map((entry) => (
                    <SidebarMenuItem key={entry._id}>
                      <SidebarMenuButton
                        tooltip={entry.key}
                        onClick={() => {
                          setActivePage("overview");
                          setSelectedGraphKey(entry.key);
                          setActiveTab("memory");
                          memorySectionRef.current?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }}
                      >
                        <span className="truncate text-xs">
                          {formatGraphLabel(entry.key)}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                ) : (
                  <SidebarMenuItem>
                    <SidebarMenuButton disabled>
                      <span className="text-xs">No Context Yet</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="pb-2">
            <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/" />
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => {
                  setActivePage("overview");
                  setActiveTab("tools");
                  toolsSectionRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  });
                }}
              >
                <ShieldCheckIcon />
                <span>Safe Tools</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <main className="min-h-screen bg-background">
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
            <header className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold">Talon</h1>
              </div>
              <div className="flex items-center gap-2">
                <SidebarTrigger />
                <UserButton />
              </div>
            </header>

            {pendingLabel ? (
              <Alert>
                <AlertTitle>Working</AlertTitle>
                <AlertDescription>{pendingLabel}</AlertDescription>
              </Alert>
            ) : null}

            {activePage === "overview" ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Current Focus</CardTitle>
                    <CardDescription>
                      Active objective and latest work summary.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant={statusTone(state?.status)}>
                        {state?.status ?? "idle"}
                      </Badge>
                      <span className="text-muted-foreground">
                        last start {timeAgo(state?.lastLoopStartedAt)}
                      </span>
                      <span className="text-muted-foreground">
                        last finish {timeAgo(state?.lastLoopFinishedAt)}
                      </span>
                      <span className="text-muted-foreground">
                        next check {formatDue(state?.nextRunAt, renderNow)}
                      </span>
                    </div>
                    <p className="text-sm">
                      {state?.currentFocus ??
                        "No active objective yet. Launch employee to begin autonomous work."}
                    </p>
                    {latestLog ? (
                      <div className="border p-3 text-sm">
                        <p className="font-medium">Latest Outcome</p>
                        <p className="text-muted-foreground">
                          {latestLog.outcome}
                        </p>
                      </div>
                    ) : null}
                    {!state && canAdmin ? (
                      <Button
                        onClick={() =>
                          run("launch", async () => {
                            const result = await launchEmployee({
                              name: "Talon",
                              role: "Ops Generalist",
                              goal: "Monitor configured operational surfaces and take safe autonomous action.",
                              autonomyMode: "autonomous",
                            });
                            setSelection({
                              orgId,
                              employeeId: result.employeeId,
                            });
                          })
                        }
                        disabled={isPending}
                      >
                        Launch
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>

                <div className="grid gap-3 md:grid-cols-4">
                  <div className="border p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <ShieldCheckIcon className="size-4" />
                      Approvals
                    </div>
                    <p className="text-2xl font-semibold">
                      {pendingApprovalCount}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      waiting on operator
                    </p>
                  </div>
                  <div className="border p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <ClockIcon className="size-4" />
                      Follow-ups
                    </div>
                    <p className="text-2xl font-semibold">
                      {dueFollowUps.length}/{followUps.length}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      due / scheduled
                    </p>
                  </div>
                  <div className="border p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <AlertTriangleIcon className="size-4" />
                      Failures
                    </div>
                    <p className="text-2xl font-semibold">
                      {failedTasks.length + blockedTasks.length}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      retrying or blocked
                    </p>
                  </div>
                  <div className="border p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <BrainIcon className="size-4" />
                      Learned
                    </div>
                    <p className="text-2xl font-semibold">
                      {memoryInsights.length}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      proposed memory updates
                    </p>
                  </div>
                </div>

                {approvalRequests.length ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        Pending Approvals
                      </CardTitle>
                      <CardDescription>
                        Risky work stopped before execution.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {approvalRequests.map((approval) => (
                        <div key={approval._id} className="border p-3 text-sm">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                approval.risk === "high"
                                  ? "destructive"
                                  : "secondary"
                              }
                            >
                              {approval.risk}
                            </Badge>
                            <Badge variant="outline">
                              {approval.actionType}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {timeAgo(approval.requestedAt)}
                            </span>
                          </div>
                          <p className="font-medium">{approval.reason}</p>
                          <pre className="mt-2 max-h-28 overflow-auto bg-muted p-2 text-xs">
                            {approval.action}
                          </pre>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={isPending || !canAdmin}
                              onClick={() =>
                                run("approve-action", async () => {
                                  await runApprovedAction({
                                    employeeId:
                                      selectedEmployeeId ??
                                      data.state?.employeeId ??
                                      "",
                                    approvalId: approval._id,
                                  });
                                })
                              }
                            >
                              <CheckCircleIcon />
                              Approve and Run
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isPending || !canAdmin}
                              onClick={() =>
                                run("reject-action", async () => {
                                  await rejectApproval({
                                    approvalId: approval._id,
                                  });
                                })
                              }
                            >
                              <XCircleIcon />
                              Reject
                            </Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : null}

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Task Queue</CardTitle>
                    <CardDescription>
                      Prioritized work being handled autonomously.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-0 p-0">
                    {tasks.length ? (
                      tasks.map((task) => (
                        <div
                          key={task._id}
                          className="border-t p-4 first:border-t-0"
                        >
                          <div className="mb-1 flex items-center gap-2">
                            <Badge variant="outline">{task.priority}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {task.source}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {task.status}
                            </span>
                          </div>
                          <p className="font-medium">{task.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {task.rationale}
                          </p>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-sm text-muted-foreground">
                        No queued tasks.
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Tabs
                  value={activeTab}
                  onValueChange={(value) =>
                    setActiveTab(
                      value as
                        | "activity"
                        | "approvals"
                        | "signals"
                        | "memory"
                        | "tools",
                    )
                  }
                >
                  <TabsList>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                    <TabsTrigger value="approvals">Approvals</TabsTrigger>
                    <TabsTrigger value="signals">Signals</TabsTrigger>
                    <TabsTrigger value="memory">Memory</TabsTrigger>
                    <TabsTrigger value="tools">Tool Runs</TabsTrigger>
                  </TabsList>

                  <TabsContent value="activity">
                    <Card>
                      <CardHeader>
                        <CardTitle>Live Activity</CardTitle>
                        <CardDescription>
                          Real-time timeline of what the agent is seeing,
                          deciding, and doing.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-1">
                        <ScrollArea className="h-[360px] border bg-muted/30 p-2">
                          {activityItems.length ? (
                            <div className="space-y-2 font-mono text-xs">
                              {activityItems.map((item) => (
                                <div key={item.id} className="border p-2">
                                  <div className="mb-1 flex items-center justify-between">
                                    <span className="uppercase">
                                      {item.type}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {timeAgo(item.time)}
                                    </span>
                                  </div>
                                  <p className="font-semibold">{item.title}</p>
                                  <p className="text-muted-foreground">
                                    {item.meta}
                                  </p>
                                  <p className="mt-1 whitespace-pre-wrap">
                                    {item.body}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              No activity yet.
                            </p>
                          )}
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="approvals">
                    <Card>
                      <CardHeader>
                        <CardTitle>Accountability Queue</CardTitle>
                        <CardDescription>
                          Approvals, follow-ups, and blocked work.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {approvalRequests.length === 0 &&
                        followUps.length === 0 &&
                        failedTasks.length === 0 &&
                        blockedTasks.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            No operator action needed.
                          </p>
                        ) : null}
                        {followUps.map((followUp) => (
                          <div
                            key={followUp._id}
                            className="border p-3 text-sm"
                          >
                            <div className="mb-1 flex items-center gap-2">
                              <Badge variant="outline">follow-up</Badge>
                              <span className="text-xs text-muted-foreground">
                                {formatDue(followUp.dueAt, renderNow)}
                              </span>
                            </div>
                            <p className="font-medium">{followUp.taskTitle}</p>
                            <p className="text-muted-foreground">
                              {followUp.reason}
                            </p>
                          </div>
                        ))}
                        {[...failedTasks, ...blockedTasks].map((task) => (
                          <div key={task._id} className="border p-3 text-sm">
                            <div className="mb-1 flex items-center gap-2">
                              <Badge
                                variant={
                                  task.status === "blocked"
                                    ? "destructive"
                                    : "secondary"
                                }
                              >
                                {task.status}
                              </Badge>
                              <Badge variant="outline">{task.source}</Badge>
                              {task.nextAttemptAt ? (
                                <span className="text-xs text-muted-foreground">
                                  retry {formatDue(task.nextAttemptAt, renderNow)}
                                </span>
                              ) : null}
                            </div>
                            <p className="font-medium">{task.title}</p>
                            <p className="text-muted-foreground">
                              {task.lastError || task.rationale}
                            </p>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="signals">
                    <Card>
                      <CardContent className="pt-4">
                        <ScrollArea className="h-[300px] pr-2">
                          {signals.length ? (
                            <div className="space-y-3">
                              {signals.map((signal) => (
                                <div
                                  key={signal._id}
                                  className="border p-3 text-sm"
                                >
                                  <div className="mb-1 flex items-center gap-2">
                                    <Badge variant="outline">
                                      {signal.source}
                                    </Badge>
                                    <Badge
                                      variant={
                                        signal.severity === "critical"
                                          ? "destructive"
                                          : "secondary"
                                      }
                                    >
                                      {signal.severity}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {timeAgo(signal.createdAt)}
                                    </span>
                                  </div>
                                  <p className="font-medium">{signal.title}</p>
                                  <p className="text-muted-foreground">
                                    {signal.summary}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              No signals yet.
                            </p>
                          )}
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="memory" ref={memorySectionRef}>
                    <Card>
                      <CardContent className="pt-4">
                        {selectedGraphKey ? (
                          <div className="mb-3 border p-3 text-sm">
                            <p className="font-medium">
                              {formatGraphLabel(selectedGraphKey)}
                            </p>
                            <p className="text-muted-foreground">
                              {semanticMemory.find(
                                (entry) => entry.key === selectedGraphKey,
                              )?.content ?? "No details available."}
                            </p>
                          </div>
                        ) : null}
                        <ScrollArea className="h-[300px] pr-2">
                          {memoryInsights.length ? (
                            <div className="mb-3 space-y-2">
                              {memoryInsights.map((insight) => (
                                <div
                                  key={insight._id}
                                  className="border p-3 text-sm"
                                >
                                  <div className="mb-1 flex items-center gap-2">
                                    <Badge variant="secondary">
                                      {insight.kind}
                                    </Badge>
                                    <Badge variant="outline">
                                      {insight.confidence}
                                    </Badge>
                                  </div>
                                  <p className="font-medium">{insight.title}</p>
                                  <p className="text-muted-foreground">
                                    {insight.detail}
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {episodicLogs.length ? (
                            <div className="space-y-3">
                              {episodicLogs.map((entry) => (
                                <div
                                  key={entry._id}
                                  className="border p-3 text-sm"
                                >
                                  <div className="mb-1 flex items-center justify-between">
                                    <Badge variant="outline">
                                      {timeAgo(entry.createdAt)}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {entry.loopId.slice(0, 8)}
                                    </span>
                                  </div>
                                  <p className="mb-1 text-xs text-muted-foreground">
                                    Reasoning
                                  </p>
                                  <Streamdown>
                                    {entry.reasoningSummary}
                                  </Streamdown>
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    Outcome
                                  </p>
                                  <p>{entry.outcome}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              No episodic memory yet.
                            </p>
                          )}
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="tools" ref={toolsSectionRef}>
                    <Card>
                      <CardContent className="pt-4">
                        <ScrollArea className="h-[300px] pr-2">
                          {toolRuns.length ? (
                            <div className="space-y-3">
                              {toolRuns.map((runRow) => (
                                <div
                                  key={runRow._id}
                                  className="border p-3 text-sm"
                                >
                                  <div className="mb-2 flex items-center gap-2">
                                    <Badge variant="outline">
                                      {runRow.tool}
                                    </Badge>
                                    <Badge
                                      variant={
                                        runRow.status === "error"
                                          ? "destructive"
                                          : "secondary"
                                      }
                                    >
                                      {runRow.status}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {runRow.durationMs}ms ·{" "}
                                      {timeAgo(runRow.createdAt)}
                                    </span>
                                  </div>
                                  {runRow.stdout ? (
                                    <pre className="whitespace-pre-wrap bg-muted p-2 text-xs">
                                      {runRow.stdout}
                                    </pre>
                                  ) : null}
                                  {runRow.stderr ? (
                                    <pre className="mt-2 whitespace-pre-wrap bg-muted p-2 text-xs text-destructive">
                                      {runRow.stderr}
                                    </pre>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              No tool runs yet.
                            </p>
                          )}
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Create Agent</CardTitle>
                  <CardDescription>
                    Launch a dedicated autonomous employee for a specific
                    operational mandate.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      className="h-10 border bg-card px-3 text-sm"
                      placeholder="Agent name (e.g. GitHub Triage)"
                      value={newAgentName}
                      onChange={(e) => setNewAgentName(e.target.value)}
                    />
                    <input
                      className="h-10 border bg-card px-3 text-sm"
                      placeholder="Role"
                      value={newAgentRole}
                      onChange={(e) => setNewAgentRole(e.target.value)}
                    />
                  </div>
                  <textarea
                    className="min-h-28 w-full border bg-card px-3 py-2 text-sm"
                    placeholder="Task goal (e.g. Watch all open PRs, run safe repo checks in E2B, comment clear next steps, open PRs for low-risk fixes, escalate risky changes to Slack)."
                    value={newAgentGoal}
                    onChange={(e) => setNewAgentGoal(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={
                        isPending ||
                        !canAdmin ||
                        !newAgentName.trim() ||
                        !newAgentGoal.trim()
                      }
                      onClick={() =>
                        run("create-agent", async () => {
                          const result = await launchEmployee({
                            name: newAgentName.trim(),
                            role: newAgentRole.trim() || "Ops Generalist",
                            goal: newAgentGoal.trim(),
                            autonomyMode: "autonomous",
                          });
                          setSelection({
                            orgId,
                            employeeId: result.employeeId,
                          });
                          setActivePage("overview");
                        })
                      }
                    >
                      Create and Start
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Starts immediately.
                    </p>
                  </div>
                  <div className="border p-3 text-sm">
                    <p className="font-medium">Existing Agents</p>
                    <div className="mt-2 space-y-2">
                      {agents.length ? (
                        agents.map((agent) => (
                          <div
                            key={agent._id}
                            className="flex items-center justify-between border p-2"
                          >
                            <div>
                              <p className="font-medium">{agent.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {agent.role} · {agent.status}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelection({
                                  orgId,
                                  employeeId: agent.employeeId,
                                });
                                setActivePage("overview");
                              }}
                            >
                              Open
                            </Button>
                          </div>
                        ))
                      ) : (
                        <p className="text-muted-foreground">No agents yet.</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
