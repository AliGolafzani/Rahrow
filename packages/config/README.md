# Shared configuration

Private workspace for this repository's TypeScript presets and ESLint configuration. The root ESLint entry point consumes `eslint.mjs`; all code workspaces extend the appropriate TypeScript preset. File-specific include/output paths stay in each consumer.

This package contains configuration only and has no build output. Root lint checks its JavaScript; application and library type checks exercise the TypeScript presets. It does not define domain, deployment, secrets, or provider configuration.
