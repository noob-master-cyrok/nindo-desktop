import { localIsoDate, statuses } from '../src/domain/planner';
import { buildReport, listProjects, listTasks, type NindoData, type ReportArgs, type TaskArgs } from './report';

/// The Nindo connector as a hosted MCP server (Supabase Edge Function
/// `nindo-mcp`), for Claude on the web, phone and any computer. Claude signs
/// the person in through Supabase Auth's OAuth 2.1 server (consent on the
/// desktop site); each request carries that person's access token, and every
/// read goes through PostgREST with it, so row-level security limits it to
/// their own rows. Read only. Streamable HTTP, stateless, JSON responses.

export interface Env {
  supabaseUrl: string;
  anonKey: string;
  /// Public URL of this function, e.g. https://<ref>.supabase.co/functions/v1/nindo-mcp
  selfUrl: string;
  /// The person's local time zone; reports count days in it.
  timeZone?: string;
  fetch?: typeof fetch;
}

const tools = [
  {
    name: 'nindo_report',
    title: 'Nindo report',
    description:
      "The signed-in person's work in Nindo for a day, week (Sunday to Saturday) or month: hours worked, breaks, time at work, time per project, tasks finished and in progress, and their own day notes. Can cover only some projects or labels and leave tasks out. Returns facts to write a report from; use only these facts.",
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['day', 'week', 'month'] },
        date: { type: 'string', description: 'Any day inside the period, YYYY-MM-DD. Leave out for today.' },
        projects: { type: 'array', items: { type: 'string' }, description: 'Only these projects (names as in Nindo, or "No project"). Leave out for all.' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Only tasks with one of these labels.' },
        exclude_tasks: { type: 'array', items: { type: 'string' }, description: 'Task titles to leave out of the report.' },
      },
      required: ['period'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'nindo_tasks',
    title: 'Nindo tasks',
    description: "The signed-in person's Nindo tasks with status, project, labels and due date. Filter by status, project or words.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', ...statuses], description: 'open = not done or cancelled' },
        project: { type: 'string', description: 'Project name, or "No project"' },
        query: { type: 'string', description: 'Words in the title, description or labels' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'nindo_projects',
    title: 'Nindo projects',
    description: "The signed-in person's Nindo projects and how many tasks are open in each.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'www-authenticate, mcp-session-id',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors, ...headers } });

/// Today's date where the person is (the function itself runs in UTC).
function todayIn(timeZone: string | undefined): string {
  if (!timeZone) return localIsoDate(new Date());
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return parts;
}

/// Milliseconds to add to a UTC instant to read it as wall-clock time in
/// [timeZone] (Kathmandu: +5:45).
function zoneOffset(ms: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - Math.floor(ms / 1000) * 1000;
}

/// The summary code counts days in the runtime's local time, which is UTC on
/// the server. Moving every instant by the person's offset makes those days
/// the person's days.
export function inZone(data: NindoData, timeZone: string | undefined): NindoData {
  if (!timeZone) return data;
  const at = (ms: number | null) => (ms == null ? ms : ms + zoneOffset(ms, timeZone));
  return {
    ...data,
    tasks: data.tasks.map((t) => ({ ...t, completed_at_ms: at(t.completed_at_ms) })),
    time: {
      ...data.time,
      sessions: data.time.sessions.map((x) => ({ ...x, started_at_ms: at(x.started_at_ms)! })),
      runs: data.time.runs.map((x) => ({ ...x, started_at_ms: at(x.started_at_ms)!, ended_at_ms: at(x.ended_at_ms)! })),
      attendance: data.time.attendance.map((x) => ({ ...x, check_in_ms: at(x.check_in_ms), check_out_ms: at(x.check_out_ms) })),
    },
  };
}

async function rows<T>(env: Env, token: string, table: string): Promise<T[]> {
  const f = env.fetch ?? fetch;
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await f(`${env.supabaseUrl}/rest/v1/${table}?select=*&deleted_at_ms=is.null&order=id&offset=${from}&limit=1000`, {
      headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Reading ${table} failed (${res.status}).`);
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function load(env: Env, token: string): Promise<NindoData> {
  const [tasks, projects, sessions, breaks, runs, attendance, dayNotes] = await Promise.all([
    rows<NindoData['tasks'][number]>(env, token, 'planner_tasks'),
    rows<NindoData['projects'][number]>(env, token, 'planner_projects'),
    rows<NindoData['time']['sessions'][number]>(env, token, 'planner_sessions'),
    rows<NindoData['time']['breaks'][number]>(env, token, 'planner_breaks'),
    rows<NindoData['time']['runs'][number]>(env, token, 'planner_break_runs'),
    rows<NindoData['time']['attendance'][number]>(env, token, 'planner_attendance'),
    rows<{ id: string; note: string }>(env, token, 'planner_day_notes'),
  ]);
  return { tasks, projects, time: { sessions, breaks, runs, attendance }, notes: Object.fromEntries(dayNotes.map((n) => [n.id, n.note])) };
}

/// The signed-in user for [token], or null when it is missing, expired or
/// not issued by this project.
async function userFor(env: Env, token: string): Promise<{ id: string } | null> {
  const res = await (env.fetch ?? fetch)(`${env.supabaseUrl}/auth/v1/user`, { headers: { apikey: env.anonKey, Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id ? { id: user.id } : null;
}

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> };

async function answer(msg: Rpc, env: Env, token: string): Promise<unknown | null> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (msg.id === undefined) return null; // A notification: nothing to answer.
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'nindo', title: 'Nindo', version: '1.0.0' },
        instructions: 'Read-only access to the signed-in person’s Nindo tasks, worked time and day notes, for day, week and month reports.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools });
    case 'tools/call': {
      const name = msg.params?.name;
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      const today = todayIn(env.timeZone);
      try {
        const data = inZone(await load(env, token), env.timeZone);
        const text =
          name === 'nindo_report'
            ? buildReport(data, args as unknown as ReportArgs, today)
            : name === 'nindo_tasks'
              ? listTasks(data, args as TaskArgs, today)
              : name === 'nindo_projects'
                ? listProjects(data)
                : null;
        if (text === null) return fail(-32602, `Unknown tool ${String(name)}`);
        return reply({ content: [{ type: 'text', text }] });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: e instanceof Error ? e.message : 'Reading Nindo failed.' }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const metadataUrl = `${env.selfUrl}/.well-known/oauth-protected-resource`;
  if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return json({
      resource: env.selfUrl,
      authorization_servers: [`${env.supabaseUrl}/auth/v1`],
      bearer_methods_supported: ['header'],
      resource_name: 'Nindo',
    });
  }
  if (req.method !== 'POST') return json({ error: 'Use POST for MCP requests.' }, 405, { Allow: 'POST, OPTIONS' });

  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const unauthorized = () =>
    json({ error: 'Sign in to Nindo to use this connector.' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"` });
  if (!token || !(await userFor(env, token))) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  const batch = Array.isArray(body);
  const messages: unknown[] = batch ? (body as unknown[]) : [body];
  const replies = (await Promise.all(messages.map((m) => answer(m as Rpc, env, token)))).filter((r) => r !== null);
  if (!replies.length) return new Response(null, { status: 202, headers: cors });
  return json(batch ? replies : replies[0]);
}
