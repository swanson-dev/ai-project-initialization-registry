import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from './validate.js';
function createManifest() {
    return {
        version: '0.2.0',
        published_at: '2026-03-01T00:00:00Z',
        scaffolds: [{ id: 'standard-planning-plus-code', path: 'scaffolds/standard-planning-plus-code' }],
        agent_packs: [{ id: 'core', path: 'agent-packs/core' }],
        skills: [
            { id: 'documentation-hygiene', path: 'skills/documentation-hygiene' },
            { id: 'status-and-changelog', path: 'skills/status-and-changelog' },
        ],
        tech_stack_recipes: [{ id: 'nextjs', path: 'tech-stacks/nextjs/recipe.md' }],
        file_templates: [
            { id: 'project-brief', path: 'file-templates/project/project-brief.md' },
            { id: 'requirements', path: 'file-templates/project/requirements.md' },
        ],
        registry_docs: [{ id: 'project-contract', path: 'project-contract.md' }],
    };
}
test('validateManifest accepts legacy manifests with no contract_version', () => {
    assert.doesNotThrow(() => validateManifest(createManifest()));
});
test('validateManifest ignores defaults when contract_version is missing', () => {
    const manifest = createManifest();
    manifest.defaults = {
        skills: ['missing-skill'],
    };
    assert.doesNotThrow(() => validateManifest(manifest));
});
test('validateManifest accepts contract version 1 with valid defaults', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.defaults = {
        agent_packs: ['core'],
        skills: ['documentation-hygiene'],
        file_templates: ['project-brief'],
        registry_docs: ['project-contract'],
    };
    assert.doesNotThrow(() => validateManifest(manifest));
});
test('validateManifest accepts valid materialization block', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.materialization = {
        asset_group_roots: {
            agent_packs: 'agent-packs',
            skills: 'skills',
            tech_stack_recipes: 'tech-stacks',
            file_templates: 'file-templates',
            product_type_packs: 'product-types',
        },
        copy_raw_asset_groups: [
            'agent_packs',
            'skills',
            'tech_stack_recipes',
            'file_templates',
            'product_type_packs',
        ],
        exclude_globs: ['**/.DS_Store', '**/Thumbs.db', '**/.gitkeep'],
        project_metadata_dir: '.project',
    };
    assert.doesNotThrow(() => validateManifest(manifest));
});
test('validateManifest accepts valid instantiation_rules block', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [
        {
            template_id: 'project-brief',
            target: 'docs/00-overview/project-brief.md',
            required: true,
        },
    ];
    assert.doesNotThrow(() => validateManifest(manifest));
});
test('validateManifest rejects non-object materialization', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.materialization = [];
    assert.throws(() => validateManifest(manifest), /materialization must be an object/);
});
test('validateManifest rejects unsupported contract_version', () => {
    const manifest = createManifest();
    manifest.contract_version = '2';
    assert.throws(() => validateManifest(manifest), /Unsupported contract_version: 2/);
});
test('validateManifest rejects defaults with unsupported keys', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.defaults = {
        skills: ['documentation-hygiene'],
        unsupported: ['x'],
    };
    assert.throws(() => validateManifest(manifest), /defaults contains unsupported key: unsupported/);
});
test('validateManifest rejects defaults reference to missing id', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.defaults = {
        skills: ['missing-skill'],
    };
    assert.throws(() => validateManifest(manifest), /defaults\.skills references unknown id: missing-skill/);
});
test('validateManifest allows duplicate defaults ids', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.defaults = {
        skills: ['documentation-hygiene', 'documentation-hygiene'],
    };
    assert.doesNotThrow(() => validateManifest(manifest));
});
test('validateManifest rejects unknown keys under materialization', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.materialization = {
        asset_group_roots: {
            skills: 'skills',
        },
        unsupported: true,
    };
    assert.throws(() => validateManifest(manifest), /materialization contains unsupported key: unsupported/);
});
test('validateManifest rejects copy_raw_asset_groups missing from asset_group_roots', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.materialization = {
        asset_group_roots: {
            skills: 'skills',
        },
        copy_raw_asset_groups: ['skills', 'agent_packs'],
    };
    assert.throws(() => validateManifest(manifest), /materialization\.copy_raw_asset_groups references missing asset_group_roots key: agent_packs/);
});
test('validateManifest rejects invalid copy_raw_asset_groups type', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.materialization = {
        asset_group_roots: {
            skills: 'skills',
        },
        copy_raw_asset_groups: [1],
    };
    assert.throws(() => validateManifest(manifest), /materialization\.copy_raw_asset_groups must be an array of strings/);
});
test('validateManifest rejects absolute asset_group_roots paths', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.materialization = {
        asset_group_roots: {
            skills: '/skills',
        },
    };
    assert.throws(() => validateManifest(manifest), /materialization\.asset_group_roots\.skills must be a relative path/);
});
test('validateManifest rejects asset_group_roots paths containing dot dot segments', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.materialization = {
        asset_group_roots: {
            skills: 'skills/../other',
        },
    };
    assert.throws(() => validateManifest(manifest), /materialization\.asset_group_roots\.skills must not contain '\.\.' segments/);
});
test('validateManifest rejects invalid project_metadata_dir absolute path', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.materialization = {
        project_metadata_dir: '\\.project',
    };
    assert.throws(() => validateManifest(manifest), /materialization\.project_metadata_dir must be a relative path/);
});
test('validateManifest rejects invalid project_metadata_dir with dot dot segment', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.materialization = {
        project_metadata_dir: 'project/../meta',
    };
    assert.throws(() => validateManifest(manifest), /materialization\.project_metadata_dir must not contain '\.\.' segments/);
});
test('validateManifest rejects invalid exclude_globs type', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.materialization = {
        exclude_globs: ['**/.gitkeep', 1],
    };
    assert.throws(() => validateManifest(manifest), /materialization\.exclude_globs must be an array of strings/);
});
test('validateManifest ignores materialization when contract_version is missing', () => {
    const manifest = createManifest();
    manifest.materialization = {
        asset_group_roots: {
            skills: '../invalid',
        },
        unsupported: true,
    };
    assert.doesNotThrow(() => validateManifest(manifest));
});
test('validateManifest rejects non-array instantiation_rules', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = {};
    assert.throws(() => validateManifest(manifest), /instantiation_rules must be an array/);
});
test('validateManifest rejects null instantiation_rules', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = null;
    assert.throws(() => validateManifest(manifest), /instantiation_rules must be an array/);
});
test('validateManifest rejects non-object instantiation rule entries', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = ['project-brief'];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\] must be an object/);
});
test('validateManifest rejects missing template_id in instantiation rules', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [{ target: 'docs/00-overview/project-brief.md' }];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\]\.template_id must be a non-empty string/);
});
test('validateManifest rejects missing target in instantiation rules', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [{ template_id: 'project-brief' }];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\]\.target must be a non-empty string/);
});
test('validateManifest rejects empty trimmed template_id in instantiation rules', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [{ template_id: '  ', target: 'docs/00-overview/project-brief.md' }];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\]\.template_id must be a non-empty string/);
});
test('validateManifest rejects empty trimmed target in instantiation rules', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [{ template_id: 'project-brief', target: '  ' }];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\]\.target must be a non-empty string/);
});
test('validateManifest rejects non-boolean required in instantiation rules', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [
        { template_id: 'project-brief', target: 'docs/00-overview/project-brief.md', required: 'yes' },
    ];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\]\.required must be a boolean/);
});
test('validateManifest rejects unknown keys in instantiation rules', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [
        { template_id: 'project-brief', target: 'docs/00-overview/project-brief.md', extra: true },
    ];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\] contains unsupported key: extra/);
});
test('validateManifest rejects unknown template_id in instantiation rules', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [{ template_id: 'missing', target: 'docs/00-overview/project-brief.md' }];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\]\.template_id references unknown file template id: missing/);
});
test('validateManifest rejects absolute instantiation rule targets', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [{ template_id: 'project-brief', target: '/docs/00-overview/project-brief.md' }];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\]\.target must be a relative path: \/docs\/00-overview\/project-brief\.md/);
});
test('validateManifest rejects backslash absolute instantiation rule targets', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [{ template_id: 'project-brief', target: '\\docs\\00-overview\\project-brief.md' }];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\]\.target must be a relative path: \\docs\\00-overview\\project-brief\.md/);
});
test('validateManifest rejects dot dot segments in instantiation rule targets', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [{ template_id: 'project-brief', target: 'docs/../project-brief.md' }];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\]\.target must not contain '\.\.' segments: docs\/\.\.\/project-brief\.md/);
});
test('validateManifest rejects instantiation rule targets outside docs', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [{ template_id: 'project-brief', target: 'app/project-brief.md' }];
    assert.throws(() => validateManifest(manifest), /instantiation_rules\[0\]\.target must be under docs\/: app\/project-brief\.md/);
});
test('validateManifest rejects duplicate normalized instantiation rule targets', () => {
    const manifest = createManifest();
    manifest.contract_version = '1';
    manifest.instantiation_rules = [
        { template_id: 'project-brief', target: 'docs/00-overview/project-brief.md' },
        { template_id: 'requirements', target: 'docs\\00-overview\\project-brief.md' },
    ];
    assert.throws(() => validateManifest(manifest), /instantiation_rules contains duplicate target: docs\/00-overview\/project-brief\.md/);
});
test('validateManifest ignores instantiation_rules when contract_version is missing', () => {
    const manifest = createManifest();
    manifest.instantiation_rules = [
        { template_id: 'missing', target: '/docs/00-overview/project-brief.md', required: 'yes' },
    ];
    assert.doesNotThrow(() => validateManifest(manifest));
});
