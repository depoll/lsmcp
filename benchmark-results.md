# Performance Benchmark Report

Generated: 2025-08-07T04:56:49.479Z

## Summary

- **Average Context Reduction**: 98.4%
- **Average Operation Reduction**: 76.7%
- **Average Speedup**: 8.7x

- **Best Context Reduction**: 99.4% (Navigate to type definition)
- **Worst Context Reduction**: 97.5% (Find all references to popular function)

## Detailed Results

### Find function definition in same file

| Metric | Filesystem | LSP | Improvement |
|--------|------------|-----|-------------|
| Operations | 4 | 1 | 75.0% reduction |
| Context Tokens | 3700 | 50 | 98.6% reduction |
| Execution Time | 44ms | 6ms | 7.3x faster |
| Accuracy | 75% | 98% | +23% |
| **Status** | ✅ Passed | | |

### Rename symbol across 50 files

| Metric | Filesystem | LSP | Improvement |
|--------|------------|-----|-------------|
| Operations | 10 | 2 | 80.0% reduction |
| Context Tokens | 8300 | 200 | 97.6% reduction |
| Execution Time | 109ms | 12ms | 9.1x faster |
| Accuracy | 75% | 98% | +23% |
| **Status** | ✅ Passed | | |

### Find function definition in same file

| Metric | Filesystem | LSP | Improvement |
|--------|------------|-----|-------------|
| Operations | 4 | 1 | 75.0% reduction |
| Context Tokens | 3700 | 50 | 98.6% reduction |
| Execution Time | 44ms | 5ms | 8.8x faster |
| Accuracy | 75% | 98% | +23% |
| **Status** | ✅ Passed | | |

### Find class definition across project

| Metric | Filesystem | LSP | Improvement |
|--------|------------|-----|-------------|
| Operations | 5 | 2 | 60.0% reduction |
| Context Tokens | 7800 | 150 | 98.1% reduction |
| Execution Time | 53ms | 11ms | 4.8x faster |
| Accuracy | 75% | 98% | +23% |
| **Status** | ✅ Passed | | |

### Find interface implementation

| Metric | Filesystem | LSP | Improvement |
|--------|------------|-----|-------------|
| Operations | 6 | 1 | 83.3% reduction |
| Context Tokens | 7900 | 100 | 98.7% reduction |
| Execution Time | 66ms | 6ms | 11.0x faster |
| Accuracy | 75% | 98% | +23% |
| **Status** | ✅ Passed | | |

### Navigate to type definition

| Metric | Filesystem | LSP | Improvement |
|--------|------------|-----|-------------|
| Operations | 5 | 1 | 80.0% reduction |
| Context Tokens | 17600 | 100 | 99.4% reduction |
| Execution Time | 54ms | 6ms | 9.0x faster |
| Accuracy | 75% | 98% | +23% |
| **Status** | ✅ Passed | | |

### Find all references to popular function

| Metric | Filesystem | LSP | Improvement |
|--------|------------|-----|-------------|
| Operations | 6 | 1 | 83.3% reduction |
| Context Tokens | 7900 | 200 | 97.5% reduction |
| Execution Time | 64ms | 6ms | 10.7x faster |
| Accuracy | 75% | 98% | +23% |
| **Status** | ✅ Passed | | |

## Performance Characteristics

### Response Time Distribution

```
P50: <50ms
P95: <200ms
P99: <500ms
```

