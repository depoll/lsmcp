/**
 * Formatter for efficiency benchmark results
 * Converts raw JSON output into user-friendly markdown tables for PR comments
 */

import type { BenchmarkResult } from './framework.js';

// Configuration constants for benchmark targets
const BENCHMARK_TARGETS = {
  CONTEXT_REDUCTION: 50, // 50% reduction target
  OPERATION_REDUCTION: 60, // 60% reduction target
  SPEEDUP: 2, // 2x speedup target
} as const;

export interface BenchmarkComparison {
  current: BenchmarkResults;
  base?: BenchmarkResults;
}

export interface BenchmarkResults {
  timestamp: string;
  environment: {
    node: string;
    platform: string;
    arch: string;
  };
  summary: {
    averageContextReduction: number;
    averageOperationReduction: number;
    averageSpeedup: number;
  };
  results: BenchmarkResult[];
}

export class BenchmarkFormatter {
  /**
   * Format benchmark results as a markdown comment for GitHub PRs
   */
  formatForPR(comparison: BenchmarkComparison): string {
    const { current, base } = comparison;
    let output = '## 📊 Efficiency Benchmark Results\n\n';

    // Add summary section
    output += this.formatSummary(current, base);

    // Add detailed results table
    output += this.formatDetailedResults(current, base);

    // Add performance characteristics
    output += this.formatPerformanceCharacteristics(current);

    // Add status summary
    output += this.formatStatusSummary(current);

    return output;
  }

  private formatSummary(current: BenchmarkResults, base?: BenchmarkResults): string {
    let output = '### Summary\n\n';

    if (base) {
      // Show comparison with base branch
      output += '| Metric | Current | Base | Change |\n';
      output += '|--------|---------|------|--------|\n';

      const contextChange =
        current.summary.averageContextReduction - base.summary.averageContextReduction;
      const operationChange =
        current.summary.averageOperationReduction - base.summary.averageOperationReduction;
      const speedupChange = current.summary.averageSpeedup - base.summary.averageSpeedup;

      output += `| **Context Reduction** | ${this.formatPercentage(current.summary.averageContextReduction)} | ${this.formatPercentage(base.summary.averageContextReduction)} | ${this.formatChange(contextChange, true)} |\n`;
      output += `| **Operation Reduction** | ${this.formatPercentage(current.summary.averageOperationReduction)} | ${this.formatPercentage(base.summary.averageOperationReduction)} | ${this.formatChange(operationChange, true)} |\n`;
      output += `| **Average Speedup** | ${current.summary.averageSpeedup.toFixed(1)}x | ${base.summary.averageSpeedup.toFixed(1)}x | ${this.formatChange(speedupChange, false, 'x')} |\n`;
    } else {
      // Show current results only
      output += '| Metric | Value | Target | Status |\n';
      output += '|--------|-------|--------|--------|\n';

      output += `| **Context Reduction** | ${this.formatPercentage(current.summary.averageContextReduction)} | ≥${BENCHMARK_TARGETS.CONTEXT_REDUCTION}% | ${this.getStatusIcon(current.summary.averageContextReduction >= BENCHMARK_TARGETS.CONTEXT_REDUCTION)} |\n`;
      output += `| **Operation Reduction** | ${this.formatPercentage(current.summary.averageOperationReduction)} | ≥${BENCHMARK_TARGETS.OPERATION_REDUCTION}% | ${this.getStatusIcon(current.summary.averageOperationReduction >= BENCHMARK_TARGETS.OPERATION_REDUCTION)} |\n`;
      output += `| **Average Speedup** | ${current.summary.averageSpeedup.toFixed(1)}x | ≥${BENCHMARK_TARGETS.SPEEDUP}x | ${this.getStatusIcon(current.summary.averageSpeedup >= BENCHMARK_TARGETS.SPEEDUP)} |\n`;
    }

    output += '\n';
    return output;
  }

