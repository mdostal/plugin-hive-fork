import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { normalizeTokenBudget } from './bundle.mjs';
import { formatInjectedBundle } from './format.mjs';
import { resolveRepoScope } from './scope.mjs';

const execFileAsync = promisify(execFile);
const MEMORY_BRIEF_TIMEOUT_MS = 10_000;
const MEMORY_BRIEF_SCRIPT_PATH = fileURLToPath(new URL('../../hive/lib/memory_brief.py', import.meta.url));

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function storyQuery(ticket) {
  return [
    ticket?.title,
    ticket?.description,
    ticket?.body,
    ticket?.goal,
  ].filter((value) => typeof value === 'string' && value.trim()).join(' - ');
}

export async function inject(ticket = {}, repoScope = null, options = {}) {
  const persona = firstString(
    options.persona,
    ticket.persona,
    ticket.dispatchingPersona,
    ticket.agent,
    ticket.agentName,
  );
  if (!persona) return null;

  const tokenBudget = normalizeTokenBudget(
    options.tokenBudget ?? ticket.memoryTokenBudget ?? ticket.tokenBudget,
  );
  const scope = resolveRepoScope(repoScope ?? options.repoScope ?? ticket.repoScope);
  const query = firstString(options.query, ticket.query, storyQuery(ticket));

  const args = [MEMORY_BRIEF_SCRIPT_PATH, '--persona', persona, '--token-budget', String(tokenBudget)];
  const epic = firstString(options.epic, ticket.epic, ticket.epicId, ticket.epic_id);
  const story = firstString(options.story, ticket.id, ticket.storyId, ticket.story_id);
  if (epic) args.push('--epic', epic);
  if (story) args.push('--story', story);
  if (query) args.push('--query', query);

  const env = { ...process.env };
  if (scope) env.HIVE_MEMORY_SCOPE = scope;

  try {
    const { stdout } = await execFileAsync(options.pythonBin ?? 'python3', args, {
      env,
      timeout: MEMORY_BRIEF_TIMEOUT_MS,
    });
    return formatInjectedBundle(stdout, { persona, scope, tokenBudget });
  } catch {
    return null;
  }
}
