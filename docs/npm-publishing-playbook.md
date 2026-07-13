# npm publishing

The public PBUI packages are published as `@go-go-golems/pbui-*` through npm Trusted Publishing. The GitHub workflow is tokenless: it must never receive `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or a Vault-backed npm credential.

## Packages and order

The release workflow builds, packs, and publishes this dependency order:

1. `@go-go-golems/pbui-core`
2. `@go-go-golems/pbui-react`
3. `@go-go-golems/pbui-listener`
4. `@go-go-golems/pbui-chrome`
5. `@go-go-golems/pbui-theme-genera`

The generated `dist/package.json` files contain publishable JavaScript/CSS paths and concrete internal dependency versions; never publish a source package directory directly.

## Configure npm once per package

npm must have a package record before a trusted publisher can be attached. Publish the initial version interactively with an OTP, then configure each package in npm as follows:

- provider: GitHub Actions
- repository: `go-go-golems/react-pbui`
- workflow: `publish-npm.yml`
- environment: `npm-production`
- publishing access: require 2FA and disallow tokens

For example:

```bash
npx -y npm@latest trust github @go-go-golems/pbui-core \
  --repo go-go-golems/react-pbui \
  --file publish-npm.yml \
  --env npm-production \
  --allow-publish
npx -y npm@latest access set mfa=publish @go-go-golems/pbui-core
```

Repeat for every package. Create the `npm-production` GitHub environment and protect it according to the organization's release policy.

## Release

Run local release checks first:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm run build:publish
pnpm run pack:smoke
```

Dispatch `.github/workflows/publish-npm.yml` with `dry_run=true` first. Use the `next` tag for a real proof release. A real `latest` publish additionally requires `confirm_latest_publish=CONFIRM_LATEST`. The job has `id-token: write`, uses npm 11.10+, and passes `--provenance`; this is the trusted-publishing authentication path.
