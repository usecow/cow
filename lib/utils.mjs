import { access } from "fs/promises"
import { relative, resolve } from "path"
import { fileURLToPath } from "url"

export const __dirname = fileURLToPath(new URL('.', import.meta.url))

export const cleanNewlines = (s) => s.replace(/\r\n/g, '\n')
export const normalizePath = (str) => cleanNewlines(str).replace(/[A-z]:\\/g, '\\').replace(/\\+/g, '/')
export const absolutePath = (path) => normalizePath(resolve(process.cwd(), path))
export const relativePath = (path) => normalizePath(relative(__dirname, path))

export const exists = async (filepath) => {
  try {
    await access(filepath)
    return true
  } catch (_) {
    return false
  }
}