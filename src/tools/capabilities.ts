/**
 * Tool capability declarations for MCP protocol optimization
 */

/**
 * Standard capabilities that tools can declare
 */
export interface ToolCapabilities {
  /** Supports processing multiple requests in a single call */
  supportsBatch: boolean;
  /** Supports streaming results incrementally */
  supportsStreaming: boolean;
  /** Supports request cancellation via AbortSignal */
  supportsCancellation: boolean;
  /** Has result caching enabled */
  cacheEnabled: boolean;
  /** Maximum number of items in a batch request */
  maxBatchSize?: number;
  /** Supports progress reporting during execution */
  supportsProgress: boolean;
  /** Average response time in milliseconds */
  avgResponseTime?: number;
}

/**
 * Tool capabilities for each MCP tool
 */
export const TOOL_CAPABILITIES: Record<string, ToolCapabilities> = {
  getCodeIntelligence: {
    supportsBatch: true,
    supportsStreaming: false,
    supportsCancellation: false,
    cacheEnabled: true,
    supportsProgress: false,
    avgResponseTime: 50,
  },
  navigate: {
    supportsBatch: true,
    supportsStreaming: false,
    supportsCancellation: false,
    cacheEnabled: true,
    supportsProgress: false,
    maxBatchSize: 100,
    avgResponseTime: 100,
  },
  findSymbols: {
    supportsBatch: true,
    supportsStreaming: false,
    supportsCancellation: false,
    cacheEnabled: true,
    supportsProgress: false,
    avgResponseTime: 200,
  },
  findUsages: {
    supportsBatch: true,
    supportsStreaming: true,
    supportsCancellation: false,
    cacheEnabled: false,
    supportsProgress: true,
    maxBatchSize: 50,
    avgResponseTime: 500,
  },
};

/**
 * Get capabilities for a tool
 */
export function getToolCapabilities(toolName: string): ToolCapabilities | undefined {
  return TOOL_CAPABILITIES[toolName];
}
