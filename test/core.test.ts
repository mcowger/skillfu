import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { parseSource } from '../src/core/source-parser.js';
import { sanitizeName, isPathSafe, getCanonicalSkillsDir, getSymlinkDir, getLockfilePath, getConfigDir } from '../src/utils/paths.js';
import { computeSkillHash, hashString } from '../src/core/hash.js';
import { discoverSkills, filterSkills, parseSkillMd, getSkillDisplayName } from '../src/core/skill-discovery.js';
import { readLockfile, writeLockfile, addSkillToLockfile, removeSkillFromLockfile } from '../src/core/lockfile.js';

// ─── Source Parser Tests ───

describe('source-parser', () => {
  test('parses GitHub shorthand: owner/repo', () => {
    const result = parseSource('vercel-labs/agent-skills');
    expect(result.type).toBe('github');
    expect(result.ownerRepo).toBe('vercel-labs/agent-skills');
    expect(result.url).toBe('https://github.com/vercel-labs/agent-skills.git');
  });

  test('parses GitHub shorthand with subpath', () => {
    const result = parseSource('vercel-labs/agent-skills/skills/my-skill');
    expect(result.type).toBe('github');
    expect(result.subpath).toBe('skills/my-skill');
  });

  test('parses @skill syntax', () => {
    const result = parseSource('vercel-labs/agent-skills@frontend-design');
    expect(result.type).toBe('github');
    expect(result.skillFilter).toBe('frontend-design');
  });

  test('parses #branch syntax', () => {
    const result = parseSource('vercel-labs/agent-skills#develop');
    expect(result.type).toBe('github');
    expect(result.ref).toBe('develop');
  });

  test('parses #branch@skill syntax', () => {
    const result = parseSource('vercel-labs/agent-skills#develop@frontend-design');
    expect(result.type).toBe('github');
    expect(result.ref).toBe('develop');
    expect(result.skillFilter).toBe('frontend-design');
  });

  test('parses full GitHub URL', () => {
    const result = parseSource('https://github.com/vercel-labs/agent-skills');
    expect(result.type).toBe('github');
    expect(result.ownerRepo).toBe('vercel-labs/agent-skills');
  });

  test('parses GitHub URL with tree/branch/path', () => {
    const result = parseSource('https://github.com/vercel-labs/agent-skills/tree/main/skills/design');
    expect(result.type).toBe('github');
    expect(result.ref).toBe('main');
    expect(result.subpath).toBe('skills/design');
  });

  test('parses local path: ./relative', () => {
    const result = parseSource('./my-skills');
    expect(result.type).toBe('local');
    expect(result.localPath).toContain('my-skills');
  });

  test('parses local path: /absolute', () => {
    const result = parseSource('/tmp/skills');
    expect(result.type).toBe('local');
    expect(result.localPath).toBe('/tmp/skills');
  });

  test('rejects path traversal in subpath', () => {
    expect(() => parseSource('owner/repo/skills/../etc')).toThrow('Unsafe subpath');
  });

  test('throws on invalid source', () => {
    expect(() => parseSource('something:weird:format')).toThrow('Invalid source');
  });
});

// ─── Path Utils Tests ───

describe('paths', () => {
  test('sanitizeName: converts to lowercase hyphens', () => {
    expect(sanitizeName('Frontend Design')).toBe('frontend-design');
  });

  test('sanitizeName: prevents path traversal', () => {
    expect(sanitizeName('../../../etc/passwd')).toBe('etc-passwd');
  });

  test('sanitizeName: limits to 255 chars', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeName(long).length).toBe(255);
  });

  test('sanitizeName: returns fallback for empty', () => {
    expect(sanitizeName('!!!')).toBe('unnamed-skill');
  });

  test('isPathSafe: allows child paths', () => {
    expect(isPathSafe('/home/user/skills', '/home/user/skills/my-skill')).toBe(true);
  });

  test('isPathSafe: rejects traversal', () => {
    expect(isPathSafe('/home/user/skills', '/home/user/etc/passwd')).toBe(false);
  });

  test('getCanonicalSkillsDir: global returns ~/.config/skillfu/skills/', () => {
    const dir = getCanonicalSkillsDir(false);
    expect(dir).toContain('skillfu');
    expect(dir).toContain('skills');
  });

  test('getCanonicalSkillsDir: local returns .agents/skills/', () => {
    const dir = getCanonicalSkillsDir(true, '/tmp/project');
    expect(dir).toBe('/tmp/project/.agents/skills');
  });

  test('getLockfilePath: global returns ~/.config/skillfu/skills.lock', () => {
    const path = getLockfilePath(false);
    expect(path).toContain('skillfu');
    expect(path).toContain('skills.lock');
  });

  test('getLockfilePath: local returns .agents/skills.lock', () => {
    const path = getLockfilePath(true, '/tmp/project');
    expect(path).toBe('/tmp/project/.agents/skills.lock');
  });
});

