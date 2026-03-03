import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const NON_HASHED_METADATA_FILES = new Set([
    '.project/bootstrap.lock',
    '.project/selected-assets.json',
]);
export function normalizeHashPath(relPath) {
    const normalized = relPath.replace(/\\/g, '/');
    if (normalized.length === 0) {
        throw new Error('Hash path must not be empty');
    }
    if (normalized.startsWith('/') || normalized.startsWith('\\')) {
        throw new Error(`Hash path must be relative: ${relPath}`);
    }
    if (normalized.split('/').includes('..')) {
        throw new Error(`Hash path must not contain '..' segments: ${relPath}`);
    }
    return normalized.replace(/^\.\//, '');
}
export function getHashEligibleExpectedPaths(outputs) {
    const paths = new Set();
    for (const relPath of outputs.copied_paths) {
        paths.add(normalizeHashPath(relPath));
    }
    for (const relPath of outputs.instantiated_docs) {
        paths.add(normalizeHashPath(relPath));
    }
    for (const relPath of outputs.metadata_files) {
        const normalized = normalizeHashPath(relPath);
        if (!NON_HASHED_METADATA_FILES.has(normalized)) {
            paths.add(normalized);
        }
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
}
export async function computeSingleFileHash(projectRoot, relPath) {
    const normalized = normalizeHashPath(relPath);
    const absolutePath = path.join(projectRoot, ...normalized.split('/'));
    const bytes = await fs.readFile(absolutePath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return {
        path: normalized,
        sha256,
    };
}
export async function computeFileHashes(projectRoot, expectedPaths) {
    const normalizedPaths = [...new Set(expectedPaths.map((relPath) => normalizeHashPath(relPath)))].sort((left, right) => left.localeCompare(right));
    const hashes = [];
    for (const relPath of normalizedPaths) {
        hashes.push(await computeSingleFileHash(projectRoot, relPath));
    }
    return hashes;
}
