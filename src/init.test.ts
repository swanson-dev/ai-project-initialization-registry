import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { clearRegistryTreeCache } from './fetch.js';
import { runInit } from './init.js';

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

const TEMPLATE_FIXTURES = [
  { id: 'project-brief', path: 'file-templates/project/project-brief.md', target: 'docs/00-overview/project-brief.md' },
  { id: 'requirements', path: 'file-templates/project/requirements.md', target: 'docs/01-requirements/requirements.md' },
  {
    id: 'architecture-overview',
    path: 'file-templates/architecture/architecture-overview.md',
    target: 'docs/02-architecture/architecture-overview.md',
  },
  { id: 'api-contract', path: 'file-templates/architecture/api-contract.md', target: 'docs/02-architecture/api-contract.md' },
  { id: 'ui-spec', path: 'file-templates/ui-ux/ui-spec.md', target: 'docs/03-ui-ux/ui-spec.md' },
  {
    id: 'wireframes-request',
    path: 'file-templates/ui-ux/wireframes-request.md',
    target: 'docs/03-ui-ux/wireframes-request.md',
  },
  {
    id: 'ui-approval-checklist',
    path: 'file-templates/ui-ux/ui-approval-checklist.md',
    target: 'docs/03-ui-ux/ui-approval-checklist.md',
  },
  { id: 'status-update', path: 'file-templates/status/status-update.md', target: 'docs/07-status/status-update.md' },
  { id: 'changelog', path: 'file-templates/status/changelog.md', target: 'docs/07-status/changelog.md' },
] as const;

const RAW_LIBRARY_FIXTURES = {
  'agent-packs/core/agent-guidelines.md': 'core guidelines\n',
  'agent-packs/core/OUTPUT_RULES.md': 'output rules\n',
  'agent-packs/core/.DS_Store': 'ignored\n',
  'skills/documentation-hygiene/skill.md': 'skill body\n',
  'skills/documentation-hygiene/checklist.md': 'checklist body\n',
  'skills/documentation-hygiene/examples.md': 'examples body\n',
  'skills/documentation-hygiene/.gitkeep': 'ignored\n',
  'tech-stacks/nextjs/recipe.md': 'next recipe\n',
  'file-templates/project/project-brief.md': 'template:project-brief\n',
  'agent-packs/product-types/ecommerce/pack.md': 'ecommerce pack\n',
  'skills/documentation-hygiene/Thumbs.db': 'ignored\n',
} as const;

function responseFrom(value: unknown): MockResponse {
  return {
    ok: true,
    status: 200,
    json: async () => value,
    text: async () => {
      if (typeof value !== 'string') {
        throw new Error('Expected string response');
      }
      return value;
    },
  };
}

function createManifest(): Record<string, unknown> {
  return {
    version: '0.2.0',
    published_at: '2026-03-01T00:00:00Z',
    contract_version: '1',
    defaults: {
      agent_packs: ['core'],
      skills: ['documentation-hygiene'],
      file_templates: ['project-brief'],
      registry_docs: ['project-contract'],
    },
    materialization: {
      asset_group_roots: {
        agent_packs: 'agent-packs',
        skills: 'skills',
        tech_stack_recipes: 'tech-stacks',
        file_templates: 'file-templates',
        product_type_packs: 'product-types',
      },
      copy_raw_asset_groups: ['agent_packs', 'skills', 'tech_stack_recipes', 'file_templates', 'product_type_packs'],
      exclude_globs: ['**/.DS_Store', '**/Thumbs.db', '**/.gitkeep'],
      project_metadata_dir: '.project',
    },
    instantiation_rules: TEMPLATE_FIXTURES.map((template) => ({
      template_id: template.id,
      target: template.target,
      required: true,
    })),
    scaffolds: [{ id: 'standard-planning-plus-code', path: 'scaffolds/standard-planning-plus-code' }],
    agent_packs: [{ id: 'core', path: 'agent-packs/core' }],
    skills: [{ id: 'documentation-hygiene', path: 'skills/documentation-hygiene' }],
    tech_stack_recipes: [{ id: 'nextjs', path: 'tech-stacks/nextjs/recipe.md' }],
    file_templates: TEMPLATE_FIXTURES.map((template) => ({ id: template.id, path: template.path })),
    product_type_packs: [{ id: 'ecommerce', path: 'agent-packs/product-types/ecommerce' }],
    registry_docs: [{ id: 'project-contract', path: 'project-contract.md' }],
  };
}

