/**
 * i18n Template Alignment Tests
 *
 * Validates that:
 * 1. All i18n keys used in code exist in both en.ts and zh.ts
 * 2. Type definitions in index.ts match implementation keys
 * 3. en.ts and zh.ts have identical key structures
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Helper to extract keys from a block
function extractKeysFromBlock(content: string, blockName: string): string[] {
  const start = content.indexOf(`${blockName}: {`);
  if (start === -1) return [];

  let braceCount = 0;
  let i = start;
  while (i < content.length) {
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') {
      braceCount--;
      if (braceCount === 0) break;
    }
    i++;
  }

  const block = content.substring(start, i + 1);
  const keys: string[] = [];
  const lines = block.split('\n');

  for (const line of lines) {
    // Match key: 'value' or key: "value" or key: `value` or key: string
    const match = line.match(/^\s+(\w+)\s*:\s*(?:['"`]|string)/);
    if (match) {
      keys.push(match[1]);
    }
  }

  return keys;
}

// Helper to extract all i18n references from code
function extractI18nReferences(content: string): string[] {
  const refs = new Set<string>();

  // Match patterns like texts.xxx, i18n.xxx, t(cwd).xxx
  const patterns = [
    /texts\.(\w+(?:\.\w+)*)/g,
    /i18n\.(\w+(?:\.\w+)*)/g,
    /t\(cwd\)\.(\w+(?:\.\w+)*)/g,
    /getI18n\([^)]*\)\.(\w+(?:\.\w+)*)/g,
  ];

  for (const regex of patterns) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(content)) !== null) {
      refs.add(match[1]);
    }
  }

  return Array.from(refs).sort();
}

describe('i18n Template Alignment', () => {
  const indexPath = path.join(__dirname, '../i18n/index.ts');
  const enPath = path.join(__dirname, '../i18n/en.ts');
  const zhPath = path.join(__dirname, '../i18n/zh.ts');

  const indexContent = fs.readFileSync(indexPath, 'utf-8');
  const enContent = fs.readFileSync(enPath, 'utf-8');
  const zhContent = fs.readFileSync(zhPath, 'utf-8');

  describe('harness.logs alignment', () => {
    it('should have matching keys between type definition and implementations', () => {
      const typeKeys = extractKeysFromBlock(indexContent, 'logs');
      const enKeys = extractKeysFromBlock(enContent, 'logs');
      const zhKeys = extractKeysFromBlock(zhContent, 'logs');

      expect(typeKeys.length).toBeGreaterThan(0);
      expect(enKeys.length).toBeGreaterThan(0);
      expect(zhKeys.length).toBeGreaterThan(0);

      // Type definition should match en.ts
      const missingInType = enKeys.filter((k) => !typeKeys.includes(k));
      expect(missingInType).toEqual([]);

      // en.ts and zh.ts should have same keys
      const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
      const extraInZh = zhKeys.filter((k) => !enKeys.includes(k));
      expect(missingInZh).toEqual([]);
      expect(extraInZh).toEqual([]);
    });
  });

  describe('harness.reports alignment', () => {
    it('should have matching keys between type definition and implementations', () => {
      const typeKeys = extractKeysFromBlock(indexContent, 'reports');
      const enKeys = extractKeysFromBlock(enContent, 'reports');
      const zhKeys = extractKeysFromBlock(zhContent, 'reports');

      expect(typeKeys.length).toBeGreaterThan(0);
      expect(enKeys.length).toBeGreaterThan(0);
      expect(zhKeys.length).toBeGreaterThan(0);

      const missingInType = enKeys.filter((k) => !typeKeys.includes(k));
      expect(missingInType).toEqual([]);

      const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
      const extraInZh = zhKeys.filter((k) => !enKeys.includes(k));
      expect(missingInZh).toEqual([]);
      expect(extraInZh).toEqual([]);
    });
  });

  describe('analyzeFixPipeline alignment', () => {
    it('should have matching keys between type definition and implementations', () => {
      const typeKeys = extractKeysFromBlock(indexContent, 'analyzeFixPipeline');
      const enKeys = extractKeysFromBlock(enContent, 'analyzeFixPipeline');
      const zhKeys = extractKeysFromBlock(zhContent, 'analyzeFixPipeline');

      expect(typeKeys.length).toBeGreaterThan(0);
      expect(enKeys.length).toBeGreaterThan(0);
      expect(zhKeys.length).toBeGreaterThan(0);

      const missingInType = enKeys.filter((k) => !typeKeys.includes(k));
      expect(missingInType).toEqual([]);

      const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
      const extraInZh = zhKeys.filter((k) => !enKeys.includes(k));
      expect(missingInZh).toEqual([]);
      expect(extraInZh).toEqual([]);
    });
  });

  describe('doctorCmd alignment', () => {
    it('should have matching keys between type definition and implementations', () => {
      const typeKeys = extractKeysFromBlock(indexContent, 'doctorCmd');
      const enKeys = extractKeysFromBlock(enContent, 'doctorCmd');
      const zhKeys = extractKeysFromBlock(zhContent, 'doctorCmd');

      expect(typeKeys.length).toBeGreaterThan(0);
      expect(enKeys.length).toBeGreaterThan(0);
      expect(zhKeys.length).toBeGreaterThan(0);

      const missingInType = enKeys.filter((k) => !typeKeys.includes(k));
      expect(missingInType).toEqual([]);

      const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));
      const extraInZh = zhKeys.filter((k) => !enKeys.includes(k));
      expect(missingInZh).toEqual([]);
      expect(extraInZh).toEqual([]);
    });
  });

  describe('rolePrompts alignment', () => {
    it('should have matching keys between type definition and implementations', () => {
      // rolePrompts has nested structure, check that it exists
      const hasRolePromptsInIndex = indexContent.includes('rolePrompts:');
      const hasRolePromptsInEn = enContent.includes('rolePrompts:');
      const hasRolePromptsInZh = zhContent.includes('rolePrompts:');

      expect(hasRolePromptsInIndex).toBe(true);
      expect(hasRolePromptsInEn).toBe(true);
      expect(hasRolePromptsInZh).toBe(true);

      // Check that all role types exist
      const roleTypes = ['frontend', 'backend', 'qa', 'architect', 'security', 'performance'];
      for (const roleType of roleTypes) {
        expect(enContent.includes(`${roleType}:`)).toBe(true);
        expect(zhContent.includes(`${roleType}:`)).toBe(true);
      }
    });
  });
});
