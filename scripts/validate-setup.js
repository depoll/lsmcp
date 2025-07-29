#!/usr/bin/env node

/**
 * Validation script to check if all dependencies and tools are properly installed
 * Run this after 'npm install' to verify the setup
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const checks = [
  {
    name: 'Node modules directory',
    check: () => existsSync('node_modules'),
    error: 'node_modules directory not found. Run: npm install'
  },
  {
    name: 'ESLint executable',
    check: () => existsSync('node_modules/.bin/eslint'),
    error: 'ESLint not installed. Run: npm install'
  },
  {
    name: 'Prettier executable', 
    check: () => existsSync('node_modules/.bin/prettier'),
    error: 'Prettier not installed. Run: npm install'
  },
  {
    name: '@types/node package',
    check: () => existsSync('node_modules/@types/node'),
    error: '@types/node not installed. Run: npm install'
  },
  {
    name: 'TypeScript compilation',
    check: () => {
      try {
        execSync('npx tsc --noEmit --skipLibCheck', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },
    error: 'TypeScript compilation failed. Check tsconfig.json or run: npm install'
  }
];

console.log('🔍 Validating project setup...\n');

let allPassed = true;

for (const check of checks) {
  process.stdout.write(`Checking ${check.name}... `);
  
  try {
    if (check.check()) {
      console.log('✅');
    } else {
      console.log('❌');
      console.log(`   Error: ${check.error}`);
      allPassed = false;
    }
  } catch (error) {
    console.log('❌');
    console.log(`   Error: ${check.error}`);
    console.log(`   Details: ${error.message}`);
    allPassed = false;
  }
}

console.log();

if (allPassed) {
  console.log('✅ All checks passed! The project is ready for development.');
  console.log('   You can now run: npm run lint, npm run type-check, etc.');
} else {
  console.log('❌ Some checks failed. Please fix the issues above.');
  console.log('   Most likely solution: npm install');
  process.exit(1);
}