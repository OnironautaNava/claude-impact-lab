# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

**Scope**: Workspace root (`G:\Repos\claude-impact-lab`). Nested applications keep their own registries. For `smart-commute-cdmx`, use `smart-commute-cdmx/.atl/skill-registry.md`.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When asked to improve accessibility, run an a11y audit, address WCAG compliance, improve screen reader support, keyboard navigation, or make a UI accessible. | accessibility | `G:\Repos\claude-impact-lab\.agents\skills\accessibility\SKILL.md` |
| When asked to build or beautify frontend UI, pages, components, dashboards, posters, or web experiences with strong visual direction. | frontend-design | `G:\Repos\claude-impact-lab\.agents\skills\frontend-design\SKILL.md` |
| When asked to improve SEO, search visibility, meta tags, structured data, sitemaps, or crawlability. | seo | `G:\Repos\claude-impact-lab\.agents\skills\seo\SKILL.md` |
| When creating a GitHub issue, reporting a bug, or requesting a feature. | issue-creation | `C:\Users\Mario\.config\opencode\skills\issue-creation\SKILL.md` |
| When creating a pull request, opening a PR, or preparing changes for review. | branch-pr | `C:\Users\Mario\.config\opencode\skills\branch-pr\SKILL.md` |
| When asked to create a new skill, add agent instructions, or document reusable AI patterns. | skill-creator | `C:\Users\Mario\.config\opencode\skills\skill-creator\SKILL.md` |
| When writing Go tests, using teatest, or adding test coverage. | go-testing | `C:\Users\Mario\.config\opencode\skills\go-testing\SKILL.md` |
| When the user asks for judgment day, dual review, adversarial review, or equivalent trigger phrases. | judgment-day | `C:\Users\Mario\.config\opencode\skills\judgment-day\SKILL.md` |
| When the user wants to discover or install a skill for a capability or workflow. | find-skills | `C:\Users\Mario\.agents\skills\find-skills\SKILL.md` |
| When writing or reviewing Postgres queries, schema design, RLS, or database performance on Supabase/Postgres. | supabase-postgres-best-practices | `C:\Users\Mario\.agents\skills\supabase-postgres-best-practices\SKILL.md` |
| When asked to write a PRD, document requirements, or plan a feature with product and technical scope. | prd | `C:\Users\Mario\.agents\skills\prd\SKILL.md` |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### accessibility
- Add accessible names to icon-only controls with `aria-label` or visually hidden text.
- Keep keyboard access for every interactive element; no click-only behavior and no keyboard traps.
- Never remove focus indicators; use visible, high-contrast `:focus-visible` states.
- Meet WCAG 2.2 AA contrast targets: 4.5:1 for normal text, 3:1 for large text and UI components.
- Do not rely on color alone; pair errors and status with text and/or icons.
- Provide alt text for meaningful images and empty alt text for decorative images.

### frontend-design
- Pick a bold, explicit aesthetic direction before coding and keep the whole UI consistent with it.
- Avoid generic AI visuals: no default-looking layouts, no purple-on-white bias, no Arial/Inter/Roboto defaults.
- Use distinctive typography, CSS variables, and a dominant palette with sharp accents.
- Build atmosphere with gradients, textures, shadows, patterns, or layered backgrounds instead of flat fills.
- Prefer a few meaningful, high-impact animations over scattered micro-interactions.
- Match code complexity to the visual concept; refined minimalism needs restraint, maximalism needs richer implementation.

### seo
- Ensure crawlability with valid `robots.txt`, indexable pages, and canonical URLs for duplicate-prone content.
- Write unique page titles and meta descriptions with natural keywords and clear intent.
- Keep heading hierarchy logical with one main `h1` and no skipped levels.
- Use descriptive, keyword-friendly URLs and HTTPS-only resources.
- Optimize images with descriptive filenames, alt text, proper sizing, and lazy loading where appropriate.
- Add and maintain XML sitemap and structured data for relevant content types.

