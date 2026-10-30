import type { Env, OutboundEmail } from './env.ts'
import {
  MAX_BODY_BYTES,
  parseReport,
  reportSubject,
  reportText,
  type ProblemReport,
} from './report.ts'
import { renderUninstallPage } from './uninstall-page.ts'

const REPORT_PATHS = new Set(['/', '/report'])
const UNINSTALL_PATH = '/uninstall'
const REPORTS_ORIGIN = 'https://reports.privacymagic.com'

export const isExtensionOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin)
    return url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:'
  } catch {
    return false
  }
}

export const isAllowedOrigin = (origin: string): boolean =>
  isExtensionOrigin(origin) || origin === REPORTS_ORIGIN

const responseHeaders = (origin: string | null): Headers => {
  const headers = new Headers({
    'cache-control': 'no-store',
  })
  if (origin != null && isAllowedOrigin(origin)) {
    headers.set('access-control-allow-origin', origin)
    headers.set('vary', 'Origin')
    headers.set('access-control-allow-methods', 'POST, OPTIONS')
    headers.set('access-control-allow-headers', 'Content-Type')
    headers.set('access-control-max-age', '86400')
  }
  return headers
}

const jsonResponse = (status: number, body: unknown, origin: string | null): Response => {
  const headers = responseHeaders(origin)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers })
}

const emptyResponse = (status: number, origin: string | null): Response =>
  new Response(null, { status, headers: responseHeaders(origin) })

const uninstallPageResponse = (
  hl: string | null,
  acceptLanguage: string | null,
  template: string,
): Response =>
  new Response(renderUninstallPage(template, hl, acceptLanguage), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      vary: 'Accept-Language',
    },
  })

const clientKey = (request: Request): string => {
  const ip = request.headers.get('CF-Connecting-IP')?.trim() ?? ''
  if (ip.length > 0 && ip.length <= 128 && !/[\u0000-\u001F\u007F]/u.test(ip)) {
    return ip
  }
  return 'unknown'
}

const readLimitedBody = async (request: Request): Promise<Uint8Array | 'too-large'> => {
  const declared = request.headers.get('content-length')
  if (declared != null) {
    const length = Number(declared)
    if (!Number.isInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
      return 'too-large'
    }
  }
  if (request.body == null) {
    return new Uint8Array()
  }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    received += value.byteLength
    if (received > MAX_BODY_BYTES) {
      await reader.cancel()
      return 'too-large'
    }
    chunks.push(value)
  }
  const body = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

const decodeJson = (bytes: Uint8Array): { ok: true; value: unknown } | { ok: false } => {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return { ok: false }
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

const isJsonContentType = (request: Request): boolean => {
  const contentType = request.headers.get('content-type')
  if (contentType == null) {
    return false
  }
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase()
  return mediaType === 'application/json'
}

const outboundMessage = (env: Env, report: ProblemReport, submittedAt: Date): OutboundEmail => ({
  to: env.REPORT_TO,
  from: { email: env.REPORT_FROM, name: 'Privacy Magic' },
  subject: reportSubject(report),
  text: reportText(report, submittedAt),
  ...(report.email != null ? { replyTo: report.email } : {}),
})

export const createHandleRequest = (uninstallTemplate: string) => {
  return async (
    request: Request,
    env: Env,
    now: () => Date = () => new Date(),
  ): Promise<Response> => {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')

    if (url.pathname === UNINSTALL_PATH) {
      if (request.method === 'GET') {
        return uninstallPageResponse(
          url.searchParams.get('hl'),
          request.headers.get('Accept-Language'),
          uninstallTemplate,
        )
      }
      if (request.method === 'HEAD') {
        const page = uninstallPageResponse(
          url.searchParams.get('hl'),
          request.headers.get('Accept-Language'),
          uninstallTemplate,
        )
        return new Response(null, { status: page.status, headers: page.headers })
      }
      return jsonResponse(405, { error: 'Use GET.' }, origin)
    }

    if (!REPORT_PATHS.has(url.pathname)) {
      return jsonResponse(404, { error: 'Not found.' }, origin)
    }

    if (request.method === 'OPTIONS') {
      if (origin != null && !isAllowedOrigin(origin)) {
        return jsonResponse(403, { error: 'Origin is not allowed.' }, origin)
      }
      return emptyResponse(204, origin)
    }

    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Use POST.' }, origin)
    }

    if (origin != null && !isAllowedOrigin(origin)) {
      return jsonResponse(403, { error: 'Origin is not allowed.' }, origin)
    }

    let allowed = false
    try {
      const result = await env.REPORT_RATE_LIMITER.limit({ key: clientKey(request) })
      allowed = result.success
    } catch (error) {
      console.error('report rate limiter failed', error)
      return jsonResponse(503, { error: 'Try again later.' }, origin)
    }
    if (!allowed) {
      return jsonResponse(429, { error: 'Too many reports. Try again in a minute.' }, origin)
    }

    if (!isJsonContentType(request)) {
      return jsonResponse(415, { error: 'Content-Type must be application/json.' }, origin)
    }

    const bytes = await readLimitedBody(request)
    if (bytes === 'too-large') {
      return jsonResponse(413, { error: 'Report is too large.' }, origin)
    }
    const decoded = decodeJson(bytes)
    if (!decoded.ok) {
      return jsonResponse(400, { error: 'Invalid JSON.' }, origin)
    }
    const parsed = parseReport(decoded.value)
    if (!parsed.ok) {
      return jsonResponse(400, { error: parsed.error }, origin)
    }

    try {
      await env.EMAIL.send(outboundMessage(env, parsed.report, now()))
    } catch (error) {
      console.error('report email failed', error)
      return jsonResponse(502, { error: 'Could not send the report.' }, origin)
    }

    return jsonResponse(200, { ok: true }, origin)
  }
}
