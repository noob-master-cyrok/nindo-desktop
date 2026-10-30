import { expect, test, type Locator, type Page } from '@playwright/test';
import { MockSupabase } from './mockSupabase';

/// Layout audit: every place, pane, dialog and the black clocks at five
/// window sizes. Each must scroll with the wheel to its last element (also
/// with the pointer beside the content), and nothing may stick out sideways.
/// Screenshots land in test-results/layout/. WEBKIT=1 also runs it in WebKit.

const ORIGIN = 'https://wvqutuvvbnrnjmjokynf.supabase.co';
const sizes = [
  [1440, 900],
  [1280, 720],
  [1024, 768],
  [800, 600],
  [600, 900],
] as const;

function iso(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const long = 'with a much longer title than usual so the row has to wrap onto a second line';

function seed(server: MockSupabase) {
  const base = {
    date_system: 'AD', time_zone_policy: 'floating_local', kind: 'reminder', notes: null, due_time: null, urgency: 1, category: null, undated: false,
    repeat_rule: 'none', repeat_interval: 1, repeat_weekdays: '', anchor_month: null, anchor_day: null, missing_date_policy: 'last', series_start: null,
    repeat_until: null, repeat_count: null, repeat_exceptions: '', alert_offsets: '0', tithi_key: null, tithi_region: null, tithi_source: null, ringtone: null,
    alert_style: 'notification', steps: [], created_at_ms: 1_000, updated_at_ms: 1_000, completed_at_ms: null, deleted_at_ms: null,
  };
  const kinds = ['reminder', 'bill', 'appointment', 'renewal', 'birthday', 'household'];
  for (let i = 0; i < 48; i++) {
    server.seed('tasks', {
      ...base,
      id: `b0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      title: i % 7 === 0 ? `Errand ${i} ${long}` : `Errand ${i}`,
      due_date_ad: iso((i % 24) - 4),
      due_time: i % 3 === 0 ? '09:30' : null,
      kind: kinds[i % kinds.length],
      undated: i % 11 === 5,
      notes: i === 1 ? 'Call before noon. Bring the paperwork and the receipt from last year.' : null,
      steps: i === 1 ? Array.from({ length: 8 }, (_, k) => ({ id: `s${k}`, title: `Step ${k + 1}`, done: k < 2 })) : [],
      completed_at_ms: i % 9 === 8 ? 5_000 + i : null,
    });
  }
  for (let k = 0; k < 6; k++) {
    server.seed('item_notes', { id: `n${k}`, parent_type: 'task', parent_id: 'b0000000-0000-4000-8000-000000000001', body: `Note ${k + 1}: rang them, waiting for a reply`, created_at_ms: 2_000 + k, updated_at_ms: 2_000 + k, deleted_at_ms: null });
  }
  server.seed('planner_projects', { id: 'p-work', name: 'Work', color: 3, sort_order: 0, archived: false, created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null });
  const statuses = ['backlog', 'todo', 'doing', 'done'];
  for (let i = 0; i < 32; i++) {
    server.seed('planner_tasks', {
      id: `t${i}`, project_id: i % 2 ? 'p-work' : null, parent_id: null, title: i === 0 ? 'Prepare client deck' : i % 5 === 0 ? `Task ${i} ${long}` : `Task ${i}`,
      description: i === 0 ? 'Slides for Friday' : '', status: i === 0 ? 'doing' : statuses[i % 4], priority: i % 5, labels: i % 3 ? '' : 'client', start_date: null,
      due_date: i % 4 ? iso(i % 6) : null, sort_order: i, estimate_minutes: 30, critical: i === 0, created_at_ms: 1_000, updated_at_ms: 1_000,
      completed_at_ms: i % 4 === 3 ? Date.now() - i * 60_000 : null, deleted_at_ms: null,
    });
  }
}

async function signIn(page: Page, server: MockSupabase) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(server.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(/Errand|Task/).first()).toBeVisible();
}

/// Nothing wider than the window, and no pane wider than itself.
async function noSideways(page: Page, name: string) {
  // Let entrance motion end first; a sliding pane is briefly off its place.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  const out = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) wide.push(`page ${doc.scrollWidth} > ${doc.clientWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>('main, .detail-pane.open, dialog[open], .full-clock, .break-cover')) {
      if (getComputedStyle(el).overflowX === 'visible' && el.tagName !== 'MAIN') continue;
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      // Name the innermost things that stick out, to know what to fix.
      const edge = el.getBoundingClientRect().left + el.clientWidth;
      const clipped = (c: Element) => {
        for (let a = c.parentElement; a && a !== el; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return true;
        return false;
      };
      const out = [...el.querySelectorAll('*')].filter((c) => c.getBoundingClientRect().right > edge + 1 && !clipped(c) && ![...c.children].some((k) => k.getBoundingClientRect().right > edge + 1));
      const chain: string[] = [];
      for (let c = out[0]?.parentElement; c && c !== el; c = c.parentElement) chain.push(`${c.tagName.toLowerCase()}.${c.className} w${Math.round(c.getBoundingClientRect().width)} ${getComputedStyle(c).overflowX}`);
      wide.push(`${el.tagName.toLowerCase()}.${el.className} ${el.scrollWidth} > ${el.clientWidth}: ${out.slice(0, 3).map((c) => `${c.tagName.toLowerCase()}.${c.className}`).join(', ')} (in ${chain.join(' < ')})`);
    }
    return wide;
  });
  expect(out, `${name}: sideways overflow`).toEqual([]);
}

/// Wheels the scroller from a point near its left edge (beside the content
/// on a wide window) until it stops, then checks it reached the end and its
/// last element is on screen.
async function wheelsToEnd(page: Page, scroller: Locator, name: string) {
  await noSideways(page, name);
  const box = await scroller.boundingBox();
  expect(box, `${name}: scroller on screen`).not.toBeNull();
  const vh = page.viewportSize()!.height;
  const docScrolls = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1);
  const x = box!.x + 12;
  const y = Math.min(box!.y + Math.min(box!.height, vh) / 2, vh - 20);
  await page.mouse.move(x, y);
  const top = () => scroller.evaluate((el, doc) => (doc ? document.scrollingElement! : el).scrollTop, docScrolls);
  // Wheel until three wheels in a row move nothing (wheel scrolling is animated).
  let last = await top();
  for (let still = 0, i = 0; still < 3 && i < 80; i++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(120);
    const now = await top();
    still = now === last ? still + 1 : 0;
    last = now;
  }
  const state = await scroller.evaluate((el, doc) => {
    const s = doc ? document.scrollingElement! : el;
    const end = s.scrollHeight - s.clientHeight;
    // The last thing in the scroller that takes up room and is not pinned.
    let lastEl: Element | null = el.lastElementChild;
    const real = (e: Element) => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return cs.position !== 'fixed' && cs.display !== 'none' && r.height > 0;
    };
    while (lastEl && !real(lastEl)) lastEl = lastEl.previousElementSibling;
    const r = lastEl?.getBoundingClientRect();
    const frame = doc ? { top: 0, bottom: innerHeight } : el.getBoundingClientRect();
    return { top: s.scrollTop, end, lastBottom: r ? r.bottom : 0, frameBottom: Math.min(frame.bottom, innerHeight), what: lastEl ? `${lastEl.tagName}.${lastEl.className}` : 'none' };
  }, docScrolls);
  if (state.top < state.end - 2) await page.screenshot({ path: `test-results/layout/fail-${name.replace(/\W+/g, '-')}.png` });
  const under = await page.evaluate(([px, py]) => { const e = document.elementFromPoint(px!, py!); const sc = [...document.querySelectorAll('*')].filter((x) => x.scrollTop > 0).map((x) => `${x.tagName}.${x.className}=${x.scrollTop}`); return e ? `${e.tagName}.${e.className} in ${e.closest('main, aside, nav, dialog')?.className}; scrolled: ${sc.join(' ')}; mains ${document.querySelectorAll('main').length}` : 'nothing'; }, [x, y]);
  expect(state.top, `${name}: wheel reached the end (${JSON.stringify(state)}, pointer on ${under})`).toBeGreaterThanOrEqual(state.end - 2);
  expect(state.lastBottom, `${name}: last element ${state.what} on screen`).toBeLessThanOrEqual(state.frameBottom + 1);
}

const nav = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name }).click();
const main = (page: Page) => page.locator('main');

