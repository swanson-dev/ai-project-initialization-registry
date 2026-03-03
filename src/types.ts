export type ManifestItem = {
  id: string;
  path: string;
};

export type ManifestDefaults = {
  agent_packs?: string[];
  skills?: string[];
  file_templates?: string[];
  registry_docs?: string[];
};

export type ManifestMaterialization = {
  asset_group_roots?: Record<string, string>;
  copy_raw_asset_groups?: string[];
  exclude_globs?: string[];
  project_metadata_dir?: string;
};

export type InstantiationRule = {
  template_id: string;
  target: string;
  required?: boolean;
};

export type PlannedTemplateWrite = {
  templateId: string;
  sourcePath: string;
  targetRel: string;
  targetAbs: string;
  content: string;
};

export type CopyPlanItem = {
  sourceRel: string;
  sourceUrl: string;
  destRel: string;
  destAbs: string;
};

export type SelectedAssetsPayload = {
  registry_version: string;
  published_at: string | null;
  contract_version: '1';
  created_at: string;
  project: {
    project_id: null;
    name: string;
  };
  source?: SelectedAssetsSource;
  selected: {
    scaffold: string;
    tech_stack_recipe: string;
    agent_packs: string[];
    skills: string[];
    product_type_packs: string[];
    registry_docs: string[];
    file_templates: string[];
    instantiation_rules: Array<{
      template_id: string;
      target: string;
    }>;
  };
  materialization: {
    copy_raw_asset_groups: string[];
    asset_group_roots: Record<string, string>;
    exclude_globs: string[];
    project_metadata_dir: string;
  };
  outputs: {
    copied_paths: string[];
    instantiated_docs: string[];
    metadata_files: string[];
    hashes?: SelectedAssetsHashEntry[];
  };
};

export type SelectedAssetsSource = {
  registry: {
    owner: string | null;
    repo: string | null;
    ref: string;
    raw_base: string;
    is_override: boolean;
  };
};

export type BootstrapLockPayload = {
  registry: {
    version: string;
    published_at: string | null;
    contract_version: '1';
  };
  selection: {
    scaffold: string;
    tech_stack_recipe: string;
    agent_packs: string[];
    skills: string[];
    product_type_packs: string[];
    registry_docs: string[];
    file_templates: string[];
  };
  instantiated_docs: Array<{
    template_id: string;
    target: string;
  }>;
  manifest_contract_version_used_by_cli: '1';
  cli: {
    name: string;
    version: string;
  };
};

export type Manifest = {
  version: string;
  published_at?: string;
  contract_version?: string;
  defaults?: ManifestDefaults;
  materialization?: ManifestMaterialization;
  instantiation_rules?: InstantiationRule[];
  scaffolds: ManifestItem[];
  agent_packs: ManifestItem[];
  skills: ManifestItem[];
  tech_stack_recipes: ManifestItem[];
  file_templates: ManifestItem[];
  product_type_packs?: ManifestItem[];
  registry_docs?: ManifestItem[];
  [key: string]: unknown;
};

export type InitOptions = {
  ref: string;
  registry?: string;
  yes: boolean;
  debug: boolean;
};

export type RegistrySource = {
  rawBase: string;
  refUsed: string;
  owner: string;
  repo: string;
  isOverride: boolean;
};

export type UserSelections = {
  description: string;
  preferredTechnology: string;
  productPackId: string;
  selectedSkillIds: string[];
};

export type ComposeSelection = {
  scaffoldId: string;
  corePackId: string;
  productPackId?: string;
  skillIds: string[];
  techStackRecipeId: string;
};

export type ExplicitSelections = {
  agentPackIds: string[];
  skillIds: string[];
  registryDocIds: string[];
  fileTemplateIds: string[];
};

export type ResolvedSelections = {
  agentPackIds: string[];
  skillIds: string[];
  registryDocIds: string[];
  fileTemplateIds: string[];
};

export type DoctorOptions = {
  json: boolean;
  verbose: boolean;
  roots: boolean;
  strict: boolean;
  hash: boolean;
};

export type DoctorStatus = 'clean' | 'drift' | 'error';

export type DoctorResult = {
  status: DoctorStatus;
  provenance: {
    path: '.project/selected-assets.json';
    registry_version: string | null;
    published_at: string | null;
    contract_version: string | null;
  };
  missing: string[];
  extra: string[];
  notes: string[];
};

export type SelectedAssetsHashEntry = {
  path: string;
  sha256: string;
};

export type FreezeOptions = {
  yes: boolean;
  json: boolean;
  verbose: boolean;
  strict: boolean;
};

export type FreezeResult = {
  status: 'dry_run' | 'updated' | 'error';
  provenance_path: '.project/selected-assets.json';
  updated_hashes_count: number;
  missing: string[];
  notes: string[];
};

export type ReconcileOptions = {
  yes: boolean;
  json: boolean;
  verbose: boolean;
  strict: boolean;
  deleteExtra: boolean;
};

export type ReconcileResult = {
  status: 'clean' | 'dry_run' | 'reconciled' | 'error';
  provenance_path: '.project/selected-assets.json';
  planned: {
    write: string[];
    delete: string[];
    skip: string[];
  };
  applied: {
    written: string[];
    deleted: string[];
    skipped: string[];
  };
  missing: string[];
  mismatched: string[];
  extra: string[];
  notes: string[];
};
