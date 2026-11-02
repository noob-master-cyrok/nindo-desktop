import { describe, expect, it } from 'vitest';
import { handle, inZone, type Env } from '../mcp/remote';
import type { NindoData } from '../mcp/report';

const supabaseUrl = 'https://ref.supabase.co';
const now = Date.now();
const tables: Record<string, unknown[]> = {
  planner_tasks: [
    { id: 't1', parent_id: null, project_id: 'p1', title: 'Send the invoice', description: '', labels: '', status: 'done', priority: 0, due_date: null, sort_order: 0, completed_at_ms: now, deleted_at_ms: null },
  ],
  planner_projects: [{ id: 'p1', name: 'Work', color: 3, archived: false, deleted_at_ms: null }],
  planner_sessions: [],
  planner_breaks: [],
  planner_break_runs: [],
  planner_attendance: [],
  planner_day_notes: [],
};

/// PostgREST and Auth as the function sees them: only "good-token" is valid.
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const auth = new Headers(init?.headers).get('Authorization');
  if (auth !== 'Bearer good-token') return new Response('{}', { status: 401 });
  if (url.pathname === '/auth/v1/user') return Response.json({ id: 'u1' });
  const table = url.pathname.split('/').pop()!;
  return Response.json(tables[table] ?? []);
}) as typeof fetch;

const env: Env = { supabaseUrl, anonKey: 'anon', selfUrl: `${supabaseUrl}/functions/v1/nindo-mcp`, fetch: fakeFetch };
const rpc = (body: unknown, token = 'good-token') =>
  handle(new Request(env.selfUrl, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env);

describe('hosted Nindo connector', () => {
  it('points Claude at Supabase Auth to sign in', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, 'bad');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${env.selfUrl}/.well-known/oauth-protected-resource"`);
    const meta = await (await handle(new Request(`${env.selfUrl}/.well-known/oauth-protected-resource`), env)).json();
    expect(meta).toMatchObject({ resource: env.selfUrl, authorization_servers: [`${supabaseUrl}/auth/v1`] });
  });

  it('answers initialize, tools/list and a report with the person’s token', async () => {
    const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json();
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'nindo' }, capabilities: { tools: {} } });
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['nindo_report', 'nindo_tasks', 'nindo_projects']);
    const call = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nindo_report', arguments: { period: 'day' } } })).json();
    expect(call.result.content[0].text).toContain('- Send the invoice [Work]');
    const unknown = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'nope' })).json();
    expect(unknown.error.code).toBe(-32601);
  });

  it('reads instants as wall-clock time where the person lives', () => {
    const at = Date.UTC(2026, 10, 1, 20, 0);
    const data = { tasks: [{ completed_at_ms: at }], projects: [], time: { sessions: [{ started_at_ms: at }], breaks: [], runs: [], attendance: [] } } as unknown as NindoData;
    const shifted = inZone(data, 'Asia/Kathmandu');
    expect(shifted.tasks[0]!.completed_at_ms! - at).toBe((5 * 60 + 45) * 60_000);
    expect(shifted.time.sessions[0]!.started_at_ms - at).toBe((5 * 60 + 45) * 60_000);
    expect(inZone(data, undefined)).toBe(data);
  });
});
