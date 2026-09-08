# Vocivo agent requirements

Before changing Vocivo, every agent must read
[the Vocivo engineering skill](docs/skills/vocivo-engineering/SKILL.md),
[CONTRIBUTING.md](CONTRIBUTING.md), [ARCHITECTURE.md](ARCHITECTURE.md),
and the relevant feature README located through [docs/FEATURES.md](docs/FEATURES.md).
These requirements apply to implementation, review, debugging, infrastructure,
and any delegated work in this repository.

The skill defines the required developer competencies across app engineering,
telecom, and real-time AI, plus the supporting production disciplines. Every
agent must understand the shared boundaries and apply the domain requirements
relevant to its assignment. Do not claim expertise or production readiness merely
because these instructions were read: demonstrate correctness with repository
evidence and appropriate validation. Identify missing tools, knowledge, access,
or device coverage explicitly; verify unfamiliar behavior before changing it.

When delegation is authorized, include this file and the skill path in each
agent's assignment, identify the affected contracts, and require validation and
limitations in its handoff. This file does not itself request delegation.

Use package manifests, lockfiles, service configuration, and deployed evidence
to establish actual versions and behavior. The skill matrix is a competency
baseline, not an instruction to upgrade dependencies or replace working systems.
Preserve existing user changes. Report what changed, what was verified, and any
remaining acceptance gates. Documentation requirements do not authorize production
deployments, paid calls, or external messages beyond the user's task.
