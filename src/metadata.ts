import fs from 'node:fs/promises';
import path from 'node:path';

type MetadataInput = {
  description: string;
  preferredTechnology: string;
  productPackId: string;
  selectedSkillIds: string[];
  registryVersion: string;
  registryRef: string;
  cliVersion: string;
};

export async function writeMetadataFiles(input: MetadataInput): Promise<string[]> {
  const projectDir = path.join(process.cwd(), '.project');
  const agentsDir = path.join(process.cwd(), 'agents');
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(agentsDir, { recursive: true });

  const now = new Date().toISOString();
  const projectName = path.basename(process.cwd());

  const projectConfigPath = path.join(projectDir, 'project.config.json');
  const bootstrapLockPath = path.join(projectDir, 'bootstrap.lock');
  const agentsManifestPath = path.join(agentsDir, 'manifest.json');

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
        timestamp: now,
      },
      null,
      2,
    ) + '\n',
  );

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

  return ['.project/project.config.json', '.project/bootstrap.lock', 'agents/manifest.json'];
}
