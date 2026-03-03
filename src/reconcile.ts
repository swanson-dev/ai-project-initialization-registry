import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectExtraPaths, collectMissingExpectedPaths, buildExpectedPathSet, getKnownRoots, normalizeProjectRelativePath } from './doctor.js';
import { fetchManifest, fetchText, resolveRegistrySource } from './fetch.js';
import { computeFileHashes, computeSingleFileHash, getHashEligibleExpectedPaths, normalizeHashPath } from './hashing.js';
import { planTemplateInstantiation } from './instantiate-templates.js';
import { planRawMaterialization } from './materialize-raw-assets.js';
import { planComposePaths } from './compose.js';
import {
  Manifest,
  ReconcileOptions,
  ReconcileResult,
  RegistrySource,
  ResolvedSelections,
  SelectedAssetsHashEntry,
  SelectedAssetsPayload,
  SelectedAssetsSource,
} from './types.js';
import { createWriteContext, ensureTrackedDir, recordCreatedFile, rollbackWriteContext, WriteContext } from './write-context.js';

const PROVENANCE_PATH = '.project/selected-assets.json' as const;
const PROJECT_CONFIG_PATH = '.project/project.config.json';
const BOOTSTRAP_LOCK_PATH = '.project/bootstrap.lock';
const SELECTED_ASSETS_TEMP_PATH = '.project/selected-assets.json.tmp';

type ReconcileWritePlanItem = {
  category: 'copied' | 'instantiated';
  targetRel: string;
  targetAbs: string;
  sourceRel: string;
  desiredBytes: Buffer;
};

type ReconcileDeletePlanItem = {
  targetRel: string;
  targetAbs: string;
};

type ReconcileTransaction = {
  writeContext: WriteContext;
  backupRoot: string;
  overwrittenFiles: Array<{
    targetRel: string;
    backupAbs: string;
  }>;
  deletedFiles: Array<{
    targetRel: string;
    backupAbs: string;
  }>;
};

type SelectedAssetsPayloadWithOptionalHashes = SelectedAssetsPayload & {
  outputs: SelectedAssetsPayload['outputs'] & {
    hashes?: SelectedAssetsHashEntry[];
  };
};

type PlannedRepairs = {
  writeItems: ReconcileWritePlanItem[];
  unresolvedPaths: string[];
  mismatchedPaths: string[];
};

