import convict from 'convict'
import ini from 'ini'

const chunkString = (str, n) => {
  let arr = str?.split(' ')
  let result = []
  let subStr = arr[0]

  for (let i = 1; i < arr.length; i++) {
    let word = arr[i]
    if (subStr.length + word.length + 1 <= n){
      subStr = subStr + ' ' + word
    } else {
      result.push(subStr)
      subStr = word
    }
  }

  if (subStr.length) {
    result.push(subStr)
  }

  return result
}

convict.addParser({
  extension: 'ini',
  parse: ini.decode
})

convict.addFormat({
  name: 'enum',
  validate: (val, schema) => {
    if (schema.oneOf === undefined) {
      throw new Error('property "oneOf" must be defined on schema')
    }

    if (!Array.isArray(schema.oneOf)) {
      throw new Error('property "oneOf" must be of type Array')
    }

    if (!schema.oneOf.includes(val)) {
      throw new TypeError(`must be one of ${schema.enum.toString()}`)
    }
  }
})

convict.addFormat({
  name: 'int-range',
  validate: (val, schema) => {
    let min = schema.min || -Infinity
    let max = schema.max || Infinity

    if (typeof min !== 'number') {
      throw new Error('property "min" must be of type Number')
    }

    if (typeof max !== 'number') {
      throw new Error('property "max" must be of type Number')
    }

    if (val < min) {
      throw new TypeError(`must be greater than ${min}`)
    }

    if (val > max) {
      throw new TypeError(`must be less than ${max}`)
    }
  },
  coerce: (val) => parseInt(val, 10)
})

convict.addFormat({
  name: 'float-percent',
  validate: function(val) {
    if (val !== 0 && (!val || val > 1 || val < 0)) {
      throw new Error('must be a float between 0 and 1, inclusive')
    }
  },
  coerce: function(val) {
    return parseFloat(val, 10)
  }
})

