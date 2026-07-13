#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// npm Trusted Publishing must use the GitHub OIDC token, never a token injected by
// setup-node or a caller's shell.
delete process.env.NODE_AUTH_TOKEN;
delete process.env.NPM_TOKEN;

const root = path.resolve(import.meta.dirname, '..', '..');
const packageDirs = ['packages/core', 'packages/react', 'packages/listener', 'packages/chrome', 'packages/theme-genera'];
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipExisting = args.includes('--skip-existing');
const tagIndex = args.indexOf('--tag');
const tag = tagIndex === -1 ? 'latest' : args[tagIndex + 1];

if (!tag) throw new Error('Expected a non-empty value after --tag.');
if (!dryRun && tag === 'latest' && process.env.CONFIRM_LATEST_PUBLISH !== 'true') {
  throw new Error('Refusing a real latest publish without CONFIRM_LATEST_PUBLISH=true.');
}

function run(args, options = {}) {
  return spawnSync('pnpm', ['exec', 'npm', ...args], { cwd: root, stdio: 'inherit', ...options }).status ?? 1;
}

for (const packageDir of packageDirs) {
  const manifest = JSON.parse(await readFile(path.join(root, packageDir, 'dist/package.json'), 'utf8'));
  const qualifiedVersion = `${manifest.name}@${manifest.version}`;
  const exists = spawnSync('pnpm', ['exec', 'npm', 'view', qualifiedVersion, 'version', '--registry=https://registry.npmjs.org/'], {
    cwd: root,
    stdio: 'ignore',
  }).status === 0;

  if (exists) {
    if (skipExisting) {
      console.log(`${qualifiedVersion} already exists; skipping.`);
      continue;
    }
    throw new Error(`${qualifiedVersion} already exists on npm.`);
  }

  const publishArgs = ['publish', path.join(packageDir, 'dist'), '--access', 'public', '--tag', tag, '--registry=https://registry.npmjs.org/'];
  if (dryRun) publishArgs.push('--dry-run');
  else publishArgs.push('--provenance');
  if (run(publishArgs) !== 0) process.exit(1);
}
