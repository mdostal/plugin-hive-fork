import { capMarkdownToBudget, estimateTokens } from './bundle.mjs';

export const MNEMOSYNE_SECTION_HEADING = '## Prior Experience';
export const MNEMOSYNE_MARKER_PREFIX = '<!-- mnemosyne-bundle:';
export const MNEMOSYNE_SECTION_RE =
  /\n*## Prior Experience\n(?:<!-- mnemosyne-bundle:[\s\S]*?-->\n)?[\s\S]*?(?=\n## |\n---\n|$)/;

function stripPriorExperienceHeading(markdown) {
  return String(markdown ?? '')
    .trim()
    .replace(/^## Prior Experience\s*/m, '')
    .trim();
}

function markerValue(value) {
  return String(value ?? '')
    .replace(/[\r\n"<>]/g, ' ')
    .trim();
}

export function formatInjectedBundle(rawMarkdown, meta = {}) {
  const body = stripPriorExperienceHeading(rawMarkdown);
  if (!body) return null;

  const tokenBudget = meta.tokenBudget;
  const capped = capMarkdownToBudget(body, tokenBudget);
  if (!capped.markdown) return null;

  const section = [
    MNEMOSYNE_SECTION_HEADING,
    `${MNEMOSYNE_MARKER_PREFIX} source=mnemosyne scope="${markerValue(meta.scope)}" persona="${markerValue(meta.persona)}" estimated_tokens=${capped.estimatedTokens} chars=${capped.chars} -->`,
    '',
    capped.markdown,
  ].join('\n');

  return `${section.trimEnd()}\n`;
}

export function replaceInjectedBundle(description, bundle) {
  const base = String(description ?? '').replace(MNEMOSYNE_SECTION_RE, '').trimEnd();
  if (!bundle) return `${base}\n`;

  const insightIdx = base.indexOf('## Insight Capture');
  if (insightIdx >= 0) {
    return `${base.slice(0, insightIdx).trimEnd()}\n\n${bundle.trimEnd()}\n\n${base.slice(insightIdx).trimStart()}\n`;
  }
  return `${base}\n\n${bundle.trimEnd()}\n`;
}

export function bundleStats(bundle) {
  const text = String(bundle ?? '');
  return {
    chars: text.length,
    estimated_tokens: estimateTokens(text),
    lines: text ? text.split(/\r?\n/).length : 0,
  };
}
