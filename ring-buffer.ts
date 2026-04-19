import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs'
import type { Event, SignalName } from './events'

interface RingBufferOpts {
  file: string
  capacity: number
  retentionMs: number
}

export class RingBuffer {
  private events: Event[] = []
  constructor(private opts: RingBufferOpts) {}

  push(event: Event): void {
    this.prune()
    this.events.push(event)
    if (this.events.length > this.opts.capacity) {
      this.events.splice(0, this.events.length - this.opts.capacity)
    }
  }

  all(): Event[] {
    this.prune()
    return [...this.events]
  }

  /** Return events for `signal` within the last `windowMs`. */
  query(signal: SignalName, windowMs: number): Event[] {
    const cutoff = Date.now() - windowMs
    return this.events.filter(e => e.signal === signal && e.timestamp >= cutoff)
  }

  flush(): void {
    this.prune()
    const tmp = this.opts.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.events) + '\n', { mode: 0o600 })
    renameSync(tmp, this.opts.file)
  }

  load(): void {
    if (!existsSync(this.opts.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.opts.file, 'utf8'))
      if (Array.isArray(parsed)) {
        this.events = parsed.filter(this.isValidEvent)
        this.prune()
      }
    } catch {
      this.events = []
    }
  }

  private prune(): void {
    const cutoff = Date.now() - this.opts.retentionMs
    this.events = this.events.filter(e => e.timestamp >= cutoff)
  }

  private isValidEvent = (x: unknown): x is Event => {
    return typeof x === 'object' && x !== null &&
      typeof (x as Event).timestamp === 'number' &&
      typeof (x as Event).signal === 'string' &&
      typeof (x as Event).severity === 'string'
  }
}
