import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeFileHashes, getHashEligibleExpectedPaths } from './hashing.js';
import { getDoctorExitCode, renderDoctorText, runDoctor } from './doctor.js';
import { DoctorOptions, SelectedAssetsPayload } from './types.js';

const DEFAULT_OPTIONS: DoctorOptions = {
  json: false,
  verbose: false,
  roots: false,
  strict: false,
  hash: false,
};

function createSelectedAssetsFixture(): SelectedAssetsPayload {
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

async function withTempProject(run: (root: string) => Promise<void>): Promise<void> {
  const current = process.cwd();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-os-doctor-'));

  try {
    process.chdir(tempRoot);
    await run(tempRoot);
  } finally {
    process.chdir(current);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function writeExpectedFiles(root: string, relPaths: string[]): Promise<void> {
  for (const relPath of relPaths) {
    const absolutePath = path.join(root, ...relPath.split('/'));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `${relPath}\n`, 'utf8');
  }
}

async function writeSelectedAssetsFixture(
  root: string,
  overrides?: Partial<SelectedAssetsPayload>,
): Promise<SelectedAssetsPayload> {
  const base = createSelectedAssetsFixture();
  const payload: SelectedAssetsPayload = {
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

async function writeHashedSelectedAssetsFixture(root: string): Promise<SelectedAssetsPayload> {
  const payload = await writeSelectedAssetsFixture(root);
  await writeExpectedFiles(root, [
    ...payload.outputs.copied_paths,
    ...payload.outputs.instantiated_docs,
    ...payload.outputs.metadata_files.filter((item) => item !== '.project/selected-assets.json'),
  ]);

  const hashes = await computeFileHashes(
    root,
    getHashEligibleExpectedPaths(payload.outputs),
  );

  return writeSelectedAssetsFixture(root, {
    outputs: {
      ...payload.outputs,
      hashes,
    },
  });
}

test('doctor reports clean project and renders clean text output', async () => {
  await withTempProject(async (root) => {
    const payload = await writeSelectedAssetsFixture(root);
    await writeExpectedFiles(root, [
      ...payload.outputs.copied_paths,
      ...payload.outputs.instantiated_docs,
      ...payload.outputs.metadata_files.filter((item) => item !== '.project/selected-assets.json'),
    ]);

    const result = await runDoctor(root, DEFAULT_OPTIONS);

    assert.equal(result.status, 'clean');
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.extra, []);
    assert.equal(getDoctorExitCode(result), 0);
    assert.equal(renderDoctorText(result, { verbose: false, strict: false }), 'CLEAN');
    assert.equal(
      renderDoctorText(result, { verbose: true, strict: false }),
      [
        'CLEAN',
        '',
        'Missing files',
        '  none',
        '',
        'Extra files',
        '  none',
        '',
        'Notes',
        '  selected-assets.json loaded successfully',
      ].join('\n'),
    );
  });
});

test('doctor reports missing expected file as drift', async () => {
  await withTempProject(async (root) => {
    const payload = await writeSelectedAssetsFixture(root);
    await writeExpectedFiles(root, [
      ...payload.outputs.copied_paths,
      ...payload.outputs.instantiated_docs,
      ...payload.outputs.metadata_files.filter((item) => item !== '.project/selected-assets.json'),
    ]);
    await fs.rm(path.join(root, 'docs', '00-overview', 'project-brief.md'));

    const result = await runDoctor(root, DEFAULT_OPTIONS);

    assert.equal(result.status, 'drift');
    assert.deepEqual(result.missing, ['docs/00-overview/project-brief.md']);
    assert.deepEqual(result.extra, []);
    assert.equal(getDoctorExitCode(result), 1);
  });
});

test('doctor reports missing provenance as error', async () => {
  await withTempProject(async (root) => {
    const result = await runDoctor(root, DEFAULT_OPTIONS);

    assert.equal(result.status, 'error');
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.extra, []);
    assert.deepEqual(result.notes, ['.project/selected-assets.json is missing']);
    assert.equal(getDoctorExitCode(result), 2);
    assert.equal(
      renderDoctorText(result, { verbose: false, strict: false }),
      ['ERROR', '', 'Provenance problems', '  .project/selected-assets.json is missing'].join('\n'),
    );
  });
});

test('doctor json output keeps stable key order and sorted arrays', async () => {
  await withTempProject(async (root) => {
    const payload = await writeSelectedAssetsFixture(root, {
      outputs: {
        copied_paths: ['skills/documentation-hygiene/skill.md', 'agent-packs/core/agent-guidelines.md'],
        instantiated_docs: ['docs/00-overview/project-brief.md'],
        metadata_files: ['.project/project.config.json', '.project/bootstrap.lock', '.project/selected-assets.json'],
      },
    });
    await writeExpectedFiles(root, [
      ...payload.outputs.copied_paths,
      ...payload.outputs.instantiated_docs,
      ...payload.outputs.metadata_files.filter((item) => item !== '.project/selected-assets.json'),
    ]);

    const result = await runDoctor(root, DEFAULT_OPTIONS);

    assert.deepEqual(Object.keys(result), ['status', 'provenance', 'missing', 'extra', 'notes']);
    assert.deepEqual(Object.keys(result.provenance), ['path', 'registry_version', 'published_at', 'contract_version']);
    assert.equal(result.provenance.path, '.project/selected-assets.json');
    assert.equal(
      JSON.stringify(result),
      '{"status":"clean","provenance":{"path":".project/selected-assets.json","registry_version":"0.2.0","published_at":"2026-03-01T00:00:00Z","contract_version":"1"},"missing":[],"extra":[],"notes":[]}',
    );
  });
});

test('doctor strict mode reports extra files under known roots only', async () => {
  await withTempProject(async (root) => {
    const payload = await writeSelectedAssetsFixture(root);
    await writeExpectedFiles(root, [
      ...payload.outputs.copied_paths,
      ...payload.outputs.instantiated_docs,
      ...payload.outputs.metadata_files.filter((item) => item !== '.project/selected-assets.json'),
    ]);

    const extraPath = path.join(root, 'skills', 'documentation-hygiene', 'local-note.md');
    await fs.mkdir(path.dirname(extraPath), { recursive: true });
    await fs.writeFile(extraPath, 'note\n', 'utf8');

    const relaxed = await runDoctor(root, DEFAULT_OPTIONS);
    assert.equal(relaxed.status, 'clean');
    assert.deepEqual(relaxed.extra, []);

    const strict = await runDoctor(root, { ...DEFAULT_OPTIONS, strict: true });
    assert.equal(strict.status, 'drift');
    assert.deepEqual(strict.extra, ['skills/documentation-hygiene/local-note.md']);
    assert.equal(getDoctorExitCode(strict), 1);
    assert.match(renderDoctorText(strict, { verbose: false, strict: true }), /Extra files/);
  });
});

test('doctor strict scanning ignores unrelated roots', async () => {
  await withTempProject(async (root) => {
    const payload = await writeSelectedAssetsFixture(root);
    await writeExpectedFiles(root, [
      ...payload.outputs.copied_paths,
      ...payload.outputs.instantiated_docs,
      ...payload.outputs.metadata_files.filter((item) => item !== '.project/selected-assets.json'),
    ]);

    const extraPath = path.join(root, 'tmp', 'local.txt');
    await fs.mkdir(path.dirname(extraPath), { recursive: true });
    await fs.writeFile(extraPath, 'note\n', 'utf8');

    const strict = await runDoctor(root, { ...DEFAULT_OPTIONS, strict: true, roots: true });
    assert.equal(strict.status, 'clean');
    assert.deepEqual(strict.extra, []);
    assert.deepEqual(strict.notes, ['Strict root scanning is limited to known roots only']);
  });
});

test('doctor rejects unsafe provenance paths', async () => {
  await withTempProject(async (root) => {
    await writeSelectedAssetsFixture(root, {
      outputs: {
        copied_paths: ['/bad/file.txt'],
        instantiated_docs: [],
        metadata_files: ['.project/selected-assets.json'],
      },
    });

    const result = await runDoctor(root, DEFAULT_OPTIONS);

    assert.equal(result.status, 'error');
    assert.deepEqual(result.notes, ['Provenance contains an absolute path: /bad/file.txt']);
    assert.equal(getDoctorExitCode(result), 2);
  });
});

test('doctor reports hash mode as error when hashes are absent', async () => {
  await withTempProject(async (root) => {
    const payload = await writeSelectedAssetsFixture(root);
    await writeExpectedFiles(root, [
      ...payload.outputs.copied_paths,
      ...payload.outputs.instantiated_docs,
      ...payload.outputs.metadata_files.filter((item) => item !== '.project/selected-assets.json'),
    ]);

    const result = await runDoctor(root, { ...DEFAULT_OPTIONS, hash: true });

    assert.equal(result.status, 'error');
    assert.deepEqual(result.notes, ['Hash verification requested, but selected-assets.json does not contain hashes']);
    assert.equal(getDoctorExitCode(result), 2);
  });
});

test('doctor --hash succeeds when hashes match', async () => {
  await withTempProject(async (root) => {
    await writeHashedSelectedAssetsFixture(root);

    const result = await runDoctor(root, { ...DEFAULT_OPTIONS, hash: true });

    assert.equal(result.status, 'clean');
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.extra, []);
    assert.deepEqual(result.notes, []);
    assert.equal(getDoctorExitCode(result), 0);
  });
});

test('doctor --hash reports drift when file contents change', async () => {
  await withTempProject(async (root) => {
    const payload = await writeHashedSelectedAssetsFixture(root);
    await fs.writeFile(path.join(root, 'docs', '00-overview', 'project-brief.md'), 'changed\n', 'utf8');

    const result = await runDoctor(root, { ...DEFAULT_OPTIONS, hash: true });

    assert.equal(result.status, 'drift');
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.extra, []);
    assert.deepEqual(result.notes, ['hash mismatch: docs/00-overview/project-brief.md']);
    assert.equal(getDoctorExitCode(result), 1);

    void payload;
  });
});

