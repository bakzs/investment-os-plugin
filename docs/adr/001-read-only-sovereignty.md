# 001. Read-Only Sovereignty

- **Status:** Accepted

## Context
Portfolio analytics, thesis research, and broker execution carry fundamentally different failure modes. Allowing an exploratory research agent to place, modify, or cancel live brokerage orders mixes analytical iteration with irreversible financial risk and forces the plugin to manage sensitive trading permissions.

## Decision
Investment OS is strictly **read-only** toward all financial accounts forever:
1. No tool in `src/server/index.ts` may submit, modify, cancel, or confirm orders, nor initiate cash transfers or wires.
2. Broker synchronization operates purely through read-only queries against external broker MCPs (such as `ibkr_ibkr-mcp`) or explicit user snapshots stored locally in `${PLUGIN_DATA}`.

## Consequences
- **Safety guarantee:** Users can experiment freely with triggers, scenarios, and agent Red-Team sessions without risking live orders.
- **Automated enforcement:** `scripts/verify-bundle.mjs` scans all declared MCP tool names during `npm run verify` and fails the build if order-placement or transfer tools appear.
- **Separation of concerns:** Order execution remains strictly inside the user's broker interface under direct human confirmation.
