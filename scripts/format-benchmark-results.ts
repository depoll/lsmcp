#!/usr/bin/env tsx
/**
 * Script to format benchmark results for CI/CD
 * Reads benchmark JSON and outputs formatted markdown
 */

import * as fs from 'fs/promises';
import { BenchmarkFormatter, type BenchmarkResults } from '../tests/efficiency/formatter.js';

async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  const currentFile = args.find(arg => arg.startsWith('--current='))?.split('=')[1];
  const baseFile = args.find(arg => arg.startsWith('--base='))?.split('=')[1];
  const outputFile = args.find(arg => arg.startsWith('--output='))?.split('=')[1];
  const format = args.find(arg => arg.startsWith('--format='))?.split('=')[1] || 'markdown';
  
  if (!currentFile) {
    console.error('Usage: format-benchmark-results.ts --current=<file> [--base=<file>] [--output=<file>] [--format=markdown|console]');
    process.exit(1);
  }
  
  try {
    // Read current benchmark results
    const currentData = await fs.readFile(currentFile, 'utf-8');
    const current: BenchmarkResults = JSON.parse(currentData);
    
    // Read base benchmark results if provided
    let base: BenchmarkResults | undefined;
    if (baseFile) {
      try {
        const baseData = await fs.readFile(baseFile, 'utf-8');
        base = JSON.parse(baseData);
      } catch (error) {
        console.warn(`Warning: Could not read base file ${baseFile}:`, error);
      }
    }
    
    // Format the results
    const formatter = new BenchmarkFormatter();
    let formatted: string;
    
    if (format === 'console') {
      formatted = formatter.formatForConsole(current);
    } else {
      formatted = formatter.formatForPR({ current, base });
    }
    
    // Output the results
    if (outputFile) {
      await fs.writeFile(outputFile, formatted);
      console.log(`Formatted results written to ${outputFile}`);
    } else {
      console.log(formatted);
    }
    
    // Exit with non-zero if not all scenarios passed
    const allPassed = current.results.every(r => r.passedExpectations);
    process.exit(allPassed ? 0 : 1);
    
  } catch (error) {
    console.error('Error formatting benchmark results:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});