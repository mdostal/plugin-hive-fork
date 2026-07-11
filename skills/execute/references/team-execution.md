# Team Execution (Step 6)

> `${HIVE_STATE_DIR}` resolves from `paths.state_dir` in the ROOT `hive.config.yaml` at runtime (not from the shipped baseline `hive/hive.config.yaml`). Default: `.pHive`.
>
> **Parallel-dispatch gate (ed-7):** `Agent(name:)` is the in-scope local team dispatch point for the parallel gate. Each story listed in the prompt must already carry the `parallel_allowed: true` + `parallel_rationale ∈ {variation, read-only, bounded-slice}` pair emitted by `/plan` Phase C step 13, with `bounded-slice` stories declaring disjoint `files_to_modify[]`. The gate runs in `execute-dispatch` Step 1.5 *before* this section's prompt is generated — by the time you arrive here, the depth-0 `unblocked_stories[]` set has already been validated and `mode_decision` was downgraded to `sequential` on any violation. See [`hive/references/parallel-call-sites.md`](../../../hive/references/parallel-call-sites.md) §2 for the catalog of in-scope sites.

Describe each story as a named teammate in the team prompt — one teammate per story, each carrying ONLY that story's scope. Never combine two or more stories into a single teammate's scope description. The runtime materializes teammates automatically from the natural-language team description; parallel execution is the default for eligible story sets; `execution.parallel_teams: false` or `--sequential` forces sequential execution. Generate a natural-language prompt per story that describes that single story's task:

```
Execute story "{story-id}" of the "{epic-id}" epic.

## Scope (this teammate, this story only)
You own exactly one story: {story-id}. Do NOT read, start, or execute any
other story. Read the story at
${HIVE_STATE_DIR}/epics/{epic-id}/stories/{story-id}.yaml and execute the
steps described.

## Dependencies & context
[If no depends_on:] No dependencies — start immediately.
[If depends_on present:] Depends on: {dep-1}, {dep-2}. Wait until all
dependencies complete before starting this story.

## Workflow
Follow the development workflow phases from the loaded methodology
(e.g., research -> implement -> test -> review -> integrate).

## Completion & reporting
Write episode records after each step to
${HIVE_STATE_DIR}/episodes/{epic-id}/{story-id}/. When this story
completes, report back.
```

Rules for generating each per-story prompt:
- Emit exactly one prompt per story, addressed to that single story only — never name a second story's scope inside a teammate's prompt. Use the story ID as the teammate name.
- Stories with no `depends_on` say "start immediately"; stories with dependencies list them explicitly so the teammate blocks correctly.
- Do NOT inline the full story content — each teammate reads its own story YAML file directly.
- For large epics (10+ stories), keep each prompt minimal (ID + title + deps only) — but still one scoped prompt per story.

## Sidecar injection (append-placement triggers)

After building each story's task block, check if that story's ID is present in the story→sidecar_agents map (populated in step 2b from `appends[]` records).

- If the story ID is **not** in the map: the task block is emitted byte-for-byte as described above — no changes.
- If the story ID **is** in the map: append the following to that story's task block (one line-pair per agent in the list):

  ```
  Also spawn {agent-name} as a sidecar for the review step.
  {agent-name} reads hive/agents/{agent-name}.md and participates in code review.
  ```

- Epics with no `appends[]` entries produce a story prompt that is byte-for-byte identical to pre-sidecar behavior — this is the primary constraint.

> **Pattern note:** This is the sidecar-within-named-teammate pattern — sidecar runs within the dev teammate's pane, not as a separate `Agent(name:)` call.

## Per-Story Commits

Stories commit independently on their own feature branches (`hive-{story-id}`) as soon as review passes. Do NOT batch commits at epic end.

## Respawn Monitoring (team execution)

The orchestrator monitors active teammates for context degradation signals during execution. If a teammate shows signs of context pressure (see `skills/hive/skills/respawn/SKILL.md` for detection heuristics), the orchestrator triggers the respawn protocol:

1. `SendMessage` the respawn signal to the teammate
2. Wait for the teammate to write its respawn summary to `${HIVE_STATE_DIR}/respawn-summaries/`
3. Check the respawn iteration count — if >= 3, escalate to user instead
4. Spawn a fresh teammate via agent-spawn skill with `respawn_summary_path` pointing to the summary
5. The fresh teammate picks up where the previous one left off

Ensure `${HIVE_STATE_DIR}/respawn-summaries/` exists before epic execution begins (create if needed).

## Completion Tracking

The local team path relies on the runtime-managed `Agent(name:)` completion contract and the issue/episode markers emitted by the orchestrator. Bash `run_in_background` remains a carve-out with no `SubagentStop` hook; tracking for that path must use the existing explicit poll or marker mechanism.
