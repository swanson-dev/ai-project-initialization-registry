import inquirer from "inquirer";
import { Manifest, ManifestItem, UserSelections } from "./types.js";

export async function promptSelections(
  manifest: Manifest,
  yes: boolean,
): Promise<UserSelections> {
  const techChoices = manifest.tech_stack_recipes.map((recipe: ManifestItem) => recipe.id);
  const productPacks = (manifest.product_type_packs ?? []).map(
    (pack: ManifestItem) => pack.id,
  );
  const skillChoices = manifest.skills.map((skill: ManifestItem) => skill.id);

  if (yes) {
    return {
      description: "TODO: Add project description",
      preferredTechnology: techChoices[0] ?? "",
      productPackId: "",
      selectedSkillIds: [...skillChoices],
    };
  }

  const { descriptionMode } = (await inquirer.prompt([
    {
      type: "list",
      name: "descriptionMode",
      message: "Project description:",
      choices: [
        { name: "Provide description", value: "provide" },
        { name: "Generate placeholder", value: "generate" },
      ],
    },
  ])) as { descriptionMode: "provide" | "generate" };

  let description = "TODO: Add project description";
  if (descriptionMode === "provide") {
    const answer = (await inquirer.prompt([
      {
        type: "input",
        name: "description",
        message: "Enter project description:",
        validate: (value: string) =>
          value.trim().length > 0 ? true : "Description is required",
      },
    ])) as { description: string };
    description = answer.description.trim();
  }

  const answers = (await inquirer.prompt([
    {
      type: "list",
      name: "preferredTechnology",
      message: "Preferred technology:",
      choices: techChoices,
    },
    {
      type: "list",
      name: "productPackId",
      message: "Product pack:",
      choices: ["none", ...productPacks],
      default: "none",
    },
    {
      type: "checkbox",
      name: "selectedSkillIds",
      message: "Skills selection:",
      choices: skillChoices,
      default: [...skillChoices],
    },
  ])) as {
    preferredTechnology: string;
    productPackId: string;
    selectedSkillIds: string[];
  };

  return {
    description,
    preferredTechnology: answers.preferredTechnology,
    productPackId:
      answers.productPackId === "none" ? "" : answers.productPackId,
    selectedSkillIds: answers.selectedSkillIds,
  };
}
