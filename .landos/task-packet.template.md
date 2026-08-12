# Outcome

<One or two sentences. What is true when this is done, stated as a result, not
as a plan.>

# Acceptance

<Observable behavior that proves the outcome. Concrete examples beat adjectives.
Omit the section when the outcome is already its own acceptance.>

# Scope

<Path globs the change is allowed to touch, one per line, e.g. `src/landos/**`.
Anything changed outside them is reported as a scope exception. Omit the section
to leave scope unconstrained.>

# Surface

<Known relevant files or entry points, when you already know them. Omit when you
do not: guessing wastes the builder's time more than searching does.>

# Verify

<Exact commands that must pass, one per line. Omit the section to let the runner
derive checks from what actually changed.>
