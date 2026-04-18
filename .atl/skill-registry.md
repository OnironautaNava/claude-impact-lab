# Skill Registry — claude-impact-lab

Generated: 2026-04-18

## User Skills

| Skill | Description | Triggers |
|-------|-------------|----------|
| `go-testing` | Go testing patterns for Gentleman.Dots, including Bubbletea TUI testing | Writing Go tests, using teatest, adding test coverage |
| `skill-creator` | Creates new AI agent skills following the Agent Skills spec | Creating a new skill, adding agent instructions, documenting patterns for AI |
| `branch-pr` | PR creation workflow for Agent Teams Lite (issue-first enforcement) | Creating a PR, opening a pull request, preparing changes for review |
| `issue-creation` | Issue creation workflow for Agent Teams Lite (issue-first enforcement) | Creating a GitHub issue, reporting a bug, requesting a feature |
| `judgment-day` | Parallel adversarial review — two blind judges, synthesized findings, iterative fixes | "judgment day", "adversarial review", "dual review", "juzgar" |
| `find-skills` | Helps discover and install agent skills | "how do I do X", "find a skill for X", "is there a skill that can..." |
| `prd` | Generate Product Requirements Documents | "write a PRD", "document requirements", "plan a feature" |

## Compact Rules

### branch-pr
- Always create an issue BEFORE opening a PR (issue-first enforcement).
- Link PR to issue in body (`Closes #N`).
- Use conventional commits for PR title.

### issue-creation
- Fill in title, description, and acceptance criteria before submitting.
- Assign appropriate labels (bug, feature, chore).

### judgment-day
- Launch two judge sub-agents in parallel with no shared context.
- Synthesize findings and apply fixes before re-judging.
- Escalate after 2 failed iterations.

### go-testing
- Use `teatest` for Bubbletea TUI testing.
- Table-driven tests preferred.
- Use `t.Helper()` in assertion helpers.

### skill-creator
- Follow the Agent Skills spec for frontmatter and structure.
- Include triggers, tools, and compact rules sections.
