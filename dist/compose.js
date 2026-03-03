import path from 'node:path';
import fs from 'node:fs/promises';
import { fetchText } from './fetch.js';
import { ensureTrackedDir, recordCreatedFile } from './write-context.js';
function findById(items, id) {
    const found = items?.find((item) => item.id === id);
    if (!found) {
        throw new Error(`Missing manifest entry id: ${id}`);
    }
    return found;
}
function findRelatedFilePaths(manifest, prefixId) {
    const sections = Object.entries(manifest).filter(([key, value]) => key.endsWith('_files') && Array.isArray(value));
    const paths = [];
    for (const [, value] of sections) {
        const items = value;
        for (const item of items) {
            if (item.id === prefixId || item.id.startsWith(`${prefixId}-`)) {
                paths.push(item.path);
            }
        }
    }
    return paths;
}
export function planComposePaths(manifest, scaffoldId) {
    const selectedPaths = new Set();
    selectedPaths.add(findById(manifest.scaffolds, scaffoldId).path);
    for (const relativePath of findRelatedFilePaths(manifest, scaffoldId)) {
        selectedPaths.add(relativePath);
    }
    return [...selectedPaths].sort((left, right) => left.localeCompare(right));
}
async function ensureNoConflicts(pathsToCreate) {
    for (const relativePath of pathsToCreate) {
        const fullPath = path.join(process.cwd(), relativePath);
        try {
            await fs.access(fullPath);
            throw new Error(`Conflict: ${relativePath} already exists`);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
}
async function writeFetchedFile(rawBase, relativePath, context) {
    const content = await fetchText(rawBase, relativePath);
    const destination = path.join(process.cwd(), relativePath);
    if (context) {
        await ensureTrackedDir(path.dirname(relativePath), context);
    }
    else {
        await fs.mkdir(path.dirname(destination), { recursive: true });
    }
    await fs.writeFile(destination, content, 'utf8');
    if (context) {
        recordCreatedFile(context, relativePath);
    }
}
export async function composeFromManifest(rawBase, manifest, selection, context) {
    const explicitPaths = planComposePaths(manifest, selection.scaffoldId);
    await ensureNoConflicts(explicitPaths);
    for (const relativePath of explicitPaths) {
        await writeFetchedFile(rawBase, relativePath, context);
    }
    return explicitPaths;
}
