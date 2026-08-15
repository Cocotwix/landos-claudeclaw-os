# Build-runner proof fixtures

Bounded, throwaway modules used to prove the runner mechanically without
spending a real product sprint. Each source file starts unimplemented and each
test states the contract. Nothing here is imported by LandOS.

Run a fixture check directly:

    npx vitest run --config scripts/devloop/fixtures/vitest.config.mjs