function createFetchOverrides(manifest: Record<string, unknown>): Record<string, unknown> {
  const overrides: Record<string, unknown> = {
    'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/manifest.json': manifest,
    'https://api.github.com/repos/swanson-dev/ai-project-initialization/git/trees/main?recursive=1': {
      truncated: false,
      tree: [
        { path: 'scaffolds/standard-planning-plus-code', type: 'blob' },
        ...Object.keys(RAW_LIBRARY_FIXTURES).map((filePath) => ({ path: filePath, type: 'blob' })),
      ],
    },
    'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/scaffolds/standard-planning-plus-code': 'scaffold',
    'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/scaffolds/standard-planning-plus-code/README.template.md':
      'name={{project_name}}\ndescription={{description}}\ntech={{preferred_technology}}\n',
  };

  for (const [filePath, content] of Object.entries(RAW_LIBRARY_FIXTURES)) {
    overrides[`https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/${filePath}`] = content;
  }

  for (const template of TEMPLATE_FIXTURES) {
    overrides[`https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/${template.path}`] =
      `template:${template.id}\n`;
  }

  return overrides;
}

async function withTempRepo(run: (repoPath: string) => Promise<void>): Promise<void> {
  const current = process.cwd();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-os-init-'));

  try {
    await fs.mkdir(path.join(tempRoot, '.git'));
    process.chdir(tempRoot);
    await run(tempRoot);
  } finally {
    process.chdir(current);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function installFetchMock(overrides: Record<string, unknown>): () => void {
  const originalFetch = globalThis.fetch;
  clearRegistryTreeCache();
  globalThis.fetch = (async (input: string | URL) => {
    const key = input.toString();
    if (!(key in overrides)) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: 'not found' }),
        text: async () => 'not found',
      } satisfies MockResponse;
    }
    return responseFrom(overrides[key]);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
    clearRegistryTreeCache();
  };
}

test('runInit aborts when app already exists', async () => {
  await withTempRepo(async (repoPath) => {
    await fs.mkdir(path.join(repoPath, 'app'));

    await assert.rejects(
      () => runInit({ ref: 'main', yes: true, debug: false }),
      /Validation failed: app must not exist/,
    );
  });
});

test('runInit aborts when docs already exists', async () => {
  await withTempRepo(async (repoPath) => {
    await fs.mkdir(path.join(repoPath, 'docs'));

    await assert.rejects(
      () => runInit({ ref: 'main', yes: true, debug: false }),
      /Validation failed: docs must not exist/,
    );
  });
});

test('runInit aborts on defaults validation failure before writing files', async () => {
  await withTempRepo(async (repoPath) => {
    const restoreFetch = installFetchMock({
      ...createFetchOverrides(createManifest()),
      'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/manifest.json': {
        ...createManifest(),
        defaults: {
          skills: ['missing-skill'],
        },
      },
    });

    try {
      await assert.rejects(
        () => runInit({ ref: 'main', yes: true, debug: false }),
        /defaults\.skills references unknown id: missing-skill/,
      );

      const files = await fs.readdir(repoPath);
      assert.deepEqual(files.sort(), ['.git']);
    } finally {
      restoreFetch();
    }
  });
});

