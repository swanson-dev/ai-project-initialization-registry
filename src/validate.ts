import { Manifest } from './types.js';

export function validateManifest(manifest: Manifest): void {
  const requiredKeys = [
    'version',
    'scaffolds',
    'agent_packs',
    'skills',
    'tech_stack_recipes',
    'file_templates',
  ] as const;

  for (const key of requiredKeys) {
    if (!(key in manifest)) {
      throw new Error(`Manifest missing required key: ${key}`);
    }
  }

  if (!manifest.scaffolds.some((s) => s.id === 'standard-planning-plus-code')) {
    throw new Error('Manifest missing required scaffold id: standard-planning-plus-code');
  }

  if (!manifest.agent_packs.some((p) => p.id === 'core')) {
    throw new Error('Manifest missing required core pack id: core');
  }
}
