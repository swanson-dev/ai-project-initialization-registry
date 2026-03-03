import { Manifest, RegistrySource } from './types.js';

const DEFAULT_OWNER = 'swanson-dev';
const DEFAULT_REPO = 'ai-project-initialization';
const treeCache = new Map<string, Promise<GitTreeEntry[]>>();

type GitTreeEntry = {
  path: string;
  type: 'blob' | 'tree';
};

function normalizeRegistryPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function isLikelyDirectoryPath(relativePath: string): boolean {
  const normalized = normalizeRegistryPath(relativePath);
  const basename = normalized.split('/').pop() ?? normalized;
  return !basename.includes('.');
}

async function fetchGitTree(source: RegistrySource): Promise<GitTreeEntry[]> {
  const cacheKey = `${source.owner}/${source.repo}@${source.refUsed}`;
  let treePromise = treeCache.get(cacheKey);
  if (!treePromise) {
    treePromise = (async () => {
      const response = await fetch(
        `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(source.refUsed)}?recursive=1`,
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch Git tree for ${cacheKey} (${response.status})`);
      }

      const payload = (await response.json()) as { truncated?: boolean; tree?: Array<{ path?: string; type?: string }> };
      if (payload.truncated) {
        throw new Error(`Git tree for ${cacheKey} is truncated`);
      }

      return (payload.tree ?? [])
        .filter((entry): entry is GitTreeEntry => typeof entry.path === 'string' && (entry.type === 'blob' || entry.type === 'tree'))
        .map((entry) => ({
          path: normalizeRegistryPath(entry.path),
          type: entry.type,
        }));
    })();

    treeCache.set(cacheKey, treePromise);
    treePromise.catch(() => {
      treeCache.delete(cacheKey);
    });
  }

  return treePromise;
}

export function resolveRegistrySource(ref: string, registryOverride?: string): RegistrySource {
  if (registryOverride) {
    const normalized = registryOverride.replace(/\/$/, '');
    return {
      rawBase: normalized,
      refUsed: 'custom',
      owner: DEFAULT_OWNER,
      repo: DEFAULT_REPO,
      isOverride: true,
    };
  }

  return {
    rawBase: `https://raw.githubusercontent.com/${DEFAULT_OWNER}/${DEFAULT_REPO}/${ref}`,
    refUsed: ref,
    owner: DEFAULT_OWNER,
    repo: DEFAULT_REPO,
    isOverride: false,
  };
}

export async function fetchText(rawBase: string, path: string): Promise<string> {
  const url = `${rawBase}/${path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }
  return response.text();
}

export async function fetchManifest(rawBase: string): Promise<Manifest> {
  const response = await fetch(`${rawBase}/manifest.json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest.json (${response.status})`);
  }
  return (await response.json()) as Manifest;
}

export async function listRegistryFiles(source: RegistrySource, relativePath: string): Promise<string[]> {
  const normalized = normalizeRegistryPath(relativePath);

  if (source.isOverride) {
    if (isLikelyDirectoryPath(normalized)) {
      if (source.refUsed === 'custom' || source.owner === 'unknown' || source.repo === 'unknown') {
        throw new Error(`Directory-backed raw materialization is not supported with registry override sources: ${normalized}`);
      }

      const tree = await fetchGitTree(source);
      const directoryPrefix = `${normalized}/`;
      const matches = tree
        .filter((entry) => entry.type === 'blob' && (entry.path === normalized || entry.path.startsWith(directoryPrefix)))
        .map((entry) => entry.path)
        .sort((left, right) => left.localeCompare(right));

      return matches;
    }
    return [normalized];
  }

  const tree = await fetchGitTree(source);
  const directoryPrefix = `${normalized}/`;
  const matches = tree
    .filter((entry) => entry.type === 'blob' && (entry.path === normalized || entry.path.startsWith(directoryPrefix)))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));

  return matches;
}

export function clearRegistryTreeCache(): void {
  treeCache.clear();
}
