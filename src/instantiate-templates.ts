import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchText } from './fetch.js';
import { Manifest, PlannedTemplateWrite } from './types.js';
import { ensureTrackedDir, recordCreatedFile, WriteContext } from './write-context.js';

function normalizeRuleTarget(target: string): string {
  if (target.startsWith('/') || target.startsWith('\\')) {
    throw new Error(`Instantiation target must be a relative path: ${target}`);
  }

  const normalized = target.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) {
    throw new Error(`Instantiation target must not contain '..' segments: ${target}`);
  }

  return normalized;
}

function assertTargetUnderDocs(targetRel: string): void {
  if (!targetRel.startsWith('docs/')) {
    throw new Error(`Instantiation target must be under docs/: ${targetRel}`);
  }
}

function findTemplatePath(manifest: Manifest, templateId: string): string {
  const template = manifest.file_templates.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Missing file template id: ${templateId}`);
  }
  return template.path;
}

export async function planTemplateInstantiation(
  rawBase: string,
  manifest: Manifest,
  projectRoot = process.cwd(),
): Promise<PlannedTemplateWrite[]> {
  if (manifest.contract_version === undefined) {
    return [];
  }

  if (manifest.contract_version !== '1') {
    throw new Error(`Unsupported contract_version: ${String(manifest.contract_version)}`);
  }

  const rules = manifest.instantiation_rules ?? [];
  if (rules.length === 0) {
    return [];
  }

  const seenTargets = new Set<string>();
  const plan: PlannedTemplateWrite[] = [];

  for (const rule of rules) {
    const sourcePath = findTemplatePath(manifest, rule.template_id);
    const content = await fetchText(rawBase, sourcePath);
    const targetRel = normalizeRuleTarget(rule.target);
    assertTargetUnderDocs(targetRel);

    if (seenTargets.has(targetRel)) {
      throw new Error(`Instantiation plan contains duplicate target: ${targetRel}`);
    }
    seenTargets.add(targetRel);

    const targetAbs = path.resolve(projectRoot, ...targetRel.split('/'));
    plan.push({
      templateId: rule.template_id,
      sourcePath,
      targetRel,
      targetAbs,
      content,
    });
  }

  return plan;
}

export async function preflightTemplateInstantiation(plan: PlannedTemplateWrite[]): Promise<void> {
  for (const item of plan) {
    assertTargetUnderDocs(item.targetRel);
    try {
      await fs.access(item.targetAbs);
      throw new Error(`Conflict: ${item.targetRel} already exists`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

export async function instantiatePlannedTemplates(
  plan: PlannedTemplateWrite[],
  context: WriteContext,
  projectRoot = process.cwd(),
): Promise<string[]> {
  const createdFiles: string[] = [];

  for (const item of plan) {
    assertTargetUnderDocs(item.targetRel);
    const parentDir = path.posix.dirname(item.targetRel);
    await ensureTrackedDir(parentDir, context, projectRoot);
    await fs.writeFile(item.targetAbs, item.content, 'utf8');
    recordCreatedFile(context, item.targetRel);
    createdFiles.push(item.targetRel);
  }

  return createdFiles;
}

export async function instantiateTemplates(
  rawBase: string,
  manifest: Manifest,
  context: WriteContext,
  projectRoot = process.cwd(),
): Promise<string[]> {
  const plan = await planTemplateInstantiation(rawBase, manifest, projectRoot);
  await preflightTemplateInstantiation(plan);
  return instantiatePlannedTemplates(plan, context, projectRoot);
}
