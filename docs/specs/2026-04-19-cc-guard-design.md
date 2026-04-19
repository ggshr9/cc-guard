# cc-guard — Claude Code Usage Health Monitor — Design Spec

**Status:** Draft (brainstormed 2026-04-19)
**Target MVP:** v0.1 — 6 signals, Level 0-2 response, 5 alert backends, event-driven.
**Positioning:** Observation-only health monitoring. Not evasion, not proxy, not fingerprint normalization.

## Goal

Give Claude Code users a real-time view of what their session is reporting to Anthropic, plus early warnings for usage patterns that commonly precede account suspension or rate limiting.

## Non-Goals

- **No evasion.** We don't normalize device fingerprints, bypass TLS detection, or mask identity. That's what `motiful/cc-gateway` and similar do. We take a different path.
- **No proxy / TLS manipulation.** We don't sit in the network path.
- **No telemetry rewriting.** We don't modify or intercept what Claude Code sends.
- **No auto-intervention.** We inform and advise, never act on the user's behalf.
- **No prompt content analysis.** Doesn't appear in telemetry, and would be invasive.
- **No account pool management.** Not our scope.
- **No probing of Anthropic's side.** We don't hit their API speculatively — that would add to our risk footprint.

## Design Constraints (decided during brainstorm)

1. **Observation-only.** Everything we expose is locally-observable data. No guessing about Anthropic's internal state.
2. **Event-driven, not polling.** Network / fs / DNS changes come via OS event subscription. Zero idle cost.
3. **Local-first.** Nothing leaves the user's machine without explicit opt-in.
4. **Pluggable alert backends.** User chooses how they want to be notified.
5. **Layered response (Level 0-2 only in MVP).**
   - L0: always-on observation (`cc-guard status`)
   - L1: passive notification via configured backend
   - L2: notification + actionable advice
   - L3 (v0.2, opt-in): pre-flight blocking prompts via shell wrapper
   - L4 (never): auto-kill / auto-switch / auto-config — out of scope forever
6. **Bun + TypeScript.** Same stack as `wechat-cc` for consistency.
7. **Standalone repo.** `github.com/ggshr9/cc-guard`. MIT. Bilingual README (English primary, Chinese secondary).
8. **State under `~/.claude/channels/cc-guard/`.** Peer to `wechat-cc` on disk.

## Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Fingerprint normalization (cc-gateway style) | Evasion; adversarial to Anthropic; ToS gray area |
| TLS client impersonation (dario style) | Same — evasion, cat-and-mouse with Anthropic |
| Polling-based monitoring (60s loops) | Wastes cycles, leaks query volume to external services, delays detection |
| API probing (check account health via test calls) | Adds to risk footprint of the very account we're protecting |
| MCP server / hook integration only | Only observable during active Claude Code session; misses between-session signals |
| Integration into wechat-cc | Couples two unrelated concerns; limits cc-guard audience to WeChat users |

## Architecture

### Process model

Single foreground daemon process (`cc-guard run`). User wraps with tmux / screen / systemd for persistence. No self-daemonization, no pidfile magic, no fork tricks. A v0.2 helper `cc-guard install-systemd-unit` generates a systemd user unit.

### State layout on disk

```
~/.claude/channels/cc-guard/
├── config.json           # user config (thresholds, alert backends)
├── config.example.json   # annotated default, reference only
├── state.json            # ring-buffer persistence (24h window)
├── alerts.log            # append-only JSON lines, one alert per line
├── unknown_events.log    # Tengu events not in catalog — user can share back
├── daemon.pid            # flock for singleton enforcement
└── crash-*.log           # stack traces on unclean exit
```

### Component diagram

