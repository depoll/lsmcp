export interface EfficiencyMetrics {
  contextTokens: number;
  operationCount: number;
  executionTimeMs: number;
  memoryUsageMB: number;
}

export class EfficiencyMeasurement {
  private startTime: number;
  private startMemory: number;
  private operations: string[] = [];
  private contextSize = 0;

  constructor() {
    this.startTime = Date.now();
    this.startMemory = process.memoryUsage().heapUsed / 1024 / 1024;
  }

  recordOperation(operation: string): void {
    this.operations.push(operation);
  }

  recordContext(tokens: number): void {
    this.contextSize += tokens;
  }

  finish(): EfficiencyMetrics {
    const endTime = Date.now();
    const endMemory = process.memoryUsage().heapUsed / 1024 / 1024;

    return {
      contextTokens: this.contextSize,
      operationCount: this.operations.length,
      executionTimeMs: endTime - this.startTime,
      memoryUsageMB: endMemory - this.startMemory,
    };
  }

  static compareToBaseline(
    actual: EfficiencyMetrics,
    baseline: EfficiencyMetrics
  ): {
    contextReduction: number;
    operationReduction: number;
    speedImprovement: number;
  } {
    return {
      contextReduction: ((baseline.contextTokens - actual.contextTokens) / baseline.contextTokens) * 100,
      operationReduction: ((baseline.operationCount - actual.operationCount) / baseline.operationCount) * 100,
      speedImprovement: ((baseline.executionTimeMs - actual.executionTimeMs) / baseline.executionTimeMs) * 100,
    };
  }
}

export function estimateTokenCount(text: string): number {
  // Rough estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}