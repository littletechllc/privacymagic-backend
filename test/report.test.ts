import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { Env, OutboundEmail } from '../src/env.ts'
import { handleRequest } from '../src/index.ts'
import { DESCRIPTION_MAX_LENGTH, parseReport } from '../src/report.ts'

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const submittedAt = new Date('2026-10-20T21:00:00.000Z')

const allowAll = async (): Promise<{ success: boolean }> => ({ success: true })

const testEnv = (sent: OutboundEmail[]): Env => ({
  REPORT_TO: 'reports@privacymagic.com',
  REPORT_FROM: 'noreply@reports.privacymagic.com',
  REPORT_RATE_LIMITER: { limit: allowAll },
  EMAIL: {
    async send(message) {
      sent.push(message)
      return { messageId: 'test-message' }
    },
  },
})

const postReport = (body: unknown, init: RequestInit = {}): Request =>
  new Request('https://reports.privacymagic.com/report', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ...init.headers,
    },
    body: JSON.stringify(body),
  })

describe('parseReport', () => {
  it('accepts a description, email, and website', () => {
    assert.deepEqual(
      parseReport({
        description: '  The video player stays blank.  ',
        email: ' person@example.com ',
        website: 'theguardian.com',
      }),
      {
        ok: true,
        report: {
          description: 'The video player stays blank.',
          type: 'problem',
          email: 'person@example.com',
          website: 'theguardian.com',
        },
      },
    )
  })

  it('omits an empty email and website', () => {
    assert.deepEqual(parseReport({ description: 'Broken layout', email: '', website: '  ' }), {
      ok: true,
      report: { description: 'Broken layout', type: 'problem' },
    })
  })

  it('accepts uninstall feedback and ignores website', () => {
    assert.deepEqual(
      parseReport({
        description: 'Too complicated',
        email: 'person@example.com',
        website: 'example.com',
        type: 'uninstall',
      }),
      {
        ok: true,
        report: {
          description: 'Too complicated',
          type: 'uninstall',
          email: 'person@example.com',
        },
      },
    )
  })

  it('rejects a missing, blank, or oversized description', () => {
    assert.equal(parseReport({}).ok, false)
    assert.equal(parseReport({ description: '   ' }).ok, false)
    assert.equal(parseReport({ description: 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1) }).ok, false)
  })

  it('rejects an invalid type', () => {
    assert.equal(parseReport({ description: 'x', type: 'other' }).ok, false)
  })

  it('rejects an email or website that could break the message headers', () => {
    assert.equal(parseReport({ description: 'x', email: 'a@b.com\nBcc: evil@example.com' }).ok, false)
    assert.equal(parseReport({ description: 'x', email: 'not-an-email' }).ok, false)
    assert.equal(parseReport({ description: 'x', website: 'https://example.com/path' }).ok, false)
    assert.equal(parseReport({ description: 'x', website: 'example.com\nBcc: evil@example.com' }).ok, false)
  })
})

describe('handleRequest', () => {
  it('emails the report to the reports mailbox and sets Reply-To', async () => {
    const sent: OutboundEmail[] = []
    const response = await handleRequest(
      postReport({
        description: 'Images never load.',
        email: 'reader@example.com',
        website: 'example.com',
      }),
      testEnv(sent),
      () => submittedAt,
    )

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
    assert.deepEqual(sent, [
      {
        to: 'reports@privacymagic.com',
        from: { email: 'noreply@reports.privacymagic.com', name: 'Privacy Magic' },
        replyTo: 'reader@example.com',
        subject: 'Privacy Magic problem report: example.com',
        text: [
          'Type: problem',
          'Email: reader@example.com',
          'Submitted: 2026-10-20T21:00:00.000Z',
          '',
          'Website: example.com',
          '',
          'Images never load.',
        ].join('\n'),
      },
    ])
  })

  it('sends a report with no reply address when the email is omitted', async () => {
    const sent: OutboundEmail[] = []
    const response = await handleRequest(
      postReport({ description: 'The page is blank.', website: '' }),
      testEnv(sent),
      () => submittedAt,
    )

    assert.equal(response.status, 200)
    assert.equal(sent[0]?.replyTo, undefined)
    assert.match(sent[0]?.text ?? '', /Website: not included/)
    assert.match(sent[0]?.text ?? '', /Email: not provided/)
    assert.match(sent[0]?.text ?? '', /Type: problem/)
    assert.equal(sent[0]?.subject, 'Privacy Magic problem report')
  })

  it('emails uninstall feedback from the reports origin', async () => {
    const sent: OutboundEmail[] = []
    const response = await handleRequest(
      postReport(
        { description: 'Switching browsers.', email: 'reader@example.com', type: 'uninstall' },
        { headers: { origin: 'https://reports.privacymagic.com' } },
      ),
      testEnv(sent),
      () => submittedAt,
    )

    assert.equal(response.status, 200)
    assert.equal(sent[0]?.subject, 'Privacy Magic uninstall feedback')
    assert.match(sent[0]?.text ?? '', /Type: uninstall/)
    assert.equal(/Website:/.test(sent[0]?.text ?? ''), false)
    assert.equal(sent[0]?.replyTo, 'reader@example.com')
  })

  it('keeps an uninstall.html asset for Workers static hosting', () => {
    const html = readFileSync(join(publicDir, 'uninstall.html'), 'utf8')
    assert.match(html, /Thank you for trying Privacy Magic!/)
    assert.match(html, /type: 'uninstall'/)
  })

  it('allows a Firefox extension origin and answers the preflight', async () => {
    const sent: OutboundEmail[] = []
    const origin = 'moz-extension://12345678-abcd-1234-abcd-123456789abc'
    const response = await handleRequest(
      postReport({ description: 'Popup does not open.' }, { headers: { origin } }),
      testEnv(sent),
    )
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('access-control-allow-origin'), origin)

    const preflight = await handleRequest(
      new Request('https://reports.privacymagic.com/report', { method: 'OPTIONS', headers: { origin } }),
      testEnv(sent),
    )
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS')
  })

  it('rejects a website origin before sending mail', async () => {
    const sent: OutboundEmail[] = []
    const response = await handleRequest(
      postReport(
        { description: 'Spam' },
        { headers: { origin: 'https://evil.example' } },
      ),
      testEnv(sent),
    )
    assert.equal(response.status, 403)
    assert.equal(sent.length, 0)
  })

  it('rejects a request that exceeds the rate limit', async () => {
    const sent: OutboundEmail[] = []
    const env = testEnv(sent)
    env.REPORT_RATE_LIMITER = { limit: async () => ({ success: false }) }
    const response = await handleRequest(postReport({ description: 'Again' }), env)
    assert.equal(response.status, 429)
    assert.equal(sent.length, 0)
  })

  it('returns an error when email sending fails', async () => {
    const env = testEnv([])
    env.EMAIL = {
      async send() {
        throw new Error('binding rejected the sender')
      },
    }
    const response = await handleRequest(postReport({ description: 'Still broken' }), env)
    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), { error: 'Could not send the report.' })
  })

  it('rejects other methods, paths, and oversized bodies', async () => {
    const sent: OutboundEmail[] = []
    const env = testEnv(sent)
    assert.equal((await handleRequest(new Request('https://reports.privacymagic.com/report'), env)).status, 405)
    assert.equal((await handleRequest(new Request('https://reports.privacymagic.com/other', { method: 'POST' }), env)).status, 404)

    const oversized = new Request('https://reports.privacymagic.com/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '999999',
      },
      body: '{}',
    })
    assert.equal((await handleRequest(oversized, env)).status, 413)
    assert.equal(sent.length, 0)
  })
})
