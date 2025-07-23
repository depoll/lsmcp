import { describe, it, expect } from '@jest/globals';
import { EfficiencyMeasurement } from './utils.js';

describe('LSP Efficiency Benchmarks', () => {
  it('should demonstrate context reduction vs file reading', () => {
    // Simulate finding definition with file reading
    const fileReading = new EfficiencyMeasurement();
    
    // Read 5 files to find definition
    for (let i = 0; i < 5; i++) {
      fileReading.recordOperation(`read file ${i}`);
      fileReading.recordContext(2500); // ~10KB per file
    }
    
    const fileMetrics = fileReading.finish();
    
    // Simulate LSP approach
    const lspApproach = new EfficiencyMeasurement();
    lspApproach.recordOperation('lsp.textDocument/definition');
    lspApproach.recordContext(50); // Just the definition location
    
    const lspMetrics = lspApproach.finish();
    
    const comparison = EfficiencyMeasurement.compareToBaseline(lspMetrics, fileMetrics);
    
    expect(comparison.contextReduction).toBeGreaterThan(95); // >95% reduction
    expect(comparison.operationReduction).toBeGreaterThan(75); // >75% fewer operations
  });

  it('should demonstrate efficiency of symbol search', () => {
    // Simulate grep-based symbol search
    const grepApproach = new EfficiencyMeasurement();
    
    // Grep through 20 files
    for (let i = 0; i < 20; i++) {
      grepApproach.recordOperation(`grep file ${i}`);
      grepApproach.recordContext(500); // Context from grep results
    }
    
    const grepMetrics = grepApproach.finish();
    
    // Simulate LSP workspace symbol search
    const lspApproach = new EfficiencyMeasurement();
    lspApproach.recordOperation('lsp.workspace/symbol');
    lspApproach.recordContext(200); // Symbol list
    
    const lspMetrics = lspApproach.finish();
    
    const comparison = EfficiencyMeasurement.compareToBaseline(lspMetrics, grepMetrics);
    
    expect(comparison.contextReduction).toBeGreaterThan(90); // >90% reduction
    expect(comparison.operationReduction).toBeGreaterThan(90); // >90% fewer operations
  });

  it('should measure connection pooling efficiency', () => {
    // Without pooling - new connection each time
    const withoutPooling = new EfficiencyMeasurement();
    
    for (let i = 0; i < 5; i++) {
      withoutPooling.recordOperation('spawn language server');
      withoutPooling.recordOperation('initialize connection');
      withoutPooling.recordOperation('shutdown server');
      withoutPooling.recordContext(100); // Initialization overhead
    }
    
    const withoutPoolingMetrics = withoutPooling.finish();
    
    // With pooling - reuse connection
    const withPooling = new EfficiencyMeasurement();
    withPooling.recordOperation('spawn language server');
    withPooling.recordOperation('initialize connection');
    withPooling.recordContext(100); // One-time initialization
    
    // Reuse connection 4 times
    for (let i = 0; i < 4; i++) {
      withPooling.recordOperation('reuse connection');
    }
    
    const withPoolingMetrics = withPooling.finish();
    
    const comparison = EfficiencyMeasurement.compareToBaseline(
      withPoolingMetrics, 
      withoutPoolingMetrics
    );
    
    expect(comparison.operationReduction).toBeGreaterThanOrEqual(60); // >=60% fewer operations
    expect(comparison.contextReduction).toBeGreaterThan(75); // >75% less context
  });
});