// ─── Hash Tests ───

describe('hash', () => {
  test('computeSkillHash: produces deterministic hash', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'skillfu-test-'));
    try {
      await mkdir(join(tmp, 'sub'), { recursive: true });
      await writeFile(join(tmp, 'SKILL.md'), '---\nname: test\ndescription: test\n---\n# Test');
      await writeFile(join(tmp, 'sub', 'helper.ts'), 'export const x = 1;');

      const hash1 = await computeSkillHash(tmp);
      const hash2 = await computeSkillHash(tmp);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('hashString: produces consistent SHA-256', () => {
    const hash = hashString('hello world');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashString('hello world')).toBe(hash);
    expect(hashString('different')).not.toBe(hash);
  });
});

// ─── Skill Discovery Tests ───

describe('skill-discovery', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'skillfu-test-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test('discovers skill in root SKILL.md', async () => {
    await writeFile(
      join(tmp, 'SKILL.md'),
      '---\nname: root-skill\ndescription: A root skill\n---\n# Root'
    );

    const skills = await discoverSkills(tmp);
    expect(skills.length).toBe(1);
    expect(skills[0]!.name).toBe('root-skill');
  });

  test('discovers skills in skills/ directory', async () => {
    await mkdir(join(tmp, 'skills', 'design'), { recursive: true });
    await mkdir(join(tmp, 'skills', 'review'), { recursive: true });
    await writeFile(
      join(tmp, 'skills', 'design', 'SKILL.md'),
      '---\nname: design\ndescription: Design skill\n---\n# Design'
    );
    await writeFile(
      join(tmp, 'skills', 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Review skill\n---\n# Review'
    );

    const skills = await discoverSkills(tmp);
    expect(skills.length).toBe(2);
    expect(skills.map((s) => s.name).sort()).toEqual(['design', 'review']);
  });

  test('skips skills without required frontmatter', async () => {
    await mkdir(join(tmp, 'skills', 'bad'), { recursive: true });
    await writeFile(join(tmp, 'skills', 'bad', 'SKILL.md'), '# No frontmatter');

    const skills = await discoverSkills(tmp);
    expect(skills.length).toBe(0);
  });

  test('skips internal skills by default', async () => {
    await mkdir(join(tmp, 'skills', 'internal'), { recursive: true });
    await writeFile(
      join(tmp, 'skills', 'internal', 'SKILL.md'),
      '---\nname: internal-skill\ndescription: Internal\nmetadata:\n  internal: true\n---\n# Internal'
    );

    const skills = await discoverSkills(tmp);
    expect(skills.length).toBe(0);
  });

  test('includes internal skills when explicitly requested', async () => {
    await mkdir(join(tmp, 'skills', 'internal'), { recursive: true });
    await writeFile(
      join(tmp, 'skills', 'internal', 'SKILL.md'),
      '---\nname: internal-skill\ndescription: Internal\nmetadata:\n  internal: true\n---\n# Internal'
    );

    const skills = await discoverSkills(tmp, undefined, { includeInternal: true });
    expect(skills.length).toBe(1);
    expect(skills[0]!.name).toBe('internal-skill');
  });

  test('filterSkills: matches by name (case-insensitive)', async () => {
    await mkdir(join(tmp, 'skills', 'design'), { recursive: true });
    await mkdir(join(tmp, 'skills', 'review'), { recursive: true });
    await writeFile(
      join(tmp, 'skills', 'design', 'SKILL.md'),
      '---\nname: design\ndescription: Design\n---\n# Design'
    );
    await writeFile(
      join(tmp, 'skills', 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Review\n---\n# Review'
    );

    const all = await discoverSkills(tmp);
    const filtered = filterSkills(all, ['DESIGN']);
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.name).toBe('design');
  });

  test('parseSkillMd: returns null for missing fields', async () => {
    const tmpFile = join(tmp, 'SKILL.md');
    await writeFile(tmpFile, '---\nname: test\n---\n# Missing description');
    const result = await parseSkillMd(tmpFile);
    expect(result).toBeNull();
  });
});

