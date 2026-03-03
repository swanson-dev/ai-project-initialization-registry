import fs from 'node:fs/promises';
import path from 'node:path';
import { recordCreatedFile } from './write-context.js';
function getProjectName(projectRoot) {
    return path.basename(projectRoot);
}
function getProductTypePacks(productPackId) {
    return productPackId ? [productPackId] : [];
}
function getInstantiationRuleOutputs(manifest) {
    return (manifest.instantiation_rules ?? []).map((rule) => ({
        template_id: rule.template_id,
        target: rule.target.replace(/\\/g, '/'),
    }));
}
function sortLex(values) {
    return [...values].sort((left, right) => left.localeCompare(right));
}
function getMaterializationSnapshot(manifest) {
    const materialization = manifest.materialization;
    return {
        copy_raw_asset_groups: materialization?.copy_raw_asset_groups ? [...materialization.copy_raw_asset_groups] : [],
        asset_group_roots: materialization?.asset_group_roots ? { ...materialization.asset_group_roots } : {},
        exclude_globs: materialization?.exclude_globs ? [...materialization.exclude_globs] : [],
        project_metadata_dir: materialization?.project_metadata_dir ?? '.project',
    };
}
export function buildSelectedAssetsPayload(input) {
    const projectRoot = input.projectRoot ?? process.cwd();
    const instantiationRules = getInstantiationRuleOutputs(input.manifest);
    const hashes = input.hashes
        ? [...input.hashes].sort((left, right) => left.path.localeCompare(right.path)).map((entry) => ({
            path: entry.path,
            sha256: entry.sha256,
        }))
        : undefined;
    return {
        registry_version: input.manifest.version,
        published_at: input.manifest.published_at ?? null,
        contract_version: '1',
        created_at: input.createdAt,
        project: {
            project_id: null,
            name: getProjectName(projectRoot),
        },
        source: {
            registry: {
                owner: input.source.owner,
                repo: input.source.repo,
                ref: input.source.ref,
                raw_base: input.source.rawBase,
                is_override: input.source.isOverride,
            },
        },
        selected: {
            scaffold: input.scaffoldId,
            tech_stack_recipe: input.techStackRecipeId,
            agent_packs: [...input.resolvedSelections.agentPackIds],
            skills: [...input.resolvedSelections.skillIds],
            product_type_packs: getProductTypePacks(input.productPackId),
            registry_docs: [...input.resolvedSelections.registryDocIds],
            file_templates: [...input.resolvedSelections.fileTemplateIds],
            instantiation_rules: instantiationRules,
        },
        materialization: getMaterializationSnapshot(input.manifest),
        outputs: {
            copied_paths: sortLex(input.copiedPaths),
            instantiated_docs: [...input.instantiatedDocs],
            metadata_files: sortLex(input.metadataFiles),
            hashes,
        },
    };
}
export function buildBootstrapLockPayload(input) {
    return {
        registry: {
            version: input.manifest.version,
            published_at: input.manifest.published_at ?? null,
            contract_version: '1',
        },
        selection: {
            scaffold: input.scaffoldId,
            tech_stack_recipe: input.techStackRecipeId,
            agent_packs: [...input.resolvedSelections.agentPackIds],
            skills: [...input.resolvedSelections.skillIds],
            product_type_packs: getProductTypePacks(input.productPackId),
            registry_docs: [...input.resolvedSelections.registryDocIds],
            file_templates: [...input.resolvedSelections.fileTemplateIds],
        },
        instantiated_docs: getInstantiationRuleOutputs(input.manifest),
        manifest_contract_version_used_by_cli: '1',
        cli: {
            name: input.cliName,
            version: input.cliVersion,
        },
    };
}
export async function writeSelectedAssets(payload, context, projectRoot = process.cwd()) {
    const relativePath = '.project/selected-assets.json';
    await fs.writeFile(path.join(projectRoot, relativePath), JSON.stringify(payload, null, 2) + '\n', 'utf8');
    recordCreatedFile(context, relativePath);
    return relativePath;
}
export async function writeBootstrapLock(payload, context, projectRoot = process.cwd()) {
    const relativePath = '.project/bootstrap.lock';
    await fs.writeFile(path.join(projectRoot, relativePath), JSON.stringify(payload, null, 2) + '\n', 'utf8');
    recordCreatedFile(context, relativePath);
    return relativePath;
}
