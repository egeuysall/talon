**Submission Answers**

**Team Name**
Talon

**Team Members**
Ege Uysal

**Project Description**
Talon is a digital engineering teammate that watches real work surfaces like GitHub, Slack, health checks, and deployment signals. Instead of waiting for a prompt, it clocks in on a schedule, collects signals, remembers recent work, understands company context, decides what needs attention, and takes safe actions autonomously.

It can triage GitHub issues, inspect stale PRs, summarize failures, comment with next steps, run approved diagnostics in E2B, post Slack updates, and create approval requests for riskier actions like opening PRs or closing issues. The goal is to reduce engineering drag: fewer forgotten issues, fewer stale PRs, fewer repeated manual checks, and clearer follow-up.

**Public GitHub Repository**
`https://github.com/egeuysall/talon`  
Use the actual repo URL if different.

**Demo Video**
Paste your Loom/YouTube link after recording.

**Does your project use managed agents? Explain how.**
Yes. Talon is built around a managed autonomous agent loop rather than a user-triggered chatbot.

The agent continuously runs a perceive, remember, decide, act, and log loop. It pulls signals from GitHub, Slack, health checks, and deployment surfaces; loads working memory, episodic memory, and semantic company memory from Convex; asks Gemini 3.5 Flash to return a structured decision; then executes through approved tools such as GitHub actions, Slack updates, and E2B diagnostics.

It also manages its own task queue, follow-ups, approval requests, and episodic logs. Low-risk actions can run automatically, while medium or high-risk actions are routed through an approval flow. This makes it feel closer to an engineering teammate than a copilot: it notices work, takes initiative, and keeps track of what happened.

**Any feedback for the organizers?**
Great hackathon theme. The managed agents category pushed us to think beyond chat interfaces and build something that actually runs, remembers, acts, and follows up. More examples of what judges consider managed agents versus normal tool-calling agents would be helpful.

**Any feedback on the Google products/models you used today?**
Gemini 3.5 Flash worked well for fast structured decision-making. The main thing that mattered was constraining it with schemas and policy checks instead of relying on free-form reasoning. It was strongest when asked to choose between bounded actions and weakest when the task was too open-ended. For agentic apps, better examples around structured outputs, tool safety, and long-running autonomous loops would be very useful.

**Demo Script**

Most AI tools today are copilots. They wait for a human to ask a question. Talon is different. It is a digital engineering teammate that clocks in, watches the team’s tools, remembers what happened, and moves work forward.

On this dashboard, Talon is monitoring GitHub, Slack, health checks, and deployment signals. It has working memory for what it is focused on, episodic memory for recent actions, and semantic memory for company context like repos, owners, policies, and runbooks.

Here is the important part: the product is not the cron job. The cron is just the heartbeat. The real product is that Talon notices engineering work and decides what to do next.

Let me trigger a clock-in for the demo so we do not wait for the next scheduled run.

Now Talon is collecting signals. It checks GitHub issues and PRs, health signals, Slack configuration, and its own prior memory. Then Gemini 3.5 Flash returns a structured decision, not free-form text. The app validates that decision against a policy layer before anything executes.

If the action is low-risk, Talon can do it automatically: comment on an issue, label something, inspect GitHub, or run an approved diagnostic. If the action is medium or high-risk, like opening a PR, closing an issue, or merging code, it creates an approval request instead of blindly doing it.

This is what makes it useful to a senior engineer. I do not want an agent that spams Slack or runs random shell commands. I want something that reduces loose ends: stale PRs, untriaged issues, repeated failures, and forgotten follow-ups.

Here Talon runs an approved diagnostic through E2B. The model does not invent arbitrary bash. It selects an approved runbook, the app executes it, captures the output, and logs the result.

Here Talon found a GitHub issue or PR that needs attention. It can comment with context, open a tracking issue, request review, or prepare a PR. Riskier actions go through approval.

The core idea is an engineering teammate that watches real work surfaces, remembers context, takes safe initiative, and asks for approval when risk crosses a boundary. It is not just another chatbot. It is a managed agent with memory, tools, policy, follow-up, and an audit trail.
