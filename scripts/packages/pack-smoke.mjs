#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..', '..');
const packageDirs = ['packages/core', 'packages/react', 'packages/listener', 'packages/chrome', 'packages/theme-genera'];

for (const packageDir of packageDirs) {
  const distDir = path.join(root, packageDir, 'dist');
  const { stdout } = await execFileAsync('pnpm', ['exec', 'npm', 'pack', '--json'], { cwd: distDir });
  const [result] = JSON.parse(stdout);
  const unwanted = result.files.filter((file) => /(^|\/)(__tests__\/|.*\.test\.)/.test(file.path));
  if (unwanted.length) {
    throw new Error(`${packageDir} tarball contains test files: ${unwanted.map((file) => file.path).join(', ')}`);
  }
  await rm(path.join(distDir, result.filename), { force: true });
  console.log(`${packageDir}: packed ${result.filename} (${result.entryCount} files)`);
}
