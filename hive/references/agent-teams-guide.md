# Agent Teams Guide

Agent teams are Claude Code's multi-agent system for parallel task execution. Hive uses agent teams to run independent stories from an epic concurrently: the lead describes the work in natural language, and the Claude Code runtime materializes teammates automatically. Each story becomes a task assigned to a separate teammate with its own context window. Parallel execution is the default for eligible story sets; projects opt out with `hive.config.yaml` → `execution.parallel_teams: false` or with the `--sequential` flag.

Reference: https://code.claude.com/docs/en/agent-teams

## Detection

Agent teams are GA. Do not gate parallel execution on the legacy experimental environment variable:

```
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
```

If this env var is present in an existing `.env` file, Hive treats it as deprecated and ignored for compatibility. It must not produce an error, warning, or sequential fallback.

Check `hive.config.yaml` → `execution.parallel_teams`. Parallel dispatch is enabled by default when the setting is absent. Only `execution.parallel_teams: false` opts out and routes eligible story sets to sequential execution.

## Mapping Epics to Teams

Each story in an epic maps to one task in the agent team. Story-level `depends_on` fields become task dependencies.

```yaml
# Epic stories:
#   story-a (no deps)     → task-a (unblocked, runs immediately)
#   story-b (no deps)     → task-b (unblocked, runs in parallel with a)
#   story-c (deps: a, b)  → task-c (blocked until a AND b complete)
```

Rules:

- Each story = one task
- `depends_on` in the story YAML maps directly to task dependencies
- Stories with no dependencies are unblocked and can run immediately as separate teammates
- Stories with dependencies wait until all predecessors complete before becoming available
- Within a story, phases (research, implement, test, review) still execute sequentially — parallelism is between stories, not within them

## Team Prompt Generation

Agent teams are created from natural-language prompts. The lead describes the team, tasks, dependencies, and handoff requirements; the Claude Code runtime reads that prose and auto-spawns the teammates. There is no explicit team-creation tool call and no JSON team config to author in Hive.

**Spawn hierarchy:**
- **Orchestrator → stories:** the orchestrator describes each story-level task and dependency in prose. The runtime creates a teammate for each unblocked story and gives each teammate an isolated context window.
- **Teammates → workflow steps:** each teammate uses the `Agent` tool internally to spawn sub-workers (researcher, developer, tester) for individual workflow steps. These run inline within the teammate's pane; nested story-level teams are still forbidden.

The execute command describes the team structure and dependencies in prose:

```
Create a team to work on epic hive-phase3.
Task 1: agent-teams-guide — no dependencies
Task 2: code-review-workflow — no dependencies
Task 3: review-command — no dependencies
Task 4: parallel-execution — depends on task 1
Tasks 1-3 can run in parallel.
```

Each task prompt includes:
- The story YAML content (acceptance criteria, steps, context)
- Any relevant reference docs the story needs
- The agent persona to use for each phase
- Episode write instructions so downstream tasks receive handoff context


This is the existing behavior from Phase 1 and requires no additional configuration. The execute command should silently use this path whenever agent teams are not detected.

## Limitations

| Limitation | Impact |
|------------|--------|
| No nested teams | A teammate cannot spawn its own team. Within a story, phases execute sequentially via subagent spawning, not agent teams. Only story-level parallelism uses teams. |
| One team per session | If the user starts a new epic execution, the previous team must be cleaned up first. |
| No session resumption | If a team session is interrupted, it cannot be resumed — the team must be recreated. |
| Task status can lag | The shared task list updates asynchronously. A teammate may briefly see stale status for other tasks. |