for (const [w, h] of sizes) {
  test(`every screen scrolls and fits at ${w}x${h}`, async ({ page, browserName }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: w, height: h });
    const server = new MockSupabase(ORIGIN);
    seed(server);
    await server.install(page);
    await signIn(page, server);
    const shot = (name: string) => page.screenshot({ path: `test-results/layout/${browserName}-${w}x${h}-${name}.png`, caret: 'initial' });

    await nav(page, /^Today/);
    await wheelsToEnd(page, main(page), 'Today');
    await shot('today');

    await nav(page, /^Calendar/);
    for (const v of ['Month', 'Week', 'Year', 'Events'] as const) {
      await page.getByRole('radio', { name: v, exact: true }).click();
      await wheelsToEnd(page, main(page), `Calendar ${v}`);
      await shot(`calendar-${v.toLowerCase()}`);
    }

    await nav(page, /^Events/);
    for (const t of ['Today', 'Upcoming', 'Overdue', 'Inbox'] as const) {
      await page.getByRole('tab', { name: new RegExp(t) }).click();
      await wheelsToEnd(page, main(page), `Events ${t}`);
    }
    await page.getByRole('button', { name: /Completed/ }).click();
    await wheelsToEnd(page, main(page), 'Events with completed');
    await shot('events');

    // The item editor beside the page.
    await main(page).locator('.item-open').first().click();
    const item = page.locator('.detail-pane.open');
    await expect(item).toBeVisible();
    await wheelsToEnd(page, item, 'Item editor');
    await shot('item');
    await page.keyboard.press('Escape');

    await nav(page, /^Tasks/);
    for (const v of ['List', 'Board', 'Day planner'] as const) {
      await page.getByRole('radio', { name: v }).click();
      await wheelsToEnd(page, main(page), `Tasks ${v}`);
      await shot(`tasks-${v.toLowerCase().replace(' ', '-')}`);
    }
    await page.getByRole('radio', { name: 'List' }).click();
    await page.getByRole('button', { name: /^Prepare client deck/ }).first().click();
    const task = page.locator('.detail-pane.open');
    await expect(task).toBeVisible();
    await wheelsToEnd(page, task, 'Task panel');
    await shot('task');
    await page.getByRole('button', { name: 'Close' }).first().click();
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await wheelsToEnd(page, page.locator('dialog[open]'), 'Filter dialog');
    await page.keyboard.press('Escape');

    await nav(page, /^Festivals/);
    await wheelsToEnd(page, main(page), 'Festivals');
    await shot('festivals');
    await page.locator('.festival-row .item-open').first().click();
    const fest = page.locator('.detail-pane.open');
    await expect(fest).toBeVisible();
    await wheelsToEnd(page, fest, 'Festival panel');
    await page.keyboard.press('Escape');

    await nav(page, /^Search/);
    await page.getByRole('searchbox', { name: 'Search' }).fill('errand');
    await wheelsToEnd(page, main(page), 'Search');
    await shot('search');

    for (const [place, label] of [
      [/^People/, 'People'],
      [/^Alarms/, 'Alarms'],
    ] as const) {
      await nav(page, place);
      await wheelsToEnd(page, main(page), label);
    }

    await page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: 'Settings' }).click();
    await wheelsToEnd(page, page.locator('dialog[open]'), 'Settings dialog');
    await shot('settings');
    await page.keyboard.press('Escape');

    // The black clock and the break cover: every control on screen.
    await nav(page, /^Tasks/);
    await page.getByRole('button', { name: 'Start timer: Prepare client deck' }).click();
    await page.getByRole('button', { name: 'Running timer, open the full-screen clock' }).or(page.getByRole('button', { name: 'Full screen' }).first()).first().click();
    const clock = page.getByRole('dialog', { name: 'Full-screen timer' });
    await expect(clock).toBeVisible();
    await noSideways(page, 'Full clock');
    for (const b of await clock.getByRole('button').all()) await expect(b, 'Full clock control inside the window').toBeInViewport({ ratio: 1 });
    await shot('fullclock');
    const brk = clock.getByRole('button', { name: /Take a break/ });
    if (await brk.count()) {
      await brk.click();
      await page.waitForTimeout(400);
      await noSideways(page, 'Break');
      const cover = page.getByRole('dialog', { name: 'On a break' });
      await expect(cover).toBeVisible();
      for (const b of await cover.getByRole('button').all()) await expect(b, 'Break control inside the window').toBeInViewport({ ratio: 1 });
      await shot('break');
    }

    expect(errors).toEqual([]);
  });
}

test('the keys scroll a page right after picking it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  await signIn(page, server);
  await nav(page, /^Events/);
  const pane = main(page);
  await expect(pane).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
  await page.keyboard.press('End');
  await expect.poll(() => pane.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
  // A new place starts at the top.
  await nav(page, /^Festivals/);
  await expect.poll(() => main(page).evaluate((el) => el.scrollTop)).toBe(0);
  // With nothing focused the keys still reach the page.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('PageDown');
  await expect.poll(() => main(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
});