```
┌───────────────────────────────────────────────────────────────┐
│  cc-guard daemon                                              │
├───────────────────────────────────────────────────────────────┤
│  Sources  (event-driven, OS-native primitives)                │
│   ├─ network-sink    — ip monitor / scutil / WMI              │
│   ├─ ip-sink         — triggered public IP lookup (voting)    │
│   ├─ telemetry-sink  — fs.watch ~/.claude/telemetry/          │
│   ├─ session-sink    — fs.watch ~/.claude/projects/           │
│   ├─ dns-sink        — fs.watch /etc/resolv.conf + dig        │
│   └─ ccswitch-sink   — fs.watch ~/.claude.json                │
│                         │                                     │
│                         ▼                                     │
│  Ring-buffer state (24h, capacity 10k events)                 │
│                         │                                     │
│                         ▼                                     │
│  Rules engine (threshold evaluator + advice generator)        │
│                         │                                     │
│                         ▼                                     │
│  Alert router                                                 │
│   ├─ stderr                (always on)                        │
│   ├─ os-notify             (notify-send / osascript / toast)  │
│   ├─ json-log              (alerts.log)                       │
│   ├─ webhook               (opt-in)                           │
│   └─ wechat-cc adapter     (opt-in, shell-out)                │
└───────────────────────────────────────────────────────────────┘
```

### CLI surface

- `cc-guard run` — start the daemon
- `cc-guard status` — render dashboard from state.json
- `cc-guard status --raw` — raw JSON
- `cc-guard check` — one-shot full-signal scan, print report, exit
- `cc-guard doctor` — diagnose permissions, dependencies, network reachability
- `cc-guard install-systemd-unit` (v0.2) — emit `~/.config/systemd/user/cc-guard.service`

CLI reads `state.json`, never writes. Daemon is the sole writer. No sockets, no IPC — simple and restart-safe.

## Signals (MVP v0.1)

Six signals, each with its own source. Each emits `Event` records with `{timestamp, signal, severity, payload}`.

### S1 — IP stability

**Source:** netlink `ip monitor` (Linux) / `scutil --nwi` subscribe (macOS) / WMI route-change (Windows). On change: parallel fetch from 3 endpoints, majority vote consensus.

**Payload:** `{old_ip, new_ip, asn, country, org, is_datacenter}`

**ASN datacenter detection:** internal blocklist (Vultr, DigitalOcean, Linode, AWS, GCP, Azure, Alibaba Cloud, Tencent Cloud, etc.) bundled with the package + updatable via `datacenter_asn_blocklist_url` in config.

**Thresholds:**
- Cross-ASN changes ≥ 2 in 1h → `medium`
- Cross-ASN changes ≥ 3 in 1h → `high`
- Cross-country changes ≥ 1 in 1h → `medium`
- Cross-country changes ≥ 2 in 1h → `high`
- Current IP is datacenter ASN → `high` immediately

### S2 — Concurrent Claude Code sessions

**Source:** `fs.watch ~/.claude/projects/`, debounce 500ms, then scan `*/*.jsonl` for mtime within last 5 minutes.

**Payload:** `{active_session_count, active_projects: string[]}`

**Thresholds:**
- ≥ 2 active sessions → `medium`
- ≥ 3 active sessions → `high`

**Deduplication:** same-project multi-session (e.g., `--continue` generating a new jsonl) counts as 1 project, not 1 session.

### S3 — Telemetry event rate

**Source:** `fs.watch ~/.claude/telemetry/`. For each new file, parse, classify by event_name against events-catalog.

**Payload:** `{event_name, category, rate_per_min}`

**Thresholds (HIGH_RELEVANCE events only):**
- `tengu_api_query > 60/min` → `medium`
- `tengu_api_query > 120/min` → `high`
- `tengu_api_auth_failed ≥ 1` → `high` (any occurrence)
- `tengu_api_rate_limited ≥ 1` → `high` (any occurrence)

### S4 — Streaming stalls

**Source:** subset of telemetry-sink, specifically counting `tengu_streaming_stall` + `tengu_streaming_stall_summary`.

**Payload:** `{stall_count, window_ms}`

**Thresholds:**
- ≥ 3 in 10min → `medium`
- ≥ 5 in 10min → `high`

**Rationale:** Stalls signal unstable network; repeated stalls look like automation to Anthropic's retry-detection heuristics.

