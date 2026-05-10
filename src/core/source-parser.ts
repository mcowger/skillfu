import { isAbsolute, resolve } from 'path';

export interface ParsedSource {
  type: 'github' | 'local';
  url: string;
  localPath?: string;
  subpath?: string;
  ref?: string;
  skillFilter?: string;
  /** The owner/repo string for GitHub sources (e.g., "vercel-labs/agent-skills") */
  ownerRepo?: string;
}

/**
 * Parse a source string into a structured format.
 * Supports: GitHub shorthand, GitHub URLs, local paths.
 */
export function parseSource(input: string): ParsedSource {
  // Handle fragment refs (#branch or #branch@skill) for git-like sources
  const { inputWithoutFragment, ref: fragmentRef, skillFilter: fragmentSkillFilter } = parseFragmentRef(input);
  input = inputWithoutFragment;

  // Local path: absolute, relative, or current directory
  if (isLocalPath(input)) {
    const resolvedPath = resolve(input);
    return {
      type: 'local',
      url: resolvedPath,
      localPath: resolvedPath,
      ...(fragmentRef ? { ref: fragmentRef } : {}),
    };
  }

  // GitHub URL with tree/path: https://github.com/owner/repo/tree/branch/path
  const githubTreeWithPathMatch = input.match(
    /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/
  );
  if (githubTreeWithPathMatch) {
    const [, owner, repo, ref, subpath] = githubTreeWithPathMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref: ref || fragmentRef,
      subpath: subpath ? sanitizeSubpath(subpath) : subpath,
      ownerRepo: `${owner}/${repo}`,
    };
  }

  // GitHub URL with branch only: https://github.com/owner/repo/tree/branch
  const githubTreeMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/);
  if (githubTreeMatch) {
    const [, owner, repo, ref] = githubTreeMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref: ref || fragmentRef,
      ownerRepo: `${owner}/${repo}`,
    };
  }

  // GitHub URL: https://github.com/owner/repo
  const githubRepoMatch = input.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (githubRepoMatch) {
    const [, owner, repo] = githubRepoMatch;
    const cleanRepo = repo!.replace(/\.git$/, '');
    return {
      type: 'github',
      url: `https://github.com/${owner}/${cleanRepo}.git`,
      ...(fragmentRef ? { ref: fragmentRef } : {}),
      ...(fragmentSkillFilter ? { skillFilter: fragmentSkillFilter } : {}),
      ownerRepo: `${owner}/${cleanRepo}`,
    };
  }

  // @skill syntax: owner/repo@skill-name
  const atSkillMatch = input.match(/^([^/]+)\/([^/@]+)@(.+)$/);
  if (atSkillMatch && !input.includes(':') && !input.startsWith('.') && !input.startsWith('/')) {
    const [, owner, repo, skillFilter] = atSkillMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ...(fragmentRef ? { ref: fragmentRef } : {}),
      skillFilter: fragmentSkillFilter || skillFilter,
      ownerRepo: `${owner}/${repo}`,
    };
  }

  // GitHub shorthand: owner/repo or owner/repo/subpath
  const shorthandMatch = input.match(/^([^/]+)\/([^/]+)(?:\/(.+?))?\/?$/);
  if (shorthandMatch && !input.includes(':') && !input.startsWith('.') && !input.startsWith('/')) {
    const [, owner, repo, subpath] = shorthandMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ...(fragmentRef ? { ref: fragmentRef } : {}),
      subpath: subpath ? sanitizeSubpath(subpath) : subpath,
      ...(fragmentSkillFilter ? { skillFilter: fragmentSkillFilter } : {}),
      ownerRepo: `${owner}/${repo}`,
    };
  }

  // If nothing matched and it doesn't look like a local path, try as GitHub shorthand
  throw new Error(
    `Invalid source: "${input}"\n` +
    `Supported formats:\n` +
    `  owner/repo            (GitHub shorthand)\n` +
    `  https://github.com/owner/repo  (GitHub URL)\n` +
    `  ./path or /abs/path   (local directory)`
  );
}

/**
 * Check if a string represents a local file system path.
 */
function isLocalPath(input: string): boolean {
  return (
    isAbsolute(input) ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input === '.' ||
    input === '..' ||
    /^[a-zA-Z]:[/\\]/.test(input)
  );
}

/**
 * Sanitize a subpath to prevent path traversal.
 */
function sanitizeSubpath(subpath: string): string {
  const segments = subpath.replace(/\\/g, '/').split('/');
  for (const segment of segments) {
    if (segment === '..') {
      throw new Error(
        `Unsafe subpath: "${subpath}" contains ".." segments. Subpaths must not escape the repository root.`
      );
    }
  }
  return subpath;
}

/**
 * Parse URL fragment refs (#branch or #branch@skill).
 */
function parseFragmentRef(input: string): {
  inputWithoutFragment: string;
  ref?: string;
  skillFilter?: string;
} {
  const hashIndex = input.indexOf('#');
  if (hashIndex < 0) {
    return { inputWithoutFragment: input };
  }

  const inputWithoutFragment = input.slice(0, hashIndex);
  const fragment = input.slice(hashIndex + 1);

  // Only treat fragments as git refs for git-like sources
  if (!fragment || !looksLikeGitSource(inputWithoutFragment)) {
    return { inputWithoutFragment: input };
  }

  const atIndex = fragment.indexOf('@');
  if (atIndex === -1) {
    return {
      inputWithoutFragment,
      ref: decodeFragmentValue(fragment),
    };
  }

  const ref = fragment.slice(0, atIndex);
  const skillFilter = fragment.slice(atIndex + 1);
  return {
    inputWithoutFragment,
    ref: ref ? decodeFragmentValue(ref) : undefined,
    skillFilter: skillFilter ? decodeFragmentValue(skillFilter) : undefined,
  };
}

function decodeFragmentValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeGitSource(input: string): boolean {
  if (input.startsWith('github:') || input.startsWith('git@')) return true;
  if (input.startsWith('http://') || input.startsWith('https://')) {
    try {
      const parsed = new URL(input);
      if (parsed.hostname === 'github.com') return true;
    } catch {}
  }
  // owner/repo shorthand
  if (/^([^/]+)\/([^/]+)(?:\/.*)?$/.test(input) && !input.startsWith('.')) return true;
  return false;
}
