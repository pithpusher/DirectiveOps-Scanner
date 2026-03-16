## Contributing to DirectiveOps Scanner

### Local development

- Clone this repository alongside the main private `DirectiveOps` monorepo.
- Run `npm install` at the repo root to install dependencies.
- Use `npm run typecheck` and `npm run build` to validate changes.
- Use `npm run scan -- --path examples/simple-repo` (once examples are added) to smoke-test the CLI locally.

### Source of truth

The private `DirectiveOps` monorepo remains the source of truth for scanner development. This repository is an OSS extraction of:

- `apps/cli`
- `packages/scanner`
- `packages/parser`
- `packages/constitution-model`
- `packages/policy-engine`

To update this repo from the monorepo, follow the sync workflow described in the project plan and keep the file mapping between the two repos aligned.

