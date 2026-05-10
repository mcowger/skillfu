/**
 * Client for the skills.sh API.
 * Used for update detection (hash comparison) and security audits.
 */

export interface SkillDetail {
  id: string;
  source: string;
  slug: string;
  installs: number;
  hash: string | null;
  files: Array<{ path: string; contents: string }> | null;
}

export interface AuditEntry {
  provider: string;
  slug: string;
  status: 'pass' | 'warn' | 'fail';
  summary: string;
  auditedAt: string;
  riskLevel?: string;
}

export interface AuditResponse {
  id: string;
  source: string;
  slug: string;
  audits: AuditEntry[];
}

const API_BASE = 'https://skills.sh/api/v1';

/**
 * Fetch skill details from the skills.sh API.
 * Returns the skill detail including hash and files, or null if not found.
 */
export async function fetchSkillDetail(
  source: string,
  skillSlug: string
): Promise<SkillDetail | null> {
  try {
    const url = `${API_BASE}/skills/${source}/${skillSlug}`;
    const headers: Record<string, string> = {
      'User-Agent': 'skillfu-cli',
    };

    // Optional API key for higher rate limits
    const apiKey = process.env.SKILLFU_SKILLS_SH_KEY;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 404) return null;
      return null;
    }

    return (await response.json()) as SkillDetail;
  } catch {
    return null;
  }
}

/**
 * Fetch security audit results for a skill from the skills.sh API.
 */
export async function fetchSkillAudit(
  source: string,
  skillSlug: string
): Promise<AuditResponse | null> {
  try {
    const url = `${API_BASE}/skills/audit/${source}/${skillSlug}`;
    const headers: Record<string, string> = {
      'User-Agent': 'skillfu-cli',
    };

    const apiKey = process.env.SKILLFU_SKILLS_SH_KEY;
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 404) return null;
      return null;
    }

    return (await response.json()) as AuditResponse;
  } catch {
    return null;
  }
}

/**
 * Get the current hash for a skill from the skills.sh API.
 * Returns the hash string, or null if unavailable.
 */
export async function getSkillHash(source: string, skillSlug: string): Promise<string | null> {
  const detail = await fetchSkillDetail(source, skillSlug);
  return detail?.hash ?? null;
}

/**
 * Build the skills.sh source identifier from owner/repo format.
 * e.g., "vercel-labs/agent-skills" → "vercel-labs/agent-skills"
 * The API uses the same owner/repo format in its IDs.
 */
export function buildSourceId(ownerRepo: string): string {
  return ownerRepo;
}

/**
 * Convert a skill name to a slug for the skills.sh API.
 * The API uses URL-safe slugs (lowercase, hyphens).
 */
export function skillNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '');
}
