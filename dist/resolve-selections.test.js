import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelections } from './resolve-selections.js';
function createLegacyManifest() {
    return {
        version: '0.2.0',
        scaffolds: [{ id: 'standard-planning-plus-code', path: 'scaffolds/standard-planning-plus-code' }],
        agent_packs: [{ id: 'core', path: 'agent-packs/core' }],
        skills: [
            { id: 'documentation-hygiene', path: 'skills/documentation-hygiene' },
            { id: 'status-and-changelog', path: 'skills/status-and-changelog' },
            { id: 'ui-ux-approval-gate', path: 'skills/ui-ux-approval-gate' },
        ],
        tech_stack_recipes: [{ id: 'nextjs', path: 'tech-stacks/nextjs/recipe.md' }],
        file_templates: [
            { id: 'project-brief', path: 'file-templates/project/project-brief.md' },
            { id: 'requirements', path: 'file-templates/project/requirements.md' },
        ],
        registry_docs: [{ id: 'project-contract', path: 'project-contract.md' }],
    };
}
function createStep1Manifest() {
    return {
        ...createLegacyManifest(),
        contract_version: '1',
        defaults: {
            agent_packs: ['core'],
            skills: ['documentation-hygiene', 'status-and-changelog', 'documentation-hygiene'],
            registry_docs: ['project-contract'],
            file_templates: ['project-brief', 'project-brief'],
        },
    };
}
test('resolveSelections resolves explicit selections only for legacy manifests', () => {
    const manifest = createLegacyManifest();
    manifest.defaults = {
        skills: ['status-and-changelog'],
        registry_docs: ['project-contract'],
    };
    assert.deepEqual(resolveSelections(manifest, {
        agentPackIds: ['core'],
        skillIds: ['documentation-hygiene'],
        registryDocIds: [],
        fileTemplateIds: [],
    }), {
        agentPackIds: ['core'],
        skillIds: ['documentation-hygiene'],
        registryDocIds: [],
        fileTemplateIds: [],
    });
});
test('resolveSelections merges defaults and explicit selections preserving first occurrence', () => {
    assert.deepEqual(resolveSelections(createStep1Manifest(), {
        agentPackIds: ['core'],
        skillIds: ['status-and-changelog', 'ui-ux-approval-gate'],
        registryDocIds: ['project-contract'],
        fileTemplateIds: ['requirements'],
    }), {
        agentPackIds: ['core'],
        skillIds: ['documentation-hygiene', 'status-and-changelog', 'ui-ux-approval-gate'],
        registryDocIds: ['project-contract'],
        fileTemplateIds: ['project-brief', 'requirements'],
    });
});
test('resolveSelections de-dupes defaults and explicit values', () => {
    assert.deepEqual(resolveSelections(createStep1Manifest(), {
        agentPackIds: ['core', 'core'],
        skillIds: ['documentation-hygiene', 'ui-ux-approval-gate', 'documentation-hygiene'],
        registryDocIds: ['project-contract', 'project-contract'],
        fileTemplateIds: ['project-brief', 'requirements', 'requirements'],
    }), {
        agentPackIds: ['core'],
        skillIds: ['documentation-hygiene', 'status-and-changelog', 'ui-ux-approval-gate'],
        registryDocIds: ['project-contract'],
        fileTemplateIds: ['project-brief', 'requirements'],
    });
});
test('resolveSelections rejects unknown explicit ids', () => {
    assert.throws(() => resolveSelections(createStep1Manifest(), {
        agentPackIds: ['core'],
        skillIds: ['missing-skill'],
        registryDocIds: [],
        fileTemplateIds: [],
    }), /Unknown skillIds id: missing-skill/);
});
