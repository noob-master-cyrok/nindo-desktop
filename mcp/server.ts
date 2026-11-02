import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { localIsoDate, statuses } from '../src/domain/planner';
import { cleanCode, parseSignInLink } from '../src/domain/signInLink';
import { buildReport, listProjects, listTasks, type NindoData } from './report';

/// Nindo for Claude: a read-only MCP server on this computer. It signs in as
/// the Nindo account once (an emailed code), keeps that session in
/// ~/.config/nindo-mcp, and reads only that account's rows through the same
/// row-level security as the desktop app. Claude Code and the Claude app
/// start it themselves; nothing here writes to Nindo.
///
///   node nindo-mcp.mjs login    sign in (asks for the email and the code)
///   node nindo-mcp.mjs logout   forget the session
///   node nindo-mcp.mjs check    print this week's report, to test
///   node nindo-mcp.mjs          the MCP server, over stdio

const dir = process.env.NINDO_MCP_HOME ?? join(homedir(), '.config', 'nindo-mcp');
const sessionFile = join(dir, 'session.json');
const configFile = join(dir, 'config.json');

function config(): { url: string; anonKey: string } {
  const fromEnv = { url: process.env.NINDO_SUPABASE_URL, anonKey: process.env.NINDO_SUPABASE_ANON_KEY };
  if (fromEnv.url && fromEnv.anonKey) return fromEnv as { url: string; anonKey: string };
  if (existsSync(configFile)) return JSON.parse(readFileSync(configFile, 'utf8')) as { url: string; anonKey: string };
  throw new Error(`No Supabase settings. Put {"url","anonKey"} in ${configFile}.`);
}

/// supabase-js keeps the session (and every refreshed token) in one file
/// only this user can read.
const fileStorage = {
  getItem(key: string): string | null {
    if (!existsSync(sessionFile)) return null;
    const all = JSON.parse(readFileSync(sessionFile, 'utf8')) as Record<string, string>;
    return all[key] ?? null;
  },
  setItem(key: string, value: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const all = existsSync(sessionFile) ? (JSON.parse(readFileSync(sessionFile, 'utf8')) as Record<string, string>) : {};
    all[key] = value;
    writeFileSync(sessionFile, JSON.stringify(all), { mode: 0o600 });
    chmodSync(sessionFile, 0o600);
  },
  removeItem(key: string) {
    if (!existsSync(sessionFile)) return;
    const all = JSON.parse(readFileSync(sessionFile, 'utf8')) as Record<string, string>;
    delete all[key];
    writeFileSync(sessionFile, JSON.stringify(all), { mode: 0o600 });
  },
};

function client(): SupabaseClient {
  const { url, anonKey } = config();
  return createClient(url, anonKey, { auth: { storage: fileStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } });
}

/// Every live row of [table] the account can see, a page at a time (the API
/// returns at most 1000 rows per request).
async function rows<T>(db: SupabaseClient, table: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select('*').is('deleted_at_ms', null).range(from, from + 999);
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    out.push(...(data as T[]));
    if (data.length < 1000) return out;
  }
}

async function load(db: SupabaseClient): Promise<NindoData> {
  const { data: auth, error } = await db.auth.getSession();
  if (error || !auth.session) throw new Error('Not signed in to Nindo. Run the connector with "login" in a terminal first.');
  if (auth.session.expires_at && auth.session.expires_at * 1000 < Date.now() + 60_000) {
    const { error: refreshError } = await db.auth.refreshSession();
    if (refreshError) throw new Error(`The Nindo sign-in has expired (${refreshError.message}). Run "login" again.`);
  }
  const [tasks, projects, sessions, breaks, runs, attendance, dayNotes] = await Promise.all([
    rows<NindoData['tasks'][number]>(db, 'planner_tasks'),
    rows<NindoData['projects'][number]>(db, 'planner_projects'),
    rows<NindoData['time']['sessions'][number]>(db, 'planner_sessions'),
    rows<NindoData['time']['breaks'][number]>(db, 'planner_breaks'),
    rows<NindoData['time']['runs'][number]>(db, 'planner_break_runs'),
    rows<NindoData['time']['attendance'][number]>(db, 'planner_attendance'),
    rows<{ id: string; note: string }>(db, 'planner_day_notes'),
  ]);
  const notes = Object.fromEntries(dayNotes.map((n) => [n.id, n.note]));
  return { tasks, projects, time: { sessions, breaks, runs, attendance }, notes };
}

