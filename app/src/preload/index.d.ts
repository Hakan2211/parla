import type { ParlaApi } from './index'

declare global {
  interface Window {
    parla: ParlaApi
  }
}

export {}