### S5 — cc-switch account changes

**Source:** `fs.watch ~/.claude.json`. On change, diff `mcpServers.anthropic` (or configured proxy) token/baseUrl fields.

**Payload:** `{old_account, new_account, changed_at}`

**Thresholds:**
- ≥ 2 switches in 1h → `medium`
- ≥ 5 switches in 1h → `high`

**Noise suppression:** only watch token/endpoint fields. Other mcpServers edits (e.g., `wechat-cc install --user`) are ignored.

### S6 — DNS stability + leak

**Source:** `fs.watch /etc/resolv.conf` (Linux), `scutil --dns` subscribe (macOS). On change: run `dig api.anthropic.com +short` and compare.

**Payload:** `{resolv_changed, dig_result_ip, is_cloudflare, leak_detected}`

**Thresholds:**
- `resolv.conf` changes ≥ 2 in 1h → `medium`
- `dig api.anthropic.com` returns non-Cloudflare IP → `high` (possible hijack/proxy)
- DNS leak detected (user-configured VPN DNS vs actual resolver) → `high`

**DNS leak detection:** user configures `network.vpn_expected_dns` in config (e.g., `10.0.0.1` for their VPN's DNS). We compare `dig @<vpn_expected>` vs `dig @<system_default>` — divergence = leak.

## Data flow

End-to-end for the most complex signal (IP change):

1. User switches VPN node → kernel emits `RTM_NEWROUTE` netlink event
2. `network-sink` (runs `ip monitor` subprocess) reads event, emits internal `{type: 'route_changed'}`
3. `ip-sink` subscribed to `route_changed`, fires parallel HEAD to 3 IP-lookup endpoints
4. Majority consensus → emit `{signal: 'ip_change', severity, payload: {old, new, asn, country, is_dc}}`
5. Ring-buffer records event; `state.json` atomically rewritten (tmp + rename)
6. Rules engine evaluates 1h window of `ip_change` events → determines aggregate severity
7. If severity ≥ `medium`, construct `Alert` (with title, message, advice, evidence, fingerprint)
8. Fingerprint dedup check against state — if seen within 30min, skip
9. Alert router dispatches to all enabled backends (Promise.allSettled)

Other signals follow same pattern but with different sources.

## Rules engine

### Event schema (internal)

```ts
type SignalName =
  | 'ip_change'
  | 'concurrent_session'
  | 'api_query_rate'
  | 'api_auth_failed'
  | 'api_rate_limited'
  | 'streaming_stall'
  | 'account_switch'
  | 'dns_drift'
  | 'dns_leak'

interface Event {
  timestamp: number
  signal: SignalName
  severity: 'info' | 'low' | 'medium' | 'high'
  payload: Record<string, unknown>
}
```

### Aggregate risk

`overall_risk = max(all active signal severities over last 5 min)`

**Escalation rule:** ≥ 3 concurrent `medium` signals aggregate to `high` (noise is itself a signal).

### Advice generation

Hardcoded map keyed by signal name. Extensible via future template system.

```ts
const ADVICE: Record<SignalName, string> = {
  ip_change:           "Consider pausing 10 min; verify VPN/proxy stability",
  concurrent_session:  "Close inactive Claude sessions",
  api_query_rate:      "Reduce request frequency or take a short break",
  api_auth_failed:     "🚨 Auth failed — check account status and proxy config",
  api_rate_limited:    "🚨 Rate limited by Anthropic — stop and wait ≥ 10 minutes",
  streaming_stall:     "Network instability detected — check connection",
  account_switch:      "Frequent account switching may raise risk flags",
  dns_drift:           "DNS resolution changed unexpectedly — verify setup",
  dns_leak:            "DNS leak detected — VPN may not be routing DNS",
}
```

## Alert routing

### Alert shape

```ts
interface Alert {
  timestamp: number
  level: 'low' | 'medium' | 'high' | 'critical'
  signal: string
  title: string
  message: string
  advice: string
  evidence: Event[]
  fingerprint: string  // sha256 of {signal + level} — for dedup
}
```

### Backend interface

```ts
interface AlertBackend {
  name: string
  send(alert: Alert): Promise<void>
}
```

All enabled backends dispatch in parallel via `Promise.allSettled`. One backend failing doesn't block others.

### Deduplication

Same fingerprint within 30min → skip. Tracked in state.json `recent_alerts` map (fingerprint → last-sent timestamp).

### Backends in v0.1

| Backend | Default enabled | Config | Notes |
|---|---|---|---|
| stderr | ✓ | `min_level` | Colored, human-readable |
| os-notify | ✓ | `min_level` | Auto-detects platform |
| json-log | ✓ | `min_level` | Append-only, tail-friendly |
| webhook | — | `url`, `headers`, `min_level` | POST JSON alert; retries 3× with exponential backoff; auto-disable after 5 consecutive failures |
| wechat-cc | — | `chat_id`, `wechat_cc_path?`, `min_level` | Shell-out to `wechat-cc reply --to <chat_id> "<text>"`; no code dependency |

Per-backend `min_level` filter — stderr shows everything, wechat only medium+, webhook only high+.

## Configuration

### File: `~/.claude/channels/cc-guard/config.json`

Complete schema shown in design discussion (section "Configuration" above in brainstorm). Key sections:

- `thresholds`: one entry per threshold parameter
- `alerts`: one entry per backend with `enabled` + `min_level` + backend-specific fields
- `network`: IP lookup endpoints, datacenter ASN blocklist URL, VPN DNS for leak check, sanity check period
- `privacy`: anonymize IP in logs (false by default), send analytics (false — reserved for future opt-in)

### Hot reload

`fs.watch(config.json)` → on write, re-parse, atomic swap active config. Parse failure → keep old + stderr warn. No restart required.

### First-run behavior

If `config.json` missing at `cc-guard run` startup, generate default + write `config.example.json` with annotated examples next to it.

## Lifecycle

1. **Startup:** load config → restore state.json ring-buffer → start all sources → start 1h sanity-check timer → emit "started" log line
2. **Runtime:** sources emit events → ring-buffer records → rules evaluate → alerts dispatch → 60s periodic state.json flush
3. **Heartbeat:** every 60s write a single `.` to stderr so user knows daemon is alive
4. **Graceful shutdown (SIGINT/SIGTERM):** unsubscribe sources → final state.json write → wait up to 2s for in-flight alert backends → exit 0
5. **Crash:** crash-*.log written with stack trace; systemd/tmux handles restart; at most 60s of events lost

## Error handling & edge cases

| Scenario | Behavior |
|---|---|
| config.json parse fails at startup | Use built-in defaults + stderr warn |
| config.json parse fails on hot-reload | Keep active config unchanged + stderr warn |
| state.json corrupted | Rename corrupted file + start with empty ring-buffer + stderr warn |
| Source startup fails (e.g., netlink no permission) | Disable that source only + stderr warn + continue degraded |
| Public IP lookup: all endpoints fail | Keep last known IP + stderr warn; do not emit event |
| Public IP lookup: 2 of 3 agree, 1 disagrees | Trust consensus |
| ASN blocklist URL unreachable | Fallback to bundled snapshot |
| Alert backend send fails | Log to stderr; do not retry; other backends unaffected |
| Webhook persistently fails (5 consecutive) | Auto-disable + notify user |
| All backends fail | stderr always works as fallback |
| Ring-buffer reaches capacity (10k) | Drop oldest |
| First-run, no history yet | Rules don't fire high (thresholds not met) — correct, expected |
| Claude Code not yet launched | All sources idle, dashboard shows idle, no alerts — correct |
| VPN drops → no network | IP lookup fails, keep last known — don't fire alert for our own network issue |
| Two `cc-guard run` invocations | pid lockfile via `flock(2)` → second refuses with clear error |
| wechat-cc CLI path invalid | Warn once, auto-disable that backend |
| fs.watch ~/.claude/ fails (permission) | Disable affected sink, stderr warn, continue degraded |

## Testing strategy

### Unit tests (bun test, vitest-compatible)

~10 test files covering:
- `rules-engine.test.ts` — threshold logic, aggregate escalation, dedup
- `ring-buffer.test.ts` — insert, expire, query by window, atomic persistence round-trip, corrupted file fallback
- `sources/ip-sink.test.ts` — voting consensus, partial endpoint failure, ASN classification, 24h lookup cache
- `sources/telemetry-sink.test.ts` — event parsing, catalog classification, unknown event logging
- `sources/dns-sink.test.ts` — resolv.conf diff, non-CF IP detection, leak logic
- `sources/session-sink.test.ts` — debounce, mtime filter, same-project dedup
- `alerts/stderr.test.ts` / `alerts/json-log.test.ts` — formatting + min_level filter
- `alerts/webhook.test.ts` — POST, retry with backoff, auto-disable
- `alerts/wechat-adapter.test.ts` — shell-out args, missing binary handling
- `config.test.ts` — default generation, schema validation, hot-reload
- `events-catalog.test.ts` — known classification, UNKNOWN fallthrough

Philosophy: one test per public behavior users rely on. Not pursuing line coverage.

### Not tested in CI (manual smoke only)

- Real netlink / scutil / WMI (OS-specific, mock the interface)
- Real Anthropic account ban behavior (unreproducible)
- Real VPN transitions (environment-dependent)
- Real wechat-cc reply shell-out (requires bound account)

### Manual E2E smoke checklist (release gate)

1. `cc-guard run` starts cleanly, no errors
2. After 30s, `cc-guard status` shows idle + `device_id` + `stable_id`
3. Simulate IP jump (VPN node switch) → MEDIUM `ip_change` alert appears
4. Three consecutive IP jumps → HIGH alert, os-notify fires
5. Start a second `claude` session → `status` shows `active_session_count: 2`
6. Start a third → MEDIUM `concurrent_session` alert
7. Edit `config.json` to set `os_notify.min_level: high` → hot-reload, MEDIUMs no longer notify on desktop
8. `kill -TERM <daemon pid>` → graceful exit, state.json persisted
9. Restart daemon → `cc-guard status` recovers history
10. Disconnect network → ip-sink degrades (last known IP), other sinks still running
11. `chmod 000 config.json` → hot-reload warns, continues with prior config
12. Point webhook URL at unreachable host → auto-disables after 5 retries

## Estimated implementation

- Production code: ~1200 LOC (sources ~500, rules ~200, alerts ~250, cli/config ~250)
- Test code: ~800 LOC
- Bundled data: datacenter ASN snapshot (~200 entries), events catalog (~150 entries)
- Documentation: README (bilingual), CONTRIBUTING.md, events-catalog reference
- Effort: 3-5 days focused implementation + 1 day polish + manual smoke

## Out of scope for MVP (deferred)

- Level 3 pre-flight block mode (`cc-guard wrap claude` shell wrapper)
- Systemd unit auto-generator (v0.2)
- Machine-learning-based anomaly detection (explicit non-goal; threshold heuristics are sufficient)
- Prometheus/OpenTelemetry export
- Multi-user / team dashboard
- Enterprise-wide account pool coordination
- IPv6-specific handling beyond "also works"
- Email alert backend (webhook covers email via services like Mailgun)
- Dingtalk / Slack / Discord direct backends (use webhook)

## Ethical positioning (README-critical)

The README's first paragraph must make the stance unmistakable:

> *"Claude Code reports 640+ telemetry events and your permanent device ID to Anthropic. cc-guard shows you, in real time, what's being sent, and warns you about usage patterns that commonly precede account reviews. It does not evade, proxy, or modify anything — it only observes. Think of it as a Grafana dashboard for your own Claude Code risk profile."*

Principles:
- Respect Anthropic's right to run their service how they see fit
- Respect the user's right to know what their tool does and to self-regulate
- Never claim the tool "prevents bans" — it raises awareness, no more
- Open-source under MIT so the claim "only observes" is auditable
