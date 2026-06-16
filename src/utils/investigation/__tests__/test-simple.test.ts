import { describe, it, expect } from '@jest/globals';
import { PREFIX_MAP } from '../types.js';

describe('simple', () => {
  it('should work', () => {
    expect(PREFIX_MAP.verify).toBeDefined();
  });
});