test('doctor --hash reports malformed hash entries as error', async () => {
  await withTempProject(async (root) => {
    const payload = await writeHashedSelectedAssetsFixture(root);

    const malformedCases: Array<{
      description: string;
      hashes: unknown;
      expected: string;
    }> = [
      {
        description: 'invalid hex length',
        hashes: [{ path: 'docs/00-overview/project-brief.md', sha256: 'abc' }],
        expected: 'selected-assets.json contains invalid sha256 for path: docs/00-overview/project-brief.md',
      },
      {
        description: 'uppercase hex',
        hashes: [{ path: 'docs/00-overview/project-brief.md', sha256: 'A'.repeat(64) }],
        expected: 'selected-assets.json contains invalid sha256 for path: docs/00-overview/project-brief.md',
      },
      {
        description: 'duplicate path',
        hashes: [
          { path: 'docs/00-overview/project-brief.md', sha256: 'a'.repeat(64) },
          { path: 'docs/00-overview/project-brief.md', sha256: 'b'.repeat(64) },
        ],
        expected: 'selected-assets.json contains duplicate hash entry: docs/00-overview/project-brief.md',
      },
      {
        description: 'unsafe path',
        hashes: [{ path: '../bad/file.txt', sha256: 'a'.repeat(64) }],
        expected: 'Provenance contains an unsafe path: ../bad/file.txt',
      },
      {
        description: 'malformed entry',
        hashes: [{ path: 'docs/00-overview/project-brief.md' }],
        expected: 'selected-assets.json contains malformed hash entry',
      },
    ];

    for (const testCase of malformedCases) {
      await writeSelectedAssetsFixture(root, {
        outputs: {
          ...payload.outputs,
          hashes: testCase.hashes as never,
        },
      });

      const result = await runDoctor(root, { ...DEFAULT_OPTIONS, hash: true });
      assert.equal(result.status, 'error', testCase.description);
      assert.deepEqual(result.notes, [testCase.expected], testCase.description);
      assert.equal(getDoctorExitCode(result), 2, testCase.description);
    }
  });
});

test('doctor --hash reports error when required hash coverage is incomplete', async () => {
  await withTempProject(async (root) => {
    const payload = await writeHashedSelectedAssetsFixture(root);
    const hashes = payload.outputs.hashes ?? [];

    await writeSelectedAssetsFixture(root, {
      outputs: {
        ...payload.outputs,
        hashes: hashes.filter((entry) => entry.path !== 'docs/00-overview/project-brief.md'),
      },
    });

    const result = await runDoctor(root, { ...DEFAULT_OPTIONS, hash: true });

    assert.equal(result.status, 'error');
    assert.deepEqual(result.notes, [
      'Hash verification requested, but selected-assets.json is missing hash for expected path: docs/00-overview/project-brief.md',
    ]);
    assert.equal(getDoctorExitCode(result), 2);
  });
});
