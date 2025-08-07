/**
 * Tests for BenchmarkFormatter
 */

import { describe, it, expect } from '@jest/globals';
import { BenchmarkFormatter, type BenchmarkResults, type BenchmarkComparison } from './formatter.js';

describe('BenchmarkFormatter', () => {
  const formatter = new BenchmarkFormatter();

  // Sample test data
  const createMockResults = (overrides?: Partial<BenchmarkResults>): BenchmarkResults => ({
    timestamp: '2025-01-01T00:00:00.000Z',
    environment: {
      node: 'v20.0.0',
      platform: 'linux',
      arch: 'x64',
    },
    summary: {
      averageContextReduction: 75.5,
      averageOperationReduction: 65.3,
      averageSpeedup: 3.2,
    },
    results: [
      {
        name: 'Navigate to definition',
        filesystem: { operationCount: 5, contextTokens: 5000, executionTimeMs: 100, accuracy: 0.75 },
        lsp: { operationCount: 1, contextTokens: 100, executionTimeMs: 20, accuracy: 0.98 },
        improvement: {
          operationReduction: 80,
          contextReduction: 98,
          speedup: 5,
          accuracyGain: 0.23,
        },
        passedExpectations: true,
        expectedReduction: { context: 50, operations: 60 },
      },
      {
        name: 'Find all references',
        filesystem: { operationCount: 10, contextTokens: 10000, executionTimeMs: 200, accuracy: 0.70 },
        lsp: { operationCount: 2, contextTokens: 500, executionTimeMs: 40, accuracy: 0.95 },
        improvement: {
          operationReduction: 80,
          contextReduction: 95,
          speedup: 5,
          accuracyGain: 0.25,
        },
        passedExpectations: true,
        expectedReduction: { context: 50, operations: 60 },
      },
    ],
    ...overrides,
  });

  describe('formatForPR', () => {
    it('should format results without base comparison', () => {
      const results = createMockResults();
      const formatted = formatter.formatForPR({ current: results });

      expect(formatted).toContain('## 📊 Efficiency Benchmark Results');
      expect(formatted).toContain('### Summary');
      expect(formatted).toContain('75.5%'); // average context reduction
      expect(formatted).toContain('65.3%'); // average operation reduction
      expect(formatted).toContain('3.2x'); // average speedup
      expect(formatted).toContain('✅'); // status icons
    });

    it('should format results with base comparison', () => {
      const current = createMockResults();
      const base = createMockResults({
        summary: {
          averageContextReduction: 70.0,
          averageOperationReduction: 60.0,
          averageSpeedup: 2.5,
        },
      });

      const formatted = formatter.formatForPR({ current, base });

      expect(formatted).toContain('| Metric | Current | Base | Change |');
      expect(formatted).toContain('📈'); // improvement indicator
      expect(formatted).toContain('+5.5%'); // context improvement
      expect(formatted).toContain('+5.3%'); // operation improvement
      expect(formatted).toContain('+0.7x'); // speedup improvement
    });

    it('should handle empty results gracefully', () => {
      const emptyResults = createMockResults({ results: [] });
      const formatted = formatter.formatForPR({ current: emptyResults });

      expect(formatted).toContain('## 📊 Efficiency Benchmark Results');
      expect(formatted).not.toContain('undefined');
      expect(formatted).not.toContain('NaN');
    });

    it('should categorize results correctly', () => {
      const results = createMockResults({
        results: [
          {
            name: 'Navigate to definition',
            filesystem: { operationCount: 5, contextTokens: 5000, executionTimeMs: 100 },
            lsp: { operationCount: 1, contextTokens: 100, executionTimeMs: 20 },
            improvement: { operationReduction: 80, contextReduction: 98, speedup: 5 },
            passedExpectations: true,
          },
          {
            name: 'Rename symbol',
            filesystem: { operationCount: 10, contextTokens: 10000, executionTimeMs: 200 },
            lsp: { operationCount: 2, contextTokens: 500, executionTimeMs: 40 },
            improvement: { operationReduction: 80, contextReduction: 95, speedup: 5 },
            passedExpectations: true,
          },
          {
            name: 'Find symbol',
            filesystem: { operationCount: 8, contextTokens: 8000, executionTimeMs: 150 },
            lsp: { operationCount: 1, contextTokens: 200, executionTimeMs: 25 },
            improvement: { operationReduction: 87.5, contextReduction: 97.5, speedup: 6 },
            passedExpectations: true,
          },
        ],
      });

      const formatted = formatter.formatForPR({ current: results });

      expect(formatted).toContain('#### Navigation');
      expect(formatted).toContain('#### Editing');
      expect(formatted).toContain('#### Search');
    });

    it('should show failed scenarios in status summary', () => {
      const results = createMockResults({
        results: [
          {
            name: 'Failed scenario',
            filesystem: { operationCount: 10, contextTokens: 10000, executionTimeMs: 200 },
            lsp: { operationCount: 5, contextTokens: 5000, executionTimeMs: 100 },
            improvement: { operationReduction: 50, contextReduction: 50, speedup: 2 },
            passedExpectations: false,
            expectedReduction: { context: 80, operations: 70 },
          },
          ...createMockResults().results,
        ],
      });

      const formatted = formatter.formatForPR({ current: results });

      expect(formatted).toContain('Scenarios needing attention');
      expect(formatted).toContain('Failed scenario');
      expect(formatted).toContain('(target: 80%)'); // context target
      expect(formatted).toContain('(target: 70%)'); // operations target
    });
  });

  describe('formatForConsole', () => {
    it('should format results for console output', () => {
      const results = createMockResults();
      const formatted = formatter.formatForConsole(results);

      expect(formatted).toContain('=== Efficiency Benchmark Results ===');
      expect(formatted).toContain('Average Context Reduction: 75.5%');
      expect(formatted).toContain('Average Operation Reduction: 65.3%');
      expect(formatted).toContain('Average Speedup: 3.2x');
      expect(formatted).toContain('Scenarios Passed: 2/2');
    });
  });

  describe('calculateMedian', () => {
    it('should handle empty arrays', () => {
      const formatter = new BenchmarkFormatter();
      // Access private method through type assertion for testing
      const result = (formatter as any).calculateMedian([]);
      expect(result).toBe(0);
    });

    it('should calculate median for odd-length arrays', () => {
      const formatter = new BenchmarkFormatter();
      const result = (formatter as any).calculateMedian([1, 2, 3, 4, 5]);
      expect(result).toBe(3);
    });

    it('should calculate median for even-length arrays', () => {
      const formatter = new BenchmarkFormatter();
      const result = (formatter as any).calculateMedian([1, 2, 3, 4]);
      expect(result).toBe(2.5);
    });

    it('should handle unsorted arrays', () => {
      const formatter = new BenchmarkFormatter();
      const result = (formatter as any).calculateMedian([5, 1, 3, 2, 4]);
      expect(result).toBe(3);
    });

    it('should handle single-element arrays', () => {
      const formatter = new BenchmarkFormatter();
      const result = (formatter as any).calculateMedian([42]);
      expect(result).toBe(42);
    });
  });

  describe('truncateName', () => {
    it('should not truncate short names', () => {
      const formatter = new BenchmarkFormatter();
      const result = (formatter as any).truncateName('Short name', 20);
      expect(result).toBe('Short name');
    });

    it('should truncate long names with ellipsis', () => {
      const formatter = new BenchmarkFormatter();
      const result = (formatter as any).truncateName('This is a very long scenario name that needs truncation', 20);
      expect(result).toBe('This is a very lo...');
    });
  });

  describe('formatPercentage', () => {
    it('should format percentage with one decimal place', () => {
      const formatter = new BenchmarkFormatter();
      expect((formatter as any).formatPercentage(75.456)).toBe('75.5%');
      expect((formatter as any).formatPercentage(100)).toBe('100.0%');
      expect((formatter as any).formatPercentage(0)).toBe('0.0%');
    });
  });

  describe('getStatusIcon', () => {
    it('should return correct status icons', () => {
      const formatter = new BenchmarkFormatter();
      expect((formatter as any).getStatusIcon(true)).toBe('✅');
      expect((formatter as any).getStatusIcon(false)).toBe('❌');
    });
  });

  describe('formatChange', () => {
    it('should format positive changes with up arrow', () => {
      const formatter = new BenchmarkFormatter();
      const result = (formatter as any).formatChange(5.5, true);
      expect(result).toContain('📈');
      expect(result).toContain('+5.5%');
    });

    it('should format negative changes with down arrow', () => {
      const formatter = new BenchmarkFormatter();
      const result = (formatter as any).formatChange(-3.2, true);
      expect(result).toContain('📉');
      expect(result).toContain('-3.2%');
    });

    it('should format zero changes with dash', () => {
      const formatter = new BenchmarkFormatter();
      const result = (formatter as any).formatChange(0, true);
      expect(result).toContain('➖');
      expect(result).toContain('+0.0%');
    });

    it('should handle custom suffixes', () => {
      const formatter = new BenchmarkFormatter();
      const result = (formatter as any).formatChange(2.5, false, 'x');
      expect(result).toContain('+2.5x');
    });
  });

  describe('edge cases', () => {
    it('should handle results with no accuracy data', () => {
      const results = createMockResults({
        results: [{
          name: 'Test scenario',
          filesystem: { operationCount: 5, contextTokens: 5000, executionTimeMs: 100 },
          lsp: { operationCount: 1, contextTokens: 100, executionTimeMs: 20 },
          improvement: { operationReduction: 80, contextReduction: 98, speedup: 5 },
          passedExpectations: true,
        }],
      });

      const formatted = formatter.formatForPR({ current: results });
      expect(formatted).not.toContain('undefined');
      expect(formatted).not.toContain('Accuracy');
    });

    it('should handle very large numbers', () => {
      const results = createMockResults({
        summary: {
          averageContextReduction: 99.999,
          averageOperationReduction: 99.999,
          averageSpeedup: 999.999,
        },
      });

      const formatted = formatter.formatForPR({ current: results });
      expect(formatted).toContain('100.0%');
      expect(formatted).toContain('1000.0x');
    });

    it('should handle negative improvements gracefully', () => {
      const results = createMockResults({
        results: [{
          name: 'Regression scenario',
          filesystem: { operationCount: 1, contextTokens: 100, executionTimeMs: 10 },
          lsp: { operationCount: 5, contextTokens: 500, executionTimeMs: 50 },
          improvement: { operationReduction: -400, contextReduction: -400, speedup: 0.2 },
          passedExpectations: false,
        }],
      });

      const formatted = formatter.formatForPR({ current: results });
      expect(formatted).not.toContain('NaN');
      expect(formatted).toContain('⚠️'); // warning for failed scenario
    });
  });
});