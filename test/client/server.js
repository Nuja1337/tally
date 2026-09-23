// Runs the real Worker from wrangler.jsonc (static assets + API + a fresh local D1) for Node-side tests.
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

export const INVITE = 'test-invite';

export async function startServer() {
  const server = createTestHarness({ root: fileURLToPath(new URL('../..', import.meta.url)), workers: [{ configPath: './wrangler.jsonc', secrets: { INVITE_CODE: INVITE } }] });
  const { url } = await server.listen();
  await server.getWorker().applyD1Migrations('DB');
  const base = url.href.replace(/\/$/, '');
  const api = async (method, path, { key, body } = {}) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-tally-format': '5', ...(key ? { authorization: 'Bearer ' + key } : {}) }, body: body == null ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, headers: r.headers, text, json: text ? JSON.parse(text) : null };
  };
  return { server, base, api, close: () => server.close() };
}
