export const DESCRIPTION_MAX_LENGTH = 10_000
export const EMAIL_MAX_LENGTH = 254
export const WEBSITE_MAX_LENGTH = 253
/** UTF-8 ceiling for a maximum-length description plus the other fields. */
export const MAX_BODY_BYTES = 48_000

export type ReportType = 'problem' | 'uninstall'

export interface ProblemReport {
  description: string
  type: ReportType
  email?: string
  website?: string
}

export type ParseResult =
  | { ok: true; report: ProblemReport }
  | { ok: false; error: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/u

export const isDisplayableDomain = (domain: string): boolean => {
  if (domain.length === 0 || domain.length > WEBSITE_MAX_LENGTH) {
    return false
  }
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return false
  }
  return /^[\p{L}\p{N}.-]+$/u.test(domain)
}

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string'

const parseType = (value: unknown): ReportType | { error: string } => {
  if (value === undefined) {
    return 'problem'
  }
  if (value !== 'problem' && value !== 'uninstall') {
    return { error: 'Type must be "problem" or "uninstall".' }
  }
  return value
}

export const parseReport = (body: unknown): ParseResult => {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Expected a JSON object.' }
  }
  const record = body as Record<string, unknown>
  const { description, email, website, type: rawType } = record

  const type = parseType(rawType)
  if (typeof type === 'object') {
    return { ok: false, error: type.error }
  }

  if (typeof description !== 'string') {
    return { ok: false, error: 'Description is required.' }
  }
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    return { ok: false, error: 'Description is too long.' }
  }
  const trimmedDescription = description.trim()
  if (trimmedDescription.length === 0) {
    return { ok: false, error: 'Description is required.' }
  }

  if (!isOptionalString(email)) {
    return { ok: false, error: 'Email must be a string.' }
  }
  let parsedEmail: string | undefined
  if (email != null && email.trim() !== '') {
    const trimmedEmail = email.trim()
    if (
      trimmedEmail.length > EMAIL_MAX_LENGTH ||
      CONTROL_CHARS.test(trimmedEmail) ||
      !EMAIL_PATTERN.test(trimmedEmail)
    ) {
      return { ok: false, error: 'Email address is invalid.' }
    }
    parsedEmail = trimmedEmail
  }

  if (!isOptionalString(website)) {
    return { ok: false, error: 'Website must be a string.' }
  }
  let parsedWebsite: string | undefined
  if (type === 'problem' && website != null && website.trim() !== '') {
    const trimmedWebsite = website.trim()
    if (!isDisplayableDomain(trimmedWebsite)) {
      return { ok: false, error: 'Website is invalid.' }
    }
    parsedWebsite = trimmedWebsite
  }

  return {
    ok: true,
    report: {
      description: trimmedDescription,
      type,
      ...(parsedEmail != null ? { email: parsedEmail } : {}),
      ...(parsedWebsite != null ? { website: parsedWebsite } : {}),
    },
  }
}

export const reportSubject = (report: ProblemReport): string => {
  if (report.type === 'uninstall') {
    return 'Privacy Magic uninstall feedback'
  }
  return report.website != null
    ? `Privacy Magic problem report: ${report.website}`
    : 'Privacy Magic problem report'
}

export const reportText = (report: ProblemReport, submittedAt: Date): string => {
  const lines = [
    `Type: ${report.type}`,
    `Email: ${report.email ?? 'not provided'}`,
    `Submitted: ${submittedAt.toISOString()}`,
    '',
  ]
  if (report.type === 'problem') {
    lines.push(`Website: ${report.website ?? 'not included'}`, '')
  }
  lines.push(report.description)
  return lines.join('\n')
}
