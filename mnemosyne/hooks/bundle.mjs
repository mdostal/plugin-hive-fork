const CHARS_PER_TOKEN = 4;

export const DEFAULT_BUNDLE_TOKEN_BUDGET = 1200;
export const MAX_BUNDLE_TOKEN_BUDGET = 1500;

export function estimateTokens(text) {
  const len = String(text ?? '').length;
  return Math.max(1, Math.ceil(len / CHARS_PER_TOKEN));
}

export function normalizeTokenBudget(value, fallback = DEFAULT_BUNDLE_TOKEN_BUDGET) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  const candidate = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.min(candidate, MAX_BUNDLE_TOKEN_BUDGET);
}

export function capMarkdownToBudget(markdown, tokenBudget) {
  const budget = normalizeTokenBudget(tokenBudget);
  const lines = String(markdown ?? '').trim().split(/\r?\n/);
  const kept = [];
  let used = 0;

  for (const line of lines) {
    const cost = estimateTokens(line || '\n');
    if (kept.length > 0 && used + cost > budget) break;
    kept.push(line);
    used += cost;
  }

  return {
    markdown: kept.join('\n').trim(),
    estimatedTokens: estimateTokens(kept.join('\n')),
    chars: kept.join('\n').length,
  };
}
