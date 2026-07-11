---
name: backend-dispatch
description: Resolve the model-provider backend for an agent spawn and route to the correct dispatch surface. Inherits the caller's model and persona context.
---

# Hive Backend Dispatch

Atomic skill, NOT inline agent-spawn prose. Resolves which provider serves a given persona spawn and selects the dispatch surface (Messages-API substrate, tmux fallback, or Multica issue assignment). The caller still builds the spawn prompt and owns the surrounding procedure (respawn handling, episode reporting); this skill only owns the resolution + dispatch handoff.

## Invocation contract

Call this skill after `memory-loading` returned `prior_knowledge_block` and the caller has assembled the full prompt structure, but BEFORE invoking the actual `Agent` or Multica assignment surface.

**Inputs:**
- `persona_context` — output of `persona-resolve` (carries `agent_name`, `frontmatter.model`).
- `agent_backends` — `agent_backends.*` map from root `hive.config.yaml`.
- `backend_override` — optional explicit override the caller passed in (highest precedence).
- `prompt_parts` — assembled `{persona_text, domain_note, prior_knowledge_block, skills, continuation_context, task}` parts. Claude dispatch concatenates them for `Agent(name:)`; native runtime dispatch hands them through the Multica issue assignment brief.
- `caller_mode` — caller's invocation context: `team-execution` or `standalone`.
- `pane_mode` — deprecated; native runtime backends ignore pane mode.
- `existing_surface_id` — deprecated; native runtime backends do not reuse terminal surfaces.

**Outputs:**
- `resolved_backend` enum `claude | multica:<runtime>` (e.g. `multica:codex`, `multica:opencode`, `multica:gemini`).
- `dispatch_decision` — record of the chosen surface: `messages-api`, `tmux-fallback`, or `multica-issue-assign`.
- `dispatch_result` — the report returned by whichever surface was invoked.

**Side effects:** episode record write for `multica:<runtime>` backends, logging the runtime tag for future cost/bias telemetry.

## Process

### Step 1: Resolve backend (model provider)

Decide which backend serves this spawn. Resolution order, first match wins:

1. Explicit `backend_override` passed in by the caller.
2. `agent_backends.{persona_context.agent_name}` from root `hive.config.yaml` (consumer override layer; falls back to `hive/hive.config.yaml`). Matches the input-section contract at line 16. Normalize the resolved value: `opencode` is a convenience alias for `multica:opencode`.
3. Default: `claude`.

Supported backends: `claude` | `codex` | `multica:<runtime>` (e.g. `multica:codex`, `multica:opencode`, `multica:gemini`). The `codex` and `opencode` short-forms are accepted in config and treated as `multica:codex` and `multica:opencode` at resolution time.

### Step 2: Native runtime branch

If the resolved backend matches `multica:<runtime>` (including `multica:codex`):

- Record the runtime tag in the episode record (for future cost/bias telemetry).
- Do NOT open a terminal pane. Do NOT invoke the Messages-API or tmux substrate. Dispatch exclusively through the **Multica CLI substrate** (issue assignment via `multica issue update --assignee`).
- The persona's story brief MUST NOT include a `/codex:rescue` instruction — the assigned agent is a native Multica agent that already knows its own runtime.
- Assign the story issue to the agent persona's Multica agent UUID via `dispatchStoryToAgent`. Return `dispatch_decision=multica-issue-assign`.
- The dispatched agent runs on the Multica runtime identified by `<runtime>` (e.g. Codex, Opencode, Gemini) and posts its result as a comment on the story issue, which the orchestrator picks up through the existing episode-record path.
- Return `dispatch_result` with the standard envelope shape (`carrier`, `dispatches`, `dispatch_decision`).

### Step 3: Claude branch

If the resolved backend is `claude`, use this flow in order:

1. **Capability-check first:** initialize the Claude client/session substrate needed for story-level dispatch. If the client cannot be initialized, treat that as a substrate capability miss rather than a story failure.
2. **Messages-API substrate by default:** when the capability-check passes, route the spawn through `hive/lib/messages-session.js`. This is the default Claude path for direct story-level dispatch because it keeps the spawn on the Messages-API loop instead of opening a tmux pane first. Return `dispatch_decision=messages-api`.
3. **tmux fallback when client init fails:** if the Messages-API client init fails, log the failure and fall back to the existing tmux `Agent(name:)` path. Do not modify the prompt shape during fallback; only the transport changes. Return `dispatch_decision=tmux-fallback`.

Terminal visibility is a presentation concern for the Claude fallback only; native runtime backends never depend on a terminal multiplexer.
