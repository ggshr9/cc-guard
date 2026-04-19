import type { Alert } from '../events'

export interface AlertBackend {
  name: string
  send(alert: Alert): Promise<void>
}
