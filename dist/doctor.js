import fs from 'node:fs/promises';
import path from 'node:path';
import { computeSingleFileHash, getHashEligibleExpectedPaths } from './hashing.js';
const PROVENANCE_PATH = '.project/selected-assets.json';
const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules']);
const IGNORED_EXTRA_FILES = new Set(['agents/manifest.json']);
function createResult(status, provenance, missing, extra, notes) {
    return {
        status,
        provenance,
        missing: [...missing].sort((left, right) => left.localeCompare(right)),
        extra: [...extra].sort((left, right) => left.localeCompare(right)),
        notes: [...notes].sort((left, right) => left.localeCompare(right)),
    };
}
export function normalizeProjectRelativePath(relPath) {
    const normalized = relPath.replace(/\\/g, '/');
    if (normalized.length === 0) {
        throw new Error('Provenance contains an empty path');
    }
    if (normalized.startsWith('/') || normalized.startsWith('\\')) {
        throw new Error(`Provenance contains an absolute path: ${relPath}`);
    }
    if (normalized.split('/').includes('..')) {
        throw new Error(`Provenance contains an unsafe path: ${relPath}`);
    }
    return normalized.replace(/^\.\//, '');
}
async function readSelectedAssets(projectRoot) {
    const absolutePath = path.join(projectRoot, PROVENANCE_PATH);
    const fileContents = await fs.readFile(absolutePath, 'utf8');
    const payload = JSON.parse(fileContents);
    if (!payload || typeof payload !== 'object') {
        throw new Error('selected-assets.json must contain a JSON object');
    }
    return payload;
}
export function buildExpectedPathSet(payload) {
    if (!payload.outputs || typeof payload.outputs !== 'object') {
        throw new Error('selected-assets.json is missing outputs');
    }
    const copiedPaths = payload.outputs.copied_paths;
    const instantiatedDocs = payload.outputs.instantiated_docs;
    const metadataFiles = payload.outputs.metadata_files;
    if (!Array.isArray(copiedPaths) || !Array.isArray(instantiatedDocs) || !Array.isArray(metadataFiles)) {
        throw new Error('selected-assets.json outputs must include copied_paths, instantiated_docs, and metadata_files arrays');
    }
    const expected = new Set();
    for (const relPath of [...copiedPaths, ...instantiatedDocs, ...metadataFiles]) {
        if (typeof relPath !== 'string') {
            throw new Error('selected-assets.json outputs must contain only string paths');
        }
        expected.add(normalizeProjectRelativePath(relPath));
    }
    return expected;
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
export async function collectMissingExpectedPaths(projectRoot, expectedPaths) {
    const missing = [];
    for (const relPath of expectedPaths) {
        const absolutePath = path.join(projectRoot, ...relPath.split('/'));
        if (!(await pathExists(absolutePath))) {
            missing.push(relPath);
        }
    }
    return missing;
}
export function getKnownRoots() {
    return ['.project', 'agent-packs', 'agents', 'docs', 'file-templates', 'skills', 'tech-stacks'];
}
async function listFilesUnderRoot(projectRoot, rootRel) {
    const normalizedRoot = normalizeProjectRelativePath(rootRel);
    const rootAbs = path.join(projectRoot, ...normalizedRoot.split('/'));
    const files = [];
    if (!(await pathExists(rootAbs))) {
        return files;
    }
    async function walk(currentAbs, currentRel) {
        const entries = await fs.readdir(currentAbs, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
                continue;
            }
            const childRel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
            const normalizedChildRel = normalizeProjectRelativePath(childRel);
            const childAbs = path.join(currentAbs, entry.name);
            if (entry.isDirectory()) {
                await walk(childAbs, normalizedChildRel);
                continue;
            }
            if (entry.isFile()) {
                files.push(normalizedChildRel);
            }
        }
    }
    await walk(rootAbs, normalizedRoot);
    return files;
}
export async function collectExtraPaths(projectRoot, expectedPaths, knownRoots) {
    const extra = new Set();
    for (const rootRel of knownRoots) {
        const files = await listFilesUnderRoot(projectRoot, rootRel);
        for (const relPath of files) {
            if (!expectedPaths.has(relPath) && !IGNORED_EXTRA_FILES.has(relPath)) {
                extra.add(relPath);
            }
        }
    }
    return [...extra].sort((left, right) => left.localeCompare(right));
}
function isValidSha256(value) {
    return /^[0-9a-f]{64}$/.test(value);
}
function hasHashData(payload) {
    return Array.isArray(payload.outputs.hashes) && payload.outputs.hashes.length > 0;
}
async function verifyHashesIfRequested(payload, options, projectRoot) {
    if (!options.hash) {
        return [];
    }
    if (!hasHashData(payload)) {
        throw new Error('Hash verification requested, but selected-assets.json does not contain hashes');
    }
    const recordedHashes = payload.outputs.hashes ?? [];
    const seenPaths = new Set();
    const hashMap = new Map();
    for (const entry of recordedHashes) {
        if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || typeof entry.sha256 !== 'string') {
            throw new Error('selected-assets.json contains malformed hash entry');
        }
        const normalizedPath = normalizeProjectRelativePath(entry.path);
        if (seenPaths.has(normalizedPath)) {
            throw new Error(`selected-assets.json contains duplicate hash entry: ${normalizedPath}`);
        }
        if (!isValidSha256(entry.sha256)) {
            throw new Error(`selected-assets.json contains invalid sha256 for path: ${normalizedPath}`);
        }
        seenPaths.add(normalizedPath);
        hashMap.set(normalizedPath, entry.sha256);
    }
    const requiredPaths = getHashEligibleExpectedPaths(payload.outputs);
    for (const relPath of requiredPaths) {
        if (!hashMap.has(relPath)) {
            throw new Error(`Hash verification requested, but selected-assets.json is missing hash for expected path: ${relPath}`);
        }
    }
    const mismatchNotes = [];
    for (const relPath of requiredPaths) {
        const absolutePath = path.join(projectRoot, ...relPath.split('/'));
        if (!(await pathExists(absolutePath))) {
            continue;
        }
        const currentHash = await computeSingleFileHash(projectRoot, relPath);
        if (currentHash.sha256 !== hashMap.get(relPath)) {
            mismatchNotes.push(`hash mismatch: ${relPath}`);
        }
    }
    return mismatchNotes;
}
export async function runDoctor(projectRoot, options) {
    let payload = null;
    let provenance = {
        path: PROVENANCE_PATH,
        registry_version: null,
        published_at: null,
        contract_version: null,
    };
    try {
        payload = await readSelectedAssets(projectRoot);
        provenance = {
            path: PROVENANCE_PATH,
            registry_version: typeof payload.registry_version === 'string' ? payload.registry_version : null,
            published_at: typeof payload.published_at === 'string' || payload.published_at === null ? payload.published_at : null,
            contract_version: typeof payload.contract_version === 'string' ? payload.contract_version : null,
        };
        if (payload.contract_version !== '1') {
            throw new Error('selected-assets.json must have contract_version "1"');
        }
        const expectedPathSet = buildExpectedPathSet(payload);
        const expectedPaths = [...expectedPathSet].sort((left, right) => left.localeCompare(right));
        const missing = await collectMissingExpectedPaths(projectRoot, expectedPaths);
        const notes = [];
        if (options.roots || options.strict) {
            notes.push('Strict root scanning is limited to known roots only');
        }
        const hashNotes = await verifyHashesIfRequested(payload, options, projectRoot);
        notes.push(...hashNotes);
        const extra = options.strict ? await collectExtraPaths(projectRoot, expectedPathSet, getKnownRoots()) : [];
        const status = missing.length > 0 || extra.length > 0 || hashNotes.length > 0 ? 'drift' : 'clean';
        return createResult(status, provenance, missing, extra, notes);
    }
    catch (error) {
        const message = error.code === 'ENOENT'
            ? `${PROVENANCE_PATH} is missing`
            : error.message;
        return createResult('error', provenance, [], [], [message]);
    }
}
export function renderDoctorText(result, options) {
    if (result.status === 'clean' && !options.verbose) {
        return 'CLEAN';
    }
    const lines = [result.status.toUpperCase()];
    if (result.status === 'error') {
        lines.push('', 'Provenance problems');
        for (const note of result.notes) {
            lines.push(`  ${note}`);
        }
        return lines.join('\n');
    }
    const notes = result.notes.length > 0 ? result.notes : options.verbose ? ['selected-assets.json loaded successfully'] : [];
    const sections = [
        { title: 'Missing files', values: result.missing, alwaysShow: options.verbose || result.missing.length > 0 },
        {
            title: 'Extra files',
            values: result.extra,
            alwaysShow: options.verbose || (options.strict && result.extra.length > 0),
        },
        { title: 'Notes', values: notes, alwaysShow: options.verbose || notes.length > 0 },
    ];
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
export function getDoctorExitCode(result) {
    switch (result.status) {
        case 'clean':
            return 0;
        case 'drift':
            return 1;
        case 'error':
            return 2;
    }
}
