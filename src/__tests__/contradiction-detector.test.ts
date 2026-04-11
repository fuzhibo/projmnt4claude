import { describe, test, expect } from 'bun:test';
import {
  detectContradiction,
  qualityScoreToVerdict,
  getQualityMinScore,
} from '../utils/contradiction-detector.js';

// ============== detectContradiction ==============

describe('detectContradiction', () => {
  // --- Edge cases: empty / whitespace content ---

  test('returns no contradiction for empty string content', () => {
    const result = detectContradiction('PASS', '');
    expect(result.hasContradiction).toBe(false);
  });

  test('returns no contradiction for whitespace-only content', () => {
    const result = detectContradiction('NOPASS', '   \n\t  ');
    expect(result.hasContradiction).toBe(false);
  });

  // --- No contradiction: neutral / insufficient indicators ---

  test('returns no contradiction when content is neutral', () => {
    const result = detectContradiction('PASS', 'The implementation follows the specification.');
    expect(result.hasContradiction).toBe(false);
  });

  test('returns no contradiction when both positive and negative indicators are present', () => {
    const content = 'The feature was successfully implemented but there is a missing test case.';
    const result = detectContradiction('PASS', content);
    expect(result.hasContradiction).toBe(false);
  });

  test('returns no contradiction with only 2 positive indicator matches (threshold is 3)', () => {
    // "successfully completed" matches PASS pattern 2, "works correctly" matches pattern 3
    // Only 2 indicators, below threshold of 3
    const content = 'successfully completed. works correctly.';
    const result = detectContradiction('NOPASS', content);
    expect(result.hasContradiction).toBe(false);
  });

  // --- Strong contradiction: NOPASS label + enough positive English content (>= 3 patterns) ---

  test('detects contradiction: NOPASS label with 3+ positive English indicator patterns', () => {
    // Matches 3 distinct PASS patterns:
    //   pattern 1: "all criteria met"
    //   pattern 2: "successfully verified"
    //   pattern 3: "works correctly"
    const content = 'all criteria met. successfully verified. works correctly.';
    const result = detectContradiction('NOPASS', content);
    expect(result.hasContradiction).toBe(true);
    expect(result.correctedResult).toBe('PASS');
    expect(result.originalResult).toBe('NOPASS');
    expect(result.reason).toContain('正向指标');
  });

  test('detects contradiction: NOPASS label with "all standards achieved" and other positives', () => {
    // "standards" (plural) matches the regex alternation literally
    const content = 'all standards achieved. successfully completed. code is clean.';
    const result = detectContradiction('NOPASS', content);
    expect(result.hasContradiction).toBe(true);
    expect(result.correctedResult).toBe('PASS');
  });

  test('detects contradiction: NOPASS with "well implemented" and other positives', () => {
    const content = 'all requirements passed. well implemented. good quality overall.';
    const result = detectContradiction('NOPASS', content);
    expect(result.hasContradiction).toBe(true);
    expect(result.correctedResult).toBe('PASS');
  });

  // --- PASS label + negative content: English negative patterns max score is 2 (below threshold 3) ---

  test('no contradiction: PASS label with negative English content (max 2 negative patterns reachable)', () => {
    // Pattern 1 matches "failed", pattern 3 matches "not met" but both won't co-occur easily
    // Even if they did, score = 2, below threshold 3
    const content = 'The implementation failed. There is a defect. A problem was found.';
    const result = detectContradiction('PASS', content);
    expect(result.hasContradiction).toBe(false);
  });

  test('no contradiction: PASS label with negative English "not X" patterns', () => {
    const content = 'Requirements not met. Standards not satisfied. Checkpoints not passed.';
    // Pattern 3 matches "not met", but "passed" in text also matches PASS pattern 2
    // So nopass score is low and pass score > 0, no contradiction
    const result = detectContradiction('PASS', content);
    expect(result.hasContradiction).toBe(false);
  });

  // --- Section header stripping ---

  test('markdown section headers do not create false negative indicators', () => {
    // "## 未满足的标准:" should be stripped so it doesn't count as negative
    // Remaining English positive content triggers the contradiction
    const content = '## 未满足的标准:\nall criteria met. successfully verified. works correctly.';
    const result = detectContradiction('NOPASS', content);
    expect(result.hasContradiction).toBe(true);
    expect(result.correctedResult).toBe('PASS');
  });

  // --- Contradiction result structure ---

  test('contradiction result includes all expected fields', () => {
    const content = 'all tests passed. successfully implemented. works correctly.';
    const result = detectContradiction('NOPASS', content);
    expect(result.hasContradiction).toBe(true);
    expect(result.correctedResult).toBe('PASS');
    expect(result.originalResult).toBe('NOPASS');
    expect(typeof result.reason).toBe('string');
    expect(result.reason!.length).toBeGreaterThan(0);
  });

  test('no contradiction result has no correctedResult or reason', () => {
    const result = detectContradiction('PASS', 'neutral content here');
    expect(result.hasContradiction).toBe(false);
    expect(result.correctedResult).toBeUndefined();
    expect(result.originalResult).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });

  // --- Different label directions ---

  test('PASS label with all positive content does not contradict', () => {
    const content = 'all criteria met. successfully completed. works correctly.';
    const result = detectContradiction('PASS', content);
    // PASS + positive content = consistent, no contradiction
    expect(result.hasContradiction).toBe(false);
  });

  test('NOPASS label with neutral content does not contradict', () => {
    const result = detectContradiction('NOPASS', 'The project has various components.');
    expect(result.hasContradiction).toBe(false);
  });

  // --- Repeated content to reach threshold ---

  test('single positive word cannot trigger contradiction alone', () => {
    // "successfully completed" only matches pattern 2 => score 1
    const content = 'successfully completed.';
    const result = detectContradiction('NOPASS', content);
    expect(result.hasContradiction).toBe(false);
  });

  test('two distinct positive patterns still below threshold', () => {
    // pattern 2: "completed", pattern 3: "works correctly"
    const content = 'completed. works correctly.';
    const result = detectContradiction('NOPASS', content);
    expect(result.hasContradiction).toBe(false);
  });

  // --- "not met" pattern (3rd NOPASS indicator) ---

  test('"not met" is detected as negative indicator', () => {
    // "not met" matches NOPASS pattern 3
    // But with only 1 negative pattern match, nopassScore < 3, no contradiction
    const content = 'not met. not satisfied. not passed.';
    const result = detectContradiction('PASS', content);
    // "passed" in "not passed" also matches PASS pattern 2, so passScore > 0
    expect(result.hasContradiction).toBe(false);
  });

  // --- Long mixed content ---

  test('long mixed content with 3+ positive indicators and some negative does not contradict', () => {
    // When both passScore > 0 and nopassScore > 0, neither strong contradiction condition is met
    const content = 'all criteria met. successfully verified. works correctly. But there is a bug reported.';
    const result = detectContradiction('NOPASS', content);
    // passScore >= 3 but nopassScore > 0, so the condition "passScore >= 3 && nopassScore === 0" fails
    expect(result.hasContradiction).toBe(false);
  });

  // --- Content with special characters ---

  test('content with markdown formatting and code blocks', () => {
    const content = '```\nall criteria met\n```\nsuccessfully implemented. works correctly. well implemented.';
    const result = detectContradiction('NOPASS', content);
    expect(result.hasContradiction).toBe(true);
    expect(result.correctedResult).toBe('PASS');
  });
});

