import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchText, listRegistryFiles } from './fetch.js';
import { CopyPlanItem, Manifest, ManifestItem, RegistrySource, ResolvedSelections } from './types.js';
import { ensureTrackedDir, recordCreatedFile, WriteContext } from './write-context.js';

type MaterializationEntry = {
  group: string;
  id: string;
  path: string;
};

function normalizeRelativePath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

export function ensureRelativePathSafe(relPath: string): void {
  const normalized = normalizeRelativePath(relPath);
  if (normalized.startsWith('/') || normalized.startsWith('\\')) {
    throw new Error(`Raw materialization path must be relative: ${relPath}`);
  }

  if (normalized.split('/').includes('..')) {
    throw new Error(`Raw materialization path must not contain '..' segments: ${relPath}`);
  }
}

export function matchesExcludeGlobs(relPath: string, excludeGlobs: string[]): boolean {
  const basename = path.posix.basename(normalizeRelativePath(relPath));
  for (const pattern of excludeGlobs) {
    const normalizedPattern = normalizeRelativePath(pattern);
    if (!normalizedPattern.startsWith('**/')) {
      continue;
    }

    const expectedBasename = normalizedPattern.slice(3);
    if (basename === expectedBasename) {
      return true;
    }
  }

  return false;
}

function findById(items: ManifestItem[] | undefined, id: string, group: string): ManifestItem {
  const found = items?.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Missing manifest ${group} entry id: ${id}`);
  }
  return found;
}

function getSelectedMaterializationEntries(
  manifest: Manifest,
  resolvedSelections: ResolvedSelections,
  techStackRecipeId: string,
  productPackIds: string[],
): MaterializationEntry[] {
  const groups = manifest.materialization?.copy_raw_asset_groups ?? [];
  const entries: MaterializationEntry[] = [];

  for (const group of groups) {
    switch (group) {
      case 'agent_packs':
        for (const id of resolvedSelections.agentPackIds) {
          entries.push({ group, id, path: findById(manifest.agent_packs, id, group).path });
        }
        break;
      case 'skills':
        for (const id of resolvedSelections.skillIds) {
          entries.push({ group, id, path: findById(manifest.skills, id, group).path });
        }
        break;
      case 'tech_stack_recipes':
        entries.push({
          group,
          id: techStackRecipeId,
          path: findById(manifest.tech_stack_recipes, techStackRecipeId, group).path,
        });
        break;
      case 'file_templates':
        for (const id of resolvedSelections.fileTemplateIds) {
          entries.push({ group, id, path: findById(manifest.file_templates, id, group).path });
        }
        break;
      case 'product_type_packs':
        for (const id of productPackIds) {
          const productTypePacks = (manifest.product_type_packs as ManifestItem[] | undefined) ?? [];
          entries.push({ group, id, path: findById(productTypePacks, id, group).path });
        }
        break;
      default:
        break;
    }
  }

  return entries;
}

async function enumerateFilesUnderPath(
  source: RegistrySource,
  manifestEntryPath: string,
  excludeGlobs: string[],
): Promise<string[]> {
  ensureRelativePathSafe(manifestEntryPath);

  const normalizedPath = normalizeRelativePath(manifestEntryPath);
  const files = await listRegistryFiles(source, normalizedPath);
  const exactMatch = files.includes(normalizedPath);
  const childMatches = files.filter((file) => file.startsWith(`${normalizedPath}/`));

  if (exactMatch && childMatches.length > 0) {
    throw new Error(`Raw materialization path is ambiguous: ${normalizedPath}`);
  }

  const candidates = exactMatch ? [normalizedPath] : childMatches;
  if (candidates.length === 0) {
    throw new Error(`Raw materialization source is missing: ${normalizedPath}`);
  }

  return candidates
    .filter((candidate) => !matchesExcludeGlobs(candidate, excludeGlobs))
    .sort((left, right) => left.localeCompare(right));
}

export async function planRawMaterialization(
  source: RegistrySource,
  manifest: Manifest,
  resolvedSelections: ResolvedSelections,
  techStackRecipeId: string,
  productPackIds: string[],
  projectRoot = process.cwd(),
): Promise<CopyPlanItem[]> {
  if (manifest.contract_version === undefined) {
    return [];
  }

  if (manifest.contract_version !== '1') {
    throw new Error(`Unsupported contract_version: ${String(manifest.contract_version)}`);
  }

  const groups = manifest.materialization?.copy_raw_asset_groups ?? [];
  if (groups.length === 0) {
    return [];
  }

  const entries = getSelectedMaterializationEntries(manifest, resolvedSelections, techStackRecipeId, productPackIds);
  const excludeGlobs = manifest.materialization?.exclude_globs ?? [];
  const plan: CopyPlanItem[] = [];
  const seenDestinations = new Set<string>();

  for (const entry of entries) {
    const sourceFiles = await enumerateFilesUnderPath(source, entry.path, excludeGlobs);

    for (const sourceRel of sourceFiles) {
      ensureRelativePathSafe(sourceRel);
      const destRel = normalizeRelativePath(sourceRel);
      const destAbs = path.join(projectRoot, ...destRel.split('/'));

      if (seenDestinations.has(destRel)) {
        throw new Error(`Raw materialization plan contains duplicate destination: ${destRel}`);
      }

      seenDestinations.add(destRel);
      plan.push({
        sourceRel,
        sourceUrl: `${source.rawBase}/${sourceRel}`,
        destRel,
        destAbs,
      });
    }
  }

  return plan.sort((left, right) => left.destRel.localeCompare(right.destRel));
}

export async function preflightRawMaterialization(plan: CopyPlanItem[]): Promise<void> {
  for (const item of plan) {
    try {
      await fs.access(item.destAbs);
      throw new Error(`Conflict: ${item.destRel} already exists`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

export async function materializeRawAssets(
  source: RegistrySource,
  plan: CopyPlanItem[],
  context: WriteContext,
  projectRoot = process.cwd(),
): Promise<string[]> {
  const createdFiles: string[] = [];

  for (const item of plan) {
    await ensureTrackedDir(path.posix.dirname(item.destRel), context, projectRoot);
    const content = await fetchText(source.rawBase, item.sourceRel);
    await fs.writeFile(item.destAbs, content, 'utf8');
    recordCreatedFile(context, item.destRel);
    createdFiles.push(item.destRel);
  }

  return createdFiles;
}
