import { runInit } from './init.js';

function printUsage(): void {
  console.log('Usage: project-os init [--ref <branch|tag|commitSHA>] [--registry <baseUrl>] [--yes] [--debug]');
}

function parseArgs(argv: string[]): { command?: string; ref: string; registry?: string; yes: boolean; debug: boolean } {
  const args = [...argv];
  const command = args.shift();

  let ref = 'main';
  let registry: string | undefined;
  let yes = false;
  let debug = false;

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--ref') {
      const value = args.shift();
      if (!value) {
        throw new Error('--ref requires a value');
      }
      ref = value;
      continue;
    }

    if (arg === '--registry') {
      const value = args.shift();
      if (!value) {
        throw new Error('--registry requires a value');
      }
      registry = value;
      continue;
    }

    if (arg === '--yes') {
      yes = true;
      continue;
    }

    if (arg === '--debug') {
      debug = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { command, ref, registry, yes, debug };
}

async function main(): Promise<void> {
  try {
    const parsed = parseArgs(process.argv.slice(2));

    if (parsed.command !== 'init') {
      printUsage();
      process.exitCode = 1;
      return;
    }

    await runInit({
      ref: parsed.ref,
      registry: parsed.registry,
      yes: parsed.yes,
      debug: parsed.debug,
    });
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}

void main();
