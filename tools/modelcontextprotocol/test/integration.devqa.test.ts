import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const KEY = process.env.SHIPPO_DEVQA_TEST_KEY;

test('dev-qa: lists the four meta-tools via the bridge', { skip: !KEY }, async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js', '--url=https://mcp.shippodev.com', `--api-key=${KEY}`],
  });
  const client = new Client({ name: 'shippo-mcp-it', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'shippo_describe_tool',
    'shippo_list_tools',
    'shippo_read_execute_tool',
    'shippo_write_execute_tool',
  ]);
  await client.close();
});