test('runInit logs resolved selections as single-line json in debug mode', async () => {
  await withTempRepo(async (repoPath) => {
    const manifest = createManifest();
    const restoreFetch = installFetchMock(createFetchOverrides(manifest));
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };

    try {
      await runInit({ ref: 'main', yes: true, debug: true });

      const resolvedLine = logs.find((line) => line.startsWith('{"resolvedSelections":'));
      assert.equal(
        resolvedLine,
        JSON.stringify({
          resolvedSelections: {
            agentPackIds: ['core'],
            skillIds: ['documentation-hygiene'],
            registryDocIds: ['project-contract'],
            fileTemplateIds: ['project-brief'],
          },
          materialization: (manifest as { materialization: unknown }).materialization,
          instantiation_rules: (manifest as { instantiation_rules: unknown }).instantiation_rules,
        }),
      );

      for (const template of TEMPLATE_FIXTURES) {
        const targetPath = path.join(repoPath, template.target);
        await assert.doesNotReject(() => fs.access(targetPath));
        const content = await fs.readFile(targetPath, 'utf8');
        assert.equal(content, `template:${template.id}\n`);
      }

      const projectConfigPath = path.join(repoPath, '.project', 'project.config.json');
      const bootstrapLockPath = path.join(repoPath, '.project', 'bootstrap.lock');
      const selectedAssetsPath = path.join(repoPath, '.project', 'selected-assets.json');

      await assert.doesNotReject(() => fs.access(projectConfigPath));
      await assert.doesNotReject(() => fs.access(bootstrapLockPath));
      await assert.doesNotReject(() => fs.access(selectedAssetsPath));
      await assert.doesNotReject(() => fs.access(path.join(repoPath, 'agents', 'manifest.json')));
      await assert.doesNotReject(() => fs.access(path.join(repoPath, 'README.md')));
      await assert.doesNotReject(() => fs.access(path.join(repoPath, '.env.init')));
      await assert.doesNotReject(() => fs.access(path.join(repoPath, 'agent-packs', 'core', 'agent-guidelines.md')));
      await assert.doesNotReject(() => fs.access(path.join(repoPath, 'agent-packs', 'core', 'OUTPUT_RULES.md')));
      await assert.doesNotReject(() => fs.access(path.join(repoPath, 'skills', 'documentation-hygiene', 'skill.md')));
      await assert.doesNotReject(() => fs.access(path.join(repoPath, 'skills', 'documentation-hygiene', 'checklist.md')));
      await assert.doesNotReject(() => fs.access(path.join(repoPath, 'skills', 'documentation-hygiene', 'examples.md')));
      await assert.doesNotReject(() => fs.access(path.join(repoPath, 'tech-stacks', 'nextjs', 'recipe.md')));
      await assert.doesNotReject(() => fs.access(path.join(repoPath, 'file-templates', 'project', 'project-brief.md')));
      await assert.rejects(() => fs.access(path.join(repoPath, 'agent-packs', 'core', '.DS_Store')));
      await assert.rejects(() => fs.access(path.join(repoPath, 'skills', 'documentation-hygiene', '.gitkeep')));
      await assert.rejects(() => fs.access(path.join(repoPath, 'skills', 'documentation-hygiene', 'Thumbs.db')));
      assert.equal(
        await fs.readFile(path.join(repoPath, 'agent-packs', 'core', 'agent-guidelines.md'), 'utf8'),
        'core guidelines\n',
      );
      assert.equal(
        await fs.readFile(path.join(repoPath, 'skills', 'documentation-hygiene', 'skill.md'), 'utf8'),
        'skill body\n',
      );
      assert.equal(
        await fs.readFile(path.join(repoPath, 'tech-stacks', 'nextjs', 'recipe.md'), 'utf8'),
        'next recipe\n',
      );

      const selectedAssets = JSON.parse(await fs.readFile(selectedAssetsPath, 'utf8')) as Record<string, unknown>;
      assert.equal(selectedAssets.registry_version, '0.2.0');
      assert.equal(selectedAssets.published_at, '2026-03-01T00:00:00Z');
      assert.equal(selectedAssets.contract_version, '1');
      assert.equal(typeof selectedAssets.created_at, 'string');
      assert.deepEqual(selectedAssets.project, {
        project_id: null,
        name: path.basename(repoPath),
      });
      assert.deepEqual(selectedAssets.source, {
        registry: {
          owner: 'swanson-dev',
          repo: 'ai-project-initialization',
          ref: 'main',
          raw_base: 'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main',
          is_override: false,
        },
      });
      assert.deepEqual(selectedAssets.selected, {
        scaffold: 'standard-planning-plus-code',
        tech_stack_recipe: 'nextjs',
        agent_packs: ['core'],
        skills: ['documentation-hygiene'],
        product_type_packs: [],
        registry_docs: ['project-contract'],
        file_templates: ['project-brief'],
        instantiation_rules: TEMPLATE_FIXTURES.map((template) => ({
          template_id: template.id,
          target: template.target,
        })),
      });
      assert.deepEqual(selectedAssets.materialization, (manifest as { materialization: unknown }).materialization);
      assert.deepEqual((selectedAssets.outputs as { copied_paths: string[] }).copied_paths, [
        'agent-packs/core/agent-guidelines.md',
        'agent-packs/core/OUTPUT_RULES.md',
        'file-templates/project/project-brief.md',
        'scaffolds/standard-planning-plus-code',
        'skills/documentation-hygiene/checklist.md',
        'skills/documentation-hygiene/examples.md',
        'skills/documentation-hygiene/skill.md',
        'tech-stacks/nextjs/recipe.md',
      ]);
      assert.deepEqual((selectedAssets.outputs as { instantiated_docs: string[] }).instantiated_docs, TEMPLATE_FIXTURES.map((template) => template.target));
      assert.deepEqual((selectedAssets.outputs as { metadata_files: string[] }).metadata_files, [
        '.project/bootstrap.lock',
        '.project/project.config.json',
        '.project/selected-assets.json',
      ]);
      const hashes = (selectedAssets.outputs as { hashes?: Array<{ path: string; sha256: string }> }).hashes;
      assert.ok(Array.isArray(hashes));
      assert.deepEqual(
        hashes.map((entry) => entry.path),
        [
          '.project/project.config.json',
          'agent-packs/core/agent-guidelines.md',
          'agent-packs/core/OUTPUT_RULES.md',
          'agents/manifest.json',
          'docs/00-overview/project-brief.md',
          'docs/01-requirements/requirements.md',
          'docs/02-architecture/api-contract.md',
          'docs/02-architecture/architecture-overview.md',
          'docs/03-ui-ux/ui-approval-checklist.md',
          'docs/03-ui-ux/ui-spec.md',
          'docs/03-ui-ux/wireframes-request.md',
          'docs/07-status/changelog.md',
          'docs/07-status/status-update.md',
          'file-templates/project/project-brief.md',
          'scaffolds/standard-planning-plus-code',
          'skills/documentation-hygiene/checklist.md',
          'skills/documentation-hygiene/examples.md',
          'skills/documentation-hygiene/skill.md',
          'tech-stacks/nextjs/recipe.md',
        ],
      );
      assert.equal(hashes.some((entry) => entry.path === '.project/selected-assets.json'), false);
      assert.equal(hashes.some((entry) => entry.path === '.project/bootstrap.lock'), false);
      for (const entry of hashes) {
        assert.match(entry.sha256, /^[0-9a-f]{64}$/);
      }
      const agentGuidelinesHash = createHash('sha256')
        .update(await fs.readFile(path.join(repoPath, 'agent-packs', 'core', 'agent-guidelines.md')))
        .digest('hex');
      assert.equal(
        hashes.find((entry) => entry.path === 'agent-packs/core/agent-guidelines.md')?.sha256,
        agentGuidelinesHash,
      );

      const bootstrapLock = JSON.parse(await fs.readFile(bootstrapLockPath, 'utf8')) as Record<string, unknown>;
      assert.deepEqual(bootstrapLock, {
        registry: {
          version: '0.2.0',
          published_at: '2026-03-01T00:00:00Z',
          contract_version: '1',
        },
        selection: {
          scaffold: 'standard-planning-plus-code',
          tech_stack_recipe: 'nextjs',
          agent_packs: ['core'],
          skills: ['documentation-hygiene'],
          product_type_packs: [],
          registry_docs: ['project-contract'],
          file_templates: ['project-brief'],
        },
        instantiated_docs: TEMPLATE_FIXTURES.map((template) => ({
          template_id: template.id,
          target: template.target,
        })),
        manifest_contract_version_used_by_cli: '1',
        cli: {
          name: '@codebasedesigns/project-os',
          version: '0.0.1',
        },
      });
    } finally {
      console.log = originalLog;
      restoreFetch();
    }
  });
});