// ============== qualityScoreToVerdict ==============

describe('qualityScoreToVerdict', () => {
  test('returns PASS for score equal to default threshold (60)', () => {
    expect(qualityScoreToVerdict(60)).toBe('PASS');
  });

  test('returns PASS for score above default threshold', () => {
    expect(qualityScoreToVerdict(85)).toBe('PASS');
  });

  test('returns NOPASS for score below default threshold', () => {
    expect(qualityScoreToVerdict(59)).toBe('NOPASS');
  });

  test('returns NOPASS for score of 0', () => {
    expect(qualityScoreToVerdict(0)).toBe('NOPASS');
  });

  test('returns PASS for score of 100', () => {
    expect(qualityScoreToVerdict(100)).toBe('PASS');
  });

  test('respects custom minScore threshold', () => {
    expect(qualityScoreToVerdict(65, 70)).toBe('NOPASS');
    expect(qualityScoreToVerdict(70, 70)).toBe('PASS');
    expect(qualityScoreToVerdict(75, 70)).toBe('PASS');
  });

  test('returns PASS when score equals custom minScore exactly', () => {
    expect(qualityScoreToVerdict(80, 80)).toBe('PASS');
  });

  test('returns NOPASS for score just below custom minScore', () => {
    expect(qualityScoreToVerdict(79, 80)).toBe('NOPASS');
  });

  test('works with very low custom minScore', () => {
    expect(qualityScoreToVerdict(1, 1)).toBe('PASS');
    expect(qualityScoreToVerdict(0, 1)).toBe('NOPASS');
  });
});

// ============== getQualityMinScore ==============

describe('getQualityMinScore', () => {
  test('returns default 60 when config path does not exist', () => {
    expect(getQualityMinScore('/nonexistent/path/that/does/not/exist')).toBe(60);
  });

  test('returns a value between 0 and 100 with no arguments', () => {
    const result = getQualityMinScore();
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});
