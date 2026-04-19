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

### Level 3: Pre-flight block mode

`cc-guard wrap claude <args...>` — a shell wrapper that:
1. Before invoking `claude`, reads current risk state from `state.json`.
2. If risk is `medium+`, prints a red banner summarizing the active signals and advice.
3. Prompts user with "Press Enter to continue, Ctrl+C to abort".
4. On continue, exec's `claude` with the original argv and user's TTY.

Plus opt-in config: `wrap.auto_confirm_below: "high"` — only block on high, silently pass medium.

**Design constraints carried forward:**
- No modification of the `claude` binary, its args, or its env
- No interception of its stdout/stderr — exec and let it take over
- User's choice every time; no "remember this answer" toggle
- MUST document that this adds 1-2 seconds of latency to each `claude` startup

### Systemd unit generator

`cc-guard install-systemd-unit` — emit `~/.config/systemd/user/cc-guard.service` with:
- `ExecStart=bun /path/to/cli.ts run`
- `Restart=on-failure`
- `RestartSec=10s`
- Documents user-level install: `systemctl --user enable --now cc-guard`

Non-systemd systems: skip with a helpful message pointing to tmux/nohup examples.

### IPv6 support

`voteConsensus` and IP-compare logic currently assume IPv4. Fixes:
- Accept IPv6 addresses in `parseDigOutput` and public-IP endpoint responses
- Normalize `::1` forms before comparing
- Expand ASN classification to IPv6 (ipinfo.io returns them for v6 too)

---

## v0.3 — Distribution + polish

### Alert backends

- **Email backend** — SMTP via Nodemailer. Opt-in, min_level gated. Useful for overnight alerts when desktop is unattended.
- **Slack / Discord / DingTalk / Feishu direct backends** — just thin wrappers over webhook with per-platform message formatting. Lower priority because webhook already works for these services.

### Privacy modes

- `privacy.anonymize_ip_in_logs` is declared in config but not honored. Implement: strip last octet in alerts.log, replace with `xxx.xxx.xxx.0`.
- Optional self-hosted IP-lookup endpoint: document the 2-line Cloudflare Worker that returns `{ip, asn, country}` so privacy-conscious users can avoid ipinfo.io entirely.

### Events catalog expansion

- Import + classify known unknowns from community `unknown_events.log` submissions
- Support remote fetch of updated `events-catalog.json` from the repo (fallback to bundled copy)

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
