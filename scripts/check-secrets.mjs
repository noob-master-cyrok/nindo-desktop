// Fails the build if a service-role key could end up in the repo or bundle.
// Scans source, config and (when present) the built dist folder.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['src', 'scripts', 'tests', 'e2e', 'index.html', '.env.example', 'dist', '.env', '.env.local'];
const skip = new Set(['node_modules']);
const self = 'scripts/check-secrets.mjs';
const problems = [];

function* files(path) {
  let info;
  try {
    info = statSync(path);
  } catch {
    return;
  }
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (!skip.has(name)) yield* files(join(path, name));
    }
  } else {
    yield path;
  }
}

function jwtRole(token) {
  try {
    const payload = token.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json).role;
  } catch {
    return undefined;
  }
}

for (const root of roots) {
  for (const file of files(root)) {
    if (file === self) continue;
    const text = readFileSync(file, 'utf8');
    if (/service_role/i.test(text)) problems.push(`${file}: mentions service_role`);
    if (/sb_secret_[A-Za-z0-9_-]+/.test(text)) problems.push(`${file}: contains a Supabase secret key`);
    for (const token of text.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
      const role = jwtRole(token);
      if (role && role !== 'anon') problems.push(`${file}: JWT with role "${role}"`);
    }
  }
}

if (problems.length) {
  console.error('Secret check failed:\n' + problems.map((p) => `  ${p}`).join('\n'));
  process.exit(1);
}
console.log('Secret check passed.');
