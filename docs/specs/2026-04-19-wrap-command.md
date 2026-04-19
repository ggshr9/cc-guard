# `cc-guard wrap <command>` — Pre-flight Block Mode

**Status:** Draft (2026-04-19, v0.2 scope)
**Parent:** `2026-04-19-cc-guard-design.md` Level 3 (opt-in pre-flight block)

## Goal

Let users run their normal `claude` command wrapped by cc-guard so that when aggregate risk is HIGH, a banner appears asking for confirmation before Claude Code starts. When risk is below the configured threshold, the wrapper is a silent pass-through.

This is how "guard" earns its name — without ever modifying Claude Code, its args, or its telemetry.

## Non-Goals

- No modification of what Claude Code does at runtime
- No stdio interception after hand-off
- No "remember this answer" toggle (every invocation re-prompts if over threshold)
- No blocking of tools other than the one the user asks to wrap

## Design decisions (finalized)

| # | Question | Decision |
|---|---|---|
| 1 | Find the real `claude` binary without recursing into ourselves | Use `which -a claude` equivalent; skip any entry whose path points at `cc-guard`'s own bin (self by `process.execPath` + `process.argv[1]` heuristic) |
| 2 | Non-TTY invocation (CI, pipe, nohup) | Direct pass-through with a single stderr line `[cc-guard] wrap: non-TTY context, passthrough`. Don't block automation. |
| 3 | Banner appears but user doesn't respond | **10-second timeout → continue**. Fail-open — the user isn't at the keyboard, blocking would orphan the session. |
| 4 | Wrapper lifecycle after exec | `execFile` replaces process image — wrapper exits. On platforms without `execFile` semantics (Node), use `spawn` with `stdio: inherit` and `process.exit(child.status)`. |
| 5 | Daemon not running | `[cc-guard] wrap: daemon not running, passthrough` then exec. Don't block when the check can't be made. |
| 6 | `wrap.auto_confirm_below: Severity` semantics | Below this level → silent passthrough. At or above this level → show banner + prompt. Default `high`. |
| 7 | How users discover this | Readme section + `cc-guard doctor` suggests aliasing. We do NOT mutate shell RC files. |

## Configuration

New top-level `wrap` section in `config.json`:

```json
{
  "wrap": {
    "auto_confirm_below": "high",
    "timeout_seconds": 10
  }
}
```

`auto_confirm_below` values: `"low"` | `"medium"` | `"high"` (`"info"` would disable blocking entirely; treat as identical to `"low"` silently).

## CLI surface

```
cc-guard wrap <command> [args...]
```

Example: `cc-guard wrap claude --fresh`

- `command` is a program name or path. We resolve via PATH unless absolute.
- `[args...]` are passed to the resolved binary verbatim.
- Exit code = the wrapped binary's exit code.
- If user Ctrl+C's the banner prompt, exit `130` (SIGINT convention).

## Banner format

```
────────────────────────────────────────────────────────────────
[cc-guard] 🚨 Risk level: HIGH  (3 active signals)
  ip_change: cross-ASN 3× in 1h (US→HK→CN)
  concurrent_session: 2 active projects
  streaming_stall: 5× in 10min
  → Consider pausing 10 min; verify VPN stability

Press Enter to continue, Ctrl+C to abort.
  (auto-continue in 10s if no input)
────────────────────────────────────────────────────────────────
```

Color: `\x1b[31m` for the level header when high, `\x1b[33m` for medium, none for low.

## State read

`wrap` reads `~/.claude/channels/cc-guard/state.json` (the daemon's ring-buffer persistence). Loads the last 24h of events, filters to active 5-min window, runs `evaluateRisk` from `rules.ts`, gets aggregate severity.

If the file is missing or unreadable → treated as "daemon not running".

## Exit codes

- `0` — wrapped command exited 0
- `1-128` — propagated from wrapped command
- `130` — user Ctrl+C'd the banner
- `127` — wrapped command not found on PATH
- otherwise — propagated

## Testing

- Unit: `resolveBinary(name, selfPath)` finds the right entry from PATH, skipping self
- Unit: `shouldBlock(risk, threshold)` returns correct true/false for severity comparisons
- Unit: banner rendering produces expected ANSI-stripped text for a given `RiskResult` + events
- Manual smoke: actually wrap an echo command, verify passthrough; simulate elevated state to verify block path

## Out of scope for this increment

- Shell integration (fish/zsh/bash auto-completion of wrapped command name)
- Log of past block decisions (what was the risk when user confirmed vs aborted)
- Per-command wrap policy (e.g., different thresholds for `claude` vs `codex`)
