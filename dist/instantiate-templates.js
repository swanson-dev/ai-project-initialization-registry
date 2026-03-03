import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchText } from './fetch.js';
import { ensureTrackedDir, recordCreatedFile } from './write-context.js';
function normalizeRuleTarget(target) {
    if (target.startsWith('/') || target.startsWith('\\')) {
        throw new Error(`Instantiation target must be a relative path: ${target}`);
    }
    const normalized = target.replace(/\\/g, '/');
    if (normalized.split('/').includes('..')) {
        throw new Error(`Instantiation target must not contain '..' segments: ${target}`);
    }
    return normalized;
}
function assertTargetUnderDocs(targetRel) {
    if (!targetRel.startsWith('docs/')) {
        throw new Error(`Instantiation target must be under docs/: ${targetRel}`);
    }
}
function findTemplatePath(manifest, templateId) {
    const template = manifest.file_templates.find((item) => item.id === templateId);
    if (!template) {
        throw new Error(`Missing file template id: ${templateId}`);
    }
    return template.path;
}
export async function planTemplateInstantiation(rawBase, manifest, projectRoot = process.cwd()) {
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
    const seenTargets = new Set();
    const plan = [];
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
export async function preflightTemplateInstantiation(plan) {
    for (const item of plan) {
        assertTargetUnderDocs(item.targetRel);
        try {
            await fs.access(item.targetAbs);
            throw new Error(`Conflict: ${item.targetRel} already exists`);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
}
export async function instantiatePlannedTemplates(plan, context, projectRoot = process.cwd()) {
    const createdFiles = [];
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
export async function instantiateTemplates(rawBase, manifest, context, projectRoot = process.cwd()) {
    const plan = await planTemplateInstantiation(rawBase, manifest, projectRoot);
    await preflightTemplateInstantiation(plan);
    return instantiatePlannedTemplates(plan, context, projectRoot);
}
