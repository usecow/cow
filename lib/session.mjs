import cuid2 from '@paralleldrive/cuid2'

export class Store {
  constructor() {}
  async clear() {}
  async gc(maxAge) {}
  async read(id) {}
  async write(id, data) {}
  async touch(id, data) {}
  async destroy(id) {}
  async encode(data) {}
  async decode(data) {}
}

export class MemoryStore extends Store {
  constructor () {
    super()
    this.db = {}
  }

  async clear() {
    this.db = {}
    return true
  }

  async gc(maxAge) {
    for (const id in this.db) {
      await this.touch(id)
    }

    return true
  }

  async read(id) {
    return this.db[id]
  }

  async write(id, data) {
    this.db[id] = { 
      mtime: Date.now(), 
      data: await this.encode(data)
    }

    return true
  }

  async touch(id) {
    const session = await this.read(id)
    if (session && session.mtime + maxAge < Date.now()) {
      await this.destroy(id)
    }
    return true
  }

  async destroy(id) {
    delete this.db[id]
    return true
  }

  async encode(data) {
    return JSON.stringify(data)
  }

  async decode(data) {
    return JSON.parse(data)
  }
}

export class Session {
  constructor(config, store) {
    this.config = config
    this.store = store
    this.createId = cuid2.init({
      length: config.id_length,
      fingerprint: config.id_fingerprint
    })
  }

  async createSession(req) {
    if ((Math.random() * 100) < (this.config.gc_probability * 100)) {
      await this.store.gc(this.config.gc_lifetime)
    }

    const session = req.cookies

    return await this.store.createId()
  }

  async read(id) {
    if (!await this.validateSessionId(id)) {
      return undefined
    }

    await this.store.touch(id)

    const session = await this.store.read(id)
    if (!session) {
      return false
    }

    return session
  }

  async write(id, data) {
    if (!this.validateSessionId(id)) {
      return undefined
    }
  }

  async validateSessionId(id) {
    if (!cuid2.isCuid(id)) {
      return false
    }

    if (!this.store[id]) {
      return false
    }

    return true
  }
}