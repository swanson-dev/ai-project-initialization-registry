import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBootstrapLockPayload, buildSelectedAssetsPayload } from './provenance.js';
function createManifest() {
    return {
        version: '0.2.0',
        published_at: '2026-03-01T00:00:00Z',
        contract_version: '1',
        scaffolds: [{ id: 'standard-planning-plus-code', path: 'scaffolds/standard-planning-plus-code' }],
        agent_packs: [{ id: 'core', path: 'agent-packs/core' }],
        skills: [{ id: 'documentation-hygiene', path: 'skills/documentation-hygiene' }],
        tech_stack_recipes: [{ id: 'nextjs', path: 'tech-stacks/nextjs/recipe.md' }],
        file_templates: [
            { id: 'project-brief', path: 'file-templates/project/project-brief.md' },
            { id: 'requirements', path: 'file-templates/project/requirements.md' },
        ],
        registry_docs: [{ id: 'project-contract', path: 'project-contract.md' }],
        materialization: {
            asset_group_roots: {
                agent_packs: 'agent-packs',
            },
            copy_raw_asset_groups: ['agent_packs'],
            exclude_globs: ['**/.gitkeep'],
            project_metadata_dir: '.project',
        },
        instantiation_rules: [
            { template_id: 'project-brief', target: 'docs/00-overview/project-brief.md', required: true },
            { template_id: 'requirements', target: 'docs/01-requirements/requirements.md', required: true },
        ],
    };
}
function createResolvedSelections() {
    return {
        agentPackIds: ['core'],
        skillIds: ['documentation-hygiene'],
        registryDocIds: ['project-contract'],
        fileTemplateIds: ['project-brief', 'requirements'],
    };
}
test('buildSelectedAssetsPayload preserves ordering and sorted outputs', () => {
    const payload = buildSelectedAssetsPayload({
        manifest: createManifest(),
        resolvedSelections: createResolvedSelections(),
        scaffoldId: 'standard-planning-plus-code',
        techStackRecipeId: 'nextjs',
        copiedPaths: [
            'skills/documentation-hygiene/skill.md',
            'agent-packs/core/agent-guidelines.md',
            'scaffolds/standard-planning-plus-code',
        ],
        instantiatedDocs: ['docs/00-overview/project-brief.md', 'docs/01-requirements/requirements.md'],
        metadataFiles: ['.project/selected-assets.json', '.project/project.config.json', '.project/bootstrap.lock'],
        hashes: [
            { path: 'skills/documentation-hygiene/skill.md', sha256: 'b'.repeat(64) },
            { path: 'agent-packs/core/agent-guidelines.md', sha256: 'a'.repeat(64) },
        ],
        cliName: '@codebasedesigns/project-os',
        cliVersion: '0.0.1',
        createdAt: '2026-03-02T00:00:00.000Z',
        source: {
            owner: 'swanson-dev',
            repo: 'ai-project-initialization',
            ref: 'main',
            rawBase: 'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main',
            isOverride: false,
        },
        projectRoot: 'C:/temp/my-project',
    });
    assert.deepEqual(Object.keys(payload), [
        'registry_version',
        'published_at',
        'contract_version',
        'created_at',
        'project',
        'source',
        'selected',
        'materialization',
        'outputs',
    ]);
    assert.equal(payload.project.project_id, null);
    assert.equal(payload.project.name, 'my-project');
    assert.deepEqual(payload.source, {
        registry: {
            owner: 'swanson-dev',
            repo: 'ai-project-initialization',
            ref: 'main',
            raw_base: 'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main',
            is_override: false,
        },
    });
    assert.deepEqual(payload.selected.agent_packs, ['core']);
    assert.deepEqual(payload.selected.skills, ['documentation-hygiene']);
    assert.deepEqual(payload.selected.registry_docs, ['project-contract']);
    assert.deepEqual(payload.selected.file_templates, ['project-brief', 'requirements']);
    assert.deepEqual(payload.selected.instantiation_rules, [
        { template_id: 'project-brief', target: 'docs/00-overview/project-brief.md' },
        { template_id: 'requirements', target: 'docs/01-requirements/requirements.md' },
    ]);
    assert.deepEqual(payload.outputs.copied_paths, [
        'agent-packs/core/agent-guidelines.md',
        'scaffolds/standard-planning-plus-code',
        'skills/documentation-hygiene/skill.md',
    ]);
    assert.deepEqual(payload.outputs.metadata_files, [
        '.project/bootstrap.lock',
        '.project/project.config.json',
        '.project/selected-assets.json',
    ]);
    assert.deepEqual(payload.outputs.hashes, [
        { path: 'agent-packs/core/agent-guidelines.md', sha256: 'a'.repeat(64) },
        { path: 'skills/documentation-hygiene/skill.md', sha256: 'b'.repeat(64) },
    ]);
});
test('buildSelectedAssetsPayload uses deterministic materialization defaults when absent', () => {
    const manifest = createManifest();
    delete manifest.materialization;
    const payload = buildSelectedAssetsPayload({
        manifest,
        resolvedSelections: createResolvedSelections(),
        scaffoldId: 'standard-planning-plus-code',
        techStackRecipeId: 'nextjs',
        copiedPaths: [],
        instantiatedDocs: [],
        metadataFiles: [],
        cliName: '@codebasedesigns/project-os',
        cliVersion: '0.0.1',
        createdAt: '2026-03-02T00:00:00.000Z',
        source: {
            owner: 'swanson-dev',
            repo: 'ai-project-initialization',
            ref: 'main',
            rawBase: 'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main',
            isOverride: false,
        },
        projectRoot: 'C:/temp/my-project',
    });
    assert.deepEqual(payload.materialization, {
        copy_raw_asset_groups: [],
        asset_group_roots: {},
        exclude_globs: [],
        project_metadata_dir: '.project',
    });
});
test('buildBootstrapLockPayload preserves manifest instantiation order and stable keys', () => {
    const payload = buildBootstrapLockPayload({
        manifest: createManifest(),
        resolvedSelections: createResolvedSelections(),
        scaffoldId: 'standard-planning-plus-code',
        techStackRecipeId: 'nextjs',
        copiedPaths: [],
        instantiatedDocs: [],
        metadataFiles: [],
        cliName: '@codebasedesigns/project-os',
        cliVersion: '0.0.1',
        createdAt: '2026-03-02T00:00:00.000Z',
        source: {
            owner: 'swanson-dev',
            repo: 'ai-project-initialization',
            ref: 'main',
            rawBase: 'https://raw.githubusercontent.com/swanson-dev/ai-project-initialization/main',
            isOverride: false,
        },
        projectRoot: 'C:/temp/my-project',
    });
    assert.deepEqual(Object.keys(payload), [
        'registry',
        'selection',
        'instantiated_docs',
        'manifest_contract_version_used_by_cli',
        'cli',
    ]);
    assert.deepEqual(payload.instantiated_docs, [
        { template_id: 'project-brief', target: 'docs/00-overview/project-brief.md' },
        { template_id: 'requirements', target: 'docs/01-requirements/requirements.md' },
    ]);
    assert.deepEqual(payload.selection.product_type_packs, []);
    assert.equal(payload.cli.name, '@codebasedesigns/project-os');
    assert.equal(payload.cli.version, '0.0.1');
});
test('buildSelectedAssetsPayload supports override source provenance', () => {
    const payload = buildSelectedAssetsPayload({
        manifest: createManifest(),
        resolvedSelections: createResolvedSelections(),
        scaffoldId: 'standard-planning-plus-code',
        techStackRecipeId: 'nextjs',
        copiedPaths: [],
        instantiatedDocs: [],
        metadataFiles: [],
        cliName: '@codebasedesigns/project-os',
        cliVersion: '0.0.1',
        createdAt: '2026-03-02T00:00:00.000Z',
        source: {
            owner: null,
            repo: null,
            ref: 'feature/override',
            rawBase: 'https://example.com/custom-registry',
            isOverride: true,
        },
        projectRoot: 'C:/temp/my-project',
    });
    assert.deepEqual(payload.source, {
        registry: {
            owner: null,
            repo: null,
            ref: 'feature/override',
            raw_base: 'https://example.com/custom-registry',
            is_override: true,
        },
    });
});
