import fs from 'node:fs/promises';
import path from 'node:path';
import { composeFromManifest } from './compose.js';
import { fetchManifest, fetchText, resolveRegistrySource } from './fetch.js';
import { computeFileHashes, getHashEligibleExpectedPaths } from './hashing.js';
import {
  instantiatePlannedTemplates,
  planTemplateInstantiation,
  preflightTemplateInstantiation,
} from './instantiate-templates.js';
import {
  materializeRawAssets,
  planRawMaterialization,
  preflightRawMaterialization,
} from './materialize-raw-assets.js';
import { writeLegacyBootstrapLock, writeMetadataFiles } from './metadata.js';
import { promptSelections } from './prompt.js';
import {
  buildBootstrapLockPayload,
  buildSelectedAssetsPayload,
  writeBootstrapLock,
  writeSelectedAssets,
} from './provenance.js';
import { resolveSelections } from './resolve-selections.js';
import { fillTemplate } from './template.js';
import { InitOptions } from './types.js';
import { validateManifest } from './validate.js';
import { createWriteContext, recordCreatedFile, rollbackWriteContext, WriteContext } from './write-context.js';

const CLI_NAME = '@codebasedesigns/project-os';
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

async function ensureInitFileDoesNotExist(relativePath: string): Promise<void> {
  try {
    await fs.access(path.join(process.cwd(), relativePath));
    throw new Error(`Conflict: ${relativePath} already exists`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function preflightStaticWriteTargets(contractVersion?: string): Promise<void> {
  const targets = [
    '.project/project.config.json',
    'agents/manifest.json',
    'README.md',
    '.env.init',
  ];

  if (contractVersion === '1') {
    targets.push('.project/bootstrap.lock', '.project/selected-assets.json');
  } else {
    targets.push('.project/bootstrap.lock');
  }

  for (const target of targets) {
    await ensureInitFileDoesNotExist(target);
  }
}

async function writeReadme(
  rawBase: string,
  description: string,
  preferredTechnology: string,
  context: WriteContext,
): Promise<string> {
  const templatePath = 'scaffolds/standard-planning-plus-code/README.template.md';
  const template = await fetchText(rawBase, templatePath);
  const readme = fillTemplate(template, {
    project_name: path.basename(process.cwd()),
    description,
    preferred_technology: preferredTechnology,
  });

  const relativePath = 'README.md';
  await fs.writeFile(path.join(process.cwd(), relativePath), readme, 'utf8');
  recordCreatedFile(context, relativePath);
  return relativePath;
}

async function writeEnvInit(context: WriteContext): Promise<string> {
  const relativePath = '.env.init';
  await fs.writeFile(path.join(process.cwd(), relativePath), '# Initialization environment values\n', 'utf8');
  recordCreatedFile(context, relativePath);
  return relativePath;
}

async function writeGitignoreIfMissing(context: WriteContext): Promise<string | null> {
  const relativePath = '.gitignore';
  try {
    await fs.access(path.join(process.cwd(), relativePath));
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.writeFile(path.join(process.cwd(), relativePath), '.env.init\n', 'utf8');
  recordCreatedFile(context, relativePath);
  return relativePath;
}

export async function runInit(options: InitOptions): Promise<void> {
  await validateWorkingDirectory();

  const source = resolveRegistrySource(options.ref, options.registry);
  const manifest = await fetchManifest(source.rawBase);
  validateManifest(manifest);

  const selections = await promptSelections(manifest, options.yes);
  const resolvedSelections = resolveSelections(manifest, {
    agentPackIds: ['core'],
    skillIds: selections.selectedSkillIds,
    registryDocIds: [],
    fileTemplateIds: [],
  });

  if (options.debug) {
    console.log(
      JSON.stringify({
        resolvedSelections,
        materialization: manifest.contract_version === '1' ? (manifest.materialization ?? null) : null,
        instantiation_rules: manifest.contract_version === '1' ? (manifest.instantiation_rules ?? null) : null,
      }),
    );
  }

  const templatePlan = await planTemplateInstantiation(source.rawBase, manifest);
  await preflightTemplateInstantiation(templatePlan);
  await preflightStaticWriteTargets(manifest.contract_version);

  const writeContext = createWriteContext();
  const createdFiles: string[] = [];
  const createdAt = new Date().toISOString();

  try {
    const copied = await composeFromManifest(
      source.rawBase,
      manifest,
      {
        scaffoldId: 'standard-planning-plus-code',
        corePackId: 'core',
        productPackId: selections.productPackId || undefined,
        skillIds: selections.selectedSkillIds,
        techStackRecipeId: selections.preferredTechnology,
      },
      writeContext,
    );
    createdFiles.push(...copied);

    const instantiated = await instantiatePlannedTemplates(templatePlan, writeContext);
    createdFiles.push(...instantiated);

    const rawMaterializationPlan = await planRawMaterialization(
      source,
      manifest,
      resolvedSelections,
      selections.preferredTechnology,
      selections.productPackId ? [selections.productPackId] : [],
    );
    await preflightRawMaterialization(rawMaterializationPlan);

    const materializedPaths = await materializeRawAssets(source, rawMaterializationPlan, writeContext);
    createdFiles.push(...materializedPaths);

    const metadataPaths = await writeMetadataFiles(
      {
        description: selections.description,
        preferredTechnology: selections.preferredTechnology,
        productPackId: selections.productPackId,
        selectedSkillIds: selections.selectedSkillIds,
        registryVersion: manifest.version,
        registryRef: source.refUsed,
        cliVersion: CLI_VERSION,
        createdAt,
      },
      writeContext,
    );
    createdFiles.push(...metadataPaths);

    if (manifest.contract_version === '1') {
      const projectMetadataFiles = ['.project/bootstrap.lock', '.project/project.config.json', '.project/selected-assets.json'];
      const hashEligiblePaths = getHashEligibleExpectedPaths({
        copied_paths: [...copied, ...materializedPaths],
        instantiated_docs: instantiated,
        metadata_files: metadataPaths,
      });
      const hashes = await computeFileHashes(process.cwd(), hashEligiblePaths);
      const provenanceInput = {
        manifest,
        resolvedSelections,
        scaffoldId: 'standard-planning-plus-code',
        techStackRecipeId: selections.preferredTechnology,
        productPackId: selections.productPackId || undefined,
        copiedPaths: [...copied, ...materializedPaths],
        instantiatedDocs: instantiated,
        metadataFiles: projectMetadataFiles,
        cliName: CLI_NAME,
        cliVersion: CLI_VERSION,
        createdAt,
        source: {
          owner: source.owner,
          repo: source.repo,
          ref: source.refUsed,
          rawBase: source.rawBase,
          isOverride: source.isOverride,
        },
        hashes,
      };

      const selectedAssetsPayload = buildSelectedAssetsPayload(provenanceInput);
      createdFiles.push(await writeSelectedAssets(selectedAssetsPayload, writeContext));

      const bootstrapLockPayload = buildBootstrapLockPayload(provenanceInput);
      createdFiles.push(await writeBootstrapLock(bootstrapLockPayload, writeContext));
    } else {
      createdFiles.push(
        await writeLegacyBootstrapLock(
          {
            description: selections.description,
            preferredTechnology: selections.preferredTechnology,
            productPackId: selections.productPackId,
            selectedSkillIds: selections.selectedSkillIds,
            registryVersion: manifest.version,
            registryRef: source.refUsed,
            cliVersion: CLI_VERSION,
            createdAt,
          },
          writeContext,
        ),
      );
    }

    createdFiles.push(await writeReadme(source.rawBase, selections.description, selections.preferredTechnology, writeContext));
    createdFiles.push(await writeEnvInit(writeContext));

    const gitignoreCreated = await writeGitignoreIfMissing(writeContext);
    if (gitignoreCreated) {
      createdFiles.push(gitignoreCreated);
    }
  } catch (error) {
    await rollbackWriteContext(writeContext);
    throw error;
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
