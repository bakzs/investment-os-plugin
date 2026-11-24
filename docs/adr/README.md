# Architecture Decision Records (ADRs)

Short, durable records explaining why non-obvious architectural constraints and guardrails exist in **Investment OS** so contributors and AI agents preserve them across future upgrades.

## Index

| ADR | Decision | Status |
| :--- | :--- | :--- |
| [001](001-read-only-sovereignty.md) | Strictly read-only brokerage boundary (no trading or transfer tools) | Accepted |
| [002](002-local-vault-isolation.md) | Strict physical isolation between `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` | Accepted |
| [003](003-progressive-disclosure-monochrome-ui.md) | Progressive-disclosure monochrome MCP App UI & modern web invariants | Accepted |

## Template for New Decisions

```markdown
# NNN. Short Decision Title

- **Status:** Accepted | Proposed | Superseded
- **Context:** What problem or failure mode forces this decision?
- **Decision:** The exact architectural rule we enforce.
- **Consequences:** Trade-offs and automated checks that guard it.
```
