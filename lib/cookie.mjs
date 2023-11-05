import { parse, serialize } from 'cookie'
import { sign, unsign } from 'cookie-signature'

export default class Cookie {
  static parse(str, options) {
    return parse(str, options)
  }

  static sign(value, secret) {
    return sign(value, secret)
  }

  static unsign(value, secret) {
    return unsign(value, secret)
  }

  constructor (options) {
    this.path = options.path || '/'
    this.domain = options.domain || undefined
    this.maxAge = options.maxAge || null
    this.httpOnly = options.httpOnly || true
    this.sameSite = options.sameSite || false
    this.originalMaxAge = this.maxAge
    this.encode = options.encode || undefined
    this.priority = options.priority || undefined
  }

  set expires(date) {
    this._expires = date
    this.originalMaxAge = this.maxAge
  }

  get expires() {
    return this._expires
  }

  get data() {
    return {
      originalMaxAge: this.originalMaxAge,
      priority: this.priority,
      expires: this.expires,
      secure: this.secure,
      httpOnly: this.httpOnly,
      sameSite: this.sameSite,
      path: this.path,
      domain: this.domain
    }
  }

  serialize(name, value) {
    return serialize(name, value, {
      ...this.data,
      encode: this.encode
    })
  }

  toJSON() {
    return this.data
  }
}