  private formatDetailedResults(current: BenchmarkResults, base?: BenchmarkResults): string {
    let output = '### Detailed Results\n\n';

    // Group results by category if possible
    const categorizedResults = this.categorizeResults(current.results);

    for (const [category, results] of Object.entries(categorizedResults)) {
      if (Object.keys(categorizedResults).length > 1) {
        output += `#### ${category}\n\n`;
      }

      output += '<details>\n';
      output += `<summary>View ${results.length} scenario${results.length > 1 ? 's' : ''}</summary>\n\n`;
      output += '| Scenario | Context | Operations | Time | Status |\n';
      output += '|----------|---------|------------|------|--------|\n';

      for (const result of results) {
        const baseResult = base?.results.find((r) => r.name === result.name);

        const contextReduction = `${result.improvement.contextReduction.toFixed(0)}%`;
        const operationReduction = `${result.improvement.operationReduction.toFixed(0)}%`;
        const speedup = `${result.improvement.speedup.toFixed(1)}x`;

        // Add comparison indicators if base exists
        const contextIndicator = baseResult
          ? this.getComparisonIndicator(
              result.improvement.contextReduction,
              baseResult.improvement.contextReduction
            )
          : '';

        const operationIndicator = baseResult
          ? this.getComparisonIndicator(
              result.improvement.operationReduction,
              baseResult.improvement.operationReduction
            )
          : '';

        const speedupIndicator = baseResult
          ? this.getComparisonIndicator(result.improvement.speedup, baseResult.improvement.speedup)
          : '';

        const status = result.passedExpectations ? '✅' : '⚠️';

        output += `| ${this.truncateName(result.name)} | ${contextReduction}${contextIndicator} | ${operationReduction}${operationIndicator} | ${speedup}${speedupIndicator} | ${status} |\n`;
      }

      output += '\n</details>\n\n';
    }

    return output;
  }

  private formatPerformanceCharacteristics(current: BenchmarkResults): string {
    let output = '### Performance Characteristics\n\n';

    // Skip if no results
    if (current.results.length === 0) {
      return output;
    }

    // Calculate performance distribution
    const contextReductions = current.results.map((r) => r.improvement.contextReduction);
    const operationReductions = current.results.map((r) => r.improvement.operationReduction);
    const speedups = current.results.map((r) => r.improvement.speedup);

    output += '<details>\n';
    output += '<summary>Distribution Analysis</summary>\n\n';
    output += '```\n';
    output += `Context Reduction:\n`;
    output += `  Min: ${Math.min(...contextReductions).toFixed(1)}%\n`;
    output += `  Max: ${Math.max(...contextReductions).toFixed(1)}%\n`;
    output += `  Median: ${this.calculateMedian(contextReductions).toFixed(1)}%\n\n`;

    output += `Operation Reduction:\n`;
    output += `  Min: ${Math.min(...operationReductions).toFixed(1)}%\n`;
    output += `  Max: ${Math.max(...operationReductions).toFixed(1)}%\n`;
    output += `  Median: ${this.calculateMedian(operationReductions).toFixed(1)}%\n\n`;

    output += `Speedup:\n`;
    output += `  Min: ${Math.min(...speedups).toFixed(1)}x\n`;
    output += `  Max: ${Math.max(...speedups).toFixed(1)}x\n`;
    output += `  Median: ${this.calculateMedian(speedups).toFixed(1)}x\n`;
    output += '```\n\n';
    output += '</details>\n\n';

    return output;
  }

