import { describe, it, expect } from '@jest/globals';
import { listInvestigationTemplatesSync } from '../../prompt-templates/loader.js';

describe('loader', () => {
  it('should list templates', () => {
    const templates = listInvestigationTemplatesSync('zh');
    expect(templates.length).toBeGreaterThan(0);
  });
});
