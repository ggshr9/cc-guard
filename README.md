# cc-guard

> **Know what Claude Code tells Anthropic about you, in real time.**

Claude Code reports 640+ telemetry events and a permanent device ID to Anthropic. cc-guard shows you, in real time, what's being sent, and warns you about usage patterns that commonly precede account reviews or rate limits.

**cc-guard does not evade, proxy, or modify anything — it only observes.** Think of it as a Grafana dashboard for your own Claude Code risk profile.

## What cc-guard watches

- **IP stability** — Sudden cross-country or cross-ASN IP jumps (classic flag for "account sharing" detection)
- **Data-center IP detection** — Bundled ASN blocklist catches when your VPN drops you onto a cloud provider IP
- **Concurrent Claude Code sessions** — Count active sessions across projects
- **Telemetry event rate** — Elevated `tengu_api_query` / `tengu_streaming_stall` / `tengu_api_auth_failed` / `tengu_api_rate_limited` rates
- **cc-switch account changes** — Detects frequent account switching
- **DNS drift + leaks** — Watches `/etc/resolv.conf` changes and compares VPN-DNS vs system-DNS resolution

Each signal has a threshold; high-severity or multiple concurrent medium signals trigger an alert.

## What cc-guard does NOT do

- ❌ **No fingerprint normalization.** We don't touch what Claude Code sends. That's `cc-gateway`'s territory.
- ❌ **No TLS client impersonation.** We don't sit in the network path.
- ❌ **No API probing.** We won't speculatively hit Anthropic to check your status.
- ❌ **No auto-intervention.** We inform and advise. Decisions are yours.
- ❌ **No data leaves your machine.** Everything runs locally, and all state lives under `~/.claude/channels/cc-guard/`.

## Install

**Prerequisites:** [Bun](https://bun.sh) 1.1+. That's it.

```bash
git clone https://github.com/ggshr9/cc-guard.git ~/.claude/plugins/local/cc-guard
cd ~/.claude/plugins/local/cc-guard
bun install
bun link
cc-guard doctor    # check permissions and paths
cc-guard run       # start the daemon (foreground)
```

For persistence across reboots, wrap with systemd / tmux / nohup.

## Usage

```bash
cc-guard run              # start daemon in foreground
cc-guard status           # dashboard summary
cc-guard check            # one-shot scan + config summary
cc-guard doctor           # diagnose setup
```

## Configuration

On first run, cc-guard creates `~/.claude/channels/cc-guard/config.json` with sensible defaults. Edit it any time — the daemon hot-reloads on save.

Key fields:

- `thresholds.*` — tune signal sensitivity per signal
- `alerts.<backend>.enabled` — turn each alert backend on/off
- `alerts.<backend>.min_level` — only notify at or above this severity
- `network.ip_lookup_endpoints` — override with self-hosted endpoint for privacy
- `network.vpn_expected_dns` — set to your VPN's DNS server for leak detection

Full schema in [`docs/specs/2026-04-19-cc-guard-design.md`](docs/specs/2026-04-19-cc-guard-design.md).

## Alert backends (MVP v0.1)

| Backend | Default | Purpose |
|---|---|---|
| `stderr` | ✓ | Formatted line in your terminal |
| `os-notify` | ✓ | Native desktop notification (Linux/macOS/Windows) |
| `json-log` | ✓ | Append-only `alerts.log` for tail/grep |
| `webhook` | — | POST JSON to any URL (Slack/Discord/custom) |
| `wechat-cc` | — | Forward via [`wechat-cc`](https://github.com/ggshr9/wechat-cc) to your WeChat |

Each backend has its own `min_level` — keep stderr verbose and wechat only high.

## Ethical positioning

**cc-guard respects Anthropic's right to run their service the way they see fit.**

**cc-guard also respects your right** to know what your tool does and to self-regulate based on that knowledge. The entire source is MIT-licensed — audit it.

If you want to evade detection, cc-guard is the wrong tool. Look at [`motiful/cc-gateway`](https://github.com/motiful/cc-gateway) (fingerprint normalization). We took a different path: transparency for the user, neutrality toward Anthropic.

---

# 中文说明

## cc-guard — Claude Code 会话健康观测工具

实时展示你的 Claude Code 正在向 Anthropic 报告什么，并在行为模式偏向"容易触发账号复查"时提前预警。

**cc-guard 只观测，不规避、不代理、不修改任何数据。** 定位是"你自己 Claude Code 风险的 Grafana 仪表盘"。

## 观测哪些信号

- **IP 稳定性** —— 跨国 / 跨 ASN 的 IP 跳变
- **数据中心 IP** —— 内置 ASN 黑名单识别 VPN 回落到云服务器 IP
- **并发 Claude Code session 数**
- **Telemetry 事件速率** —— 盯 `tengu_api_query` / `tengu_streaming_stall` / `tengu_api_auth_failed` / `tengu_api_rate_limited`
- **cc-switch 账号切换频率**
- **DNS 稳定性 + 泄露** —— `/etc/resolv.conf` 变更 + VPN-DNS vs 系统-DNS 对比

## 不做的事

- ❌ 不做 fingerprint 伪装（那是 cc-gateway）
- ❌ 不做 TLS 指纹绕过（那是 dario）
- ❌ 不主动探测 Anthropic 账号状态
- ❌ 不自动操作（杀进程 / 切账号 / 改网络配置）
- ❌ 不上传任何数据到外部服务器

## 安装

前置：[Bun](https://bun.sh) 1.1+。

```bash
git clone https://github.com/ggshr9/cc-guard.git ~/.claude/plugins/local/cc-guard
cd ~/.claude/plugins/local/cc-guard
bun install
bun link
cc-guard doctor
cc-guard run
```

## 协议

MIT License.
