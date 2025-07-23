#!/usr/bin/env node

import { execSync } from 'child_process';

console.log('🔍 Running code quality checks...');

let lintExitCode = 0;
let lintOutput = '';
let typeCheckExitCode = 0;
let typeCheckOutput = '';

// Run linting
try {
  lintOutput = execSync('npm run lint', { encoding: 'utf8' });
} catch (error) {
  lintExitCode = error.status || 1;
  lintOutput = error.stdout || error.message;
}

// Run type checking
try {
  typeCheckOutput = execSync('npm run type-check', { encoding: 'utf8' });
} catch (error) {
  typeCheckExitCode = error.status || 1;
  typeCheckOutput = error.stdout || error.message;
}

// Run formatting
try {
  execSync('npm run format', { stdio: 'inherit' });
} catch (error) {
  // Ignore formatting errors
}

// If both pass, exit successfully
if (lintExitCode === 0 && typeCheckExitCode === 0) {
  console.log('✅ All checks passed!');
  process.exit(0);
}

// If there are errors, format them
console.log('❌ Code quality issues detected:');
console.log('');

if (lintExitCode !== 0) {
  console.log('## Linting Errors:');
  const errors = lintOutput.split('\n').filter(line => 
    line.includes('error') || line.includes('warning')
  ).slice(0, 20);
  errors.forEach(error => console.log(error));
  console.log('');
}

if (typeCheckExitCode !== 0) {
  console.log('## Type Checking Errors:');
  const errors = typeCheckOutput.split('\n').filter(line => 
    line.includes('error') || /TS\d+/.test(line)
  ).slice(0, 20);
  errors.forEach(error => console.log(error));
  console.log('');
}

console.log('Please fix the above issues before continuing.');
process.exit(2);