### issue-creation
- Never create a blank issue; always use the correct GitHub template.
- Search for duplicates before creating a new bug report or feature request.
- Issues start in `status:needs-review`; implementation must wait for maintainer `status:approved`.
- Route questions to GitHub Discussions, not Issues.
- Fill all required fields, including reproducible steps or the concrete problem statement.
- Use `gh issue create --template ...` with complete, structured content.

### branch-pr
- Every PR must link exactly one approved issue with `Closes #N`, `Fixes #N`, or `Resolves #N`.
- Create branches as `type/description` using lowercase and one valid conventional type prefix.
- PRs need exactly one `type:*` label and must follow the repository PR template.
- Use conventional commits only; never add `Co-Authored-By` trailers.
- Run required validation tooling before opening the PR; modified shell scripts require `shellcheck`.
- Summarize changes clearly in the PR body with linked issue, file table, and test plan.

### skill-creator
- Create a skill only for reusable, non-trivial patterns; do not make one-off skills.
- Use `skills/{skill-name}/SKILL.md` with complete frontmatter and a trigger in the description.
- Prefer concise critical patterns, decision trees, and minimal focused examples.
- Put templates and schemas in `assets/`; point `references/` only to local docs, not web URLs.
- Do not add keyword or troubleshooting sections; keep the skill focused and operational.
- Register the new skill in the relevant agent index file after creation.

### go-testing
- Default to table-driven tests for Go logic with multiple input/output cases.
- Test Bubble Tea state transitions directly through `Model.Update()` for unit coverage.
- Use `teatest.NewTestModel()` for interactive TUI flow coverage.
- Use golden files for stable view-output assertions when rendering matters.
- Cover both success and error paths, and use `t.TempDir()` for file-system tests.
- Mock side-effectful dependencies behind interfaces rather than invoking real commands in unit tests.

### judgment-day
- Resolve the skill registry before launching judges so review prompts include project standards.
- Launch two blind review agents in parallel; neither judge should know about the other.
- Synthesize findings into confirmed, suspect, and contradictory buckets before acting.
- Fix only confirmed critical or real warning issues, then re-judge when the protocol requires it.
- Treat theoretical warnings as informational; do not block on contrived edge cases.
- Stop after two full fix iterations unless the user explicitly asks to continue.

### find-skills
- Check the leaderboard first for established skills before running a broader search.
- Use specific search queries with `npx skills find` that match the user task and domain.
- Do not recommend a skill blindly; verify install count, source reputation, and repository quality.
- Present the skill, source, popularity, install command, and learning link together.
- If nothing suitable exists, say so clearly and offer direct help or suggest creating a custom skill.

### supabase-postgres-best-practices
- Prioritize query performance, connection management, security/RLS, and schema design before lower-impact optimizations.
- Add the right indexes and validate performance-sensitive SQL with explain plans when relevant.
- Keep Row Level Security explicit and review security implications alongside performance changes.
- Use Postgres-native patterns that reduce scans, lock contention, and unnecessary round trips.
- Read the rule references for query, schema, lock, and data-access categories before non-trivial database changes.

### prd
- Never draft a PRD cold; ask clarifying questions first to uncover problem, success metrics, and constraints.
- Use measurable, testable requirements instead of vague words like fast or intuitive.
- Follow the strict structure: executive summary, UX/functionality, AI requirements if needed, technical specs, risks/roadmap.
- Define user stories, acceptance criteria, non-goals, and rollout phases explicitly.
- Mark unknown constraints as `TBD` instead of inventing them.
- Present an initial draft for feedback and iterate on specific sections.

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| `CLAUDE.md` | `G:\Repos\claude-impact-lab\CLAUDE.md` | Index - autoskills summary for project conventions |
| `SKILL.md` | `G:\Repos\claude-impact-lab\.claude\skills\accessibility\SKILL.md` | Referenced by `CLAUDE.md` |
| `SKILL.md` | `G:\Repos\claude-impact-lab\.claude\skills\frontend-design\SKILL.md` | Referenced by `CLAUDE.md` |
| `SKILL.md` | `G:\Repos\claude-impact-lab\.claude\skills\seo\SKILL.md` | Referenced by `CLAUDE.md` |

Read the convention files listed above for project-specific patterns and rules. All referenced paths have been extracted - no need to read index files to discover more.