test('runInit aborts before writes when selected-assets target already exists', async () => {
  await withTempRepo(async (repoPath) => {
    await fs.mkdir(path.join(repoPath, '.project'), { recursive: true });
    const provenancePath = path.join(repoPath, '.project', 'selected-assets.json');
    await fs.writeFile(provenancePath, '{"keep":true}\n', 'utf8');

    const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));

    try {
      await assert.rejects(
        () => runInit({ ref: 'main', yes: true, debug: false }),
        /Conflict: \.project\/selected-assets\.json already exists/,
      );

      const files = await fs.readdir(repoPath);
      assert.deepEqual(files.sort(), ['.git', '.project']);
      assert.equal(await fs.readFile(provenancePath, 'utf8'), '{"keep":true}\n');
    } finally {
      restoreFetch();
    }
  });
});

test('runInit rolls back selected-assets when bootstrap lock write fails', async (t) => {
  await withTempRepo(async (repoPath) => {
    const sentinelPath = path.join(repoPath, 'sentinel.txt');
    await fs.writeFile(sentinelPath, 'keep-me\n', 'utf8');

    const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
    const originalWriteFile = fs.writeFile.bind(fs);
    t.mock.method(fs, 'writeFile', async (
      target: Parameters<typeof fs.writeFile>[0],
      data: Parameters<typeof fs.writeFile>[1],
      options?: Parameters<typeof fs.writeFile>[2],
    ) => {
      if (
        typeof target === 'string' &&
        target.endsWith(path.join('.project', 'bootstrap.lock'))
      ) {
        throw new Error('Simulated bootstrap lock write failure');
      }

      return originalWriteFile(target, data, options);
    });

    try {
      await assert.rejects(
        () => runInit({ ref: 'main', yes: true, debug: false }),
        /Simulated bootstrap lock write failure/,
      );

      const files = await fs.readdir(repoPath);
      assert.deepEqual(files.sort(), ['.git', 'sentinel.txt']);
      assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'keep-me\n');
    } finally {
      restoreFetch();
    }
  });
});