function createResult(
  status: ReconcileResult['status'],
  planned: ReconcileResult['planned'],
  applied: ReconcileResult['applied'],
  missing: string[],
  mismatched: string[],
  extra: string[],
  notes: string[],
): ReconcileResult {
  return {
    status,
    provenance_path: PROVENANCE_PATH,
    planned: {
      write: [...planned.write].sort((left, right) => left.localeCompare(right)),
      delete: [...planned.delete].sort((left, right) => left.localeCompare(right)),
      skip: [...planned.skip].sort((left, right) => left.localeCompare(right)),
    },
    applied: {
      written: [...applied.written].sort((left, right) => left.localeCompare(right)),
      deleted: [...applied.deleted].sort((left, right) => left.localeCompare(right)),
      skipped: [...applied.skipped].sort((left, right) => left.localeCompare(right)),
    },
    missing: [...missing].sort((left, right) => left.localeCompare(right)),
    mismatched: [...mismatched].sort((left, right) => left.localeCompare(right)),
    extra: [...extra].sort((left, right) => left.localeCompare(right)),
    notes: [...notes].sort((left, right) => left.localeCompare(right)),
  };
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function readBytesIfExists(absolutePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readSelectedAssetsForReconcile(projectRoot: string): Promise<SelectedAssetsPayloadWithOptionalHashes> {
  const absolutePath = path.join(projectRoot, ...PROVENANCE_PATH.split('/'));
  const contents = await fs.readFile(absolutePath, 'utf8');
  const payload = JSON.parse(contents) as unknown;

  if (!payload || typeof payload !== 'object') {
    throw new Error('selected-assets.json must contain a JSON object');
  }

  return payload as SelectedAssetsPayloadWithOptionalHashes;
}

function buildRegistrySourceFromPersistedSource(source: SelectedAssetsSource['registry']): RegistrySource {
  return {
    rawBase: source.raw_base,
    refUsed: source.ref,
    owner: source.owner ?? 'unknown',
    repo: source.repo ?? 'unknown',
    isOverride: source.is_override,
  };
}

function validatePersistedSource(source: unknown): source is SelectedAssetsSource['registry'] {
  if (!source || typeof source !== 'object') {
    return false;
  }

  const candidate = source as {
    owner?: unknown;
    repo?: unknown;
    ref?: unknown;
    raw_base?: unknown;
    is_override?: unknown;
  };

  return (
    (candidate.owner === null || typeof candidate.owner === 'string') &&
    (candidate.repo === null || typeof candidate.repo === 'string') &&
    typeof candidate.ref === 'string' &&
    candidate.ref.length > 0 &&
    typeof candidate.raw_base === 'string' &&
    candidate.raw_base.length > 0 &&
    typeof candidate.is_override === 'boolean'
  );
}

async function resolveRegistrySourceForReconcile(
  projectRoot: string,
  payload: SelectedAssetsPayloadWithOptionalHashes,
): Promise<{ source: RegistrySource; usedFallback: boolean }> {
  if (payload.source !== undefined) {
    const persisted = (payload.source as { registry?: unknown }).registry;
    if (!validatePersistedSource(persisted)) {
      throw new Error('selected-assets.json contains malformed source provenance');
    }

    return {
      source: buildRegistrySourceFromPersistedSource(persisted),
      usedFallback: false,
    };
  }

  let registryRef = 'main';
  const projectConfigPath = path.join(projectRoot, ...PROJECT_CONFIG_PATH.split('/'));

  try {
    const contents = await fs.readFile(projectConfigPath, 'utf8');
    const payload = JSON.parse(contents) as unknown;
    if (payload && typeof payload === 'object' && typeof (payload as { registry_ref?: unknown }).registry_ref === 'string') {
      registryRef = (payload as { registry_ref: string }).registry_ref;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  return {
    source: resolveRegistrySource(registryRef),
    usedFallback: true,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function validateReconcilePayload(payload: SelectedAssetsPayloadWithOptionalHashes): void {
  if (payload.contract_version !== '1') {
    throw new Error('reconcile is only supported for contract_version "1" projects');
  }

  if (!payload.outputs || typeof payload.outputs !== 'object') {
    throw new Error('selected-assets.json is missing outputs');
  }

  if (
    !isStringArray(payload.outputs.copied_paths) ||
    !isStringArray(payload.outputs.instantiated_docs) ||
    !isStringArray(payload.outputs.metadata_files)
  ) {
    throw new Error(
      'selected-assets.json outputs must include copied_paths, instantiated_docs, and metadata_files arrays',
    );
  }

  if (!payload.selected || typeof payload.selected !== 'object') {
    throw new Error('selected-assets.json is missing selected block');
  }

  if (
    typeof payload.selected.scaffold !== 'string' ||
    typeof payload.selected.tech_stack_recipe !== 'string' ||
    !isStringArray(payload.selected.agent_packs) ||
    !isStringArray(payload.selected.skills) ||
    !isStringArray(payload.selected.product_type_packs) ||
    !isStringArray(payload.selected.registry_docs) ||
    !isStringArray(payload.selected.file_templates) ||
    !Array.isArray(payload.selected.instantiation_rules)
  ) {
    throw new Error('selected-assets.json selected block is malformed');
  }

  for (const rule of payload.selected.instantiation_rules) {
    if (
      !rule ||
      typeof rule !== 'object' ||
      typeof (rule as { template_id?: unknown }).template_id !== 'string' ||
      typeof (rule as { target?: unknown }).target !== 'string'
    ) {
      throw new Error('selected-assets.json selected.instantiation_rules is malformed');
    }
  }

  if (!payload.materialization || typeof payload.materialization !== 'object') {
    throw new Error('selected-assets.json is missing materialization block');
  }
}

function buildExpectedPathsFromPayload(payload: SelectedAssetsPayload): Set<string> {
  return buildExpectedPathSet(payload);
}

function buildResolvedSelectionsFromPayload(payload: SelectedAssetsPayload): ResolvedSelections {
  return {
    agentPackIds: [...payload.selected.agent_packs],
    skillIds: [...payload.selected.skills],
    registryDocIds: [...payload.selected.registry_docs],
    fileTemplateIds: [...payload.selected.file_templates],
  };
}

function buildManifestForReconcile(manifest: Manifest, payload: SelectedAssetsPayload): Manifest {
  return {
    ...manifest,
    materialization: payload.materialization,
    instantiation_rules: payload.selected.instantiation_rules.map((rule) => ({
      template_id: rule.template_id,
      target: rule.target,
      required: true,
    })),
  };
}

function comparePathSets(previousHashes: SelectedAssetsHashEntry[] | undefined, nextHashes: SelectedAssetsHashEntry[]): boolean {
  const previousMap = new Map<string, string>();
  for (const entry of previousHashes ?? []) {
    previousMap.set(normalizeHashPath(entry.path), entry.sha256);
  }

  if (previousMap.size !== nextHashes.length) {
    return true;
  }

  for (const entry of nextHashes) {
    if (previousMap.get(normalizeHashPath(entry.path)) !== entry.sha256) {
      return true;
    }
  }

  return false;
}

function filterHashesForEligiblePaths(
  hashes: SelectedAssetsHashEntry[] | undefined,
  eligiblePaths: string[],
): SelectedAssetsHashEntry[] {
  const eligiblePathSet = new Set(eligiblePaths);
  return (hashes ?? []).filter((entry) => eligiblePathSet.has(normalizeHashPath(entry.path)));
}

async function validateRecordedHashes(
  projectRoot: string,
  payload: SelectedAssetsPayloadWithOptionalHashes,
): Promise<string[]> {
  const mismatched = new Set<string>();
  const hashes = payload.outputs.hashes;
  if (hashes === undefined) {
    return [];
  }

  if (!Array.isArray(hashes)) {
    throw new Error('selected-assets.json outputs.hashes must be an array');
  }

  const hashMap = new Map<string, string>();
  for (const entry of hashes) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.path !== 'string' ||
      typeof entry.sha256 !== 'string'
    ) {
      throw new Error('selected-assets.json contains malformed hash entry');
    }

    const normalizedPath = normalizeHashPath(entry.path);
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`selected-assets.json contains invalid sha256 for path: ${normalizedPath}`);
    }
    if (hashMap.has(normalizedPath)) {
      throw new Error(`selected-assets.json contains duplicate hash entry: ${normalizedPath}`);
    }

    hashMap.set(normalizedPath, entry.sha256);
  }

  const requiredPaths = getHashEligibleExpectedPaths(payload.outputs);
  for (const relPath of requiredPaths) {
    if (!hashMap.has(relPath)) {
      throw new Error(`selected-assets.json is missing hash for expected path: ${relPath}`);
    }
  }

  for (const relPath of requiredPaths) {
    const absolutePath = path.join(projectRoot, ...relPath.split('/'));
    if (!(await pathExists(absolutePath))) {
      continue;
    }

    const currentHash = await computeSingleFileHash(projectRoot, relPath);
    if (currentHash.sha256 !== hashMap.get(relPath)) {
      mismatched.add(relPath);
    }
  }

  return [...mismatched].sort((left, right) => left.localeCompare(right));
}

async function planCopiedRepairs(
  source: RegistrySource,
  manifest: Manifest,
  payload: SelectedAssetsPayload,
  projectRoot: string,
): Promise<PlannedRepairs> {
  const writeItems: ReconcileWritePlanItem[] = [];
  const unresolvedPaths: string[] = [];
  const mismatchedPaths: string[] = [];
  const composePathSet = new Set(planComposePaths(manifest, payload.selected.scaffold));
  const rawPlan = await planRawMaterialization(
    source,
    manifest,
    buildResolvedSelectionsFromPayload(payload),
    payload.selected.tech_stack_recipe,
    payload.selected.product_type_packs,
    projectRoot,
  );
  const rawPlanMap = new Map(rawPlan.map((item) => [item.destRel, item.sourceRel]));

  for (const relPath of [...payload.outputs.copied_paths].map((item) => normalizeProjectRelativePath(item))) {
    let sourceRel: string | undefined;
    if (composePathSet.has(relPath)) {
      sourceRel = relPath;
    } else if (rawPlanMap.has(relPath)) {
      sourceRel = rawPlanMap.get(relPath);
    }

    if (!sourceRel) {
      unresolvedPaths.push(relPath);
      continue;
    }

    const desiredBytes = Buffer.from(await fetchText(source.rawBase, sourceRel), 'utf8');
    const targetAbs = path.join(projectRoot, ...relPath.split('/'));
    const currentBytes = await readBytesIfExists(targetAbs);

    if (currentBytes && !currentBytes.equals(desiredBytes)) {
      mismatchedPaths.push(relPath);
    }

    if (!currentBytes || !currentBytes.equals(desiredBytes)) {
      writeItems.push({
        category: 'copied',
        targetRel: relPath,
        targetAbs,
        sourceRel,
        desiredBytes,
      });
    }
  }

  return {
    writeItems: writeItems.sort((left, right) => left.targetRel.localeCompare(right.targetRel)),
    unresolvedPaths: unresolvedPaths.sort((left, right) => left.localeCompare(right)),
    mismatchedPaths: mismatchedPaths.sort((left, right) => left.localeCompare(right)),
  };
}

async function planInstantiatedDocRepairs(
  source: RegistrySource,
  manifest: Manifest,
  payload: SelectedAssetsPayload,
  projectRoot: string,
): Promise<PlannedRepairs> {
  const writeItems: ReconcileWritePlanItem[] = [];
  const unresolvedPaths: string[] = [];
  const mismatchedPaths: string[] = [];
  const plan = await planTemplateInstantiation(source.rawBase, manifest, projectRoot);
  const planMap = new Map(plan.map((item) => [item.targetRel, item]));

  for (const relPath of [...payload.outputs.instantiated_docs].map((item) => normalizeProjectRelativePath(item))) {
    const plannedItem = planMap.get(relPath);
    if (!plannedItem) {
      unresolvedPaths.push(relPath);
      continue;
    }

    const desiredBytes = Buffer.from(plannedItem.content, 'utf8');
    const currentBytes = await readBytesIfExists(plannedItem.targetAbs);
    if (currentBytes && !currentBytes.equals(desiredBytes)) {
      mismatchedPaths.push(relPath);
    }

    if (!currentBytes || !currentBytes.equals(desiredBytes)) {
      writeItems.push({
        category: 'instantiated',
        targetRel: relPath,
        targetAbs: plannedItem.targetAbs,
        sourceRel: plannedItem.sourcePath,
        desiredBytes,
      });
    }
  }

  return {
    writeItems: writeItems.sort((left, right) => left.targetRel.localeCompare(right.targetRel)),
    unresolvedPaths: unresolvedPaths.sort((left, right) => left.localeCompare(right)),
    mismatchedPaths: mismatchedPaths.sort((left, right) => left.localeCompare(right)),
  };
}

function planMetadataSkips(
  payload: SelectedAssetsPayload,
  missing: string[],
  mismatched: string[],
): string[] {
  const missingSet = new Set(missing);
  const mismatchedSet = new Set(mismatched);
  const skipped = new Set<string>();

  for (const relPath of payload.outputs.metadata_files.map((item) => normalizeProjectRelativePath(item))) {
    const drifted = missingSet.has(relPath) || mismatchedSet.has(relPath);
    if (!drifted) {
      continue;
    }

    if (relPath === '.project/selected-assets.json') {
      continue;
    }

    skipped.add(relPath);
  }

  return [...skipped].sort((left, right) => left.localeCompare(right));
}

async function createReconcileTransaction(): Promise<ReconcileTransaction> {
  return {
    writeContext: createWriteContext(),
    backupRoot: await fs.mkdtemp(path.join(os.tmpdir(), 'project-os-reconcile-')),
    overwrittenFiles: [],
    deletedFiles: [],
  };
}

async function backupExistingFile(
  transaction: ReconcileTransaction,
  projectRoot: string,
  targetRel: string,
  destination: 'overwrittenFiles' | 'deletedFiles',
): Promise<void> {
  const collection = transaction[destination];
  if (collection.some((entry) => entry.targetRel === targetRel)) {
    return;
  }

  const targetAbs = path.join(projectRoot, ...targetRel.split('/'));
  if (!(await pathExists(targetAbs))) {
    return;
  }

  const backupAbs = path.join(transaction.backupRoot, ...targetRel.split('/'));
  await fs.mkdir(path.dirname(backupAbs), { recursive: true });
  await fs.copyFile(targetAbs, backupAbs);
  collection.push({ targetRel, backupAbs });
}

async function removeEmptyParentDirs(projectRoot: string, targetRel: string): Promise<void> {
  const segments = path.posix.dirname(targetRel).split('/').filter(Boolean);
  while (segments.length > 0) {
    const currentRel = segments.join('/');
    try {
      await fs.rmdir(path.join(projectRoot, ...currentRel.split('/')));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        segments.pop();
        continue;
      }
      if (code === 'ENOTEMPTY') {
        break;
      }
      throw error;
    }
    segments.pop();
  }
}

async function applyWritePlan(
  plan: ReconcileWritePlanItem[],
  transaction: ReconcileTransaction,
  projectRoot: string,
): Promise<string[]> {
  const written: string[] = [];

  for (const item of [...plan].sort((left, right) => left.targetRel.localeCompare(right.targetRel))) {
    const existed = await pathExists(item.targetAbs);
    if (existed) {
      await backupExistingFile(transaction, projectRoot, item.targetRel, 'overwrittenFiles');
    } else {
      await ensureTrackedDir(path.posix.dirname(item.targetRel), transaction.writeContext, projectRoot);
    }

    await fs.writeFile(item.targetAbs, item.desiredBytes);
    if (!existed) {
      recordCreatedFile(transaction.writeContext, item.targetRel);
    }
    written.push(item.targetRel);
  }

  return written;
}

async function applyDeletePlan(
  plan: ReconcileDeletePlanItem[],
  transaction: ReconcileTransaction,
  projectRoot: string,
): Promise<string[]> {
  const deleted: string[] = [];

  for (const item of [...plan].sort((left, right) => left.targetRel.localeCompare(right.targetRel))) {
    if (!(await pathExists(item.targetAbs))) {
      continue;
    }

    await backupExistingFile(transaction, projectRoot, item.targetRel, 'deletedFiles');
    await fs.rm(item.targetAbs);
    await removeEmptyParentDirs(projectRoot, item.targetRel);
    deleted.push(item.targetRel);
  }

  return deleted;
}

async function restoreBackedUpFiles(
  entries: Array<{ targetRel: string; backupAbs: string }>,
  projectRoot: string,
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    const targetAbs = path.join(projectRoot, ...entry.targetRel.split('/'));
    await fs.mkdir(path.dirname(targetAbs), { recursive: true });
    await fs.copyFile(entry.backupAbs, targetAbs);
  }
}

