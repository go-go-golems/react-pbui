#!/usr/bin/env node

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const packageDir = process.cwd();
const distDir = path.join(packageDir, 'dist');
const sourceDir = path.join(packageDir, 'src');
const packageJsonPath = path.join(packageDir, 'package.json');
const tsconfigPath = path.join(packageDir, 'tsconfig.json');
const temporaryTsconfigPath = path.join(packageDir, '.tsconfig.publish.json');

function normalizeSourceTarget(target) {
  return target.startsWith('src/') ? `./${target}` : target;
}

function rewriteRuntimeTarget(target) {
  if (typeof target !== 'string') return target;
  return normalizeSourceTarget(target)
    .replace(/^\.\/src\//, './')
    .replace(/\.(ts|tsx)$/, '.js');
}

function rewriteTypesTarget(target) {
  if (typeof target !== 'string') return target;
  return normalizeSourceTarget(target)
    .replace(/^\.\/src\//, './')
    .replace(/\.(ts|tsx)$/, '.d.ts');
}

function rewriteExports(value) {
  if (typeof value === 'string') return rewriteRuntimeTarget(value);
  if (Array.isArray(value)) return value.map(rewriteExports);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rewriteExports(child)]));
  }
  return value;
}

async function buildTypeScript() {
  try {
    await readFile(tsconfigPath, 'utf8');
  } catch {
    return;
  }

  const config = {
    extends: './tsconfig.json',
    compilerOptions: {
      noEmit: false,
      outDir: './dist',
      rootDir: './src',
      declaration: true,
      declarationMap: false,
      sourceMap: false,
    },
  };
  await writeFile(temporaryTsconfigPath, `${JSON.stringify(config, null, 2)}\n`);
  const result = spawnSync('pnpm', ['exec', 'tsc', '-p', temporaryTsconfigPath], {
    cwd: packageDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function rewriteWorkspaceDependencies(dependencies) {
  if (!dependencies) return dependencies;
  const rewritten = {};
  for (const [name, version] of Object.entries(dependencies)) {
    if (typeof version !== 'string' || !version.startsWith('workspace:')) {
      rewritten[name] = version;
      continue;
    }
    const dependencyDir = path.join(workspaceRoot, 'packages', name.replace('@go-go-golems/pbui-', ''));
    const dependency = JSON.parse(await readFile(path.join(dependencyDir, 'package.json'), 'utf8'));
    const suffix = version.slice('workspace:'.length);
    rewritten[name] = suffix === '^' || suffix === '~' ? `${suffix}${dependency.version}` : dependency.version;
  }
  return rewritten;
}

const workspaceRoot = path.resolve(packageDir, '..', '..');
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

try {
  await buildTypeScript();
  // CSS-only packages do not have a tsconfig; TypeScript packages may also ship CSS assets.
  await cp(sourceDir, distDir, {
    recursive: true,
    force: true,
    filter: (source) => source.endsWith('.css') || path.extname(source) === '',
  });

  const publishJson = {
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    type: packageJson.type,
    license: packageJson.license,
    author: packageJson.author,
    repository: packageJson.repository,
    homepage: packageJson.homepage,
    bugs: packageJson.bugs,
    keywords: packageJson.keywords,
    sideEffects: packageJson.sideEffects,
    publishConfig: packageJson.publishConfig,
    main: rewriteRuntimeTarget(packageJson.main),
    types: rewriteTypesTarget(packageJson.types),
    exports: rewriteExports(packageJson.exports),
    dependencies: await rewriteWorkspaceDependencies(packageJson.dependencies),
    peerDependencies: await rewriteWorkspaceDependencies(packageJson.peerDependencies),
    peerDependenciesMeta: packageJson.peerDependenciesMeta,
  };
  await writeFile(
    path.join(distDir, 'package.json'),
    `${JSON.stringify(Object.fromEntries(Object.entries(publishJson).filter(([, value]) => value !== undefined)), null, 2)}\n`,
  );
  await writeFile(path.join(distDir, '.npmignore'), '**/*.test.*\n**/__tests__/**\n');
  try {
    await cp(path.join(packageDir, 'README.md'), path.join(distDir, 'README.md'));
  } catch {
    // A README is recommended but does not make a build invalid.
  }
} finally {
  await rm(temporaryTsconfigPath, { force: true });
}
