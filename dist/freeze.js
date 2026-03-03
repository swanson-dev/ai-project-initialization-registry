import fs from 'node:fs/promises';
import path from 'node:path';
import { computeFileHashes, getHashEligibleExpectedPaths, normalizeHashPath, } from './hashing.js';
const PROVENANCE_PATH = '.project/selected-assets.json';
function createResult(status, updatedHashesCount, missing, notes) {
    return {
        status,
        provenance_path: PROVENANCE_PATH,
        updated_hashes_count: updatedHashesCount,
        missing: [...missing].sort((left, right) => left.localeCompare(right)),
        notes: [...notes].sort((left, right) => left.localeCompare(right)),
    };
}
async function readSelectedAssetsForFreeze(projectRoot) {
    const absolutePath = path.join(projectRoot, '.project', 'selected-assets.json');
    const contents = await fs.readFile(absolutePath, 'utf8');
    const payload = JSON.parse(contents);
    if (!payload || typeof payload !== 'object') {
        throw new Error('selected-assets.json must contain a JSON object');
    }
    return payload;
}
function validateFreezePayload(payload) {
    if (payload.contract_version !== '1') {
        throw new Error('freeze is only supported for contract_version "1" projects');
    }
    if (!payload.outputs || typeof payload.outputs !== 'object') {
        throw new Error('selected-assets.json is missing outputs');
    }
    if (!Array.isArray(payload.outputs.copied_paths) ||
        !Array.isArray(payload.outputs.instantiated_docs) ||
        !Array.isArray(payload.outputs.metadata_files)) {
        throw new Error('selected-assets.json outputs must include copied_paths, instantiated_docs, and metadata_files arrays');
    }
}
async function pathExists(absolutePath) {
    try {
        await fs.access(absolutePath);
        return true;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
async function collectMissingHashEligiblePaths(projectRoot, expectedPaths) {
    const missing = [];
    for (const relPath of expectedPaths) {
        const absolutePath = path.join(projectRoot, ...relPath.split('/'));
        if (!(await pathExists(absolutePath))) {
            missing.push(relPath);
        }
    }
    return missing.sort((left, right) => left.localeCompare(right));
}
function countHashDifferences(previousHashes, nextHashes) {
    const previous = new Map();
    const next = new Map();
    for (const entry of previousHashes ?? []) {
        if (entry &&
            typeof entry === 'object' &&
            typeof entry.path === 'string' &&
            typeof entry.sha256 === 'string') {
            previous.set(normalizeHashPath(entry.path), entry.sha256);
        }
    }
    for (const entry of nextHashes) {
        next.set(normalizeHashPath(entry.path), entry.sha256);
    }
    const allPaths = new Set([...previous.keys(), ...next.keys()]);
    let changed = 0;
    for (const relPath of allPaths) {
        if (previous.get(relPath) !== next.get(relPath)) {
            changed += 1;
        }
    }
    return changed;
}
function buildUpdatedSelectedAssetsPayload(payload, hashes) {
    const sortedHashes = [...hashes].sort((left, right) => left.path.localeCompare(right.path));
    return {
        registry_version: payload.registry_version,
        published_at: payload.published_at,
        contract_version: payload.contract_version,
        created_at: payload.created_at,
        project: payload.project,
        selected: payload.selected,
        materialization: payload.materialization,
        outputs: {
            copied_paths: payload.outputs.copied_paths,
            instantiated_docs: payload.outputs.instantiated_docs,
            metadata_files: payload.outputs.metadata_files,
            hashes: sortedHashes,
        },
    };
}
async function writeSelectedAssetsAtomically(projectRoot, payload) {
    const targetPath = path.join(projectRoot, '.project', 'selected-assets.json');
    const tempPath = path.join(projectRoot, '.project', 'selected-assets.json.tmp');
    const contents = JSON.stringify(payload, null, 2) + '\n';
    let handle;
    try {
        handle = await fs.open(tempPath, 'w');
        await handle.writeFile(contents, 'utf8');
        if (typeof handle.sync === 'function') {
            await handle.sync();
        }
        await handle.close();
        handle = undefined;
        await fs.rename(tempPath, targetPath);
    }
    catch (error) {
        if (handle) {
            await handle.close().catch(() => undefined);
        }
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
export async function runFreeze(projectRoot, options) {
    try {
        const payload = await readSelectedAssetsForFreeze(projectRoot);
        validateFreezePayload(payload);
        const expectedPaths = getHashEligibleExpectedPaths(payload.outputs);
        const missing = await collectMissingHashEligiblePaths(projectRoot, expectedPaths);
        if (options.strict && missing.length > 0) {
            return createResult('error', 0, missing, [
                'strict mode blocked freeze because expected files are missing',
            ]);
        }
        if (missing.length > 0 && !options.yes) {
            return createResult('dry_run', 0, missing, [
                'missing expected files would block freeze --yes',
            ]);
        }
        if (missing.length > 0) {
            return createResult('error', 0, missing, [
                'freeze cannot update hashes while expected files are missing',
            ]);
        }
        const hashes = await computeFileHashes(projectRoot, expectedPaths);
        const updatedHashesCount = countHashDifferences(payload.outputs.hashes, hashes);
        if (!options.yes) {
            return createResult('dry_run', updatedHashesCount, [], [
                updatedHashesCount === 0 ? 'selected-assets.json would not change' : 'hashes would be updated',
            ]);
        }
        const updatedPayload = buildUpdatedSelectedAssetsPayload(payload, hashes);
        await writeSelectedAssetsAtomically(projectRoot, updatedPayload);
        return createResult('updated', updatedHashesCount, [], ['selected-assets.json hashes updated']);
    }
    catch (error) {
        const message = error.code === 'ENOENT'
            ? `${PROVENANCE_PATH} is missing`
            : error.message;
        return createResult('error', 0, [], [message]);
    }
}
export function renderFreezeText(result, options) {
    const lines = [result.status === 'dry_run' ? 'DRY RUN' : result.status.toUpperCase()];
    if (result.status !== 'error') {
        lines.push('', 'Updated hashes', `  ${result.updated_hashes_count}`);
    }
    if (result.missing.length > 0 || options.verbose) {
        lines.push('', 'Missing files');
        if (result.missing.length === 0) {
            lines.push('  none');
        }
        else {
            for (const relPath of result.missing) {
                lines.push(`  ${relPath}`);
            }
        }
    }
    if (result.notes.length > 0 || options.verbose) {
        lines.push('', 'Notes');
        if (result.notes.length === 0) {
            lines.push('  none');
        }
        else {
            for (const note of result.notes) {
                lines.push(`  ${note}`);
            }
        }
    }
    return lines.join('\n');
}
export function getFreezeExitCode(result) {
    return result.status === 'error' ? 2 : 0;
}
