import { createHash } from 'crypto';
import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';

/**
 * Compute SHA-256 hash from all files in a skill directory.
 * Reads files recursively, sorts by relative path for determinism,
 * and produces a single hash from their concatenated contents.
 */
export async function computeSkillHash(skillDir: string): Promise<string> {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  await collectFiles(skillDir, skillDir, files);

  // Sort by relative path for deterministic hashing
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }

  return hash.digest('hex');
}

async function collectFiles(
  baseDir: string,
  currentDir: string,
  results: Array<{ relativePath: string; content: Buffer }>
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') return;
        await collectFiles(baseDir, fullPath, results);
      } else if (entry.isFile()) {
        const content = await readFile(fullPath);
        const relPath = relative(baseDir, fullPath).split('\\').join('/');
        results.push({ relativePath: relPath, content });
      }
    })
  );
}

/**
 * Compute SHA-256 of a string.
 */
export function hashString(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}
