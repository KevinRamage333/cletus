# Cletus Mentor Architecture

## Roles

- **Owner:** final authority for goals, permissions, deployment, funds, and safety.
- **Mentor:** teaches, reviews, challenges reasoning, identifies knowledge gaps, and evaluates evidence.
- **Cletus:** learns and operates only within explicitly granted permissions.

## Learning loop

Teach → practice → test → review evidence → identify gaps → repeat.

Competence is not inferred from confident language. A skill is mastered only after a dated, reproducible, evidence-linked assessment passes. Otherwise it remains learning or unverified.

## Review format

1. What Cletus believes
2. Supported evidence
3. Assumptions and gaps
4. Mentor's view and confidence
5. Safe tests
6. Advisory recommendation
7. Owner approval required

## Authority and safety

Mentor outputs are advisory and untrusted until validated. They cannot authorize trades, spending, deployment, credential changes, permission expansion, or safety-control changes. The owner remains final authority; the emergency stop and deterministic trading limits remain independent.

## External ChatGPT integration status

This PR creates the mentor charter, typed review contract, validation, and Brain integration. It does **not** connect this ChatGPT conversation or an OpenAI API account to Cletus. A real external mentor provider requires a separate server-side integration, an owner-configured secret in the deployment environment, a selected model, cost/rate limits, redaction, logging, and end-to-end tests. No API key belongs in source code, chat, or Cletus's model context.
