import fs from 'node:fs/promises';
import path from 'node:path';
import { composeFromManifest } from './compose';
import { fetchManifest, fetchText, resolveRegistrySource } from './fetch';
import { writeMetadataFiles } from './metadata';
import { promptSelections } from './prompt';
import { fillTemplate } from './template';
import { InitOptions } from './types';
import { validateManifest } from './validate';

const CLI_VERSION = '0.0.1';

async function validateWorkingDirectory(): Promise<void> {
  const gitPath = path.join(process.cwd(), '.git');
  const appPath = path.join(process.cwd(), 'app');
  const docsPath = path.join(process.cwd(), 'docs');

  await fs.access(gitPath).catch(() => {
    throw new Error('Validation failed: .git must exist in current working directory.');
  });

  const checks = [appPath, docsPath];
  for (const target of checks) {
    try {
      await fs.access(target);
      throw new Error(`Validation failed: ${path.basename(target)} must not exist.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

async function updateGitignore(): Promise<string | null> {
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  let content = '';
  try {
    content = await fs.readFile(gitignorePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  if (content.includes('.env.init')) {
    return null;
  }

  const next = content.length > 0 && !content.endsWith('\n') ? `${content}\n.env.init\n` : `${content}.env.init\n`;
  await fs.writeFile(gitignorePath, next, 'utf8');
  return '.gitignore';
}

export async function runInit(options: InitOptions): Promise<void> {
  await validateWorkingDirectory();

  const source = resolveRegistrySource(options.ref, options.registry);
  const manifest = await fetchManifest(source.rawBase);
  validateManifest(manifest);

  const selections = await promptSelections(manifest, options.yes);

  const createdFiles: string[] = [];

  const copied = await composeFromManifest(source.rawBase, manifest, {
    scaffoldId: 'standard-planning-plus-code',
    corePackId: 'core',
    productPackId: selections.productPackId || undefined,
    skillIds: selections.selectedSkillIds,
    techStackRecipeId: selections.preferredTechnology,
  });
  createdFiles.push(...copied);

  const metadataPaths = await writeMetadataFiles({
    description: selections.description,
    preferredTechnology: selections.preferredTechnology,
    productPackId: selections.productPackId,
    selectedSkillIds: selections.selectedSkillIds,
    registryVersion: manifest.version,
    registryRef: source.refUsed,
    cliVersion: CLI_VERSION,
  });
  createdFiles.push(...metadataPaths);

  const templatePath = 'scaffolds/standard-planning-plus-code/README.template.md';
  const template = await fetchText(source.rawBase, templatePath);
  const readme = fillTemplate(template, {
    project_name: path.basename(process.cwd()),
    description: selections.description,
    preferred_technology: selections.preferredTechnology,
  });
  await fs.writeFile(path.join(process.cwd(), 'README.md'), readme, 'utf8');
  createdFiles.push('README.md');

  await fs.writeFile(path.join(process.cwd(), '.env.init'), '# Initialization environment values\n', 'utf8');
  createdFiles.push('.env.init');

  const gitignoreCreated = await updateGitignore();
  if (gitignoreCreated) {
    createdFiles.push(gitignoreCreated);
  }

  console.log('Project initialized successfully.');
  console.log(`- Selected tech: ${selections.preferredTechnology}`);
  console.log(`- Selected pack: ${selections.productPackId || 'none'}`);
  console.log(`- Selected skills: ${selections.selectedSkillIds.join(', ') || 'none'}`);
  console.log(`- Ref used: ${source.refUsed}`);
  console.log(`- Files created: ${createdFiles.length}`);

  if (options.debug) {
    console.log('Created files:');
    for (const file of createdFiles) {
      console.log(`  - ${file}`);
    }
  }
}
