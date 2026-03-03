import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearRegistryTreeCache } from './fetch.js';
import { getDoctorExitCode, runDoctor } from './doctor.js';
import { runInit } from './init.js';
import { getReconcileExitCode, runReconcile } from './reconcile.js';
const DEFAULT_RECONCILE_OPTIONS = {
    yes: false,
    json: false,
    verbose: false,
    strict: false,
    deleteExtra: false,
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
];
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
};
function responseFrom(value) {
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
function createManifest() {
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
function createFetchOverrides(manifest) {
    const overrides = {
        'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/manifest.json': manifest,
        'https://api.github.com/repos/swanson-dev/ai-project-initialization/git/trees/main?recursive=1': {
            truncated: false,
            tree: [
                { path: 'scaffolds/standard-planning-plus-code', type: 'blob' },
                ...Object.keys(RAW_LIBRARY_FIXTURES).map((filePath) => ({ path: filePath, type: 'blob' })),
            ],
        },
        'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/scaffolds/standard-planning-plus-code': 'scaffold',
        'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/scaffolds/standard-planning-plus-code/README.template.md': 'name={{project_name}}\ndescription={{description}}\ntech={{preferred_technology}}\n',
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
function createOverrideFetchOverrides(manifest, rawBase, ref) {
    const normalizedBase = rawBase.replace(/\/$/, '');
    const overrides = {
        [`${normalizedBase}/manifest.json`]: manifest,
        [`https://api.github.com/repos/swanson-dev/ai-project-initialization/git/trees/${encodeURIComponent(ref)}?recursive=1`]: {
            truncated: false,
            tree: [
                { path: 'scaffolds/standard-planning-plus-code', type: 'blob' },
                ...Object.keys(RAW_LIBRARY_FIXTURES).map((filePath) => ({ path: filePath, type: 'blob' })),
            ],
        },
        [`${normalizedBase}/scaffolds/standard-planning-plus-code`]: 'scaffold',
        [`${normalizedBase}/scaffolds/standard-planning-plus-code/README.template.md`]: 'name={{project_name}}\ndescription={{description}}\ntech={{preferred_technology}}\n',
    };
    for (const [filePath, content] of Object.entries(RAW_LIBRARY_FIXTURES)) {
        overrides[`${normalizedBase}/${filePath}`] = content;
    }
    for (const template of TEMPLATE_FIXTURES) {
        overrides[`${normalizedBase}/${template.path}`] = `template:${template.id}\n`;
    }
    return overrides;
}
async function withTempRepo(run) {
    const current = process.cwd();
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-os-reconcile-'));
    try {
        await fs.mkdir(path.join(tempRoot, '.git'));
        process.chdir(tempRoot);
        await run(tempRoot);
    }
    finally {
        process.chdir(current);
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}
function installFetchMock(overrides) {
    const originalFetch = globalThis.fetch;
    clearRegistryTreeCache();
    globalThis.fetch = (async (input) => {
        const key = input.toString();
        if (!(key in overrides)) {
            return {
                ok: false,
                status: 404,
                json: async () => ({ message: 'not found' }),
                text: async () => 'not found',
            };
        }
        return responseFrom(overrides[key]);
    });
    return () => {
        globalThis.fetch = originalFetch;
        clearRegistryTreeCache();
    };
}
async function initializeProject(repoPath) {
    void repoPath;
    await runInit({ ref: 'main', yes: true, debug: false });
}
test('reconcile dry-run detects drift and does not write', async () => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
        try {
            await initializeProject(repoPath);
            const selectedAssetsPath = path.join(repoPath, '.project', 'selected-assets.json');
            const originalSelectedAssets = await fs.readFile(selectedAssetsPath, 'utf8');
            await fs.rm(path.join(repoPath, 'docs', '00-overview', 'project-brief.md'));
            await fs.writeFile(path.join(repoPath, 'skills', 'documentation-hygiene', 'skill.md'), 'changed\n', 'utf8');
            const result = await runReconcile(repoPath, DEFAULT_RECONCILE_OPTIONS);
            assert.equal(result.status, 'dry_run');
            assert.equal(getReconcileExitCode(result), 1);
            assert.equal(result.applied.written.length, 0);
            assert.equal(result.planned.write.includes('docs/00-overview/project-brief.md'), true);
            assert.equal(result.planned.write.includes('skills/documentation-hygiene/skill.md'), true);
            assert.equal(await fs.readFile(selectedAssetsPath, 'utf8'), originalSelectedAssets);
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile --yes repairs a missing instantiated doc and doctor --hash becomes clean', async () => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
        try {
            await initializeProject(repoPath);
            const targetPath = path.join(repoPath, 'docs', '00-overview', 'project-brief.md');
            await fs.rm(targetPath);
            const result = await runReconcile(repoPath, { ...DEFAULT_RECONCILE_OPTIONS, yes: true });
            assert.equal(result.status, 'reconciled');
            assert.equal(await fs.readFile(targetPath, 'utf8'), 'template:project-brief\n');
            const doctorResult = await runDoctor(repoPath, {
                json: false,
                verbose: false,
                roots: false,
                strict: false,
                hash: true,
            });
            assert.equal(doctorResult.status, 'clean');
            assert.equal(getDoctorExitCode(doctorResult), 0);
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile --yes repairs a mismatched raw asset and updates hashes', async () => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
        try {
            await initializeProject(repoPath);
            const targetPath = path.join(repoPath, 'skills', 'documentation-hygiene', 'skill.md');
            await fs.writeFile(targetPath, 'changed\n', 'utf8');
            const result = await runReconcile(repoPath, { ...DEFAULT_RECONCILE_OPTIONS, yes: true });
            assert.equal(result.status, 'reconciled');
            assert.equal(await fs.readFile(targetPath, 'utf8'), 'skill body\n');
            const doctorResult = await runDoctor(repoPath, {
                json: false,
                verbose: false,
                roots: false,
                strict: false,
                hash: true,
            });
            assert.equal(doctorResult.status, 'clean');
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile strict mode fails if extra files exist without --delete-extra', async () => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
        try {
            await initializeProject(repoPath);
            const extraPath = path.join(repoPath, 'skills', 'documentation-hygiene', 'local-note.md');
            await fs.writeFile(extraPath, 'note\n', 'utf8');
            const dryRun = await runReconcile(repoPath, { ...DEFAULT_RECONCILE_OPTIONS, strict: true });
            assert.equal(dryRun.status, 'dry_run');
            assert.deepEqual(dryRun.extra, ['skills/documentation-hygiene/local-note.md']);
            assert.equal(getReconcileExitCode(dryRun), 1);
            const apply = await runReconcile(repoPath, { ...DEFAULT_RECONCILE_OPTIONS, yes: true, strict: true });
            assert.equal(apply.status, 'error');
            assert.deepEqual(apply.extra, ['skills/documentation-hygiene/local-note.md']);
            assert.equal(getReconcileExitCode(apply), 2);
            assert.equal(await fs.readFile(extraPath, 'utf8'), 'note\n');
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile strict mode with --delete-extra deletes extra files transactionally', async () => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
        try {
            await initializeProject(repoPath);
            const extraPath = path.join(repoPath, 'skills', 'documentation-hygiene', 'local-note.md');
            await fs.writeFile(extraPath, 'note\n', 'utf8');
            const result = await runReconcile(repoPath, {
                ...DEFAULT_RECONCILE_OPTIONS,
                yes: true,
                strict: true,
                deleteExtra: true,
            });
            assert.equal(result.status, 'reconciled');
            await assert.rejects(() => fs.access(extraPath));
            const doctorResult = await runDoctor(repoPath, {
                json: false,
                verbose: false,
                roots: true,
                strict: true,
                hash: true,
            });
            assert.equal(doctorResult.status, 'clean');
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile rolls back on mid-write failure and preserves prior state', async (t) => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
        try {
            await initializeProject(repoPath);
            const sentinelPath = path.join(repoPath, 'sentinel.txt');
            await fs.writeFile(sentinelPath, 'keep-me\n', 'utf8');
            const selectedAssetsPath = path.join(repoPath, '.project', 'selected-assets.json');
            const originalSelectedAssets = await fs.readFile(selectedAssetsPath, 'utf8');
            const changedSkillPath = path.join(repoPath, 'skills', 'documentation-hygiene', 'skill.md');
            await fs.writeFile(changedSkillPath, 'changed\n', 'utf8');
            await fs.rm(path.join(repoPath, 'docs', '00-overview', 'project-brief.md'));
            const originalWriteFile = fs.writeFile.bind(fs);
            t.mock.method(fs, 'writeFile', async (target, data, options) => {
                if (typeof target === 'string' && target.endsWith(path.join('skills', 'documentation-hygiene', 'skill.md'))) {
                    throw new Error('Simulated reconcile write failure');
                }
                return originalWriteFile(target, data, options);
            });
            const result = await runReconcile(repoPath, { ...DEFAULT_RECONCILE_OPTIONS, yes: true });
            assert.equal(result.status, 'error');
            assert.equal(await fs.readFile(changedSkillPath, 'utf8'), 'changed\n');
            await assert.rejects(() => fs.access(path.join(repoPath, 'docs', '00-overview', 'project-brief.md')));
            assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'keep-me\n');
            assert.equal(await fs.readFile(selectedAssetsPath, 'utf8'), originalSelectedAssets);
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile skips missing project config in dry-run and blocks apply', async () => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
        try {
            await initializeProject(repoPath);
            await fs.rm(path.join(repoPath, '.project', 'project.config.json'));
            const dryRun = await runReconcile(repoPath, DEFAULT_RECONCILE_OPTIONS);
            assert.equal(dryRun.status, 'dry_run');
            assert.deepEqual(dryRun.planned.skip, ['.project/project.config.json']);
            const apply = await runReconcile(repoPath, { ...DEFAULT_RECONCILE_OPTIONS, yes: true });
            assert.equal(apply.status, 'error');
            assert.match(apply.notes.join('\n'), /reconcile cannot safely repair unreconstructable provenance-managed file: \.project\/project\.config\.json/);
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile rejects --delete-extra without --strict', async () => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
        try {
            await initializeProject(repoPath);
            const result = await runReconcile(repoPath, {
                ...DEFAULT_RECONCILE_OPTIONS,
                yes: true,
                deleteExtra: true,
            });
            assert.equal(result.status, 'error');
            assert.deepEqual(result.notes, ['--delete-extra requires --strict']);
            assert.equal(getReconcileExitCode(result), 2);
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile does not touch agents manifest because it is not provenance-managed', async () => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock(createFetchOverrides(createManifest()));
        try {
            await initializeProject(repoPath);
            const agentsManifestPath = path.join(repoPath, 'agents', 'manifest.json');
            await fs.rm(agentsManifestPath);
            const result = await runReconcile(repoPath, DEFAULT_RECONCILE_OPTIONS);
            assert.equal(result.status, 'clean');
            await assert.rejects(() => fs.access(agentsManifestPath));
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile prefers persisted source provenance over project config fallback', async () => {
    await withTempRepo(async (repoPath) => {
        const manifest = createManifest();
        const overrideRawBase = 'https://example.com/custom-registry';
        const restoreFetch = installFetchMock({
            ...createFetchOverrides(manifest),
            ...createOverrideFetchOverrides(manifest, overrideRawBase, 'feature/source'),
        });
        try {
            await initializeProject(repoPath);
            const selectedAssetsPath = path.join(repoPath, '.project', 'selected-assets.json');
            const selectedAssets = JSON.parse(await fs.readFile(selectedAssetsPath, 'utf8'));
            selectedAssets.source = {
                registry: {
                    owner: 'swanson-dev',
                    repo: 'ai-project-initialization',
                    ref: 'feature/source',
                    raw_base: overrideRawBase,
                    is_override: true,
                },
            };
            await fs.writeFile(selectedAssetsPath, JSON.stringify(selectedAssets, null, 2) + '\n', 'utf8');
            await fs.rm(path.join(repoPath, 'docs', '00-overview', 'project-brief.md'));
            const result = await runReconcile(repoPath, { ...DEFAULT_RECONCILE_OPTIONS, yes: true });
            assert.equal(result.status, 'reconciled');
            assert.equal(result.notes.includes('selected-assets.json does not include source provenance; reconcile is using compatibility fallback resolution'), false);
            assert.equal(await fs.readFile(path.join(repoPath, 'docs', '00-overview', 'project-brief.md'), 'utf8'), 'template:project-brief\n');
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile falls back when source provenance is absent', async () => {
    await withTempRepo(async (repoPath) => {
        const manifest = createManifest();
        const restoreFetch = installFetchMock(createFetchOverrides(manifest));
        try {
            await initializeProject(repoPath);
            const selectedAssetsPath = path.join(repoPath, '.project', 'selected-assets.json');
            const selectedAssets = JSON.parse(await fs.readFile(selectedAssetsPath, 'utf8'));
            delete selectedAssets.source;
            await fs.writeFile(selectedAssetsPath, JSON.stringify(selectedAssets, null, 2) + '\n', 'utf8');
            await fs.rm(path.join(repoPath, 'docs', '00-overview', 'project-brief.md'));
            const result = await runReconcile(repoPath, { ...DEFAULT_RECONCILE_OPTIONS, yes: true });
            assert.equal(result.status, 'reconciled');
            assert.equal(result.notes.includes('selected-assets.json does not include source provenance; reconcile is using compatibility fallback resolution'), true);
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile errors on malformed source provenance', async () => {
    await withTempRepo(async (repoPath) => {
        const manifest = createManifest();
        const restoreFetch = installFetchMock(createFetchOverrides(manifest));
        try {
            await initializeProject(repoPath);
            const selectedAssetsPath = path.join(repoPath, '.project', 'selected-assets.json');
            const selectedAssets = JSON.parse(await fs.readFile(selectedAssetsPath, 'utf8'));
            selectedAssets.source = { registry: { owner: 'swanson-dev' } };
            await fs.writeFile(selectedAssetsPath, JSON.stringify(selectedAssets, null, 2) + '\n', 'utf8');
            const result = await runReconcile(repoPath, DEFAULT_RECONCILE_OPTIONS);
            assert.equal(result.status, 'error');
            assert.deepEqual(result.notes, ['selected-assets.json contains malformed source provenance']);
            assert.equal(getReconcileExitCode(result), 2);
        }
        finally {
            restoreFetch();
        }
    });
});
test('reconcile supports persisted override sources', async () => {
    await withTempRepo(async (repoPath) => {
        const manifest = createManifest();
        const overrideRawBase = 'https://example.com/custom-override';
        const restoreFetch = installFetchMock({
            ...createFetchOverrides(manifest),
            ...createOverrideFetchOverrides(manifest, overrideRawBase, 'override-ref'),
        });
        try {
            await initializeProject(repoPath);
            const selectedAssetsPath = path.join(repoPath, '.project', 'selected-assets.json');
            const selectedAssets = JSON.parse(await fs.readFile(selectedAssetsPath, 'utf8'));
            selectedAssets.source = {
                registry: {
                    owner: 'swanson-dev',
                    repo: 'ai-project-initialization',
                    ref: 'override-ref',
                    raw_base: overrideRawBase,
                    is_override: true,
                },
            };
            await fs.writeFile(selectedAssetsPath, JSON.stringify(selectedAssets, null, 2) + '\n', 'utf8');
            await fs.writeFile(path.join(repoPath, 'skills', 'documentation-hygiene', 'skill.md'), 'changed\n', 'utf8');
            const result = await runReconcile(repoPath, { ...DEFAULT_RECONCILE_OPTIONS, yes: true });
            assert.equal(result.status, 'reconciled');
            assert.equal(result.notes.includes('selected-assets.json does not include source provenance; reconcile is using compatibility fallback resolution'), false);
            assert.equal(await fs.readFile(path.join(repoPath, 'skills', 'documentation-hygiene', 'skill.md'), 'utf8'), 'skill body\n');
        }
        finally {
            restoreFetch();
        }
    });
});