test('runInit rolls back raw materialization when a copy fails mid-plan', async (t) => {
  await withTempRepo(async (repoPath) => {
    const sentinelPath = path.join(repoPath, 'sentinel.txt');
    await fs.writeFile(sentinelPath, 'keep-me\n', 'utf8');

    const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
    const originalWriteFile = fs.writeFile.bind(fs);
    let failureTriggered = false;

    t.mock.method(fs, 'writeFile', async (
      target: Parameters<typeof fs.writeFile>[0],
      data: Parameters<typeof fs.writeFile>[1],
      options?: Parameters<typeof fs.writeFile>[2],
    ) => {
      if (
        typeof target === 'string' &&
        target.endsWith(path.join('skills', 'documentation-hygiene', 'examples.md'))
      ) {
        failureTriggered = true;
        throw new Error('Simulated raw materialization write failure');
      }

      return originalWriteFile(target, data, options);
    });

    try {
      await assert.rejects(
        () => runInit({ ref: 'main', yes: true, debug: false }),
        /Simulated raw materialization write failure/,
      );

      assert.equal(failureTriggered, true);
      const files = await fs.readdir(repoPath);
      assert.deepEqual(files.sort(), ['.git', 'sentinel.txt']);
      assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'keep-me\n');
    } finally {
      restoreFetch();
    }
  });
});

test('runInit rolls back when hash computation fails', async (t) => {
  await withTempRepo(async (repoPath) => {
    const sentinelPath = path.join(repoPath, 'sentinel.txt');
    await fs.writeFile(sentinelPath, 'keep-me\n', 'utf8');

    const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
    const originalReadFile = fs.readFile.bind(fs);
    let failureTriggered = false;

    t.mock.method(fs, 'readFile', async (
      target: Parameters<typeof fs.readFile>[0],
      options?: Parameters<typeof fs.readFile>[1],
    ) => {
      if (
        typeof target === 'string' &&
        target.endsWith(path.join('agent-packs', 'core', 'agent-guidelines.md'))
      ) {
        failureTriggered = true;
        throw new Error('Simulated hash computation read failure');
      }

      return originalReadFile(target, options as never);
    });

    try {
      await assert.rejects(
        () => runInit({ ref: 'main', yes: true, debug: false }),
        /Simulated hash computation read failure/,
      );

      assert.equal(failureTriggered, true);
      const files = await fs.readdir(repoPath);
      assert.deepEqual(files.sort(), ['.git', 'sentinel.txt']);
      assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'keep-me\n');
    } finally {
      restoreFetch();
    }
  });
});

test('runInit logs null instantiation_rules in legacy debug mode', async () => {
  await withTempRepo(async (repoPath) => {
    const legacyManifest = createManifest();
    delete legacyManifest.contract_version;
    delete legacyManifest.defaults;
    delete legacyManifest.materialization;

    const restoreFetch = installFetchMock(createFetchOverrides(legacyManifest));
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };

    try {
      await runInit({ ref: 'main', yes: true, debug: true });

      const resolvedLine = logs.find((line) => line.startsWith('{"resolvedSelections":'));
      assert.equal(
        resolvedLine,
        '{"resolvedSelections":{"agentPackIds":["core"],"skillIds":["documentation-hygiene"],"registryDocIds":[],"fileTemplateIds":[]},"materialization":null,"instantiation_rules":null}',
      );

      await assert.rejects(() => fs.access(path.join(repoPath, '.project', 'selected-assets.json')));
      const legacyBootstrap = JSON.parse(await fs.readFile(path.join(repoPath, '.project', 'bootstrap.lock'), 'utf8')) as Record<string, unknown>;
      assert.equal('registry' in legacyBootstrap, false);
      assert.equal('selection' in legacyBootstrap, false);
      assert.equal('instantiated_docs' in legacyBootstrap, false);
      await assert.rejects(() => fs.access(path.join(repoPath, 'agent-packs', 'core', 'agent-guidelines.md')));
      await assert.rejects(() => fs.access(path.join(repoPath, 'skills', 'documentation-hygiene', 'skill.md')));
      await assert.rejects(() => fs.access(path.join(repoPath, 'tech-stacks', 'nextjs', 'recipe.md')));
      await assert.rejects(() => fs.access(path.join(repoPath, 'file-templates', 'project', 'project-brief.md')));

      for (const template of TEMPLATE_FIXTURES) {
        await assert.rejects(() => fs.access(path.join(repoPath, template.target)));
      }
    } finally {
      console.log = originalLog;
      restoreFetch();
    }
  });
});
