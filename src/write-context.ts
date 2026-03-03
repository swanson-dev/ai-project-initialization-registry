import fs from 'node:fs/promises';
import path from 'node:path';

export type WriteContext = {
  createdFiles: string[];
  createdDirs: string[];
};

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function createWriteContext(): WriteContext {
  return {
    createdFiles: [],
    createdDirs: [],
  };
}

export function recordCreatedFile(context: WriteContext, relativePath: string): void {
  const normalized = normalizeRelativePath(relativePath);
  if (!context.createdFiles.includes(normalized)) {
    context.createdFiles.push(normalized);
  }
}

export function recordCreatedDir(context: WriteContext, relativePath: string): void {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized.length === 0 || normalized === '.') {
    return;
  }

  if (!context.createdDirs.includes(normalized)) {
    context.createdDirs.push(normalized);
  }
}

export async function ensureTrackedDir(
  relativePath: string,
  context: WriteContext,
  projectRoot = process.cwd(),
): Promise<void> {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized.length === 0 || normalized === '.') {
    return;
  }

  const segments = normalized.split('/').filter(Boolean);
  let currentRelative = '';

  for (const segment of segments) {
    currentRelative = currentRelative ? `${currentRelative}/${segment}` : segment;
    const currentAbsolute = path.join(projectRoot, currentRelative);

    try {
      await fs.access(currentAbsolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      await fs.mkdir(currentAbsolute);
      recordCreatedDir(context, currentRelative);
    }
  }
}

export async function rollbackWriteContext(
  context: WriteContext,
  projectRoot = process.cwd(),
): Promise<void> {
  for (const relativePath of [...context.createdFiles].reverse()) {
    try {
      await fs.rm(path.join(projectRoot, relativePath), { force: false });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const directories = [...new Set(context.createdDirs)].sort((left, right) => {
    const leftDepth = left.split('/').length;
    const rightDepth = right.split('/').length;
    return rightDepth - leftDepth;
  });

  for (const relativePath of directories) {
    try {
      await fs.rmdir(path.join(projectRoot, relativePath));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
        throw error;
      }
    }
  }
}
