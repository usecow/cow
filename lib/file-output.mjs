import { open } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'

export function downloadDisposition(filename) {
  if (typeof filename !== 'string' || !filename || filename.length > 255 || /[\x00-\x1f\x7f/\\]/.test(filename) || /^\.+$/.test(filename)) {
    throw new TypeError('A download filename must be a nonempty filename without paths or control characters (at most 255 characters)')
  }
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g,'_')
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

export async function openOutputFile(path, download, filename) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new TypeError('File output requires an explicit absolute path')
  const headers = download ? {'content-disposition':downloadDisposition(filename ?? basename(path))} : {}
  let file
  try {
    file = await open(path,'r')
    const info = await file.stat()
    if (!info.isFile()) throw Object.assign(new Error('File output requires a regular file'),{code:'COW_FILE_NOT_REGULAR'})
    if (!Number.isSafeInteger(info.size)) throw new RangeError('File size exceeds the supported integer range')
    return {
      size:info.size, headers, close:()=>file.close(),
      source:(async function* () {
        const buffer = Buffer.allocUnsafe(65_536)
        for (let offset=0;offset<info.size;) {
          const {bytesRead} = await file.read(buffer,0,Math.min(buffer.length,info.size-offset),offset)
          if (!bytesRead) throw Object.assign(new Error('File ended before its declared length'),{code:'COW_FILE_CHANGED'})
          offset += bytesRead
          yield buffer.subarray(0,bytesRead)
        }
      })()
    }
  } catch (error) {
    await file?.close()
    if (['ENOENT','ENOTDIR'].includes(error.code)) error.status = 404
    throw error
  }
}
