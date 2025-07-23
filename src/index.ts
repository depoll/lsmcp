#!/usr/bin/env node
import { LSMCPServer } from './server.js';
import pino from 'pino';

const logger = pino({ level: 'info' });

async function main(): Promise<void> {
  const server = new LSMCPServer();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    void (async () => {
      try {
        await server.stop();
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', error);
        process.exit(1);
      }
    })();
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    void (async () => {
      try {
        await server.stop();
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', error);
        process.exit(1);
      }
    })();
  });

  try {
    await server.start();
    logger.info('LSMCP server is running');
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('Unhandled error', error);
    process.exit(1);
  });
}

export { LSMCPServer } from './server.js';
