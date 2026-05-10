import simpleGit from 'simple-git';
import { join, normalize, resolve, sep } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';

const DEFAULT_CLONE_TIMEOUT_MS = 300_000; // 5 minutes

function getCloneTimeout(): number {
  const raw = process.env.BRIEF_CLONE_TIMEOUT_MS || process.env.SKILLS_CLONE_TIMEOUT_MS;
  if (!raw) return DEFAULT_CLONE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLONE_TIMEOUT_MS;
}

export class GitCloneError extends Error {
  readonly url: string;
  readonly isTimeout: boolean;
  readonly isAuthError: boolean;

  constructor(message: string, url: string, isTimeout = false, isAuthError = false) {
    super(message);
    this.name = 'GitCloneError';
    this.url = url;
    this.isTimeout = isTimeout;
    this.isAuthError = isAuthError;
  }
}

/**
 * Clone a git repository to a temp directory.
 * Uses shallow clone (--depth 1) for speed.
 */
export async function cloneRepo(url: string, ref?: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'skillfu-'));
  const git = simpleGit({
    timeout: { block: getCloneTimeout() },
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_LFS_SKIP_SMUDGE: '1',
    },
  });

  const cloneArgs: string[] = ['--depth', '1'];
  if (ref) {
    cloneArgs.push('--branch', ref);
  }

  try {
    await git.clone(url, tempDir, cloneArgs);
    return tempDir;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});

    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('block timeout') || errorMessage.includes('timed out');
    const isAuthError =
      errorMessage.includes('Authentication failed') ||
      errorMessage.includes('could not read Username') ||
      errorMessage.includes('Permission denied') ||
      errorMessage.includes('Repository not found');

    if (isTimeout) {
      const seconds = Math.round(getCloneTimeout() / 1000);
      throw new GitCloneError(
        `Clone timed out after ${seconds}s. Common causes:\n` +
          `  - Large repository: raise the timeout with BRIEF_CLONE_TIMEOUT_MS=600000 (10m)\n` +
          `  - Slow network: retry, or clone manually and pass the local path\n` +
          `  - Private repo without credentials: ensure auth is configured\n` +
          `      - For SSH: ssh-add -l (to check loaded keys)\n` +
          `      - For HTTPS: gh auth status (if using GitHub CLI)`,
        url,
        true,
        false
      );
    }

    if (isAuthError) {
      throw new GitCloneError(
        `Authentication failed for ${url}.
` +
          `  - For private repos, ensure you have access
` +
          `  - For SSH: Check your keys with 'ssh -T git@github.com'
` +
          `  - For HTTPS: Set GITHUB_TOKEN or GH_TOKEN environment variable`,
        url,
        false,
        true
      );
    }

    throw new GitCloneError(`Failed to clone ${url}: ${errorMessage}`, url, false, false);
  }
}

/**
 * Clean up a temp directory safely.
 */
export async function cleanupTempDir(dir: string): Promise<void> {
  const normalizedDir = normalize(resolve(dir));
  const normalizedTmpDir = normalize(resolve(tmpdir()));

  if (!normalizedDir.startsWith(normalizedTmpDir + sep) && normalizedDir !== normalizedTmpDir) {
    throw new Error('Attempted to clean up directory outside of temp directory');
  }

  await rm(dir, { recursive: true, force: true });
}

/**
 * Get GitHub token from environment variables only.
 */
export function getGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  return null;
}

/**
 * Fetch the tree SHA for a skill folder using GitHub's Trees API.
 * Returns the tree SHA for the skill folder, or null if not found.
 */
export async function fetchSkillFolderHash(
  ownerRepo: string,
  skillPath: string,
  ref?: string
): Promise<string | null> {
  const token = getGitHubToken();
  const branch = ref || 'main';

  // Try main first, then master
  for (const branchName of [branch, branch === 'main' ? 'master' : null].filter(Boolean) as string[]) {
    try {
      const url = `https://api.github.com/repos/${ownerRepo}/git/trees/${branchName}?recursive=1`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'skillfu-cli',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) continue;

      const data = (await response.json()) as { tree?: Array<{ path: string; sha: string; type: string }> };
      if (!data.tree) continue;

      // Find the skill folder in the tree
      const normalizedSkillPath = skillPath.replace(/\\/g, '/');
      const skillEntry = data.tree.find(
        (entry) =>
          entry.type === 'tree' &&
          (entry.path === normalizedSkillPath ||
            entry.path === normalizedSkillPath.replace(/\/SKILL\.md$/, '') ||
            entry.path === normalizedSkillPath.replace(/SKILL\.md$/, '').replace(/\/$/, ''))
      );

      if (skillEntry) {
        return skillEntry.sha;
      }
    } catch {
      continue;
    }
  }

  return null;
}
