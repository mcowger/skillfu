import { readFile } from 'fs/promises';

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Returns the frontmatter data as an object, or null if parsing fails.
 */
export async function parseFrontmatter(filePath: string): Promise<Record<string, any> | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return parseFrontmatterFromString(content);
  } catch {
    return null;
  }
}

/**
 * Parse YAML frontmatter from a string.
 */
export function parseFrontmatterFromString(content: string): Record<string, any> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!match) {
    return null;
  }

  const yamlContent = match[1]!;
  return parseSimpleYaml(yamlContent);
}

/**
 * Simple YAML parser for frontmatter.
 * Handles basic key-value pairs, nested objects (metadata:), and arrays.
 * Not a full YAML parser — just enough for SKILL.md frontmatter.
 */
function parseSimpleYaml(yaml: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentIndent = 0;
  let inNested = false;
  let nestedObj: Record<string, any> = {};
  let nestedKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);

    // Nested block (indented)
    if (inNested && indent > currentIndent) {
      const nestedMatch = trimmed.match(/^(\w+):\s*(.*)$/);
      if (nestedMatch) {
        const [, key, value] = nestedMatch;
        if (value.trim()) {
          nestedObj[key!] = parseValue(value.trim());
        } else {
          // Deeper nesting not supported, treat as true
          nestedObj[key!] = true;
        }
      }
      continue;
    }

    // End of nested block
    if (inNested && indent <= currentIndent) {
      if (currentKey) {
        result[currentKey] = nestedObj;
      }
      inNested = false;
      nestedObj = {};
    }

    // Key: value
    const match = trimmed.match(/^(\w[\w-]*):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      currentKey = key!;

      if (value.trim()) {
        result[currentKey] = parseValue(value.trim());
        inNested = false;
      } else {
        // Start of nested block
        inNested = true;
        currentIndent = indent;
        nestedObj = {};
      }
      continue;
    }
  }

  // Close any remaining nested block
  if (inNested && currentKey) {
    result[currentKey] = nestedObj;
  }

  return result;
}

/**
 * Parse a YAML value string into a JS value.
 */
function parseValue(value: string): any {
  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Number
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Plain string
  return value;
}
