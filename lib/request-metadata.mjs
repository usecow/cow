import { isIP } from 'node:net'

function invalidHost() {
  return Object.assign(new Error('Expected one valid Host authority (hostname or bracketed IPv6, with an optional port)'), {
    status: 400, code: 'COW_INVALID_HOST'
  })
}

// Host is client input, not a configured/trusted origin. Keep an explicit port
// (including :80 / :443); do not invent one from the listener or request URL.
export function requestHost(headers = {}) {
  const supplied = Object.entries(headers || {}).filter(([name]) => name.toLowerCase() === 'host')
  if (!supplied.length) return null
  if (supplied.length !== 1) throw invalidHost()
  let value = supplied[0][1]
  if (Array.isArray(value)) {
    if (value.length !== 1) throw invalidHost()
    value = value[0]
  }
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 1024) throw invalidHost()
  // Deliberately accept ASCII hostnames (punycode for IDNs), IPv4 spellings
  // and IPv6 literals, not a permissively repaired URL or a list of hosts.
  const match = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9._-]+)(?::([0-9]+))?$/.exec(value)
  if (!match || (match[1].startsWith('[') && isIP(match[1].slice(1, -1)) !== 6) ||
      (match[2] !== undefined && Number(match[2]) > 65535)) throw invalidHost()
  return match[1].toLowerCase() + (match[2] === undefined ? '' : `:${Number(match[2])}`)
}

export function connectionMetadata({ remoteAddress = null, scheme = null } = {}) {
  if (remoteAddress !== null && (typeof remoteAddress !== 'string' || !isIP(remoteAddress))) {
    throw new TypeError('remoteAddress must be an IP address or null')
  }
  if (scheme !== null && !['http', 'https'].includes(scheme)) throw new TypeError('scheme must be http, https or null')
  return { remoteAddress, scheme }
}

// Called while the IncomingMessage still owns its live socket. No forwarded,
// real-IP, Host or request-target value can claim connection encryption/address.
export function httpConnection(req) {
  return {
    remoteAddress: req.socket?.remoteAddress ?? null,
    scheme: req.socket ? (req.socket.encrypted === true ? 'https' : 'http') : null
  }
}
