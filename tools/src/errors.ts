/** The input is wrong in a way the caller can fix; the message says how. */
export class InputError extends Error {}

/** Returns the value of a required command line option, or fails with a message that names the option. */
export function requireOption(name: string, value: string | undefined): string {
  if (!value) throw new InputError(`missing option ${name}`);
  return value;
}
