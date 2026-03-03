import path from 'node:path';
import fs from 'node:fs/promises';
import { fetchText } from './fetch.js';
import { ComposeSelection, Manifest } from './types.js';
import { ensureTrackedDir, recordCreatedFile, WriteContext } from './write-context.js';

function findById(items: { id: string; path: string }[] | undefined, id: string): { id: string; path: string } {
  const found = items?.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Missing manifest entry id: ${id}`);
  }
  return found;
}

function findRelatedFilePaths(manifest: Manifest, prefixId: string): string[] {
  const sections = Object.entries(manifest).filter(([key, value]) => key.endsWith('_files') && Array.isArray(value));
  const paths: string[] = [];

  for (const [, value] of sections) {
    const items = value as { id: string; path: string }[];
    for (const item of items) {
      if (item.id === prefixId || item.id.startsWith(`${prefixId}-`)) {
        paths.push(item.path);
      }
    }
  }

  return paths;
}

export function planComposePaths(manifest: Manifest, scaffoldId: string): string[] {
  const selectedPaths = new Set<string>();

  selectedPaths.add(findById(manifest.scaffolds, scaffoldId).path);
  for (const relativePath of findRelatedFilePaths(manifest, scaffoldId)) {
    selectedPaths.add(relativePath);
  }

  return [...selectedPaths].sort((left, right) => left.localeCompare(right));
}

async function ensureNoConflicts(pathsToCreate: string[]): Promise<void> {
  for (const relativePath of pathsToCreate) {
    const fullPath = path.join(process.cwd(), relativePath);
    try {
      await fs.access(fullPath);
      throw new Error(`Conflict: ${relativePath} already exists`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

async function writeFetchedFile(rawBase: string, relativePath: string, context?: WriteContext): Promise<void> {
  const content = await fetchText(rawBase, relativePath);
  const destination = path.join(process.cwd(), relativePath);
  if (context) {
    await ensureTrackedDir(path.dirname(relativePath), context);
  } else {
    await fs.mkdir(path.dirname(destination), { recursive: true });
  }
  await fs.writeFile(destination, content, 'utf8');
  if (context) {
    recordCreatedFile(context, relativePath);
  }
}

export async function composeFromManifest(
  rawBase: string,
  manifest: Manifest,
  selection: ComposeSelection,
  context?: WriteContext,
): Promise<string[]> {
  const explicitPaths = planComposePaths(manifest, selection.scaffoldId);
  await ensureNoConflicts(explicitPaths);

  for (const relativePath of explicitPaths) {
    await writeFetchedFile(rawBase, relativePath, context);
  }

  return explicitPaths;
}
