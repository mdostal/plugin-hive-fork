# Agent Spawn Skill

Spawn a roster agent with full config validation, persona injection, and memory loading. This skill enforces the pre-spawn checklist from the orchestrator persona — use it instead of calling the `Agent` tool directly for story-level work.

**Input:** `$ARGUMENTS` contains the agent name and story context.

## When to Use

- **Orchestrator** spawning a team lead or specialist for a story
- **Team lead** spawning sub-workers (developer, tester, reviewer) for workflow steps
- Any time a roster agent needs to be created with its full persona and context

## When NOT to Use

- Quick inline questions where Agent tool is sufficient (no persona needed)
- The orchestrator deciding to handle work solo (no spawn needed)

## Procedure

### 1-4. Resolve persona context

Invoke `skills/hive/skills/persona-resolve/SKILL.md` with:

- `agent_name` from `$ARGUMENTS`
- `task_context` from `$ARGUMENTS`

Bind the returned `persona_context`. Subsequent sections must read persona text,
frontmatter, resolved paths, validated tools, and domain constraints from
`persona_context` instead of re-reading `hive/agents/{agent-name}.md`.

### 5. Load agent memories

Invoke `skills/hive/skills/memory-loading/SKILL.md` with:
- `persona_context`: from sections 1-4
- `task_description`: story spec + current step task text
- `epic_handle`: the parent epic identifier (optional, enables L2 KG decision context)

Consume `prior_knowledge_block` and `staleness_signals`. Inject `prior_knowledge_block` as the "Prior Knowledge" section after the persona and before the task instructions in the assembled prompt structure.

### 6. Check for applicable skills

For each skill in `persona_context.frontmatter.skills`:
1. Read the `use-when` description
2. If it matches the current task, check if the skill file exists at the path in `persona_context.resolved_paths.skills`
3. If the file exists: read it and include in the agent's prompt
4. If the file does not exist and `optional: true`: skip silently — the agent has fallback behavior
5. If the file does not exist and not optional: **STOP. Report the missing skill.**

### 7. Construct the spawn call

#### 7.0 Resolve backend (model provider)

Invoke `skills/hive/skills/backend-dispatch/SKILL.md` with:
- `persona_context`, `agent_backends` map from root `hive.config.yaml`, optional `backend_override`
- `prompt_parts` assembled from §7.1–§7.5 below
- `caller_mode` (`team-execution` or `standalone`)

Consume `resolved_backend`, `dispatch_decision`, and `dispatch_result`. Native runtime backends are fully handed off by the backend dispatch atom; respawn handling (§7b) and episode reporting (§8) still apply on the surrounding agent-spawn procedure when the Claude path is selected.

Native runtime backends (`multica:<runtime>`, including the `codex` alias) return
`dispatch_decision=multica-issue-assign` and do not use any terminal pane.

#### 7.1 `Agent(name:)` call (claude backend)

For `resolved_backend=claude`, use the standard `Agent(name:)` call:

```
Agent(
  prompt: [persona_context.persona_text + story context + memories + skills + domain note + completion contract],
  model: "{persona_context.frontmatter.model}",  // opus, sonnet, or haiku
  name: "{agent-name}-{story-id}",
  description: "{agent-name} working on {story-id}"
)
```

**Completion contract (`Agent(name:)` path only — E5 s1):** this is the
only dispatch path `SubagentStop` fires for, and `hooks/notify-agent-complete.sh`
derives its verdict solely from a self-written `<cwd>/.hive-task-status.json`
marker (no exit-status field exists in the payload — see
`.pHive/epics/e5-execution-loop/docs/design-discussion.md` §2, §4 R1). Append
this instruction to the assembled task prompt so every tmux-dispatched agent
writes the marker as its last action:

```
## Completion Contract
Before you finish, as your LAST action, run exactly one of:
  bash "${CLAUDE_PLUGIN_ROOT}/hooks/write-task-status.sh" success
  bash "${CLAUDE_PLUGIN_ROOT}/hooks/write-task-status.sh" failure
Use "success" only if every acceptance criterion for this task was met and
all required tests pass. Use "failure" otherwise. A missing marker is always
read downstream as failure, never success — so skipping this step silently
fails the story even if your work was correct.
```

Not required for native Multica runtime issue assignment (completion arrives as
an issue comment) or for Bash `run_in_background` dispatch (no completion
hook exists for that path at all — carve-out, not fixed).

**Prompt structure (shared by both paths):**
For the **Claude path** (`Agent(name:)`), all six parts are concatenated into
the single `prompt` parameter — the framework handles system-level injection:
1. **Persona** — `persona_context.persona_text`
2. **Domain note** — "You may modify files matching: {allow patterns}."
3. **Prior knowledge** — relevant memories from the agent's memory directory
4. **Applicable skills** — skill content if any matched
5. **Continuation Context** (respawn only) — see step 7b below
6. **Task** — the story spec, step instructions, any inputs from prior steps,
   and (Claude `Agent(name:)` path only) the Completion Contract from §7.1

### 7b. Handle respawn continuation (optional)

If a `respawn_summary_path` is provided (indicating this is a respawn, not a fresh spawn):

1. **Read the respawn summary** from the provided file path
2. **Parse the frontmatter** to extract `respawn_iteration`, `story_id`, `step_id`
3. **Inject the summary** into the prompt as a "Continuation Context" section (position 5 in the prompt structure above), wrapped with:

```
## Continuation Context

You are continuing work from a previous instance of yourself (respawn iteration {N}).
Review the context below carefully before proceeding. Do not repeat completed work.
Verify the current state of files and tests before assuming the summary is accurate —
things may have changed since the previous instance wrote this.

{full respawn summary content}
```

If `respawn_summary_path` is NOT provided, skip this step entirely — behavior is unchanged from a normal fresh spawn.

### 8. Report spawn result

After spawning, report:
- Agent name and model tier used
- Backend: claude (`Agent(name:)`) | multica:<runtime> (issue assignment)
- Respawn: yes (iteration {N} of 3) | no (fresh spawn)
- Required tools: `persona_context.validated_tools` available / missing (with fallback)
- Memories loaded: count and names
- Skills injected: count and names
- Continuation context: loaded from {path} | none
- Domain restrictions communicated
- Backend-specific info (native runtime only): assigned issue id, agent uuid,
  runtime tag, and polling/episode marker path.

## Key Rules

1. **Never improvise replacements.** If a roster persona exists for the task, use it. If it fails, improve the persona — don't bypass it.
2. **Always inject the full persona text.** Do not summarize, excerpt, or paraphrase `persona_context.persona_text`.
3. **Always pass the model parameter.** Without it, the spawner may default to the wrong tier.
4. **Always load memories.** Memories are what make agents improve over time. Skipping them wastes accumulated knowledge.
5. **Always communicate domain.** The agent needs to know its write boundaries.