// ─── Lockfile Tests ───

describe('lockfile', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'skillfu-test-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test('readLockfile: returns empty for missing file', async () => {
    const lock = await readLockfile(true, tmp);
    expect(lock.version).toBe(1);
    expect(Object.keys(lock.skills).length).toBe(0);
  });

  test('addSkillToLockfile + readLockfile roundtrip', async () => {
    await addSkillToLockfile('my-skill', {
      source: 'owner/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/owner/repo.git',
      skillPath: 'skills/my-skill',
      hash: 'abc123',
    }, true, tmp);

    const lock = await readLockfile(true, tmp);
    expect(lock.skills['my-skill']).toBeDefined();
    expect(lock.skills['my-skill']!.source).toBe('owner/repo');
    expect(lock.skills['my-skill']!.hash).toBe('abc123');
  });

  test('project lockfile has no timestamps', async () => {
    await addSkillToLockfile('my-skill', {
      source: 'owner/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/owner/repo.git',
      hash: 'abc123',
    }, true, tmp);

    const content = await readFile(getLockfilePath(true, tmp), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.skills['my-skill'].installedAt).toBeUndefined();
    expect(parsed.skills['my-skill'].updatedAt).toBeUndefined();
  });

  test('global lockfile has timestamps', async () => {
    const globalTmp = join(tmp, 'global');
    await mkdir(globalTmp, { recursive: true });

    // Override config dir for this test
    const origConfigDir = process.env.BRIEF_CONFIG_DIR;
    process.env.BRIEF_CONFIG_DIR = globalTmp;

    try {
      await addSkillToLockfile('my-skill', {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        hash: 'abc123',
      }, false, undefined);

      const content = await readFile(getLockfilePath(false), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.skills['my-skill'].installedAt).toBeDefined();
      expect(parsed.skills['my-skill'].updatedAt).toBeDefined();
    } finally {
      process.env.BRIEF_CONFIG_DIR = origConfigDir;
    }
  });

  test('removeSkillFromLockfile', async () => {
    await addSkillToLockfile('skill-a', {
      source: 'owner/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/owner/repo.git',
      hash: 'hash-a',
    }, true, tmp);

    await addSkillToLockfile('skill-b', {
      source: 'owner/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/owner/repo.git',
      hash: 'hash-b',
    }, true, tmp);

    const removed = await removeSkillFromLockfile('skill-a', true, tmp);
    expect(removed).toBe(true);

    const lock = await readLockfile(true, tmp);
    expect(lock.skills['skill-a']).toBeUndefined();
    expect(lock.skills['skill-b']).toBeDefined();

    // Removing non-existent returns false
    const removedAgain = await removeSkillFromLockfile('skill-a', true, tmp);
    expect(removedAgain).toBe(false);
  });

  test('lockfile skills are sorted alphabetically', async () => {
    await addSkillToLockfile('zebra', {
      source: 'owner/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/owner/repo.git',
      hash: 'hash-z',
    }, true, tmp);

    await addSkillToLockfile('alpha', {
      source: 'owner/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/owner/repo.git',
      hash: 'hash-a',
    }, true, tmp);

    const content = await readFile(getLockfilePath(true, tmp), 'utf-8');
    const keys = Object.keys(JSON.parse(content).skills);
    expect(keys).toEqual(['alpha', 'zebra']);
  });
});

// ─── Skill Name Tests ───

describe('getSkillDisplayName', () => {
  test('uses name field', () => {
    const skill = { name: 'frontend-design', description: 'test', path: '/tmp' };
    expect(getSkillDisplayName(skill)).toBe('frontend-design');
  });

  test('falls back to directory name', () => {
    const skill = { name: '', description: 'test', path: '/tmp/my-skill' };
    expect(getSkillDisplayName(skill)).toBe('my-skill');
  });
});
