import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const mode = process.env.RUNTIME_FIXTURE_MODE;
const server = new McpServer({ name: 'runtime-fixture', version: '1' });
for (const name of ['discord_send_message', 'discord_send_typing', 'discord_wait_message']) {
  server.registerTool(name, { inputSchema: {} }, async () => ({ content: [] }));
}
if (mode === 'hang-ping') {
  server.server.setRequestHandler(PingRequestSchema, async () => new Promise(() => {}));
}
await server.connect(new StdioServerTransport());
if (mode !== 'no-ready') console.error('Discord Gateway 연결 완료. 봇이 온라인입니다.');
console.error(`Discord 수신: 1 → confidential message ${process.env.DISCORD_BOT_TOKEN}`);
if (mode === 'crash') setTimeout(() => process.exit(42), 100);
process.stdin.once('end', () => process.exit(0));