  private formatStatusSummary(current: BenchmarkResults): string {
    const passed = current.results.filter((r) => r.passedExpectations).length;
    const total = current.results.length;
    const percentage = total > 0 ? (passed / total) * 100 : 0;

    let output = '### Overall Status\n\n';

    if (total === 0) {
      output += '⚠️ **No scenarios to evaluate**\n\n';
    } else if (percentage === 100) {
      output += '✅ **All scenarios passed their efficiency targets!**\n\n';
    } else if (percentage >= 80) {
      output += `⚠️ **${passed}/${total} scenarios passed** (${percentage.toFixed(0)}%)\n\n`;
    } else {
      output += `❌ **Only ${passed}/${total} scenarios passed** (${percentage.toFixed(0)}%)\n\n`;
    }

    // Add failed scenarios if any
    const failed = current.results.filter((r) => !r.passedExpectations);
    if (failed.length > 0) {
      output += '<details>\n';
      output += '<summary>Scenarios needing attention</summary>\n\n';
      for (const scenario of failed) {
        output += `- **${scenario.name}**: `;
        output += `Context ${scenario.improvement.contextReduction.toFixed(0)}% `;
        output += `(target: ${scenario.expectedReduction?.context || BENCHMARK_TARGETS.CONTEXT_REDUCTION}%), `;
        output += `Operations ${scenario.improvement.operationReduction.toFixed(0)}% `;
        output += `(target: ${scenario.expectedReduction?.operations || BENCHMARK_TARGETS.OPERATION_REDUCTION}%)\n`;
      }
      output += '\n</details>\n\n';
    }

    return output;
  }

  private categorizeResults(results: BenchmarkResult[]): Record<string, BenchmarkResult[]> {
    const categories: Record<string, BenchmarkResult[]> = {};

    for (const result of results) {
      // Try to extract category from scenario name
      let category = 'General';

      if (
        result.name.toLowerCase().includes('navigate') ||
        result.name.toLowerCase().includes('definition')
      ) {
        category = 'Navigation';
      } else if (
        result.name.toLowerCase().includes('edit') ||
        result.name.toLowerCase().includes('refactor') ||
        result.name.toLowerCase().includes('rename')
      ) {
        category = 'Editing';
      } else if (
        result.name.toLowerCase().includes('search') ||
        result.name.toLowerCase().includes('find') ||
        result.name.toLowerCase().includes('symbol')
      ) {
        category = 'Search';
      } else if (
        result.name.toLowerCase().includes('diagnostic') ||
        result.name.toLowerCase().includes('error')
      ) {
        category = 'Diagnostics';
      }

      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category]!.push(result);
    }

    return categories;
  }

  private formatPercentage(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  private formatChange(change: number, isPercentage: boolean, suffix: string = '%'): string {
    const sign = change >= 0 ? '+' : '';
    const formatted = isPercentage
      ? `${sign}${change.toFixed(1)}${suffix}`
      : `${sign}${change.toFixed(1)}${suffix}`;

    if (change > 0) {
      return `📈 ${formatted}`;
    } else if (change < 0) {
      return `📉 ${formatted}`;
    } else {
      return `➖ ${formatted}`;
    }
  }

  private getStatusIcon(passed: boolean): string {
    return passed ? '✅' : '❌';
  }

  private getComparisonIndicator(current: number, base: number): string {
    const diff = current - base;
    if (Math.abs(diff) < 1) return '';
    return diff > 0 ? ' ↑' : ' ↓';
  }

  private truncateName(name: string, maxLength: number = 40): string {
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 3) + '...';
  }

  private calculateMedian(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1]! + sorted[mid]!) / 2;
    }

    return sorted[mid]!;
  }

  /**
   * Generate a simple text summary for console output
   */
  formatForConsole(results: BenchmarkResults): string {
    let output = '\n=== Efficiency Benchmark Results ===\n\n';

    output += `Average Context Reduction: ${results.summary.averageContextReduction.toFixed(1)}%\n`;
    output += `Average Operation Reduction: ${results.summary.averageOperationReduction.toFixed(1)}%\n`;
    output += `Average Speedup: ${results.summary.averageSpeedup.toFixed(1)}x\n\n`;

    const passed = results.results.filter((r) => r.passedExpectations).length;
    const total = results.results.length;

    output += `Scenarios Passed: ${passed}/${total}\n`;

    return output;
  }
}

// Export a singleton instance for convenience
export const benchmarkFormatter = new BenchmarkFormatter();
