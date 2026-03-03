const DEFAULT_KEYS = {
    agent_packs: 'agent_packs',
    skills: 'skills',
    file_templates: 'file_templates',
    registry_docs: 'registry_docs',
};
function isManifestItemArray(value) {
    return Array.isArray(value);
}
function resolveManifestSection(manifest, key) {
    const value = manifest[key];
    if (!isManifestItemArray(value)) {
        throw new Error(`Manifest section is not an array of items: ${key}`);
    }
    return value;
}
function validateDefaults(manifest, defaults) {
    const allowedKeys = new Set(Object.keys(DEFAULT_KEYS));
    for (const key of Object.keys(defaults)) {
        if (!allowedKeys.has(key)) {
            throw new Error(`defaults contains unsupported key: ${key}`);
        }
    }
    for (const [defaultsKey, manifestSectionKey] of Object.entries(DEFAULT_KEYS)) {
        const ids = defaults[defaultsKey];
        if (ids === undefined) {
            continue;
        }
        if (!Array.isArray(ids) || !ids.every((value) => typeof value === 'string')) {
            throw new Error(`defaults.${defaultsKey} must be an array of strings`);
        }
        const knownIds = new Set(resolveManifestSection(manifest, manifestSectionKey).map((item) => item.id));
        for (const id of ids) {
            if (!knownIds.has(id)) {
                throw new Error(`defaults.${defaultsKey} references unknown id: ${id}`);
            }
        }
    }
}
function normalizePathSegments(value) {
    return value.replace(/\\/g, '/').split('/');
}
function normalizeRelativePath(value, label) {
    if (value.startsWith('/') || value.startsWith('\\')) {
        throw new Error(`${label} must be a relative path: ${value}`);
    }
    const normalized = value.replace(/\\/g, '/');
    const segments = normalizePathSegments(value);
    if (segments.includes('..')) {
        throw new Error(`${label} must not contain '..' segments: ${value}`);
    }
    return normalized;
}
function validateRelativePath(value, label) {
    normalizeRelativePath(value, label);
}
function validateMaterialization(materialization) {
    const allowedKeys = new Set([
        'asset_group_roots',
        'copy_raw_asset_groups',
        'exclude_globs',
        'project_metadata_dir',
    ]);
    for (const key of Object.keys(materialization)) {
        if (!allowedKeys.has(key)) {
            throw new Error(`materialization contains unsupported key: ${key}`);
        }
    }
    let assetGroupRootKeys = new Set();
    if (materialization.asset_group_roots !== undefined) {
        if (typeof materialization.asset_group_roots !== 'object' ||
            materialization.asset_group_roots === null ||
            Array.isArray(materialization.asset_group_roots)) {
            throw new Error('materialization.asset_group_roots must be an object');
        }
        assetGroupRootKeys = new Set(Object.keys(materialization.asset_group_roots));
        for (const [group, root] of Object.entries(materialization.asset_group_roots)) {
            if (typeof root !== 'string') {
                throw new Error(`materialization.asset_group_roots.${group} must be a string`);
            }
            validateRelativePath(root, `materialization.asset_group_roots.${group}`);
        }
    }
    if (materialization.copy_raw_asset_groups !== undefined) {
        if (!Array.isArray(materialization.copy_raw_asset_groups) ||
            !materialization.copy_raw_asset_groups.every((value) => typeof value === 'string')) {
            throw new Error('materialization.copy_raw_asset_groups must be an array of strings');
        }
        for (const group of materialization.copy_raw_asset_groups) {
            if (!assetGroupRootKeys.has(group)) {
                throw new Error(`materialization.copy_raw_asset_groups references missing asset_group_roots key: ${group}`);
            }
        }
    }
    if (materialization.exclude_globs !== undefined) {
        if (!Array.isArray(materialization.exclude_globs) ||
            !materialization.exclude_globs.every((value) => typeof value === 'string')) {
            throw new Error('materialization.exclude_globs must be an array of strings');
        }
    }
    if (materialization.project_metadata_dir !== undefined) {
        if (typeof materialization.project_metadata_dir !== 'string') {
            throw new Error('materialization.project_metadata_dir must be a string');
        }
        validateRelativePath(materialization.project_metadata_dir, 'materialization.project_metadata_dir');
    }
}
function validateInstantiationRules(manifest) {
    const rules = manifest.instantiation_rules;
    if (rules === undefined) {
        return;
    }
    if (!Array.isArray(rules)) {
        throw new Error('instantiation_rules must be an array');
    }
    const allowedKeys = new Set(['template_id', 'target', 'required']);
    const templateIds = new Set(manifest.file_templates.map((item) => item.id));
    const normalizedTargets = new Set();
    for (const [index, rule] of rules.entries()) {
        const label = `instantiation_rules[${index}]`;
        if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
            throw new Error(`${label} must be an object`);
        }
        for (const key of Object.keys(rule)) {
            if (!allowedKeys.has(key)) {
                throw new Error(`${label} contains unsupported key: ${key}`);
            }
        }
        const { template_id, target, required } = rule;
        if (typeof template_id !== 'string' || template_id.trim().length === 0) {
            throw new Error(`${label}.template_id must be a non-empty string`);
        }
        if (typeof target !== 'string' || target.trim().length === 0) {
            throw new Error(`${label}.target must be a non-empty string`);
        }
        if (required !== undefined && typeof required !== 'boolean') {
            throw new Error(`${label}.required must be a boolean`);
        }
        if (!templateIds.has(template_id)) {
            throw new Error(`${label}.template_id references unknown file template id: ${template_id}`);
        }
        const normalizedTarget = normalizeRelativePath(target, `${label}.target`);
        if (!normalizedTarget.startsWith('docs/')) {
            throw new Error(`${label}.target must be under docs/: ${target}`);
        }
        if (normalizedTargets.has(normalizedTarget)) {
            throw new Error(`instantiation_rules contains duplicate target: ${normalizedTarget}`);
        }
        normalizedTargets.add(normalizedTarget);
    }
}
export function validateManifest(manifest) {
    const requiredKeys = [
        'version',
        'scaffolds',
        'agent_packs',
        'skills',
        'tech_stack_recipes',
        'file_templates',
    ];
    for (const key of requiredKeys) {
        if (!(key in manifest)) {
            throw new Error(`Manifest missing required key: ${key}`);
        }
    }
    if (!manifest.scaffolds.some((item) => item.id === 'standard-planning-plus-code')) {
        throw new Error('Manifest missing required scaffold id: standard-planning-plus-code');
    }
    if (!manifest.agent_packs.some((item) => item.id === 'core')) {
        throw new Error('Manifest missing required core pack id: core');
    }
    if (manifest.contract_version === undefined) {
        return;
    }
    if (manifest.contract_version !== '1') {
        throw new Error(`Unsupported contract_version: ${String(manifest.contract_version)}`);
    }
    if (manifest.defaults !== undefined) {
        if (typeof manifest.defaults !== 'object' || manifest.defaults === null || Array.isArray(manifest.defaults)) {
            throw new Error('defaults must be an object');
        }
        validateDefaults(manifest, manifest.defaults);
    }
    validateInstantiationRules(manifest);
    if (manifest.materialization === undefined) {
        return;
    }
    if (typeof manifest.materialization !== 'object' || manifest.materialization === null || Array.isArray(manifest.materialization)) {
        throw new Error('materialization must be an object');
    }
    validateMaterialization(manifest.materialization);
}
