import { z } from 'zod';
import { CallToolRequest } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool, isBatchable, isStreamable } from './base.js';
import { logger } from '../utils/logger.js';

export interface ToolRegistration {
  tool: BaseTool;
  metadata: {
    name: string;
    description: string;
    inputSchema: z.ZodSchema<unknown>;
  };
}

export class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();
  private logger = logger.child({ component: 'ToolRegistry' });

  register(tool: BaseTool): void {
    const metadata = tool.getMetadata();

    if (this.tools.has(metadata.name)) {
      throw new Error(`Tool ${metadata.name} is already registered`);
    }

    this.tools.set(metadata.name, {
      tool,
      metadata,
    });

    this.logger.info(
      {
        name: metadata.name,
        batchable: isBatchable(tool),
        streamable: isStreamable(tool),
      },
      'Tool registered'
    );
  }

  unregister(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) {
      this.logger.info({ name }, 'Tool unregistered');
    }
    return removed;
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolRegistration[] {
    return Array.from(this.tools.values());
  }

  async execute(request: CallToolRequest): Promise<unknown> {
    const { name, arguments: args } = request.params;
    const registration = this.tools.get(name);

    if (!registration) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const { tool } = registration;

    this.logger.debug({ name, args }, 'Executing tool');

    try {
      // Check if this is a batch request
      if (
        args &&
        typeof args === 'object' &&
        'batch' in args &&
        Array.isArray((args as Record<string, unknown>)['batch'])
      ) {
        if (!isBatchable(tool)) {
          throw new Error(`Tool ${name} does not support batch operations`);
        }

        const batch = (args as Record<string, unknown>)['batch'];
        if (!Array.isArray(batch)) {
          throw new Error('Batch parameter must be an array');
        }
        return await tool.executeBatch(batch);
      }

      // Regular execution
      return await tool.execute(args);
    } catch (error) {
      this.logger.error({ error, name, args }, 'Tool execution failed');
      throw error;
    }
  }

  async executeWithProgress(
    request: CallToolRequest,
    onProgress: (partial: unknown) => void
  ): Promise<unknown> {
    const { name, arguments: args } = request.params;
    const registration = this.tools.get(name);

    if (!registration) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const { tool } = registration;

    if (!isStreamable(tool)) {
      // Fall back to regular execution
      return this.execute(request);
    }

    this.logger.debug({ name, args }, 'Executing tool with streaming');

    try {
      return await tool.executeStream(args, onProgress);
    } catch (error) {
      this.logger.error({ error, name, args }, 'Streaming tool execution failed');
      throw error;
    }
  }

  getToolSchemas(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> {
    return this.getAll().map(({ metadata }) => ({
      name: metadata.name,
      description: metadata.description,
      inputSchema: this.zodToJsonSchema(metadata.inputSchema),
    }));
  }

  private zodToJsonSchema(schema: z.ZodSchema<unknown>): Record<string, unknown> {
    // This is a simplified conversion - in production, use a proper library
    // like zod-to-json-schema
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodType = value;
      properties[key] = this.zodTypeToJsonSchema(zodType);

      if (!zodType.isOptional()) {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  private zodTypeToJsonSchema(zodType: z.ZodTypeAny): Record<string, unknown> {
    if (zodType instanceof z.ZodString) {
      return { type: 'string', description: zodType.description };
    } else if (zodType instanceof z.ZodNumber) {
      return { type: 'number', description: zodType.description };
    } else if (zodType instanceof z.ZodBoolean) {
      return { type: 'boolean', description: zodType.description };
    } else if (zodType instanceof z.ZodEnum) {
      return {
        type: 'string',
        enum: (zodType as z.ZodEnum<[string, ...string[]]>)._def.values,
        description: zodType.description,
      };
    } else if (zodType instanceof z.ZodObject) {
      return {
        type: 'object',
        properties: this.zodToJsonSchema(zodType)['properties'] as Record<string, unknown>,
        description: zodType.description,
      };
    } else if (zodType instanceof z.ZodArray) {
      return {
        type: 'array',
        items: this.zodTypeToJsonSchema((zodType as z.ZodArray<z.ZodTypeAny>)._def.type),
        description: zodType.description,
      };
    } else if (zodType instanceof z.ZodOptional) {
      return this.zodTypeToJsonSchema((zodType as z.ZodOptional<z.ZodTypeAny>)._def.innerType);
    } else if (zodType instanceof z.ZodDefault) {
      const zodDefault = zodType as z.ZodDefault<z.ZodTypeAny>;
      const schema = this.zodTypeToJsonSchema(zodDefault._def.innerType);
      return { ...schema, default: zodDefault._def.defaultValue() };
    }

    // Fallback
    return { type: 'string' };
  }
}
