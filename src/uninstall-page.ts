import uninstallMessages from './uninstall-messages.json' with { type: 'json' }

export type UninstallMessages = Record<string, string>

const RTL_LANGUAGE_BASES = new Set(['ar', 'fa', 'he'])

const MESSAGE_KEYS = [
  'uninstallPageTitle',
  'uninstallHeading',
  'uninstallBody',
  'uninstallFeedbackInvite',
  'uninstallDescriptionLabel',
  'uninstallEmailLabel',
  'uninstallEmailInvalid',
  'uninstallSubmit',
  'uninstallSubmissionFailed',
  'uninstallThanks',
  'uninstallThanksWithEmail',
] as const

export const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

export const resolveUninstallLocale = (
  hl: string | null,
  acceptLanguage: string | null = null,
): string => {
  const catalog = uninstallMessages as Record<string, UninstallMessages>
  const candidates: string[] = []
  if (hl != null && hl.trim() !== '') {
    candidates.push(hl.trim())
  }
  if (acceptLanguage != null && acceptLanguage.trim() !== '') {
    for (const part of acceptLanguage.split(',')) {
      const tag = part.split(';', 1)[0]?.trim()
      if (tag != null && tag !== '') {
        candidates.push(tag)
      }
    }
  }
  candidates.push('en')

  const locales = Object.keys(catalog)
  for (const candidate of candidates) {
    const normalized = candidate.replaceAll('-', '_')
    if (catalog[normalized] != null) {
      return normalized
    }
    const lower = normalized.toLowerCase()
    const exact = locales.find((locale) => locale.toLowerCase() === lower)
    if (exact != null) {
      return exact
    }
    const base = normalized.split('_', 1)[0] ?? normalized
    if (catalog[base] != null) {
      return base
    }
    const baseLower = base.toLowerCase()
    const prefixed = locales.find((locale) => {
      const localeLower = locale.toLowerCase()
      return localeLower === baseLower || localeLower.startsWith(`${baseLower}_`)
    })
    if (prefixed != null) {
      return prefixed
    }
  }
  return 'en'
}

export const renderUninstallPage = (
  template: string,
  hl: string | null,
  acceptLanguage: string | null = null,
): string => {
  const catalog = uninstallMessages as Record<string, UninstallMessages>
  const locale = resolveUninstallLocale(hl, acceptLanguage)
  const messages = catalog[locale] ?? catalog.en
  if (messages == null) {
    throw new Error('Missing English uninstall messages.')
  }

  const lang = locale.replaceAll('_', '-')
  const base = lang.split('-', 1)[0]?.toLowerCase() ?? 'en'
  const dir = RTL_LANGUAGE_BASES.has(base) ? 'rtl' : 'ltr'

  let html = template
  html = html.replaceAll('{{lang}}', escapeHtml(lang))
  html = html.replaceAll('{{dir}}', dir)
  for (const key of MESSAGE_KEYS) {
    html = html.replaceAll(`{{${key}}}`, escapeHtml(messages[key] ?? ''))
  }
  return html
}
