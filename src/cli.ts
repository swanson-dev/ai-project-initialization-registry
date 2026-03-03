import { getDoctorExitCode, renderDoctorText, runDoctor } from './doctor.js';
import { getFreezeExitCode, renderFreezeText, runFreeze } from './freeze.js';
import { runInit } from './init.js';
import { getReconcileExitCode, renderReconcileText, runReconcile } from './reconcile.js';
import { DoctorOptions, FreezeOptions, ReconcileOptions } from './types.js';

function printUsage(): void {
  console.log('Usage:');
  console.log('  project-os init [--ref <branch|tag|commitSHA>] [--registry <baseUrl>] [--yes] [--debug]');
  console.log('  project-os doctor [--json] [--verbose] [--roots] [--strict] [--hash]');
  console.log('  project-os freeze [--yes] [--json] [--verbose] [--strict]');
  console.log('  project-os reconcile [--yes] [--json] [--verbose] [--strict] [--delete-extra]');
}

type ParsedInitArgs = {
  command: 'init';
  ref: string;
  registry?: string;
  yes: boolean;
  debug: boolean;
};

type ParsedDoctorArgs = {
  command: 'doctor';
  options: DoctorOptions;
};

type ParsedFreezeArgs = {
  command: 'freeze';
  options: FreezeOptions;
};

type ParsedReconcileArgs = {
  command: 'reconcile';
  options: ReconcileOptions;
};

type ParsedArgs = ParsedInitArgs | ParsedDoctorArgs | ParsedFreezeArgs | ParsedReconcileArgs | { command?: undefined };

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  const command = args.shift();

  if (command === 'doctor') {
    const options: DoctorOptions = {
      json: false,
      verbose: false,
      roots: false,
      strict: false,
      hash: false,
    };

    while (args.length > 0) {
      const arg = args.shift();
      if (arg === '--json') {
        options.json = true;
        continue;
      }

      if (arg === '--verbose') {
        options.verbose = true;
        continue;
      }

      if (arg === '--roots') {
        options.roots = true;
        continue;
      }

      if (arg === '--strict') {
        options.strict = true;
        continue;
      }

      if (arg === '--hash') {
        options.hash = true;
        continue;
      }

      throw new Error(`Unknown argument: ${arg}`);
    }

    return {
      command,
      options,
    };
  }

  if (command === 'freeze') {
    const options: FreezeOptions = {
      yes: false,
      json: false,
      verbose: false,
      strict: false,
    };

    while (args.length > 0) {
      const arg = args.shift();
      if (arg === '--yes') {
        options.yes = true;
        continue;
      }

      if (arg === '--json') {
        options.json = true;
        continue;
      }

      if (arg === '--verbose') {
        options.verbose = true;
        continue;
      }

      if (arg === '--strict') {
        options.strict = true;
        continue;
      }

      throw new Error(`Unknown argument: ${arg}`);
    }

    return {
      command,
      options,
    };
  }

  if (command === 'reconcile') {
    const options: ReconcileOptions = {
      yes: false,
      json: false,
      verbose: false,
      strict: false,
      deleteExtra: false,
    };

    while (args.length > 0) {
      const arg = args.shift();
      if (arg === '--yes') {
        options.yes = true;
        continue;
      }

      if (arg === '--json') {
        options.json = true;
        continue;
      }

      if (arg === '--verbose') {
        options.verbose = true;
        continue;
      }

      if (arg === '--strict') {
        options.strict = true;
        continue;
      }

      if (arg === '--delete-extra') {
        options.deleteExtra = true;
        continue;
      }

      throw new Error(`Unknown argument: ${arg}`);
    }

    return {
      command,
      options,
    };
  }

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

  if (command === 'init') {
    return { command, ref, registry, yes, debug };
  }

  return { command: undefined };
}

async function main(): Promise<void> {
  let parsed: ParsedArgs | undefined;
  try {
    parsed = parseArgs(process.argv.slice(2));

    if (parsed.command === 'doctor') {
      const result = await runDoctor(process.cwd(), parsed.options);
      if (parsed.options.json) {
        console.log(JSON.stringify(result));
      } else {
        console.log(renderDoctorText(result, parsed.options));
      }
      process.exitCode = getDoctorExitCode(result);
      return;
    }

    if (parsed.command === 'freeze') {
      const result = await runFreeze(process.cwd(), parsed.options);
      if (parsed.options.json) {
        console.log(JSON.stringify(result));
      } else {
        console.log(renderFreezeText(result, parsed.options));
      }
      process.exitCode = getFreezeExitCode(result);
      return;
    }

    if (parsed.command === 'reconcile') {
      const result = await runReconcile(process.cwd(), parsed.options);
      if (parsed.options.json) {
        console.log(JSON.stringify(result));
      } else {
        console.log(renderReconcileText(result, parsed.options));
      }
      process.exitCode = getReconcileExitCode(result);
      return;
    }

    if (!('ref' in parsed)) {
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
    process.exitCode = parsed?.command === 'doctor' || parsed?.command === 'freeze' || parsed?.command === 'reconcile' ? 2 : 1;
  }
}

void main();
