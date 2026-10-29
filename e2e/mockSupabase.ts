import type { Page, Route } from '@playwright/test';

/// A tiny stand-in for Supabase Auth and PostgREST, so the smoke test runs
/// the real built app without touching the live project. It copies the
/// server rules the app depends on: owner-only rows, a revision bumped on
/// every write, stale writes ignored, and duplicate ids refused (migration
/// 0005).
export class MockSupabase {
  readonly userId = '11111111-1111-4111-8111-111111111111';
  readonly email = 'tester@example.test';
  readonly tables: Record<string, Map<string, Record<string, unknown>>> = {
    planner_projects: new Map(),
    planner_tasks: new Map(),
    planner_links: new Map(),
    planner_activity: new Map(),
    planner_sessions: new Map(),
    planner_breaks: new Map(),
    planner_break_runs: new Map(),
    planner_attendance: new Map(),
  };
  private revision = 1000;

  constructor(readonly origin: string) {}

  seed(table: string, row: Record<string, unknown>) {
    this.tables[table]!.set(row.id as string, this.stamp({ ...row, owner_id: this.userId }));
  }

  /// A write from the phone: whole-row change, new revision.
  phoneWrite(table: string, id: string, changes: Record<string, unknown>) {
    const old = this.tables[table]!.get(id)!;
    this.tables[table]!.set(id, this.stamp({ ...old, ...changes }));
  }

  private stamp(row: Record<string, unknown>): Record<string, unknown> {
    return { ...row, revision: ++this.revision, server_updated_at: new Date().toISOString() };
  }

  session() {
    const encode = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const user = { id: this.userId, email: this.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
    return {
      access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: this.userId, role: 'authenticated', exp })}.sig`,
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: exp,
      user,
    };
  }

  async install(page: Page) {
    await page.route(`${this.origin}/**`, (route) => this.handle(route));
  }

  private filters(url: URL) {
    const out: [string, string, string][] = [];
    for (const [key, value] of url.searchParams) {
      if (['select', 'order', 'offset', 'limit', 'columns'].includes(key)) continue;
      const dot = value.indexOf('.');
      out.push([key, value.slice(0, dot), value.slice(dot + 1)]);
    }
    return out;
  }

  private matches(row: Record<string, unknown>, filters: [string, string, string][]) {
    return filters.every(([key, op, value]) => {
      const v = row[key];
      if (op === 'eq') return String(v) === value;
      if (op === 'gte') return Number(v) >= Number(value);
      if (op === 'is') return value === 'null' ? v == null : true;
      return true;
    });
  }

  private reply(route: Route, status: number, body: unknown, wantsObject: boolean) {
    const payload = wantsObject && Array.isArray(body) ? body[0] ?? null : body;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  }

  private async handle(route: Route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });

    if (url.pathname === '/auth/v1/otp') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (url.pathname === '/auth/v1/verify') {
      const body = request.postDataJSON() as { token: string };
      if (body.token !== '123456') {
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(this.session()) });
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (url.pathname === '/auth/v1/user') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(this.session().user) });
    }

    const match = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
    const table = match && this.tables[match[1]!];
    if (!table) return route.fulfill({ status: 404, body: '{}' });
    const wantsObject = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const filters = this.filters(url);

    if (method === 'GET') {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? 1000);
      const rows = [...table.values()]
        .filter((r) => this.matches(r, filters))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .slice(offset, offset + limit);
      return this.reply(route, 200, rows, wantsObject);
    }
    if (method === 'POST') {
      const values = request.postDataJSON() as Record<string, unknown>;
      if (table.has(values.id as string)) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '23505', message: 'duplicate key' }) });
      }
      const row = this.stamp({ ...values, owner_id: this.userId });
      table.set(row.id as string, row);
      return this.reply(route, 201, [row], wantsObject);
    }
    if (method === 'PATCH') {
      const values = request.postDataJSON() as Record<string, unknown>;
      const changed: Record<string, unknown>[] = [];
      for (const row of [...table.values()].filter((r) => this.matches(r, filters))) {
        if (Number(values.updated_at_ms) < Number(row.updated_at_ms)) continue;
        const next = this.stamp({ ...row, ...values });
        table.set(next.id as string, next);
        changed.push(next);
      }
      return this.reply(route, 200, changed, false);
    }
    return route.fulfill({ status: 405, body: '{}' });
  }
}
