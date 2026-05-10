import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Validate and resolve a local path source.
 * Returns the resolved absolute path, or throws if invalid.
 */
export function resolveLocalPath(inputPath: string): string {
  const resolved = resolve(inputPath);

  if (!existsSync(resolved)) {
    throw new Error(`Local path does not exist: ${inputPath}`);
  }

  return resolved;
}