async function rollbackReconcileTransaction(
  transaction: ReconcileTransaction,
  projectRoot: string,
): Promise<void> {
  await restoreBackedUpFiles(transaction.deletedFiles, projectRoot);
  await restoreBackedUpFiles(transaction.overwrittenFiles, projectRoot);
  await rollbackWriteContext(transaction.writeContext, projectRoot);
  await fs.rm(transaction.backupRoot, { recursive: true, force: true }).catch(() => undefined);
  await fs.rm(path.join(projectRoot, ...SELECTED_ASSETS_TEMP_PATH.split('/')), { force: true }).catch(() => undefined);
}

async function cleanupReconcileTransaction(transaction: ReconcileTransaction): Promise<void> {
  await fs.rm(transaction.backupRoot, { recursive: true, force: true }).catch(() => undefined);
}

async function updateSelectedAssetsHashesAtomically(
  projectRoot: string,
  payload: SelectedAssetsPayload,
  hashes: SelectedAssetsHashEntry[],
): Promise<void> {
  const targetPath = path.join(projectRoot, ...PROVENANCE_PATH.split('/'));
  const tempPath = path.join(projectRoot, ...SELECTED_ASSETS_TEMP_PATH.split('/'));
  const updatedPayload: SelectedAssetsPayload = {
    registry_version: payload.registry_version,
    published_at: payload.published_at,
    contract_version: payload.contract_version,
    created_at: payload.created_at,
    project: payload.project,
    source: payload.source,
    selected: payload.selected,
    materialization: payload.materialization,
    outputs: {
      copied_paths: payload.outputs.copied_paths,
      instantiated_docs: payload.outputs.instantiated_docs,
      metadata_files: payload.outputs.metadata_files,
      hashes: [...hashes].sort((left, right) => left.path.localeCompare(right.path)),
    },
  };

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tempPath, 'w');
    await handle.writeFile(JSON.stringify(updatedPayload, null, 2) + '\n', 'utf8');
    if (typeof handle.sync === 'function') {
      await handle.sync();
    }
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, targetPath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function buildSkipNotes(skipped: string[]): string[] {
  const notes: string[] = [];

  for (const relPath of skipped) {
    if (relPath === PROJECT_CONFIG_PATH || relPath === BOOTSTRAP_LOCK_PATH) {
      notes.push(`skipped unreconstructable file: ${relPath}`);
    } else {
      notes.push(`skipped user-authored file: ${relPath}`);
    }
  }

  return notes;
}