const today = () => localIsoDate(new Date());
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const failed = (e: unknown) => ({ ...text(e instanceof Error ? e.message : String(e)), isError: true });

async function serve() {
  const db = client();
  const server = new McpServer({ name: 'nindo', version: '1.0.0' });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    'nindo_report',
    {
      title: 'Nindo report',
      description:
        "Safu's work in Nindo for a day, week (Sunday to Saturday) or month: hours worked, breaks, time at work, time per project, tasks finished and in progress. Can cover only some projects or labels and leave tasks out. Returns facts to write a report from; use only these facts.",
      inputSchema: {
        period: z.enum(['day', 'week', 'month']).describe('day, week or month'),
        date: z.string().optional().describe('Any day inside the period, YYYY-MM-DD. Leave out for today.'),
        projects: z.array(z.string()).optional().describe('Only these projects (names as in Nindo, or "No project"). Leave out for all.'),
        labels: z.array(z.string()).optional().describe('Only tasks with one of these labels.'),
        exclude_tasks: z.array(z.string()).optional().describe('Task titles to leave out of the report.'),
      },
      annotations: { title: 'Nindo report', ...readOnly },
    },
    async (args) => {
      try {
        return text(buildReport(await load(db), args, today()));
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    'nindo_tasks',
    {
      title: 'Nindo tasks',
      description: "Safu's Nindo tasks with status, project, labels and due date. Filter by status, project or words.",
      inputSchema: {
        status: z.enum(['open', ...statuses]).optional().describe('open = not done or cancelled'),
        project: z.string().optional().describe('Project name, or "No project"'),
        query: z.string().optional().describe('Words in the title, description or labels'),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { title: 'Nindo tasks', ...readOnly },
    },
    async (args) => {
      try {
        return text(listTasks(await load(db), args, today()));
      } catch (e) {
        return failed(e);
      }
    },
  );

  server.registerTool(
    'nindo_projects',
    { title: 'Nindo projects', description: "Safu's Nindo projects and how many tasks are open in each.", annotations: { title: 'Nindo projects', ...readOnly } },
    async () => {
      try {
        return text(listProjects(await load(db)));
      } catch (e) {
        return failed(e);
      }
    },
  );

  await server.connect(new StdioServerTransport());
}

/// Signs in with the emailed link or code. Opening the link would sign in
/// the browser instead (and use it up), so the link is copied and pasted here.
async function login() {
  const db = client();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = (await rl.question('Nindo email: ')).trim();
    const fresh = (await rl.question('Send a new sign-in email? [Y/n] (n = use one you already have and have not opened): ')).trim().toLowerCase();
    if (fresh !== 'n' && fresh !== 'no') {
      const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) throw new Error(error.status === 429 ? 'Too many emails sent. Wait a while, or run login again and answer n to use the last email.' : error.message);
      console.log('Sent. In the email, right-click the sign-in link and choose Copy Link. Do not open it.');
    }
    const answer = (await rl.question('Paste the link (or type the code): ')).trim();
    const code = cleanCode(answer);
    const link = code ? null : parseSignInLink(answer);
    if (!code && !link) throw new Error('That is neither a Nindo sign-in link nor a code. Copy the whole link from the email.');
    const { error } = code
      ? await db.auth.verifyOtp({ email, token: code, type: 'email' })
      : link!.kind === 'token'
        ? await db.auth.verifyOtp({ token_hash: link!.tokenHash, type: link!.type })
        : await db.auth.setSession({ access_token: link!.accessToken, refresh_token: link!.refreshToken });
    if (error) throw new Error(`That did not work (${error.message}). A link works once and for about an hour; run login again for a new one.`);
    const { data } = await db.auth.getUser();
    console.log(`Signed in as ${data.user?.email ?? email}. The session is kept in ${sessionFile}.`);
  } finally {
    rl.close();
  }
}

async function main() {
  const command = process.argv[2];
  if (command === 'login') return login();
  if (command === 'logout') {
    // Ends this session on the server too, then forgets it here.
    await client().auth.signOut({ scope: 'local' }).catch(() => undefined);
    rmSync(sessionFile, { force: true });
    return console.log('Signed out on this computer.');
  }
  if (command === 'check') return console.log(buildReport(await load(client()), { period: 'week' }, today()));
  return serve();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
