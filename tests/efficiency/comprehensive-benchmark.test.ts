/**
 * Comprehensive efficiency benchmark tests
 * These tests validate that MCP-LSP achieves its efficiency targets
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { EfficiencyBenchmark } from './framework.js';
import {
  navigateScenarios,
  findUsagesScenarios,
  // applyEditScenarios, // Removed - applyEdit tool no longer exists
  diagnosticsScenarios,
} from './scenarios.js';

describe('MCP-LSP Efficiency Benchmarks', () => {
  let benchmark: EfficiencyBenchmark;

  beforeAll(() => {
    benchmark = new EfficiencyBenchmark();
  });

  describe('Navigation Tool Efficiency', () => {
    it('should achieve >70% context reduction for navigation', async () => {
      const scenario = navigateScenarios[0]!; // Find function in same file
      const result = await benchmark.measure('navigate-same-file', scenario);

      expect(result.improvement.contextReduction).toBeGreaterThan(70);
      expect(result.improvement.operationReduction).toBeGreaterThan(70);
      expect(result.passedExpectations).toBe(true);
    });

    it('should achieve >80% context reduction for cross-file navigation', async () => {
      const scenario = navigateScenarios[1]!; // Find class across project
      const result = await benchmark.measure('navigate-cross-file', scenario);

      expect(result.improvement.contextReduction).toBeGreaterThan(80);
      expect(result.improvement.operationReduction).toBeGreaterThanOrEqual(60);
      expect(result.passedExpectations).toBe(true);
    });

    it('should achieve >90% reduction for implementation finding', async () => {
      const scenario = navigateScenarios[2]!; // Find interface implementation
      const result = await benchmark.measure('find-implementation', scenario);

      expect(result.improvement.contextReduction).toBeGreaterThan(90);
      expect(result.improvement.operationReduction).toBeGreaterThan(83);
      expect(result.passedExpectations).toBe(true);
    });
  });

  describe('Find Usages Tool Efficiency', () => {
    it('should achieve >90% context reduction for reference finding', async () => {
      const scenario = findUsagesScenarios[0]!; // Find all references
      const result = await benchmark.measure('find-references', scenario);

      expect(result.improvement.contextReduction).toBeGreaterThan(90);
      expect(result.improvement.operationReduction).toBeGreaterThan(83);
      expect(result.passedExpectations).toBe(true);
    });

    it('should achieve >95% reduction for call hierarchy', async () => {
      const scenario = findUsagesScenarios[1]!; // Trace call hierarchy
      const result = await benchmark.measure('call-hierarchy', scenario);

      expect(result.improvement.contextReduction).toBeGreaterThan(95);
      expect(result.improvement.operationReduction).toBeGreaterThanOrEqual(75);
      expect(result.passedExpectations).toBe(true);
    });
  });

  describe('Diagnostics Tool Efficiency', () => {
    it('should achieve >85% context reduction for project errors', async () => {
      const scenario = diagnosticsScenarios[0]!; // Get all project errors
      const result = await benchmark.measure('get-all-errors', scenario);

      expect(result.improvement.contextReduction).toBeGreaterThan(85);
      expect(result.improvement.operationReduction).toBeGreaterThan(88);
      expect(result.passedExpectations).toBe(true);
    });
  });

  describe('Overall Efficiency Targets', () => {
    it('should achieve average >50% context reduction across all operations', async () => {
      // Run a representative sample of scenarios
      const sampleScenarios = [
        navigateScenarios[0]!,
        findUsagesScenarios[0]!,
        // applyEditScenarios[0]!, // applyEdit removed
        diagnosticsScenarios[0]!,
      ];

      const results = [];
      for (const scenario of sampleScenarios) {
        const result = await benchmark.measure(`sample-${scenario.name}`, scenario);
        results.push(result);
      }

      const avgContextReduction =
        results.reduce((sum, r) => sum + r.improvement.contextReduction, 0) / results.length;

      expect(avgContextReduction).toBeGreaterThan(50);
    });

    it('should achieve 2-5x operation reduction on average', async () => {
      // Run scenarios and check operation reduction
      const sampleScenarios = [
        navigateScenarios[1]!,
        findUsagesScenarios[1]!,
        // applyEditScenarios[0]!, // applyEdit removed
      ];

      const results = [];
      for (const scenario of sampleScenarios) {
        const result = await benchmark.measure(`ops-${scenario.name}`, scenario);
        results.push(result);
      }

      // Calculate average operation reduction factor
      const avgOpsFactor =
        results.reduce((sum, r) => {
          const factor = r.filesystem.operationCount / r.lsp.operationCount;
          return sum + factor;
        }, 0) / results.length;

      expect(avgOpsFactor).toBeGreaterThanOrEqual(2);
      expect(avgOpsFactor).toBeLessThanOrEqual(5);
    });
  });

  describe('Accuracy Improvements', () => {
    it('should provide higher accuracy than text-based matching', async () => {
      const scenario = navigateScenarios[0]!;
      const result = await benchmark.measure('accuracy-test', scenario);

      expect(result.lsp.accuracy).toBeGreaterThan(result.filesystem.accuracy!);
      expect(result.improvement.accuracyGain).toBeGreaterThan(0.2); // 20% better
    });
  });

  afterAll(() => {
    // Generate and log the report
    const report = benchmark.generateReport();
    console.log('\n' + report);

    // Optionally save to file
    const json = benchmark.toJSON();
    console.log('\nJSON Summary:', JSON.stringify(json, null, 2));
  });
});
