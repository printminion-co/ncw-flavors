import { parseArgs } from 'node:util';
import { buildArtifact } from './build.ts';
import { InputError } from './errors.ts';

const USAGE = 'usage: ncw build --flavors <root> --flavor <name> --tree <dir> --line <nn> --kind <dev|release> --build-number <n> --out <dir>';

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command !== 'build') {
    console.error(USAGE);
    return 2;
  }
  const { values } = parseArgs({
    args: rest,
    options: {
      flavors: { type: 'string' },
      flavor: { type: 'string' },
      tree: { type: 'string' },
      line: { type: 'string' },
      kind: { type: 'string' },
      'build-number': { type: 'string' },
      out: { type: 'string' },
    },
  });
  const artifact = buildArtifact({
    flavorsRoot: values.flavors ?? '',
    flavor: values.flavor ?? '',
    tree: values.tree ?? '',
    line: values.line ?? '',
    kind: values.kind ?? '',
    buildNumber: values['build-number'] ?? '',
    out: values.out ?? '',
  });
  console.log(artifact);
  return 0;
}

/** Mistakes in the arguments or the input exit with 2; anything else is a bug in the tool and exits with 1. */
function isUsageError(error: unknown): boolean {
  if (error instanceof InputError) return true;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS');
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`ncw: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = isUsageError(error) ? 2 : 1;
}
