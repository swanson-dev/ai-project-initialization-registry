import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearRegistryTreeCache, resolveRegistrySource } from './fetch.js';
import { materializeRawAssets, matchesExcludeGlobs, planRawMaterialization, preflightRawMaterialization, } from './materialize-raw-assets.js';
import { createWriteContext } from './write-context.js';
const TREE_URL = 'https://api.github.com/repos/swanson-dev/ai-project-initialization/git/trees/main?recursive=1';
const TREE_FILES = [
    'agent-packs/core/agent-guidelines.md',
    'agent-packs/core/OUTPUT_RULES.md',
    'skills/documentation-hygiene/skill.md',
    'skills/documentation-hygiene/checklist.md',
    'skills/documentation-hygiene/examples.md',
    'skills/documentation-hygiene/.gitkeep',
    'skills/documentation-hygiene/Thumbs.db',
    'tech-stacks/nextjs/recipe.md',
    'file-templates/project/project-brief.md',
    'file-templates/project/requirements.md',
    'agent-packs/product-types/ecommerce/pack.md',
];
const FILE_CONTENTS = {
    'agent-packs/core/agent-guidelines.md': 'core guidelines\n',
    'agent-packs/core/OUTPUT_RULES.md': 'output rules\n',
    'skills/documentation-hygiene/skill.md': 'skill body\n',
    'skills/documentation-hygiene/checklist.md': 'checklist body\n',
    'skills/documentation-hygiene/examples.md': 'examples body\n',
    'skills/documentation-hygiene/.gitkeep': 'ignored\n',
    'skills/documentation-hygiene/Thumbs.db': 'ignored\n',
    'tech-stacks/nextjs/recipe.md': 'recipe body\n',
    'file-templates/project/project-brief.md': 'brief body\n',
    'file-templates/project/requirements.md': 'requirements body\n',
    'agent-packs/product-types/ecommerce/pack.md': 'pack body\n',
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
        scaffolds: [{ id: 'standard-planning-plus-code', path: 'scaffolds/standard-planning-plus-code' }],
        agent_packs: [{ id: 'core', path: 'agent-packs/core' }],
        skills: [{ id: 'documentation-hygiene', path: 'skills/documentation-hygiene' }],
        tech_stack_recipes: [{ id: 'nextjs', path: 'tech-stacks/nextjs/recipe.md' }],
        file_templates: [
            { id: 'project-brief', path: 'file-templates/project/project-brief.md' },
            { id: 'requirements', path: 'file-templates/project/requirements.md' },
        ],
        product_type_packs: [{ id: 'ecommerce', path: 'agent-packs/product-types/ecommerce' }],
        registry_docs: [{ id: 'project-contract', path: 'project-contract.md' }],
    };
}
function createResolvedSelections() {
    return {
        agentPackIds: ['core'],
        skillIds: ['documentation-hygiene'],
        registryDocIds: ['project-contract'],
        fileTemplateIds: ['project-brief'],
    };
}
function installFetchMock() {
    const originalFetch = globalThis.fetch;
    clearRegistryTreeCache();
    globalThis.fetch = (async (input) => {
        const key = input.toString();
        if (key === TREE_URL) {
            return responseFrom({
                truncated: false,
                tree: TREE_FILES.map((filePath) => ({ path: filePath, type: 'blob' })),
            });
        }
        const prefix = 'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/';
        if (key.startsWith(prefix)) {
            const relPath = key.slice(prefix.length);
            if (relPath in FILE_CONTENTS) {
                return responseFrom(FILE_CONTENTS[relPath]);
            }
        }
        return {
            ok: false,
            status: 404,
            json: async () => ({ message: 'not found' }),
            text: async () => 'not found',
        };
    });
    return () => {
        globalThis.fetch = originalFetch;
        clearRegistryTreeCache();
    };
}
async function withTempRepo(run) {
    const current = process.cwd();
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-os-materialize-'));
    try {
        process.chdir(tempRoot);
        await run(tempRoot);
    }
    finally {
        process.chdir(current);
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}
test('matchesExcludeGlobs filters basename-only patterns', () => {
    assert.equal(matchesExcludeGlobs('skills/a/.gitkeep', ['**/.gitkeep']), true);
    assert.equal(matchesExcludeGlobs('skills/a/Thumbs.db', ['**/Thumbs.db']), true);
    assert.equal(matchesExcludeGlobs('skills/a/skill.md', ['**/.gitkeep']), false);
});
test('planRawMaterialization sorts outputs, applies excludes, and rejects duplicates', async () => {
    const restoreFetch = installFetchMock();
    try {
        const plan = await planRawMaterialization(resolveRegistrySource('main'), createManifest(), createResolvedSelections(), 'nextjs', ['ecommerce'], 'C:/temp/project');
        assert.deepEqual(plan.map((item) => item.destRel), [
            'agent-packs/core/agent-guidelines.md',
            'agent-packs/core/OUTPUT_RULES.md',
            'agent-packs/product-types/ecommerce/pack.md',
            'file-templates/project/project-brief.md',
            'skills/documentation-hygiene/checklist.md',
            'skills/documentation-hygiene/examples.md',
            'skills/documentation-hygiene/skill.md',
            'tech-stacks/nextjs/recipe.md',
        ]);
        const duplicateManifest = createManifest();
        duplicateManifest.file_templates?.push({
            id: 'duplicate-template',
            path: 'skills/documentation-hygiene/skill.md',
        });
        const duplicateSelections = createResolvedSelections();
        duplicateSelections.fileTemplateIds = ['project-brief', 'duplicate-template'];
        await assert.rejects(() => planRawMaterialization(resolveRegistrySource('main'), duplicateManifest, duplicateSelections, 'nextjs', [], 'C:/temp/project'), /duplicate destination: skills\/documentation-hygiene\/skill\.md/);
    }
    finally {
        restoreFetch();
    }
});
test('list-based materialization preflight aborts before writes when destination exists', async () => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock();
        try {
            const plan = await planRawMaterialization(resolveRegistrySource('main'), createManifest(), createResolvedSelections(), 'nextjs', [], repoPath);
            const existingPath = path.join(repoPath, 'skills', 'documentation-hygiene', 'skill.md');
            await fs.mkdir(path.dirname(existingPath), { recursive: true });
            await fs.writeFile(existingPath, 'keep\n', 'utf8');
            await assert.rejects(() => preflightRawMaterialization(plan), /Conflict: skills\/documentation-hygiene\/skill\.md already exists/);
            assert.equal(await fs.readFile(existingPath, 'utf8'), 'keep\n');
            await assert.rejects(() => fs.access(path.join(repoPath, 'agent-packs', 'core', 'agent-guidelines.md')));
        }
        finally {
            restoreFetch();
        }
    });
});
test('materializeRawAssets rejects directory-backed override sources', async () => {
    const manifest = createManifest();
    const overrideSource = resolveRegistrySource('main', 'https://example.com/registry');
    await assert.rejects(() => planRawMaterialization(overrideSource, manifest, createResolvedSelections(), 'nextjs', [], 'C:/temp/project'), /Directory-backed raw materialization is not supported with registry override sources: agent-packs\/core/);
});
test('materializeRawAssets supports file-backed override sources', async () => {
    await withTempRepo(async (repoPath) => {
        const overrideSource = resolveRegistrySource('main', 'https://example.com/registry');
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input) => {
            const key = input.toString();
            if (key === 'https://example.com/registry/file-templates/project/project-brief.md') {
                return responseFrom('brief body\n');
            }
            return {
                ok: false,
                status: 404,
                json: async () => ({ message: 'not found' }),
                text: async () => 'not found',
            };
        });
        try {
            const manifest = createManifest();
            manifest.materialization = {
                asset_group_roots: { file_templates: 'file-templates' },
                copy_raw_asset_groups: ['file_templates'],
                exclude_globs: [],
                project_metadata_dir: '.project',
            };
            const plan = await planRawMaterialization(overrideSource, manifest, createResolvedSelections(), 'nextjs', [], repoPath);
            const context = createWriteContext();
            const created = await materializeRawAssets(overrideSource, plan, context, repoPath);
            assert.deepEqual(created, ['file-templates/project/project-brief.md']);
            assert.equal(await fs.readFile(path.join(repoPath, 'file-templates', 'project', 'project-brief.md'), 'utf8'), 'brief body\n');
        }
        finally {
            globalThis.fetch = originalFetch;
        }
    });
});
