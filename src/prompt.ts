import inquirer from 'inquirer';
import { Manifest, UserSelections } from './types';

export async function promptSelections(manifest: Manifest, yes: boolean): Promise<UserSelections> {
  const techChoices = manifest.tech_stack_recipes.map((recipe) => recipe.id);
  const productPacks = (manifest.product_type_packs ?? []).map((pack) => pack.id);
  const skillChoices = manifest.skills.map((skill) => skill.id);

  if (yes) {
    return {
      description: 'TODO: Add project description',
      preferredTechnology: techChoices[0] ?? '',
      productPackId: '',
      selectedSkillIds: [...skillChoices],
    };
  }

  const { descriptionMode } = await inquirer.prompt<{ descriptionMode: 'provide' | 'generate' }>([
    {
      type: 'list',
      name: 'descriptionMode',
      message: 'Project description:',
      choices: [
        { name: 'Provide description', value: 'provide' },
        { name: 'Generate placeholder', value: 'generate' },
      ],
    },
  ]);

  let description = 'TODO: Add project description';
  if (descriptionMode === 'provide') {
    const answer = await inquirer.prompt<{ description: string }>([
      {
        type: 'input',
        name: 'description',
        message: 'Enter project description:',
        validate: (value) => (value.trim().length > 0 ? true : 'Description is required'),
      },
    ]);
    description = answer.description.trim();
  }

  const answers = await inquirer.prompt<{
    preferredTechnology: string;
    productPackId: string;
    selectedSkillIds: string[];
  }>([
    {
      type: 'list',
      name: 'preferredTechnology',
      message: 'Preferred technology:',
      choices: techChoices,
    },
    {
      type: 'list',
      name: 'productPackId',
      message: 'Product pack:',
      choices: ['none', ...productPacks],
      default: 'none',
    },
    {
      type: 'checkbox',
      name: 'selectedSkillIds',
      message: 'Skills selection:',
      choices: skillChoices,
      default: [...skillChoices],
    },
  ]);

  return {
    description,
    preferredTechnology: answers.preferredTechnology,
    productPackId: answers.productPackId === 'none' ? '' : answers.productPackId,
    selectedSkillIds: answers.selectedSkillIds,
  };
}
