import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureTrackedDir, recordCreatedFile, WriteContext } from './write-context.js';

type MetadataInput = {
  description: string;
  preferredTechnology: string;
  productPackId: string;
  selectedSkillIds: string[];
  registryVersion: string;
  registryRef: string;
  cliVersion: string;
  createdAt?: string;
};

export async function writeMetadataFiles(input: MetadataInput, context?: WriteContext): Promise<string[]> {
  const now = input.createdAt ?? new Date().toISOString();
  const projectName = path.basename(process.cwd());

  if (context) {
    await ensureTrackedDir('.project', context);
    await ensureTrackedDir('agents', context);
  } else {
    await fs.mkdir(path.join(process.cwd(), '.project'), { recursive: true });
    await fs.mkdir(path.join(process.cwd(), 'agents'), { recursive: true });
  }

  const projectConfigRelativePath = '.project/project.config.json';
  const agentsManifestRelativePath = 'agents/manifest.json';

  const projectConfigPath = path.join(process.cwd(), projectConfigRelativePath);
  const agentsManifestPath = path.join(process.cwd(), agentsManifestRelativePath);

  await fs.writeFile(
    projectConfigPath,
    JSON.stringify(
      {
        project_name: projectName,
        description: input.description,
        preferred_technology: input.preferredTechnology,
        product_type: input.productPackId,
        selected_skills: input.selectedSkillIds,
        registry_version: input.registryVersion,
        registry_ref: input.registryRef,
        registry_owner: 'swanson-dev',
        registry_repo: 'ai-project-initialization-registry',
        cli_version: input.cliVersion,
        initialized_at: now,
        code_location: '/app',
      },
      null,
      2,
    ) + '\n',
  );
  if (context) {
    recordCreatedFile(context, projectConfigRelativePath);
  }

  await fs.writeFile(
    agentsManifestPath,
    JSON.stringify(
      {
        core_pack: 'core',
        product_pack: input.productPackId,
        skills: input.selectedSkillIds,
        tech_stack_recipe: input.preferredTechnology,
        rules_file: 'agent-packs/core/OUTPUT_RULES.md',
      },
      null,
      2,
    ) + '\n',
  );
  if (context) {
    recordCreatedFile(context, agentsManifestRelativePath);
  }

  return [projectConfigRelativePath, agentsManifestRelativePath];
}

export async function writeLegacyBootstrapLock(input: MetadataInput, context?: WriteContext): Promise<string> {
  const timestamp = input.createdAt ?? new Date().toISOString();
  const bootstrapLockRelativePath = '.project/bootstrap.lock';
  const bootstrapLockPath = path.join(process.cwd(), bootstrapLockRelativePath);

  await fs.writeFile(
    bootstrapLockPath,
    JSON.stringify(
      {
        registry_version: input.registryVersion,
        registry_ref: input.registryRef,
        registry_owner: 'swanson-dev',
        registry_repo: 'ai-project-initialization-registry',
        scaffold_id: 'standard-planning-plus-code',
        core_pack: 'core',
        product_pack: input.productPackId,
        skill_ids: input.selectedSkillIds,
        tech_stack_recipe: input.preferredTechnology,
        cli_version: input.cliVersion,
        timestamp,
      },
      null,
      2,
    ) + '\n',
  );

  if (context) {
    recordCreatedFile(context, bootstrapLockRelativePath);
  }

  return bootstrapLockRelativePath;
}
