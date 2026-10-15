/** Test helpers for the MCP server (not bundled: only the tests import it). */
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** A port nothing listens on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

/** An SDK client connected over Streamable HTTP with the bearer token. */
export async function connectClient(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'extrudo-test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

/** A raw POST, for the refusals the SDK client can't make. */
export function post(
  url: string,
  headers: Record<string, string>,
  body = '{"jsonrpc":"2.0","id":1,"method":"ping"}',
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body,
  });
}
