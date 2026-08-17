# LandOS coding-agent bootstrap

This is the LandOS repository. Before coding, read these files in order:

1. `.landos/CODING_SESSION_PROTOCOL.md` — the canonical LandOS Coding-Agent
   Operating Contract. It is the highest agent doctrine; where any command,
   subagent file, or document under `docs/landos/` disagrees, the contract wins.
2. `.landos/PERMANENT_MEMORY.md` — stable invariants.
3. `.landos/DEVELOPMENT_CONTEXT.md` — durable orientation: architecture,
   conventions, commands, and what a correct operator-facing result means.

Then run `npm run landos:control -- state generate`, read `.landos/STATE.md`,
run `git status --short`, inspect only the generated state's named task and the
minimum required runtime state, and begin its Next action. Preserve all
uncommitted work and do not start with a broad repository audit.

The accepted request defines scope. Observe the contract's stop conditions,
match acceptance work to its change-class tier, and stop when Tyler accepts the
outcome. After meaningful work, update canonical Control state and regenerate
the handoff through the established checkpoint command.
