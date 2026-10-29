declare module 'node:assert/strict' {
  export function equal(actual: unknown, expected: unknown, message?: string | Error): void
  export function deepEqual(actual: unknown, expected: unknown, message?: string | Error): void
  export function match(actual: string, expected: RegExp, message?: string | Error): void
  const assert: {
    equal: typeof equal
    deepEqual: typeof deepEqual
    match: typeof match
  }
  export default assert
}

declare module 'node:test' {
  export function describe(name: string, fn: () => void): void
  export function it(name: string, fn: () => void | Promise<void>): void
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function join(...paths: string[]): string
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}

interface ImportMeta {
  url: string
}
