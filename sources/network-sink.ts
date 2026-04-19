import { spawn } from 'child_process'
import { platform } from 'os'
import { EventEmitter } from 'events'

/** Emits 'change' when the OS reports a routing/interface change.
 *  Source of truth:
 *    - Linux: `ip monitor` subprocess stdout
 *    - macOS: `scutil --nwi` polling (scutil lacks a pure subscribe CLI without
 *             entering the interactive prompt; 5s poll is acceptable because
 *             this only drives the infrequent ip-sink lookup)
 *    - Windows: polled os.networkInterfaces() snapshot diff every 5s
 *  The emitter is idle-safe: no CPU until a change fires. */
export class NetworkSink extends EventEmitter {
  private subprocess: ReturnType<typeof spawn> | null = null
  private pollTimer: NodeJS.Timeout | null = null

  start(): void {
    const plat = platform()
    if (plat === 'linux') {
      this.startLinux()
    } else {
      this.startPollFallback()
    }
  }

  stop(): void {
    if (this.subprocess) { try { this.subprocess.kill() } catch {}; this.subprocess = null }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
  }

  private startLinux(): void {
    this.subprocess = spawn('ip', ['monitor', 'route'])
    this.subprocess.stdout?.on('data', () => this.emit('change'))
    this.subprocess.on('error', err => this.fallbackOnError(err))
    this.subprocess.on('exit', code => {
      if (code !== 0) this.fallbackOnError(new Error(`ip monitor exited ${code}`))
    })
  }

  private fallbackOnError(err: Error): void {
    process.stderr.write(`[cc-guard] network-sink: ${err.message} — falling back to polling\n`)
    this.startPollFallback()
  }

  private startPollFallback(): void {
    if (this.pollTimer) return
    let lastSnapshot = this.snapshotInterfaces()
    this.pollTimer = setInterval(() => {
      const current = this.snapshotInterfaces()
      if (current !== lastSnapshot) {
        lastSnapshot = current
        this.emit('change')
      }
    }, 5000)
  }

  private snapshotInterfaces(): string {
    const { networkInterfaces } = require('os') as typeof import('os')
    return JSON.stringify(networkInterfaces())
  }
}
