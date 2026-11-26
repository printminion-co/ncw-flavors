import { parseArgs } from 'node:util';
import { InputError, buildArchive } from './build.ts';

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command !== 'build') {
    console.error('usage: ncw build --flavors <root> --flavor <name> --tree <dir> --line <nn> --kind <dev|release> --build-number <n> --out <dir>');
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
  const archive = buildArchive({
    flavorsRoot: values.flavors ?? '',
    flavor: values.flavor ?? '',
    tree: values.tree ?? '',
    line: values.line ?? '',
    kind: values.kind ?? '',
    buildNumber: values['build-number'] ?? '',
    out: values.out ?? '',
  });
  console.log(archive);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`ncw: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error instanceof InputError || error instanceof TypeError ? 2 : 1;
}
