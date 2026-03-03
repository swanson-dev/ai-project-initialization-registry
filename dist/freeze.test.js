import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeFileHashes, getHashEligibleExpectedPaths } from './hashing.js';
import { getDoctorExitCode, runDoctor } from './doctor.js';
import { getFreezeExitCode, renderFreezeText, runFreeze } from './freeze.js';
const DEFAULT_FREEZE_OPTIONS = {
    yes: false,
    json: false,
    verbose: false,
    strict: false,
};
const DEFAULT_DOCTOR_OPTIONS = {
    json: false,
    verbose: false,
    roots: false,
    strict: false,
    hash: false,
};
function createSelectedAssetsFixture() {
    return {
        registry_version: '0.2.0',
        published_at: '2026-03-01T00:00:00Z',
        contract_version: '1',
        created_at: '2026-03-02T00:00:00.000Z',
        project: {
            project_id: null,
            name: 'temp-project',
        },
        selected: {
            scaffold: 'standard-planning-plus-code',
            tech_stack_recipe: 'nextjs',
            agent_packs: ['core'],
            skills: ['documentation-hygiene'],
            product_type_packs: [],
            registry_docs: ['project-contract'],
            file_templates: ['project-brief'],
            instantiation_rules: [{ template_id: 'project-brief', target: 'docs/00-overview/project-brief.md' }],
        },
        materialization: {
            copy_raw_asset_groups: ['agent_packs', 'skills'],
            asset_group_roots: {
                agent_packs: 'agent-packs',
                skills: 'skills',
            },
            exclude_globs: ['**/.gitkeep'],
            project_metadata_dir: '.project',
        },
        outputs: {
            copied_paths: ['skills/documentation-hygiene/skill.md', 'agent-packs/core/agent-guidelines.md'],
            instantiated_docs: ['docs/00-overview/project-brief.md'],
            metadata_files: ['.project/bootstrap.lock', '.project/project.config.json', '.project/selected-assets.json'],
        },
    };
}
async function withTempProject(run) {
    const current = process.cwd();
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-os-freeze-'));
    try {
        process.chdir(tempRoot);
        await run(tempRoot);
    }
    finally {
        process.chdir(current);
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}
async function writeExpectedFiles(root, relPaths) {
    for (const relPath of relPaths) {
        const absolutePath = path.join(root, ...relPath.split('/'));
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, `${relPath}\n`, 'utf8');
    }
}
async function writeSelectedAssetsFixture(root, overrides) {
    const base = createSelectedAssetsFixture();
    const payload = {
        registry_version: overrides?.registry_version ?? base.registry_version,
        published_at: overrides?.published_at ?? base.published_at,
        contract_version: overrides?.contract_version ?? base.contract_version,
        created_at: overrides?.created_at ?? base.created_at,
        project: overrides?.project ?? base.project,
        selected: overrides?.selected ?? base.selected,
        materialization: overrides?.materialization ?? base.materialization,
        outputs: overrides?.outputs ?? base.outputs,
    };
    const absolutePath = path.join(root, '.project', 'selected-assets.json');
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return payload;
}
async function writeHashedFixture(root) {
    const payload = await writeSelectedAssetsFixture(root);
    const expectedFiles = [
        ...payload.outputs.copied_paths,
        ...payload.outputs.instantiated_docs,
        ...payload.outputs.metadata_files.filter((item) => item !== '.project/selected-assets.json'),
    ];
    await writeExpectedFiles(root, expectedFiles);
    const hashes = await computeFileHashes(root, getHashEligibleExpectedPaths(payload.outputs));
    return writeSelectedAssetsFixture(root, {
        outputs: {
            ...payload.outputs,
            hashes,
        },
    });
}
test('freeze dry-run detects drift and does not modify selected-assets.json', async () => {
    await withTempProject(async (root) => {
        await writeHashedFixture(root);
        const provenancePath = path.join(root, '.project', 'selected-assets.json');
        const original = await fs.readFile(provenancePath, 'utf8');
        await fs.writeFile(path.join(root, 'docs', '00-overview', 'project-brief.md'), 'changed\n', 'utf8');
        const result = await runFreeze(root, DEFAULT_FREEZE_OPTIONS);
        assert.equal(result.status, 'dry_run');
        assert.ok(result.updated_hashes_count > 0);
        assert.deepEqual(result.missing, []);
        assert.deepEqual(result.notes, ['hashes would be updated']);
        assert.equal(getFreezeExitCode(result), 0);
        assert.equal(await fs.readFile(provenancePath, 'utf8'), original);
        assert.match(renderFreezeText(result, { verbose: false }), /DRY RUN/);
    });
});
test('freeze --yes applies update and doctor --hash becomes clean', async () => {
    await withTempProject(async (root) => {
        await writeHashedFixture(root);
        const changedPath = path.join(root, 'docs', '00-overview', 'project-brief.md');
        await fs.writeFile(changedPath, 'changed\n', 'utf8');
        const result = await runFreeze(root, { ...DEFAULT_FREEZE_OPTIONS, yes: true });
        assert.equal(result.status, 'updated');
        assert.ok(result.updated_hashes_count > 0);
        assert.deepEqual(result.missing, []);
        assert.deepEqual(result.notes, ['selected-assets.json hashes updated']);
        const updatedPayload = JSON.parse(await fs.readFile(path.join(root, '.project', 'selected-assets.json'), 'utf8'));
        const hashes = updatedPayload.outputs.hashes ?? [];
        const sortedPaths = [...hashes].map((entry) => entry.path);
        assert.deepEqual(sortedPaths, [...sortedPaths].sort((left, right) => left.localeCompare(right)));
        for (const entry of hashes) {
            assert.match(entry.sha256, /^[0-9a-f]{64}$/);
        }
        const doctorResult = await runDoctor(root, { ...DEFAULT_DOCTOR_OPTIONS, hash: true });
        assert.equal(doctorResult.status, 'clean');
        assert.equal(getDoctorExitCode(doctorResult), 0);
    });
});
test('freeze --strict blocks missing eligible file and keeps provenance unchanged', async () => {
    await withTempProject(async (root) => {
        await writeHashedFixture(root);
        const provenancePath = path.join(root, '.project', 'selected-assets.json');
        const original = await fs.readFile(provenancePath, 'utf8');
        await fs.rm(path.join(root, 'docs', '00-overview', 'project-brief.md'));
        const result = await runFreeze(root, { ...DEFAULT_FREEZE_OPTIONS, yes: true, strict: true });
        assert.equal(result.status, 'error');
        assert.deepEqual(result.missing, ['docs/00-overview/project-brief.md']);
        assert.deepEqual(result.notes, ['strict mode blocked freeze because expected files are missing']);
        assert.equal(getFreezeExitCode(result), 2);
        assert.equal(await fs.readFile(provenancePath, 'utf8'), original);
    });
});
test('freeze --yes blocks missing eligible file even without strict', async () => {
    await withTempProject(async (root) => {
        await writeHashedFixture(root);
        const provenancePath = path.join(root, '.project', 'selected-assets.json');
        const original = await fs.readFile(provenancePath, 'utf8');
        await fs.rm(path.join(root, 'docs', '00-overview', 'project-brief.md'));
        const result = await runFreeze(root, { ...DEFAULT_FREEZE_OPTIONS, yes: true });
        assert.equal(result.status, 'error');
        assert.deepEqual(result.missing, ['docs/00-overview/project-brief.md']);
        assert.deepEqual(result.notes, ['freeze cannot update hashes while expected files are missing']);
        assert.equal(getFreezeExitCode(result), 2);
        assert.equal(await fs.readFile(provenancePath, 'utf8'), original);
    });
});
test('freeze writes hashes in sorted lowercase form with no duplicates', async () => {
    await withTempProject(async (root) => {
        const payload = await writeHashedFixture(root);
        await writeSelectedAssetsFixture(root, {
            outputs: {
                ...payload.outputs,
                hashes: [
                    { path: 'skills/documentation-hygiene/skill.md', sha256: 'B'.repeat(64).toLowerCase() },
                    { path: 'agent-packs/core/agent-guidelines.md', sha256: 'A'.repeat(64).toLowerCase() },
                ],
            },
        });
        const result = await runFreeze(root, { ...DEFAULT_FREEZE_OPTIONS, yes: true });
        assert.equal(result.status, 'updated');
        const updatedPayload = JSON.parse(await fs.readFile(path.join(root, '.project', 'selected-assets.json'), 'utf8'));
        const hashes = updatedPayload.outputs.hashes ?? [];
        const paths = hashes.map((entry) => entry.path);
        assert.deepEqual(paths, [...paths].sort((left, right) => left.localeCompare(right)));
        assert.equal(new Set(paths).size, paths.length);
        for (const entry of hashes) {
            assert.match(entry.sha256, /^[0-9a-f]{64}$/);
        }
    });
});
test('freeze preserves original selected-assets.json when atomic rename fails', async (t) => {
    await withTempProject(async (root) => {
        await writeHashedFixture(root);
        const provenancePath = path.join(root, '.project', 'selected-assets.json');
        const original = await fs.readFile(provenancePath, 'utf8');
        await fs.writeFile(path.join(root, 'docs', '00-overview', 'project-brief.md'), 'changed\n', 'utf8');
        const originalRename = fs.rename.bind(fs);
        t.mock.method(fs, 'rename', async (oldPath, newPath) => {
            if (typeof newPath === 'string' &&
                newPath.endsWith(path.join('.project', 'selected-assets.json'))) {
                throw new Error('Simulated rename failure');
            }
            return originalRename(oldPath, newPath);
        });
        const result = await runFreeze(root, { ...DEFAULT_FREEZE_OPTIONS, yes: true });
        assert.equal(result.status, 'error');
        assert.deepEqual(result.notes, ['Simulated rename failure']);
        assert.equal(await fs.readFile(provenancePath, 'utf8'), original);
        await assert.rejects(() => fs.access(path.join(root, '.project', 'selected-assets.json.tmp')));
    });
});
test('freeze rejects legacy provenance', async () => {
    await withTempProject(async (root) => {
        const payload = createSelectedAssetsFixture();
        delete payload.contract_version;
        const provenancePath = path.join(root, '.project', 'selected-assets.json');
        await fs.mkdir(path.dirname(provenancePath), { recursive: true });
        await fs.writeFile(provenancePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
        const result = await runFreeze(root, DEFAULT_FREEZE_OPTIONS);
        assert.equal(result.status, 'error');
        assert.deepEqual(result.notes, ['freeze is only supported for contract_version "1" projects']);
        assert.equal(getFreezeExitCode(result), 2);
    });
});
test('freeze dry-run no-op reports unchanged payload', async () => {
    await withTempProject(async (root) => {
        await writeHashedFixture(root);
        const result = await runFreeze(root, DEFAULT_FREEZE_OPTIONS);
        assert.equal(result.status, 'dry_run');
        assert.equal(result.updated_hashes_count, 0);
        assert.deepEqual(result.notes, ['selected-assets.json would not change']);
        assert.equal(JSON.stringify(result), '{"status":"dry_run","provenance_path":".project/selected-assets.json","updated_hashes_count":0,"missing":[],"notes":["selected-assets.json would not change"]}');
        assert.equal(renderFreezeText(result, { verbose: true }), [
            'DRY RUN',
            '',
            'Updated hashes',
            '  0',
            '',
            'Missing files',
            '  none',
            '',
            'Notes',
            '  selected-assets.json would not change',
        ].join('\n'));
    });
});
