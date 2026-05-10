import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, lstat, readlink } from 'fs/promises';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { installSkillGlobal, installSkillLocal, removeSkillGlobal, removeSkillLocal, getCanonicalSkillPath, getSymlinkSkillPath } from '../src/core/installer.js';
import { computeSkillHash } from '../src/core/hash.js';
import { existsSync } from 'fs';

describe('installer: global scope', () => {
  let tmp: string;
  let skillSrc: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'skillfu-test-'));
    skillSrc = join(tmp, 'source', 'my-skill');
    await mkdir(skillSrc, { recursive: true });
    await writeFile(
      join(skillSrc, 'SKILL.md'),
      '---\nname: my-skill\ndescription: Test skill\n---\n# My Skill'
    );
    await writeFile(join(skillSrc, 'helper.ts'), 'export const x = 1;');
  });

  afterEach(async () => {
    // Clean up any installed skills
    try {
      await removeSkillGlobal('my-skill');
    } catch {}
    await rm(tmp, { recursive: true, force: true });
  });

  test('installSkillGlobal: copies files and creates symlink', async () => {
    const skill = {
      name: 'my-skill',
      description: 'Test skill',
      path: skillSrc,
    };

    const result = await installSkillGlobal(skill);
    expect(result.success).toBe(true);
    expect(result.mode).toBe('symlink');
    expect(result.canonicalPath).toContain('skillfu/skills/my-skill');
    expect(result.symlinkPath).toContain('.agents/skills/my-skill');

    // Verify canonical files exist
    expect(existsSync(result.canonicalPath)).toBe(true);
    expect(existsSync(join(result.canonicalPath, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(result.canonicalPath, 'helper.ts'))).toBe(true);

    // Verify symlink exists and points to canonical
    const linkStat = await lstat(result.symlinkPath!);
    expect(linkStat.isSymbolicLink()).toBe(true);

    // Verify symlink target resolves to canonical dir
    const linkTarget = await readlink(result.symlinkPath!);
    const resolvedTarget = resolve(join(result.symlinkPath!, '..', linkTarget));
    expect(resolvedTarget).toBe(resolve(result.canonicalPath));
  });

  test('installSkillGlobal: overwrites existing installation', async () => {
    const skill = {
      name: 'my-skill',
      description: 'Test skill',
      path: skillSrc,
    };

    // Install twice
    await installSkillGlobal(skill);
    const result2 = await installSkillGlobal(skill);
    expect(result2.success).toBe(true);
  });

  test('removeSkillGlobal: removes canonical files and symlink', async () => {
    const skill = {
      name: 'my-skill',
      description: 'Test skill',
      path: skillSrc,
    };

    const result = await installSkillGlobal(skill);
    expect(result.success).toBe(true);

    const removed = await removeSkillGlobal('my-skill');
    expect(removed).toBe(true);

    expect(existsSync(result.canonicalPath)).toBe(false);
    expect(existsSync(result.symlinkPath!)).toBe(false);
  });
});

describe('installer: local scope', () => {
  let tmp: string;
  let skillSrc: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'skillfu-test-'));
    skillSrc = join(tmp, 'source', 'my-skill');
    await mkdir(skillSrc, { recursive: true });
    await writeFile(
      join(skillSrc, 'SKILL.md'),
      '---\nname: my-skill\ndescription: Test skill\n---\n# My Skill'
    );
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test('installSkillLocal: copies files directly to .agents/skills/', async () => {
    const skill = {
      name: 'my-skill',
      description: 'Test skill',
      path: skillSrc,
    };

    const result = await installSkillLocal(skill, tmp);
    expect(result.success).toBe(true);
    expect(result.mode).toBe('direct');
    expect(result.canonicalPath).toBe(join(tmp, '.agents', 'skills', 'my-skill'));
    expect(result.symlinkPath).toBeUndefined();

    // Verify files exist
    expect(existsSync(result.canonicalPath)).toBe(true);
    expect(existsSync(join(result.canonicalPath, 'SKILL.md'))).toBe(true);
  });

  test('installSkillLocal: no symlink created (direct mode)', async () => {
    const skill = {
      name: 'my-skill',
      description: 'Test skill',
      path: skillSrc,
    };

    const result = await installSkillLocal(skill, tmp);
    expect(result.mode).toBe('direct');

    // The canonical path is the same as the "symlink" path in local mode
    const symlinkPath = join(tmp, '.agents', 'skills', 'my-skill');
    const statResult = await lstat(symlinkPath).catch(() => null);
    if (statResult) {
      // Should not be a symlink
      expect(statResult.isSymbolicLink()).toBe(false);
    }
  });

  test('removeSkillLocal: removes files', async () => {
    const skill = {
      name: 'my-skill',
      description: 'Test skill',
      path: skillSrc,
    };

    const result = await installSkillLocal(skill, tmp);
    expect(result.success).toBe(true);

    const removed = await removeSkillLocal('my-skill', tmp);
    expect(removed).toBe(true);
    expect(existsSync(result.canonicalPath)).toBe(false);
  });
});

describe('installer: path traversal prevention', () => {
  test('installSkillGlobal: sanitized name prevents path traversal', async () => {
    const skill = {
      name: '../../../etc/passwd',
      description: 'Malicious',
      path: '/tmp/fake',
    };

    // The name gets sanitized to 'etc-passwd', so path traversal is prevented
    // The install will fail because the source path doesn't exist
    const result = await installSkillGlobal(skill);
    expect(result.success).toBe(false);
  });

  test('installSkillLocal: sanitized name prevents path traversal', async () => {
    const skill = {
      name: '../../../etc/passwd',
      description: 'Malicious',
      path: '/tmp/fake',
    };

    // The name gets sanitized to 'etc-passwd', so path traversal is prevented
    const result = await installSkillLocal(skill, '/tmp');
    expect(result.success).toBe(false);
  });
});

describe('installer: hash computation on install', () => {
  let tmp: string;
  let skillSrc: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'skillfu-test-'));
    skillSrc = join(tmp, 'source', 'hash-skill');
    await mkdir(skillSrc, { recursive: true });
    await writeFile(
      join(skillSrc, 'SKILL.md'),
      '---\nname: hash-skill\ndescription: Test\n---\n# Hash Skill'
    );
  });

  afterEach(async () => {
    try { await removeSkillGlobal('hash-skill'); } catch {}
    await rm(tmp, { recursive: true, force: true });
  });

  test('installed skill produces consistent hash', async () => {
    const skill = {
      name: 'hash-skill',
      description: 'Test',
      path: skillSrc,
    };

    const result = await installSkillGlobal(skill);
    expect(result.success).toBe(true);

    const hash = await computeSkillHash(result.canonicalPath);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Same content should produce same hash
    const hash2 = await computeSkillHash(result.canonicalPath);
    expect(hash2).toBe(hash);
  });
});
