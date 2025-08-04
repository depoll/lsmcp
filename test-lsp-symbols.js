import { spawn } from 'child_process';
import { createInterface } from 'readline';

const lspProcess = spawn('typescript-language-server', ['--stdio']);

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

let messageId = 1;

function sendMessage(method, params) {
  const message = {
    jsonrpc: '2.0',
    id: messageId++,
    method,
    params
  };
  
  const content = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
  lspProcess.stdin.write(header + content);
}

lspProcess.stdout.on('data', (data) => {
  const lines = data.toString().split('\r\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('{')) {
      try {
        const response = JSON.parse(lines[i]);
        console.log('Response:', JSON.stringify(response, null, 2));
        
        if (response.result && response.id) {
          console.log(`\nResults for request ${response.id}:`);
          if (Array.isArray(response.result)) {
            console.log(`Found ${response.result.length} symbols`);
            response.result.slice(0, 5).forEach(sym => {
              console.log(`  - ${sym.name} (${sym.kind})`);
            });
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
});

// Initialize
sendMessage('initialize', {
  processId: process.pid,
  rootUri: `file://${process.cwd()}`,
  capabilities: {
    workspace: {
      symbol: {
        dynamicRegistration: true
      }
    }
  }
});

// Wait for initialization, then test queries
setTimeout(() => {
  console.log('\n=== Testing workspace symbol queries ===\n');
  
  console.log('1. Testing exact match: "ConnectionPool"');
  sendMessage('workspace/symbol', { query: 'ConnectionPool' });
  
  setTimeout(() => {
    console.log('\n2. Testing partial match: "Connection"');
    sendMessage('workspace/symbol', { query: 'Connection' });
  }, 1000);
  
  setTimeout(() => {
    console.log('\n3. Testing pattern: "*Tool"');
    sendMessage('workspace/symbol', { query: '*Tool' });
  }, 2000);
  
  setTimeout(() => {
    console.log('\n4. Testing empty query: ""');
    sendMessage('workspace/symbol', { query: '' });
  }, 3000);
  
  setTimeout(() => {
    console.log('\n5. Testing single letter: "C"');
    sendMessage('workspace/symbol', { query: 'C' });
  }, 4000);
  
  setTimeout(() => {
    process.exit(0);
  }, 5000);
}, 1000);