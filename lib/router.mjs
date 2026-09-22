import { realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { templateExtensions, templateFormat } from './template-format.mjs'

const PUBLIC_EXTENSIONS = new Set(['.css', '.gif', '.htm', '.html', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.txt', '.webp', '.xml', '.woff', '.woff2', '.avif', '.pdf'])
const ASSET_EXTENSIONS = new Set([...PUBLIC_EXTENSIONS, '.js', '.mjs', '.json'])

export class RouteError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'RouteError'
    this.status = status
  }
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

function containedPath(root, pathname) {
  const candidate = resolve(root, `.${pathname.replaceAll('/', sep)}`)
  const difference = relative(root, candidate)

  if (difference === '..' || difference.startsWith(`..${sep}`) || isAbsolute(difference)) {
    throw new RouteError(403, 'Path is outside the Cow application root')
  }

  return candidate
}

export class Router {
  constructor(rootDir) {
    this.rootDir = resolve(rootDir)
  }

  async resolve(rawUrl) {
    let pathname
    try {
      pathname = decodeURIComponent(new URL(rawUrl, 'http://cow.local').pathname)
    } catch {
      throw new RouteError(400, 'Malformed request URL')
    }

    // Reject alternate Windows separators, drive/ADS syntax, and control bytes
    // before applying URL segment policy.
    if (/[\\:\x00-\x1f\x7f]/.test(pathname)) throw new RouteError(400, 'Malformed request path')

    const segments = pathname.split('/').filter(Boolean)
    if (segments.some((segment) => segment.startsWith('_') || segment.startsWith('.') || /[. ]$/.test(segment) || segment.toLowerCase() === 'node_modules')) {
      throw new RouteError(404, 'Resource not found')
    }

    const direct = containedPath(this.rootDir, pathname)
    const extension = extname(direct).toLowerCase()

    // Template extensions are implementation details and are not public URLs.
    if (templateFormat(direct)) {
      throw new RouteError(404, 'Resource not found')
    }

    if (extension) {
      const allowed = segments[0] === 'assets' ? ASSET_EXTENSIONS : PUBLIC_EXTENSIONS
      if (allowed.has(extension) && await isFile(direct)) {
        return { kind: 'static', filePath: await this.publicPath(direct, true) }
      }
      throw new RouteError(404, 'Resource not found')
    }

    const bases = pathname.endsWith('/') ? [resolve(direct, 'index')] : [direct]
    if (!pathname.endsWith('/')) bases.push(resolve(direct, 'index'))

    for (const base of bases) {
      for (const templateExtension of templateExtensions) {
        const filePath = `${base}${templateExtension}`
        if (await isFile(filePath)) return { kind: 'template', filePath: await this.publicPath(filePath) }
      }
    }

    throw new RouteError(404, 'Resource not found')
  }

  async publicPath(filePath, staticFile = false) {
    const root = await realpath(this.rootDir)
    const canonical = await realpath(filePath)
    const difference = relative(root, canonical)
    const allowed = difference.split(sep)[0] === 'assets' ? ASSET_EXTENSIONS : PUBLIC_EXTENSIONS
    // Symlinks may not expose private files or files outside the application.
    if (difference.startsWith(`..${sep}`) || difference === '..' || isAbsolute(difference) ||
        difference.split(sep).some((part) => part.startsWith('_') || part.startsWith('.') || part.toLowerCase() === 'node_modules') ||
        extname(canonical).toLowerCase() !== extname(filePath).toLowerCase() ||
        (staticFile && !allowed.has(extname(canonical).toLowerCase()))) {
      throw new RouteError(404, 'Resource not found')
    }
    return canonical
  }
}
