import { Manifest, RegistrySource } from './types.js';

const DEFAULT_OWNER = 'swanson-dev';
const DEFAULT_REPO = 'ai-project-initialization';

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