const configOptions = {
  log: {
    'errors': {
      doc: 'Specifies whether to log errors',
      default: true,
      format: Boolean,
      env: 'LOG_ERRORS',
      arg: 'logErrors',
      flags: '--no-log-errors'
    },
    'warnings': {
      doc: 'Specifies whether to log warnings',
      default: true,
      format: Boolean,
      env: 'LOG_WARNINGS',
      arg: 'logWarnings',
      flags: '--no-log-warnings'
    },
    'debug': {
      doc: 'pecifies whether to log debug messages',
      default: false,
      format: Boolean,
      env: 'LOG_DEBUG',
      arg: 'logDebug',
      flags: '--debug'
    },
    'timings': {
      doc: 'Specifies whether to log compiler timings',
      default: false,
      format: Boolean,
      env: 'LOG_TIMINGS',
      arg: 'logTimings',
      flags: '--log-timings'
    },
  },
  server: {
    'root_dir': {
      doc: 'Root directory for the server',
      default: './src',
      format: String,
      env: 'SERVER_ROOT_DIR',
      arg: 'directory',
    },
    'host': {
      doc: 'Host URL for the server',
      default: 'localhost',
      format: String,
      env: 'SERVER_HOST',
      arg: 'host',
      flags: '-h, --host <host>'
    },
    'port': {
      doc: 'Port that the server should run on',
      default: 8000,
      format: Number,
      env: 'SERVER_PORT',
      arg: 'port',
      flags: '-p, --port <port>'
    }
  },
  session: {
    'enable': {
      doc: 'Specifies whether the built-in session module is enabled.',
      default: false,
      format: Boolean,
      env: 'SESSION_ENABLE',
      arg: 'sessionEnable',
      flags: '--session-enable'
    },
    'dir': {
      doc: 'Directory where sessions should be stored.',
      default: '/tmp/.jsr',
      format: String,
      env: 'SESSION_DIR',
      arg: 'sessionDir',
      flags: '--session-dir <dir>'
    },
    'handler': {
      doc: 'Specifies the handler the server uses to store and lookup sessions.',
      default: 'memory',
      format: 'enum',
      oneOf: ['files','memory'],
      env: 'SESSION_HANDLER',
      arg: 'sessionHandler',
      flags: '--session-handler <handler>'
    },
    'id_length': {
      doc: 'Controls the length of the session identifier.',
      default: 32,
      format: 'int-range',
      min: 22,
      max: 256,
      env: 'SESSION_ID_LENGTH',
      arg: 'sessionIdLength',
      flags: '--session-id-length <length>'
    },
    'id_fingerprint': {
      doc: 'Custom identifier to help prevent collisions when generating identifiers.',
      default: '',
      format: String,
      env: 'SESSION_ID_FINGERPRINT',
      arg: 'sessionIdFingerprint',
      flags: '--session-id-fingerprint <string>'
    },
    'cookie_name': {
      doc: 'Specifies the name to be used for the session cookie.',
      default: 'JSRSESSION',
      format: String,
      env: 'SESSION_COOKIE_NAME',
      arg: 'sessionCookieName',
      flags: '--session-cookie-name <name>'
    },
    'cookie_lifetime': {
      doc: 'Specifies the lifetime of the cookie in seconds which is sent to the browser. The value 0 means until the browser is closed.',
      default: 0,
      format: 'nat',
      env: 'SESSION_COOKIE_LIFETIME',
      arg: 'sessionCookieLifetime',
      flags: '--session-cookie-lifetime <seconds>'
    },
    'cookie_path': {
      doc: 'Specifies the path to set in the session cookie.',
      default: '/',
      format: String,
      env: 'SESSION_COOKIE_NAME',
      arg: 'sessionCookiePath',
      flags: '--session-cookie-path <path>'
    },
    'cookie_domain': {
      doc: 'Specifies the domain to set in the session cookie. Where none is the host name of the server that generated the cookie.',
      default: '',
      format: String,
      env: 'SESSION_COOKIE_DOMAIN',
      arg: 'sessionCookieDomain',
      flags: '--session-cookie-domain <domain>'
    },
    'cookie_secure': {
      doc: 'Specifies whether cookies should only be sent over secure connections.',
      default: false,
      format: Boolean,
      env: 'SESSION_COOKIE_SECURE',
      arg: 'sessionCookieSecure',
      flags: '--session-cookie-secure'
    },
    'cookie_httponly': {
      doc: 'Marks the cookie as accessible only through the HTTP protocol. This means that the cookie won\'t be accessible by scripting languages, such as JavaScript.',
      default: false,
      format: Boolean,
      env: 'SESSION_COOKIE_HTTPONLY',
      arg: 'sessionCookieHttponly',
      flags: '--session-cookie-httponly'
    },
    'cookie_samesite': {
      doc: 'Allows servers to assert that a cookie ought not to be sent along with cross-site requests. This assertion allows user agents to mitigate the risk of cross-origin information leakage, and provides some protection against cross-site request forgery attacks. Note that this is not supported by all browsers. An empty value means that no SameSite cookie attribute will be set. Lax and Strict mean that the cookie will not be sent cross-domain for POST requests; Lax will sent the cookie for cross-domain GET requests, while Strict will not.',
      default: '',
      format: 'enum',
      oneOf: ['','strict','lax'],
      env: 'SESSION_COOKIE_SAMESITE',
      arg: 'sessionCookieSamesite',
      flags: '--session-cookie-samesite'
    },
    'gc_probability': {
      doc: 'Specifies the probability out of 100 that the garbage collection (GC) process is started on session initalization.',
      default: 1,
      format: 'float-percent',
      env: 'SESSION_GC_PROBABILITY',
      arg: 'sessionGcProbability',
      flags: '--session-gc-probability <float>'
    },
    'gc_lifetime': {
      doc: 'Specifies the number of seconds after which data will be seen as "garbage" and potentially cleaned up.',
      default: 1440,
      format: 'nat',
      env: 'SESSION_GC_LIFETIME',
      arg: 'sessionGcLifetime',
      flags: '--session-gc-lifetime <seconds>'
    },
  },
  compiler: {
    'enable_cache': {
      doc: 'Specifies whether the processor should cache JIT compiled code for each request.',
      default: true,
      format: Boolean,
      env: 'COMPILER_ENABLE_CACHE',
      arg: 'compilerEnableCache'
    },
    'cache_max_items': {
      doc: 'Specifies the maximum number of items allowed in the compiler cache.',
      default: 500,
      format: 'nat',
      env: 'COMPILER_CACHE_MAX_ITEMS',
      arg: 'compilerCacheMaxItems'
    },
    'cache_lifetime': {
      doc: 'Specifies the number of seconds cached JIT compiled code should live in memory.',
      default: 3600,
      format: 'nat',
      env: 'COMPILER_CACHE_LIFETIME',
      arg: 'compilerCacheLifetime'
    },
    'tags_open': {
      doc: 'Opening tag used for parsing shorthand and the beginning of mode logic blocks',
      default: '<?',
      format: String,
      env: 'COMPILER_TAGS_OPEN',
      arg: 'compilerTagsOpen'
    },
    'tags_close': {
      doc: 'Closing tag used for parsing shorthand, logic, and echo blocks',
      default: '?>',
      format: String,
      env: 'COMPILER_TAGS_CLOSE',
      arg: 'compilerTagsClose'
    },
    'tags_echo_symbol': {
      doc: 'Symbol used for parsing echo shorthand. This is appended to compiler.tags_open',
      default: '=',
      format: String,
      env: 'COMPILER_TAGS_ECHO_SYMBOL',
      arg: 'compilerTagsEchoSymbol'
    },
  }
}

const generateConfig = (config, opts) => {
  const exampleConfig = []

  for (const section in config) {
    const options = config[section]

    exampleConfig.push(`[${section}]`)

    for (const option in options) {
      const info = options[option]
      const format = typeof info.format === 'function' ? typeof info.default : info.format 

      exampleConfig.push(`; ${section}.${option} (${format})`)

      if (info.doc !== undefined) {
        let doc = chunkString(info.doc, 65)
        for (const chunk of doc) {
          exampleConfig.push(`;   ${chunk}`)
        }
        exampleConfig.push(`;`)
      }

      if (info.default !== undefined) {
        exampleConfig.push(`;   Default Value: ${info.default}`)
      }

      if (info.oneOf && Array.isArray(info.oneOf)) {
        exampleConfig.push(`;   Allowed Values: ${info.oneOf}`)
      }

      if (info.format === 'int-range') {
        exampleConfig.push(`;   Min Value: ${info.min || -Infinity}`)
        exampleConfig.push(`;   Max Value: ${info.max || Infinity}`)
      }

      if (info.format === 'nat') {
        exampleConfig.push(`;   Min Value: 0`)
      }

      exampleConfig.push(ini.stringify({
        [option]: info.default
      }))
    }

    exampleConfig.push('')
  }

  writeFileSync(opts.path, exampleConfig.join('\r\n'))
}

export { convict, configOptions, generateConfig }