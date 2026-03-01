export function fillTemplate(template: string, replacements: Record<string, string>): string {
  return Object.entries(replacements).reduce((acc, [key, value]) => {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    return acc.replace(pattern, value);
  }, template);
}
