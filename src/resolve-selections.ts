import { ExplicitSelections, Manifest, ManifestItem, ResolvedSelections } from './types.js';

const GROUPS = [
  {
    defaultsKey: 'agent_packs',
    explicitKey: 'agentPackIds',
    resolvedKey: 'agentPackIds',
    manifestSectionKey: 'agent_packs',
  },
  {
    defaultsKey: 'skills',
    explicitKey: 'skillIds',
    resolvedKey: 'skillIds',
    manifestSectionKey: 'skills',
  },
  {
    defaultsKey: 'registry_docs',
    explicitKey: 'registryDocIds',
    resolvedKey: 'registryDocIds',
    manifestSectionKey: 'registry_docs',
  },
  {
    defaultsKey: 'file_templates',
    explicitKey: 'fileTemplateIds',
    resolvedKey: 'fileTemplateIds',
    manifestSectionKey: 'file_templates',
  },
] as const;

function resolveManifestSection(manifest: Manifest, key: string): ManifestItem[] {
  const value = manifest[key];
  if (!Array.isArray(value)) {
    throw new Error(`Manifest section is not an array of items: ${key}`);
  }
  return value as ManifestItem[];
}

function dedupePreservingFirst(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

export function resolveSelections(manifest: Manifest, explicit: ExplicitSelections): ResolvedSelections {
  const resolved: ResolvedSelections = {
    agentPackIds: [],
    skillIds: [],
    registryDocIds: [],
    fileTemplateIds: [],
  };

  for (const group of GROUPS) {
    const knownIds = new Set(resolveManifestSection(manifest, group.manifestSectionKey).map((item) => item.id));
    const explicitValues = explicit[group.explicitKey];

    for (const id of explicitValues) {
      if (!knownIds.has(id)) {
        throw new Error(`Unknown ${group.explicitKey} id: ${id}`);
      }
    }

    const defaults =
      manifest.contract_version === '1'
        ? manifest.defaults?.[group.defaultsKey] ?? []
        : [];

    resolved[group.resolvedKey] = dedupePreservingFirst([...defaults, ...explicitValues]);
  }

  return resolved;
}