function getDeletePlan(extra: string[], options: ReconcileOptions): string[] {
  if (!options.strict || !options.deleteExtra) {
    return [];
  }

  return [...extra].sort((left, right) => left.localeCompare(right));
}

function filterReconcileExtras(extra: string[]): string[] {
  return extra
    .filter((relPath) => relPath !== 'agents/manifest.json')
    .sort((left, right) => left.localeCompare(right));
}

export async function runReconcile(projectRoot: string, options: ReconcileOptions): Promise<ReconcileResult> {
  const emptyPlan = { write: [], delete: [], skip: [] };
  const emptyApplied = { written: [], deleted: [], skipped: [] };
  let payload: SelectedAssetsPayloadWithOptionalHashes;

  try {
    payload = await readSelectedAssetsForReconcile(projectRoot);
  } catch (error) {
    const message =
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? `${PROVENANCE_PATH} is missing`
        : (error as Error).message;

    return createResult('error', emptyPlan, emptyApplied, [], [], [], [message]);
  }

  try {
    if (options.deleteExtra && !options.strict) {
      return createResult('error', emptyPlan, emptyApplied, [], [], [], ['--delete-extra requires --strict']);
    }

    validateReconcilePayload(payload);

    const expectedPathSet = buildExpectedPathsFromPayload(payload);
    const expectedPaths = [...expectedPathSet].sort((left, right) => left.localeCompare(right));
    const missing = await collectMissingExpectedPaths(projectRoot, expectedPaths);
    const mismatchedSet = new Set<string>(await validateRecordedHashes(projectRoot, payload));

    const { source, usedFallback } = await resolveRegistrySourceForReconcile(projectRoot, payload);
    const fetchedManifest = await fetchManifest(source.rawBase);
    const manifest = buildManifestForReconcile(fetchedManifest, payload);

    const copiedRepairs = await planCopiedRepairs(source, manifest, payload, projectRoot);
    const instantiatedRepairs = await planInstantiatedDocRepairs(source, manifest, payload, projectRoot);
    const unresolved = [...copiedRepairs.unresolvedPaths, ...instantiatedRepairs.unresolvedPaths].sort((left, right) =>
      left.localeCompare(right),
    );

    if (unresolved.length > 0) {
      return createResult('error', emptyPlan, emptyApplied, missing, [], [], [
        `reconcile could not resolve provenance-managed path: ${unresolved[0]}`,
      ]);
    }

    for (const relPath of copiedRepairs.mismatchedPaths) {
      mismatchedSet.add(relPath);
    }
    for (const relPath of instantiatedRepairs.mismatchedPaths) {
      mismatchedSet.add(relPath);
    }

    const mismatched = [...mismatchedSet].sort((left, right) => left.localeCompare(right));
    const skipped = planMetadataSkips(payload, missing, mismatched);
    const skipNotes = buildSkipNotes(skipped);
    const extra = options.strict ? filterReconcileExtras(await collectExtraPaths(projectRoot, expectedPathSet, getKnownRoots())) : [];
    const deleteTargets = getDeletePlan(extra, options);

    const repairWriteTargets = [
      ...copiedRepairs.writeItems.map((item) => item.targetRel),
      ...instantiatedRepairs.writeItems.map((item) => item.targetRel),
    ].sort((left, right) => left.localeCompare(right));

    const hashEligiblePaths = getHashEligibleExpectedPaths(payload.outputs);
    const eligiblePreviousHashes = filterHashesForEligiblePaths(payload.outputs.hashes, hashEligiblePaths);
    const repairableTargets = new Set(repairWriteTargets);
    const blockedHashMissing = missing.filter((relPath) => hashEligiblePaths.includes(relPath) && !repairableTargets.has(relPath));
    const canRefreshHashes = blockedHashMissing.length === 0;
    const repairableDriftExists = repairWriteTargets.length > 0 || deleteTargets.length > 0;
    let shouldRefreshHashes = false;
    if (repairableDriftExists) {
      shouldRefreshHashes = true;
    } else if (canRefreshHashes) {
      const currentHashes = await computeFileHashes(projectRoot, hashEligiblePaths);
      shouldRefreshHashes = comparePathSets(eligiblePreviousHashes, currentHashes);
    }

    const plannedWrite = [
      ...repairWriteTargets,
      ...(shouldRefreshHashes ? [PROVENANCE_PATH] : []),
    ].sort((left, right) => left.localeCompare(right));
    const planned = {
      write: plannedWrite,
      delete: deleteTargets,
      skip: skipped,
    };

    const driftExists =
      missing.length > 0 ||
      mismatched.length > 0 ||
      extra.length > 0 ||
      planned.write.length > 0 ||
      planned.delete.length > 0 ||
      planned.skip.length > 0;

    if (!options.yes) {
      if (!driftExists) {
        return createResult('clean', planned, emptyApplied, missing, mismatched, extra, []);
      }

      const notes = [...skipNotes];
      if (usedFallback) {
        notes.push('selected-assets.json does not include source provenance; reconcile is using compatibility fallback resolution');
      }
      if (extra.length > 0 && options.strict && !options.deleteExtra) {
        notes.push('strict reconcile would require --delete-extra to remove extra files');
      }
      if (shouldRefreshHashes && canRefreshHashes && repairWriteTargets.length === 0 && deleteTargets.length === 0) {
        notes.push('selected-assets.json hashes would be updated');
      }
      return createResult('dry_run', planned, emptyApplied, missing, mismatched, extra, notes);
    }

    if (planned.skip.length > 0) {
      return createResult('error', planned, emptyApplied, missing, mismatched, extra, [
        ...(usedFallback
          ? ['selected-assets.json does not include source provenance; reconcile is using compatibility fallback resolution']
          : []),
        ...skipNotes,
        `reconcile cannot safely repair unreconstructable provenance-managed file: ${planned.skip[0]}`,
      ]);
    }

    if (options.strict && extra.length > 0 && !options.deleteExtra) {
      return createResult('error', planned, emptyApplied, missing, mismatched, extra, [
        ...(usedFallback
          ? ['selected-assets.json does not include source provenance; reconcile is using compatibility fallback resolution']
          : []),
        'strict reconcile requires --delete-extra to remove extra files',
      ]);
    }

    if (!canRefreshHashes) {
      return createResult('error', planned, emptyApplied, missing, mismatched, extra, [
        ...(usedFallback
          ? ['selected-assets.json does not include source provenance; reconcile is using compatibility fallback resolution']
          : []),
        'reconcile cannot update hashes while expected files are missing',
      ]);
    }

    const transaction = await createReconcileTransaction();
    const applied = {
      written: [] as string[],
      deleted: [] as string[],
      skipped: [] as string[],
    };

    try {
      const writePlan = [...copiedRepairs.writeItems, ...instantiatedRepairs.writeItems].sort((left, right) =>
        left.targetRel.localeCompare(right.targetRel),
      );
      applied.written.push(...(await applyWritePlan(writePlan, transaction, projectRoot)));
      applied.deleted.push(
        ...(await applyDeletePlan(
          deleteTargets.map((targetRel) => ({
            targetRel,
            targetAbs: path.join(projectRoot, ...targetRel.split('/')),
          })),
          transaction,
          projectRoot,
        )),
      );

      const finalMissing = await collectMissingExpectedPaths(projectRoot, expectedPaths);
      if (finalMissing.length > 0) {
        throw new Error(`reconcile left missing expected file: ${finalMissing[0]}`);
      }

      const finalExtra = options.strict ? filterReconcileExtras(await collectExtraPaths(projectRoot, expectedPathSet, getKnownRoots())) : [];
      if (options.strict && finalExtra.length > 0) {
        throw new Error(`reconcile left extra file under known roots: ${finalExtra[0]}`);
      }

      const hashes = await computeFileHashes(projectRoot, hashEligiblePaths);
      if (
        repairableDriftExists &&
        (comparePathSets(eligiblePreviousHashes, hashes) || applied.written.length > 0 || applied.deleted.length > 0)
      ) {
        await updateSelectedAssetsHashesAtomically(projectRoot, payload, hashes);
        applied.written.push(PROVENANCE_PATH);
      }

      await cleanupReconcileTransaction(transaction);
      return createResult('reconciled', planned, applied, [], [], finalExtra, [
        ...(usedFallback
          ? ['selected-assets.json does not include source provenance; reconcile is using compatibility fallback resolution']
          : []),
        ...(applied.written.includes(PROVENANCE_PATH) ? ['selected-assets.json hashes updated'] : []),
      ]);
    } catch (error) {
      await rollbackReconcileTransaction(transaction, projectRoot);
      return createResult('error', planned, applied, missing, mismatched, extra, [
        ...(usedFallback
          ? ['selected-assets.json does not include source provenance; reconcile is using compatibility fallback resolution']
          : []),
        (error as Error).message,
      ]);
    }
  } catch (error) {
    return createResult('error', emptyPlan, emptyApplied, [], [], [], [(error as Error).message]);
  }
}

