import { parseArgs } from 'node:util';
import { buildArtifact } from './build.ts';
import { InputError, requireOption } from './errors.ts';
import { formatResolvedFlavor } from './report.ts';
import { assertValidFlavor, resolveFlavor } from './resolve.ts';

const USAGE = `usage:
  ncw build   --flavors <root> --flavor <name> --tree <dir> --line <nn> --kind <dev|release> --build-number <n> --out <dir>
  ncw resolve --flavors <root> --flavor <name>`;

function runBuild(args: string[]): number {
  const { values } = parseArgs({
    args,
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
  const { artifact, flavor } = buildArtifact({
    flavorsRoot: values.flavors ?? '',
    flavor: values.flavor ?? '',
    tree: values.tree ?? '',
    line: values.line ?? '',
    kind: values.kind ?? '',
    buildNumber: values['build-number'] ?? '',
    out: values.out ?? '',
  });
  process.stderr.write(formatResolvedFlavor(flavor, values.flavors ?? ''));
  console.log(artifact);
  return 0;
}

function runResolve(args: string[]): number {
  const { values } = parseArgs({ args, options: { flavors: { type: 'string' }, flavor: { type: 'string' } } });
  const flavorsRoot = requireOption('--flavors', values.flavors);
  const flavor = requireOption('--flavor', values.flavor);

  assertValidFlavor(flavorsRoot, flavor);
  process.stdout.write(formatResolvedFlavor(resolveFlavor(flavorsRoot, flavor), flavorsRoot));
  return 0;
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === 'build') return runBuild(rest);
  if (command === 'resolve') return runResolve(rest);
  console.error(USAGE);
  return 2;
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
