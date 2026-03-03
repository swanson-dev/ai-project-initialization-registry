import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { instantiateTemplates } from './instantiate-templates.js';
import { createWriteContext } from './write-context.js';
const TEMPLATE_FIXTURES = [
    { id: 'project-brief', path: 'file-templates/project/project-brief.md', target: 'docs/00-overview/project-brief.md' },
    { id: 'requirements', path: 'file-templates/project/requirements.md', target: 'docs/01-requirements/requirements.md' },
];
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
        scaffolds: [{ id: 'standard-planning-plus-code', path: 'scaffolds/standard-planning-plus-code' }],
        agent_packs: [{ id: 'core', path: 'agent-packs/core' }],
        skills: [{ id: 'documentation-hygiene', path: 'skills/documentation-hygiene' }],
        tech_stack_recipes: [{ id: 'nextjs', path: 'tech-stacks/nextjs/recipe.md' }],
        file_templates: TEMPLATE_FIXTURES.map((template) => ({ id: template.id, path: template.path })),
        instantiation_rules: TEMPLATE_FIXTURES.map((template) => ({
            template_id: template.id,
            target: template.target,
            required: true,
        })),
    };
}
function installFetchMock(overrides) {
    const originalFetch = globalThis.fetch;
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
    };
}
async function withTempRepo(run) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-os-templates-'));
    try {
        await run(tempRoot);
    }
    finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}
test('instantiateTemplates aborts if a target already exists and writes no other targets', async () => {
    await withTempRepo(async (repoPath) => {
        await fs.mkdir(path.join(repoPath, 'docs', '00-overview'), { recursive: true });
        const existingTargetPath = path.join(repoPath, 'docs', '00-overview', 'project-brief.md');
        await fs.writeFile(existingTargetPath, 'pre-existing\n', 'utf8');
        const restoreFetch = installFetchMock({
            'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/file-templates/project/project-brief.md': 'template:project-brief\n',
            'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/file-templates/project/requirements.md': 'template:requirements\n',
        });
        try {
            await assert.rejects(() => instantiateTemplates('https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main', createManifest(), createWriteContext(), repoPath), /Conflict: docs\/00-overview\/project-brief\.md already exists/);
            assert.equal(await fs.readFile(existingTargetPath, 'utf8'), 'pre-existing\n');
            await assert.rejects(() => fs.access(path.join(repoPath, 'docs', '01-requirements', 'requirements.md')));
        }
        finally {
            restoreFetch();
        }
    });
});
test('instantiateTemplates aborts before writes when a template source fetch fails', async () => {
    await withTempRepo(async (repoPath) => {
        const restoreFetch = installFetchMock({
            'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main/file-templates/project/project-brief.md': 'template:project-brief\n',
        });
        try {
            await assert.rejects(() => instantiateTemplates('https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main', createManifest(), createWriteContext(), repoPath), /Failed to fetch https:\/\/raw\.githubusercontent\.com\/swanson-dev\/ai-project-initialization\/main\/file-templates\/project\/requirements\.md \(404\)/);
            await assert.rejects(() => fs.access(path.join(repoPath, 'docs', '00-overview', 'project-brief.md')));
            await assert.rejects(() => fs.access(path.join(repoPath, 'docs', '01-requirements', 'requirements.md')));
        }
        finally {
            restoreFetch();
        }
    });
});
