// Tunnel-facing bridge. Credentials stay on the Mac; only MCP methods are forwarded.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {Store} from '../src/store.js';
import path from 'node:path';
import os from 'node:os';
const store=new Store(process.env.FINANCE_DATA_DIR||path.join(os.homedir(),'Library/Application Support/OpenFinanceDesktop'));
const client=new Client({name:'open-finance-bridge',version:'1.0.0'});
await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4318/mcp'),{requestInit:{headers:{Authorization:'Bearer '+store.data.mcpToken}}}));
const server=new Server({name:'open-finance-desktop',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>client.listTools());
server.setRequestHandler(CallToolRequestSchema,async req=>client.callTool(req.params));
await server.connect(new StdioServerTransport());
process.on('SIGTERM',async()=>{await client.close();await server.close();process.exit(0);});
