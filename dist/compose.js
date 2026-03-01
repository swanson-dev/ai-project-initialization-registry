import path from 'node:path';
import fs from 'node:fs/promises';
import { fetchText } from './fetch.js';
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
async function writeFetchedFile(rawBase, relativePath) {
    const content = await fetchText(rawBase, relativePath);
    const destination = path.join(process.cwd(), relativePath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, 'utf8');
}
export async function composeFromManifest(rawBase, manifest, selection) {
    const selectedPaths = new Set();
    selectedPaths.add(findById(manifest.scaffolds, selection.scaffoldId).path);
    selectedPaths.add(findById(manifest.agent_packs, selection.corePackId).path);
    for (const p of findRelatedFilePaths(manifest, selection.corePackId)) {
        selectedPaths.add(p);
    }
    if (selection.productPackId) {
        const pack = findById(manifest.product_type_packs ?? [], selection.productPackId);
        selectedPaths.add(pack.path);
        for (const p of findRelatedFilePaths(manifest, selection.productPackId)) {
            selectedPaths.add(p);
        }
    }
    for (const skillId of selection.skillIds) {
        const skill = findById(manifest.skills, skillId);
        selectedPaths.add(skill.path);
        for (const p of findRelatedFilePaths(manifest, skillId)) {
            selectedPaths.add(p);
        }
    }
    selectedPaths.add(findById(manifest.tech_stack_recipes, selection.techStackRecipeId).path);
    const explicitPaths = [...selectedPaths];
    await ensureNoConflicts(explicitPaths);
    for (const relativePath of explicitPaths) {
        await writeFetchedFile(rawBase, relativePath);
    }
    return explicitPaths;
}
