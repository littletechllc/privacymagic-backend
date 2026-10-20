export interface OutboundEmail {
  to: string
  from: string | { email: string; name?: string }
  replyTo?: string
  subject: string
  text: string
}

export interface Env {
  EMAIL: {
    send(message: OutboundEmail): Promise<{ messageId: string }>
  }
  REPORT_RATE_LIMITER: {
    limit(options: { key: string }): Promise<{ success: boolean }>
  }
  REPORT_TO: string
  REPORT_FROM: string
}
