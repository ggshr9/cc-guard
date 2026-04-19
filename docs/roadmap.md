# cc-guard Roadmap

Living document. Items within a milestone are in rough priority order — higher items land first.

## v0.1.x — MVP stabilization (current)

**Goal:** Prove the observation-only value prop in real daily use. No new features.

- [ ] **Task 21 manual E2E smoke** — 12-step checklist in `docs/plans/2026-04-19-mvp-v0.1.md`. Gate for v0.1.0-alpha.
- [ ] Fix `cc-guard check` to actually run a one-shot signal scan (currently prints persisted status; docs/help say "scan").
- [ ] AlertRouter `lastSent` map: sweep expired (>30min) entries on dispatch. Unbounded growth today — not critical at hobbyist scale but not hygienic.
- [ ] webhook.test: add a `fetch` throw path (network-level failure), not just HTTP 500.
- [ ] network-sink.test.ts: stub `ip monitor` spawn and assert the fallback-on-error path works.
- [ ] First-run UX: on daemon startup, if `config.json` is missing, write it + a sibling `config.example.json` (annotated). The spec calls for this; current code relies on defaults silently.

Ship as v0.1.0-alpha when E2E passes, tag v0.1.0 when users have run it a week without issues.

---

## v0.2 — "Guard" becomes earned (opt-in active protection)

**Goal:** User-consented pre-flight warning, without ever touching Claude Code state or spoofing anything.

### ✅ Level 3: Pre-flight block mode (shipped)

`cc-guard wrap <command> [args...]` — shell wrapper landed on master. Flow:
1. Resolves target binary via PATH (skips `cc-guard` self-paths to avoid recursion)
2. Reads `state.json`, runs `evaluateRisk` to get aggregate severity
3. If risk >= `wrap.auto_confirm_below` AND stdin is a TTY → banner + prompt
4. Passthrough in all other cases (non-TTY, daemon not running, below threshold)
5. Spawns target with `stdio: inherit`, exits with its code

Spec: `docs/specs/2026-04-19-wrap-command.md`
Still TODO for polish:
- Shell completion for wrapped-command name (fish/zsh/bash)
- Log of past block decisions (risk state when user confirmed vs aborted) for self-reflection

### ✅ Systemd unit generator (shipped)

`cc-guard install-systemd-unit` emits `~/.config/systemd/user/cc-guard.service`:
- `ExecStart=<bun path> <cli.ts path> run`
- `Restart=on-failure` + `RestartSec=10s`
- `StandardOutput/StandardError=journal`
- `WantedBy=default.target` (user-level autostart on login)

Non-Linux / no-systemctl → prints tmux / nohup fallback instead of failing.

Module: `install-systemd.ts` with 7 unit tests on `buildUnitContent`.

### ✅ IPv6 support (shipped)

Lifted the hardcoded IPv4 assumptions:
- `isIpv4`/`isIpv6` via Node's `net.isIP` (proper parser, handles `::` compression)
- `parseDigOutput` now accepts mixed IPv4 + IPv6 `dig +short` output
- `isCloudflareIp` added 7 Cloudflare IPv6 prefixes (case-insensitive)
- 4 new dns-sink tests covering CF v6 match, v4+v6 parse, malformed rejection

---

## v0.3 — Distribution + polish

### ✅ Privacy modes (shipped)

- `privacy.anonymize_ip_in_logs` is now honored in `alerts/json-log.ts` — zeros IPv4 last octet and IPv6 low bits before writing to `alerts.log`
- Self-hosted IP-lookup endpoint template documented at `docs/examples/self-hosted-ip-endpoint.md` (Cloudflare Worker + nginx snippets)

### ✅ Events catalog — unknown-event logging (shipped)

`daemon.ts` now writes every unclassified Tengu event name to
`~/.claude/channels/cc-guard/unknown_events.log` so users / maintainers
can grow the catalog from real-world observations.

Remote fetch of updated `events-catalog.json` is deferred — not worth
the network + version-check complexity until we see actual catalog drift.

### ✅ Richer `cc-guard status` dashboard (shipped)

Upgraded from the ~4-line printout to:
- Risk level with color emoji
- Permanent device ID (transparency angle — the fingerprint Anthropic sees)
- Current Claude Code session ID
- Daemon alive/dead + uptime
- Per-signal 5min + 1h counts
- Last 3 alerts from `alerts.log`
- `--watch` flag: 2s refresh loop for tmux panes
- `--raw` flag: JSON dump

### Skipped in v0.3

- **Email backend** — requires nodemailer runtime dep or SMTP-from-scratch.
  Document using webhook → Mailgun/SendGrid as the alternative.
- **Slack / Discord / DingTalk / Feishu direct backends** — webhook path
  is sufficient. Users can template their own JSON schema per platform.
  Direct backends add maintenance burden for marginal value.

### Carried forward from v0.1.x

- AlertRouter `lastSent` sweep on dispatch (unbounded map growth)
- webhook.test: add fetch-throw path (network-level error)
- network-sink.test.ts: mock `ip monitor` subprocess

---

## v1.0 — Ecosystem

### Observability

- Prometheus `/metrics` endpoint (opt-in, separate `cc-guard serve-metrics` command)
- Grafana dashboard JSON in `docs/` as a reference

### Rich status UI

`cc-guard status --watch` — TUI-style live dashboard showing:
- Current device_id + stable_id (the permanent fingerprint)
- 1h sparkline per signal
- Active alerts + time since last clear
- Cumulative telemetry event counts by category

### Shell completions

Bash / zsh / fish completion scripts shipped in `completions/`.

---

## Explicit non-goals (forever)

These are NOT on any roadmap and should not be added without revisiting project identity:

- ❌ **Fingerprint normalization / spoofing** — that's `cc-gateway`'s niche. Adding this contradicts the observation-only positioning.
- ❌ **TLS client impersonation** — ditto.
- ❌ **Auto-switch accounts / auto-toggle VPN / auto-kill claude** — we inform, user decides. Always.
- ❌ **ML-based anomaly detection** — threshold heuristics are sufficient and explainable. Opaque models make the tool untrustworthy.
- ❌ **Multi-user / team dashboards** — breaks the individual-developer identity. Enterprise users should look at tools built for that scope.
- ❌ **Probe Anthropic's API speculatively to check account health** — adds to the very risk footprint we're trying to monitor.
- ❌ **Modify any file under `~/.claude/` other than `~/.claude/channels/cc-guard/`** — violates the "only observes" guarantee.

---

## Contributing priorities

If you want to pitch in, these are the highest-leverage contributions right now:

1. **Manual E2E validation** on Linux / macOS / Windows — help us get v0.1.0 tagged.
2. **Shell wrapper for Level 3** — the biggest "guard" value prop still on the table.
3. **Tengu event classification** — submit PRs adding entries to `events-catalog.ts`, referencing source leak analyses so the community catalog grows.
4. **Self-hosted IP-lookup endpoint template** — a minimal Cloudflare Worker that users can deploy in 2 minutes.

See `CONTRIBUTING.md` (not yet written — good first issue).
