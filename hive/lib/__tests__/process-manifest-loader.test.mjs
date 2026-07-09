/**
 * Tests for hive/lib/process-manifest-loader.mjs and hive/lib/cc-manifest-adapter.mjs
 *
 * Covers:
 *  (a) loadManifests() from the real hive/manifests/ dir — plan manifest loads
 *  (b) listWorkflows() returns expected shape
 *  (c) getManifest('plan') returns the plan manifest
 *  (d) Validation rejects structurally invalid manifests
 *  (e) Non-CC executor path: step enumeration from raw manifest object
 *  (f) resolveCCSkill() returns correct paths for each substrate
 *  (g) resolveCCSkill() falls back to 'default' for unknown substrates
 *
 * Convention: vitest (matches cc-workflows-model-tier.test.mjs).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadManifests,
  getManifest,
  listWorkflows,
} from '../process-manifest-loader.mjs';

import {
  resolveCCSkill,
  listCCSkillAdapters,
} from '../cc-manifest-adapter.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpManifestsDir(manifests = []) {
  const dir = mkdtempSync(join(tmpdir(), 'hive-manifest-test-'));
  for (const { filename, content } of manifests) {
    writeFileSync(join(dir, filename), content, 'utf8');
  }
  return dir;
}

const MINIMAL_MANIFEST = (id = 'foo') => `
id: ${id}
name: Foo Workflow
version: "1.0"
steps:
  - id: do-thing
    role: researcher
adapters:
  default:
    type: cc-skill
    skill: skills/${id}/SKILL.md
`;

// ---------------------------------------------------------------------------
// (a) loadManifests() from the real manifests directory
// ---------------------------------------------------------------------------

describe('loadManifests() — real manifests dir', () => {
  beforeEach(() => loadManifests({ _reset: true }));

  it('loads without throwing', () => {
    const registry = loadManifests();
    expect(registry).toBeDefined();
    expect(registry.size).toBeGreaterThanOrEqual(1);
  });

  it('includes the plan workflow', () => {
    const registry = loadManifests();
    expect(registry.has('plan')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (b) listWorkflows()
// ---------------------------------------------------------------------------

describe('listWorkflows()', () => {
  beforeEach(() => loadManifests({ _reset: true }));

  it('returns an array of workflow summaries', () => {
    const list = listWorkflows();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);

    const plan = list.find((w) => w.id === 'plan');
    expect(plan).toBeDefined();
    expect(typeof plan.name).toBe('string');
    expect(typeof plan.source).toBe('string');
    expect(plan.source).toMatch(/plan\.process\.yaml$/);
  });
});

// ---------------------------------------------------------------------------
// (c) getManifest('plan')
// ---------------------------------------------------------------------------

describe('getManifest()', () => {
  beforeEach(() => loadManifests({ _reset: true }));

  it('returns the plan manifest with expected shape', () => {
    const { manifest, source } = getManifest('plan');
    expect(manifest.id).toBe('plan');
    expect(manifest.name).toMatch(/plan/i);
    expect(typeof manifest.version).toBe('string');
    expect(Array.isArray(manifest.steps)).toBe(true);
    expect(manifest.steps.length).toBeGreaterThan(0);
    expect(typeof manifest.adapters).toBe('object');
    expect(source).toMatch(/plan\.process\.yaml$/);
  });

  it('plan manifest has default, multica, cc-workflows, and hive-dag adapters', () => {
    const { manifest } = getManifest('plan');
    expect(manifest.adapters).toHaveProperty('default');
    expect(manifest.adapters).toHaveProperty('multica');
    expect(manifest.adapters).toHaveProperty('cc-workflows');
    expect(manifest.adapters).toHaveProperty('hive-dag');
  });

  it('plan steps include research, design, design-gate, author', () => {
    const { manifest } = getManifest('plan');
    const ids = manifest.steps.map((s) => s.id);
    expect(ids).toContain('research');
    expect(ids).toContain('design');
    expect(ids).toContain('design-gate');
    expect(ids).toContain('author');
  });

  it('throws for unknown workflow id', () => {
    expect(() => getManifest('nonexistent-workflow-xyz')).toThrow(
      /no manifest for workflow/
    );
  });
});

// ---------------------------------------------------------------------------
// (d) Validation rejects invalid manifests
// ---------------------------------------------------------------------------

describe('validation — invalid manifests', () => {
  it('rejects a manifest with non-kebab id', () => {
    const dir = makeTmpManifestsDir([
      { filename: 'Bad_Name.process.yaml', content: `id: Bad_Name\nname: x\nversion: "1.0"\nsteps:\n  - id: s\n    role: r\nadapters:\n  default:\n    type: cc-skill\n    skill: x.md\n` },
    ]);
    expect(() => loadManifests({ _manifestsDir: dir, _reset: true })).toThrow(/kebab-case/);
  });

  it('rejects a manifest with no adapters.default', () => {
    const dir = makeTmpManifestsDir([
      { filename: 'foo.process.yaml', content: `id: foo\nname: Foo\nversion: "1.0"\nsteps:\n  - id: s\n    role: r\nadapters:\n  multica:\n    type: cc-skill\n    skill: x.md\n` },
    ]);
    expect(() => loadManifests({ _manifestsDir: dir, _reset: true })).toThrow(/adapters.default is required/);
  });

  it('rejects a manifest with duplicate step ids', () => {
    const dir = makeTmpManifestsDir([
      {
        filename: 'dup.process.yaml',
        content: `id: dup\nname: Dup\nversion: "1.0"\nsteps:\n  - id: s\n    role: r\n  - id: s\n    role: r\nadapters:\n  default:\n    type: cc-skill\n    skill: x.md\n`,
      },
    ]);
    expect(() => loadManifests({ _manifestsDir: dir, _reset: true })).toThrow(/duplicate step ids/);
  });

  it('rejects a manifest where depends_on references an unknown step', () => {
    const dir = makeTmpManifestsDir([
      {
        filename: 'bad-dep.process.yaml',
        content: `id: bad-dep\nname: Bad\nversion: "1.0"\nsteps:\n  - id: a\n    role: r\n    depends_on: [ghost]\nadapters:\n  default:\n    type: cc-skill\n    skill: x.md\n`,
      },
    ]);
    expect(() => loadManifests({ _manifestsDir: dir, _reset: true })).toThrow(/depends_on unknown step/);
  });

  it('rejects a manifest whose filename stem does not match its id', () => {
    const dir = makeTmpManifestsDir([
      {
        filename: 'other-name.process.yaml',
        content: `id: foo\nname: Foo\nversion: "1.0"\nsteps:\n  - id: s\n    role: r\nadapters:\n  default:\n    type: cc-skill\n    skill: x.md\n`,
      },
    ]);
    expect(() => loadManifests({ _manifestsDir: dir, _reset: true })).toThrow(
      /filename stem.*does not match manifest id/
    );
  });
});

// ---------------------------------------------------------------------------
// (e) Non-CC executor path: step enumeration from manifest object
// ---------------------------------------------------------------------------

describe('non-CC executor path — step enumeration', () => {
  it('a non-CC executor can enumerate steps and gates without CC context', () => {
    const { manifest } = getManifest('plan');

    // A non-CC executor only needs to read manifest.steps — no CC SDK, no hooks.
    const gateSteps = manifest.steps.filter(
      (s) => s.node_type === 'user_gate' || s.node_type === 'gate'
    );
    expect(gateSteps.length).toBeGreaterThan(0);

    const agentSteps = manifest.steps.filter((s) => !s.node_type || s.node_type === 'agent');
    expect(agentSteps.length).toBeGreaterThan(0);

    // Every step can be inspected for its id, role, and depends_on
    for (const step of manifest.steps) {
      expect(typeof step.id).toBe('string');
      expect(typeof step.role).toBe('string');
      expect(Array.isArray(step.depends_on ?? [])).toBe(true);
    }
  });

  it('non-CC executor can find a dag-workflow adapter without any cc-skill knowledge', () => {
    const { manifest } = getManifest('plan');
    const dagAdapter = manifest.adapters['hive-dag'];
    expect(dagAdapter).toBeDefined();
    expect(dagAdapter.type).toBe('dag-workflow');
    expect(dagAdapter.workflow).toMatch(/\.yaml$/);
  });
});

// ---------------------------------------------------------------------------
// (f) resolveCCSkill() returns correct paths
// ---------------------------------------------------------------------------

describe('resolveCCSkill()', () => {
  let planManifest;
  beforeEach(() => {
    planManifest = getManifest('plan', { _reset: true }).manifest;
  });

  it('resolves default substrate to skills/plan/SKILL.md', () => {
    expect(resolveCCSkill(planManifest, 'default')).toBe('skills/plan/SKILL.md');
  });

  it('resolves multica substrate', () => {
    expect(resolveCCSkill(planManifest, 'multica')).toBe(
      'skills/hive/skills/plan-mode-multica/SKILL.md'
    );
  });

  it('resolves cc-workflows substrate', () => {
    expect(resolveCCSkill(planManifest, 'cc-workflows')).toBe(
      'skills/hive/skills/plan-mode-cc-workflows/SKILL.md'
    );
  });

  it('falls back to default for unknown substrate', () => {
    expect(resolveCCSkill(planManifest, 'unknown-substrate')).toBe('skills/plan/SKILL.md');
  });

  it('throws when called on a dag-workflow adapter without a cc-skill fallback path', () => {
    const noDefault = {
      id: 'mock',
      adapters: {
        default: { type: 'dag-workflow', workflow: 'hive/workflows/mock.yaml' },
      },
    };
    expect(() => resolveCCSkill(noDefault, 'default')).toThrow(/not "cc-skill"/);
  });
});

// ---------------------------------------------------------------------------
// (g) listCCSkillAdapters()
// ---------------------------------------------------------------------------

describe('listCCSkillAdapters()', () => {
  it('returns default, multica, and cc-workflows entries for plan', () => {
    const { manifest } = getManifest('plan');
    const cc = listCCSkillAdapters(manifest);
    const substrates = cc.map((a) => a.substrate).sort();
    expect(substrates).toContain('default');
    expect(substrates).toContain('multica');
    expect(substrates).toContain('cc-workflows');
    // hive-dag is dag-workflow type, should NOT appear
    expect(substrates).not.toContain('hive-dag');
  });
});
