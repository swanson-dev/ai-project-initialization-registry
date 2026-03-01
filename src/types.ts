export type ManifestItem = {
  id: string;
  path: string;
};

export type Manifest = {
  version: string;
  scaffolds: ManifestItem[];
  agent_packs: ManifestItem[];
  skills: ManifestItem[];
  tech_stack_recipes: ManifestItem[];
  file_templates: ManifestItem[];
  product_type_packs?: ManifestItem[];
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