export function renderReconcileText(
  result: ReconcileResult,
  options: Pick<ReconcileOptions, 'verbose' | 'strict' | 'deleteExtra'>,
): string {
  if (result.status === 'clean' && !options.verbose) {
    return 'CLEAN';
  }

  const title =
    result.status === 'dry_run'
      ? 'DRY RUN'
      : result.status === 'reconciled'
        ? 'RECONCILED'
        : result.status.toUpperCase();

  const lines: string[] = [title];
  const sections: Array<{ title: string; values: string[]; alwaysShow?: boolean }> = [];

  if (result.status === 'dry_run' || result.status === 'error') {
    sections.push(
      { title: 'Planned writes', values: result.planned.write, alwaysShow: options.verbose || result.planned.write.length > 0 },
      { title: 'Planned deletes', values: result.planned.delete, alwaysShow: options.verbose || result.planned.delete.length > 0 },
      { title: 'Planned skips', values: result.planned.skip, alwaysShow: options.verbose || result.planned.skip.length > 0 },
    );
  }

  if (result.status === 'reconciled') {
    sections.push(
      { title: 'Written files', values: result.applied.written, alwaysShow: options.verbose || result.applied.written.length > 0 },
      { title: 'Deleted files', values: result.applied.deleted, alwaysShow: options.verbose || result.applied.deleted.length > 0 },
      { title: 'Skipped files', values: result.applied.skipped, alwaysShow: options.verbose || result.applied.skipped.length > 0 },
    );
  }

  sections.push(
    { title: 'Missing files', values: result.missing, alwaysShow: options.verbose || result.missing.length > 0 },
    { title: 'Mismatched files', values: result.mismatched, alwaysShow: options.verbose || result.mismatched.length > 0 },
    { title: 'Extra files', values: result.extra, alwaysShow: options.verbose || result.extra.length > 0 },
    { title: 'Notes', values: result.notes, alwaysShow: options.verbose || result.notes.length > 0 },
  );

  for (const section of sections) {
    if (!section.alwaysShow) {
      continue;
    }

    lines.push('', section.title);
    if (section.values.length === 0) {
      lines.push('  none');
      continue;
    }

    for (const value of section.values) {
      lines.push(`  ${value}`);
    }
  }

  return lines.join('\n');
}

export function getReconcileExitCode(result: ReconcileResult): 0 | 1 | 2 {
  switch (result.status) {
    case 'clean':
      return 0;
    case 'dry_run':
      return 1;
    case 'reconciled':
      return 0;
    case 'error':
      return 2;
  }
}
