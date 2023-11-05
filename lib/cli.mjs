#!/usr/bin/env -S node --no-warnings --experimental-vm-modules

import { join, dirname, resolve, basename, extname } from 'path'
import { exists, absolutePath, normalizePath, relativePath } from './utils.mjs'
import { convict, configOptions, generateConfig } from './config.mjs'
import info from '../package.json' assert { type: 'json' }
import { Command, Option, Argument } from 'commander'
import { Session, MemoryStore } from './session.mjs'
import { readFile, stat } from 'fs/promises'
import { PluginSystem } from './plugin.mjs'
import { pathToFileURL, URL } from 'url'
import { caching } from 'cache-manager'
import { Worker } from 'worker_threads'
import { pinoHttp } from 'pino-http'
import { createServer } from 'http'
import Cookie from './cookie.mjs'
import timeSpan from 'time-span'
import { pino } from 'pino'
import ts from 'typescript'
import send from 'send'

// Initialize Constants

const regexImport = / from ["'](?<filepath>(?:\.?\/|\~\/)[^"']+)["'];?/gm
const regexStackFilename = /name=([^;]+)/
const regexStackPosition = /:(\d+):(\d+)/
const program = new Command()

let app = null
let args = null

// Initialize CLI Utilities

const generateProgramOptions = (program, config) => {
  for (const section in config) {
    const options = config[section]

    for (const option in options) {
      const info = options[option]
      if (!info.flags) continue;

      const opt = new Option(info.flags, info.doc)

      if (info.default !== undefined) {
        opt.default(info.default)
      }

      if (info.oneOf && Array.isArray(info.oneOf)) {
        opt.choices(info.oneOf)
      }

      program.addOption(opt)
    }
  }
}

// Initialize Classes

class ErrorHandler {
  constructor (response) {
    this.response = response
  }

  #send () {
    this.response.statusCode = this.code
    this.response.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>HTTP Status ${this.code} – ${this.title}</title>
        <style>
          body { font-family:Tahoma,Arial,sans-serif; }
          h1, h2, h3, b { color:white; background-color:#958275; }
          h1 { font-size:22px; }
          h2 { font-size:16px; }
          h3 { font-size:14px; }
          p { font-size:12px; }
          a { color:black; }
          hr { height:1px; background-color:#958275; border:none; }
        </style>
      </head>
      <body>
        <h1>HTTP Status ${this.code} – ${this.title}</h1>
        <hr />
        <p><b>message</b> ${this.message}</p>
        <hr />
        <h3>JavaScript Hypertext Preprocessor/${info.version}</h3>
      </body>
      </html>
    `)
  }

  NotFound() {
    this.code = 404
    this.title = 'File Not Found'
    this.message = 'The requested resource is not available.'
    return this.#send()
  }

  InternalServerError(message, stack) {
    this.code = 500
    this.title = 'Internal Server Error'
    this.message = 'The server encountered an internal error that prevented this request from being fulfilled.'
    app.server.httpLogger.logger.error({ err: { type: 'Error', message, stack } })
    return this.#send()
  }
}

class Compiler {
  constructor (app) {
    this.app = app
    this.log = app.logger.child({ name: 'compiler' })
    this.config = this.app.get('compiler')
    this.rootDir = this.app.get('server.root_dir')
  }

  async init() {
    if (this.config.enable_cache) {
      this.cache = await caching('memory', {
        max: this.config.cache_max_items,
        ttl: this.config.cache_lifetime * 1000,
      })
    }
  }

  async getModule(path) {
    let module = null

    if (!this.config.enable_cache) {
      this.log.debug('Cache is not enabled, compiling module')
      module = new Module(path)
      await module.compile(this.app)
      return module
    }

    module = await this.cache.get(path)
    if (!module) {
      this.log.debug('Cache enabled, module not found in cache, compiling')
      module = new Module(path)
      await module.compile(this.app)
      module.lastModified = Date.now()
      await this.cache.set(path, module)
      return module
    }

    const stats = await stat(path)
    if (module.lastModified < stats.mtime) {
      this.log.debug('Cache enabled, module recently edited, compiling')
      module = new Module(path)
      await module.compile(this.app)
      module.lastModified = Date.now()
      await this.cache.set(path, module)
      return module
    }

    this.log.debug('Cache enabled, module found in cache, serving')
    module.timings = {}
    return module
  }
}

class Module {
  static LANGUAGES = {
    'js': '.jsp',
    'ts': '.tsp'
  }

  static EXT_IMPORTS = {
    'ts': '.ts',
    'js': '.mjs'
  }

  static EXT = {
    '.tsp': 'ts',
    '.jsp': 'js'
  }

  constructor(path) {
    this.filepath = path
    this.ext = extname(this.filepath)
    this.language = Module.EXT[this.ext]
    if (!this.language) {
      throw new Error(`Unsupported module extension ${this.ext}`)
    }
    this.extImport = Module.EXT_IMPORTS[this.language]
  }

  getWorker(req, res) {
    this.buildRequest(req)
    this.buildRequestSession(req)
    this.buildResponse(res)

    return new Worker(new URL(
      `data:text/javascript;name=${this.filepath};base64,${this.codeBase64}`
    ), {
      workerData: {
        __filename: this.filename,
        __dirname: this.filedir,
        __req: this.request, 
        __res: this.response
      }
    })
  }

  async compile(app) {
    const timer = timeSpan()
    this.timings = {}
    await this.#read(app)
    this.#tokenize(app)
    await this.#build(app)
    this.timings.compile = timer() && timer.seconds()
  }

  buildRequest(req) {
    this.request = {}

    // The API requires a fully qualified url, so we use the request host 
    // or fallback to `localhost` as a hack. Note: we only use this to get
    // the query string as an object
    this.url = new URL(`https://${req.host || 'localhost:3000'}/${req.url}`)

    // We do skips because maybe the user wants to do some custom
    // logic that we can't implement through other ways
    this.request._statusCode = false
    this.request._skipHeaders = false
    this.request._skipEnd = false

    // Build objects
    this.request._url = req.url
    this.request._params = Object.fromEntries(this.url.searchParams);
    this.request._headers = req.headers

    // Note: We need to handle different content types here later.
    this.request._body = req.body
  }

  buildResponse(res) {
    this.response = {}
    this.response._statusCode = null
    this.response._headers = {}
  }

  buildRequestSession(req) {
    // const shouldAutostart = app.get('session.autostart')
    // const sessionExists = this.response.headers
    // if (shouldAutostart) {
    //   app.session.init()
    // }
  }

  async #read() {
    const timer = timeSpan()
    this.stats = await stat(this.filepath)
    this.content = await readFile(this.filepath)
    this.filedir = resolve(dirname(this.filepath))
    this.fileext = extname(this.filepath).substring(1)
    this.moduleName = basename(this.filepath, this.ext)
    this.moduleFileName = this.moduleName + Module.EXT_IMPORTS[this.language]
    this.timings.read = timer() && timer.seconds()
  }

  #tokenize(app) {
    const timer = timeSpan()
    const TAG_CLOSE = app.get('compiler.tags_close')
    const TAG_OPEN = app.get('compiler.tags_open')
    const TAG_CODE = TAG_OPEN + this.language
    const TAG_ECHO = TAG_OPEN + app.get('compiler.tags_echo_symbol')
    const tokens = [];
    const text = this.content;

    let currentPosition = 0;
    while (currentPosition < text.length) {
      const echoOpeningTagIndex = text.indexOf(TAG_ECHO, currentPosition)
      const codeOpeningTagIndex = text.indexOf(TAG_CODE, currentPosition)

      const nextTags = [
        { type: 'ECHO_OPENING_TAG', value: TAG_ECHO, index: echoOpeningTagIndex },
        { type: 'CODE_OPENING_TAG', value: TAG_CODE, index: codeOpeningTagIndex }
      ]

      nextTags.sort((a, b) => a.index - b.index)
      const nextTag = nextTags.find(tag => tag.index !== -1)

      if (!nextTag) {
        tokens.push({ type: 'TEXT', value: text.slice(currentPosition) })
        break
      }

      if (currentPosition !== nextTag.index) {
        tokens.push({ type: 'TEXT', value: text.slice(currentPosition, nextTag.index) })
      }

      let closingTagIndex;
      let tokenType;

      switch (nextTag.type) {
        case 'ECHO_OPENING_TAG':
          closingTagIndex = text.indexOf(TAG_CLOSE, nextTag.index + nextTag.value.length)
          tokenType = 'ECHO_BLOCK'
          break
        case 'CODE_OPENING_TAG':
          closingTagIndex = text.indexOf(TAG_CLOSE, nextTag.index + nextTag.value.length)
          tokenType = 'CODE_BLOCK'
          break
      }

      if (closingTagIndex === -1) {
        // NOTE !!  previously, this caught only for the first one
        //          now it catches for any trailing
        //          the code for the previous is below, just in case
        //          this new form doesn't work as intended...
        //
        // if (tokenType === 'CODE_BLOCK' && currentPosition === 0) {
        //   closingTagIndex = text.length
        // } else {
        //   throw new Error(`Missing closing tag for ${nextTag.type}`)
        // }
        //
        if (tokenType === 'CODE_BLOCK') {
          closingTagIndex = text.length
        }
      }

      const code = text.slice(nextTag.index + nextTag.value.length, closingTagIndex).trim()
      tokens.push({ type: tokenType, value: code })
      currentPosition = closingTagIndex + TAG_CLOSE.length
    }

    this.tokens = tokens
    this.timings.tokenize = timer() && timer.seconds()
  }

  async #build (app) {
    const timer = timeSpan()

    // Initialize code array
    let code = []

    // Initialize module header
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`import { parentPort, workerData } from 'worker_threads';`)
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`const { __req, __res, __filename, __dirname } = workerData;`)

    // Initialize globals
    if (this.language === 'ts') {
      code.push(`const req: any = {};`)
      code.push(`const res: any = {};`)
    } else {
      code.push(`const req = {};`)
      code.push(`const res = {};`)
    }

    // Initalize internal globals, these should start with three underscores
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`let ___continue = true;`)
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`let ___output = "";`)

    // Initialize root methods
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`const ___end = () => { try { parentPort.postMessage({ output: ___output, request: __req, response: __res, __filename, __dirname }); } catch (e) { throw new Error(e); } process.exit(); };`)
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`const die = () => { ___continue = false; ___end(); };`)
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`const echo = (...args) => { if (___continue) { ___output += args.join(' ') } };`)

    // Initialize request
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`req.url = () => __req._url;`)
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`req.headers = () => __req._headers;`)
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`req.header = (name) => __req._headers[name];`)
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`req.params = () => __req._params;`)
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`req.get = (name) => __req._params[name];`)

    // Initialize response
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`res.send = (input) => { ___output = input; die(); }`)
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`res.status = (code) => { __res._statusCode = code; };`)
    this.language === 'ts' && code.push(`// @ts-ignore`)
    code.push(`res.setHeader = (name, value) => { __res._headers[name] = value; };`)

    // Iterate over tokens and output into module body
    for (const token of this.tokens) {
      if (token.type === 'TEXT') {
        code.push(`echo(\`${token.value.replace(/\`/g, '\\`')}\`);`)
      } else if (token.type === 'CODE_BLOCK') {
        // Hack for import statements
        let m
        while ((m = regexImport.exec(token.value)) !== null) {
          if (m.index === regexImport.lastIndex) {
            regexImport.lastIndex++;
          }

          let groupFilePath = m.groups.filepath
          let resolvedGroupFilePath = groupFilePath
  
          // add `.mjs` or `.ts` if not found
          if (groupFilePath.indexOf(this.extImport) < 0) {
            resolvedGroupFilePath += this.extImport
          }
  
          // resolve relative lookup
          if (groupFilePath.indexOf('./') === 0) {
            resolvedGroupFilePath = resolvedGroupFilePath.replace('./', '')
            resolvedGroupFilePath = join(this.filedir, resolvedGroupFilePath)
          }
  
          // resolve root lookup
          if (groupFilePath.indexOf('~/') === 0) {
            resolvedGroupFilePath = resolvedGroupFilePath.replace('~/', '')
            resolvedGroupFilePath = join(resolve(app.server.rootDir), resolvedGroupFilePath)
          }
  
          token.value = token.value.replace(groupFilePath, pathToFileURL(resolvedGroupFilePath))
        }
  
        code.push(token.value + ';')
      } else if (token.type === 'ECHO_BLOCK') {
        code.push(`echo(String(${token.value}));`)
      }
    }

    // Finalize module
    code.push(`___end();`)

    // Compile module
    code = code.join('\r\n')

    // handle typescript, this should probably be done in a worker thread
    // if you are using typescript, enable cache
    if (this.language === 'ts') {
      const compilerOptions = {
        "target": ts.ScriptTarget.ES5,
        "experimentalDecorators": true,
        "emitDecoratorMetadata": true,
        "noEmitOnError": true,
        "module": ts.ModuleKind.ESNext,
        "moduleResolution": ts.ModuleResolutionKind.Classic,
        "strict": true,
        "strictNullChecks": true,
        "esModuleInterop": true,
        "forceConsistentCasingInFileNames": true,
        "declaration": true,
      }

      const sourceFile = ts.createSourceFile(
        this.moduleFileName, code, ts.ScriptTarget.Latest
      );
    
      const defaultCompilerHost = ts.createCompilerHost({});
      const customCompilerHost = {
        getSourceFile: (name, languageVersion) => {
            // console.log(`getSourceFile ${name}`);
            
            if (name.indexOf('lib-') > 0) {
              name = name.replace('lib-', 'lib.')
              name = name.replace('.ts', '.d.ts')
            }

            name = name.replace('@typescript', 'typescript/lib')
            name = name.replace('esnext/', 'esnext.')
            name = name.replace('decorators/', 'decorators.')
            name = name.replace('webworker/', 'webworker.')
            name = name.replace(/es([0-9]+)\//, "es$1.")
    
            if (name === this.moduleFileName) {
              return sourceFile;
            } else {
              return defaultCompilerHost.getSourceFile(
                name, languageVersion
              );
            }
        },
        // Note we could use promises and use the file output from here
        writeFile: (filename, data) => {},
        getDefaultLibFileName: () => "node_modules/typescript/lib/lib.d.ts",
        useCaseSensitiveFileNames: () => false,
        getCanonicalFileName: filename => filename,
        getCurrentDirectory: () => "",
        getNewLine: () => "\n",
        getDirectories: () => [],
        fileExists: () => true,
        readFile: () => ""
      };

      const program = ts.createProgram([this.moduleFileName], {
        noEmitOnError: true,
        ...compilerOptions
      }, customCompilerHost)

      const programOutput = program.emit()

      if (programOutput.diagnostics.length) {
        for (const error of programOutput.diagnostics) {
          throw new Error(`Error compiling ${this.filepath}: ${error.messageText}`)
        }
      }

      const transpiled = ts.transpileModule(code, {
        compilerOptions: { 
          ...compilerOptions,
          target: 'es5',
          module: "esnext",
          moduleResolution: "node",
          lib: ["es2016", "esnext"]
        }
      })

      code = transpiled.outputText
    }

    this.codeRaw = code
    this.codeBase64 = Buffer.from(code).toString('base64')
    this.timings.build = timer() && timer.seconds()
  }

  run (req, res) {
    const errorHandler = new ErrorHandler(res)
    const timer = timeSpan()
    const worker = this.getWorker(req, res)

    worker.on('message', ({ output, request, response }) => {
      // Set headers on response
      for (const header in response._headers) {
        if (Object.hasOwnProperty.call(response._headers, header)) {
          const value = response._headers[header]
          request._skipHeaders = true
          res.setHeader(header, value)
        }
      }

      // Set status code
      if (response._statusCode) {
        request._skipStatusCode = true;
        res.statusCode = response._statusCode
      }

      // Handle defaults
      if (!request._skipStatusCode) res.statusCode = 200
      if (!request._skipHeaders) res.setHeader('Content-Type', 'text/html')
      if (!request._skipEnd) res.end(output)

      // Stop the runtime timer
      this.timings.run = timer() && timer.seconds()

      // Output timers if allowed
      if (app.get('log.timings') && this.timings.compile) {
        const timings = {}

        timings.msg = `compile time for ${this.filepath}`
        timings.filepath = `${this.filepath}`
        
        timings.read = `${this.timings.read}s`
        timings.tokenize = `${this.timings.tokenize}s`
        timings.build = `${this.timings.build}s`
        timings.compile = `${this.timings.compile}s`

        timings.elapsed = this.timings.compile * 1000

        app.log('http').info(timings)
      }
    })

    worker.on('error', (err) => {
      let errMessage = err

      if (err.stack && err.stack.indexOf('data:') > -1) {
        let filename = ''
        let message = ''
        let line = 0
        let row = 0

        if (err.message) {
          const splitMessage = err.message ? err.message.split('\n') : ['Unknown']
          message = splitMessage[splitMessage.length - 1]
        }

        if (err.stack) {
          const stackFirstItem = err.stack.split('\n')[1]

          const stackMatchFilename = stackFirstItem.match(regexStackFilename)
          if (stackMatchFilename) {
            filename = stackMatchFilename[1]
          }

          const stackMatchPosition = stackFirstItem.match(regexStackPosition)
          if (stackMatchPosition) {
            line = Number(stackMatchPosition[2])
            row = Number(stackMatchPosition[1])
          }
        }

        errMessage = `Error: ${message}
          at ${filename}:${line}:${row}`
      }

      return errorHandler.InternalServerError(err.message, errMessage)
    })
  }
}

class Server {
  constructor(app) {
    this.config = app.get('server')
    this.server = null
    this.app = app
    this.log = app.logger.child({ name: 'server' })
    this.httpLogger = pinoHttp()
    this.middleware = []
  }

  async init() {
    const { host, port, root_dir } = this.config

    this.rootDir = absolutePath(root_dir)
    this.server = createServer()
    this.server.on('request', this.onHTTPRequest.bind(this))
    this.server.listen(port, host, () => {
      this.log.info(`Server running at http://${host}:${port}`)
    })
  }

  use(handler, path) {
    this.middleware.push({ path, handler })
  }

  /**
   * @todo build a cache of all module filenames and then 
   *       compare them against the incoming path. this
   *       would enable nextjs / express like path 
   *       matching which would be a huge improvement
   *       over users having to build their own or use
   *       something like nginx.
   */
  async resolveRequestPath(req) {
    const { pathname } = req.parsedUrl
    let filepath = join(this.config.root_dir, pathname)
    
    const urlPathExt = extname(pathname)
    if (urlPathExt) {
      return {
        isModule: false,
        filepath
      }
    }

    const isIndex = pathname[pathname.length - 1] === '/'
    if (isIndex) {
      filepath = join(filepath, 'index')
    }

    for (const lang in Module.LANGUAGES) {
      const modulePath = filepath + Module.LANGUAGES[lang]
      if (await exists(modulePath)) {
        return {
          isModule: true,
          filepath: modulePath
        };
      }
    }

    return false;
  }

  async onHTTPRequest (req, res) {
    this.httpLogger(req, res)

    const { method } = req
    const handlers = new ErrorHandler(res)

    // Parse URL
    req.parsedUrl = new URL(req.url, `http://${req.headers.host}`)

    // Match url to resources
    req.details = await this.resolveRequestPath(req)

    // File doesn't exist on the server
    if (!req.details) {
      return handlers.NotFound(req.url)
    }

    // Middleware
    await this.runMiddlewares(req, res)

    // Handle Modules
    // TODO: module -> script
    if (req.details.isModule) {
      return await this.runModule(req, res)
    }

    // Handle Files
    if (method === 'GET') {
      send(req, req.details.filepath).pipe(res)
    } else {
      res.statusCode = 'OPTIONS' === method ? 200 : 405
      res.setHeader('Allow', 'GET, HEAD, OPTIONS')
      res.setHeader('Content-Length', '0')
      res.end()
    }
  }

  async runModule(req, res) {
    const handlers = new ErrorHandler(res)
    const { plugins, compiler } = this.app
    const { filepath } = req.details

    try {
      const module = await compiler.getModule(filepath)
      if (!module) {
        return handlers.InternalServerError(`Compilation of ${filepath} failed. Reason unknown.`);
      }

      const worker = module.getWorker(req, res)
      plugins.runHook('server_runModule.start', { app: this, req, res, module, worker })
      worker.on('message', this.onHTTPWorkerResponse(module, worker, req, res))
      worker.on('error', this.onHTTPWorkerError(module, worker, req, res))
      plugins.runHook('server_runModule.end', { app: this, req, res, module, worker })
    } catch (err) {
      return handlers.InternalServerError(err.message, err.stack);
    }
  }

  async runMiddlewares(req, res) {
    const { pathname } = req.parsedUrl
    const { plugins } = this.app

    plugins.runHook('server_runMiddlewares.start', { server: this, req, res })
    for (const middleware of this.middleware) {
      await this.runMiddleware(middleware, { req, res })
    }
    plugins.runHook('server_runMiddlewares.end', { server: this, req, res })
  }

  async runMiddleware (middleware, { req, res }) {
    const { pathname } = req.parsedUrl
    const { plugins } = this.app

    plugins.runHook('server_runMiddleware.start', { server: this, middleware, req, res })

    if (middleware.path && !middleware.path.match(pathname)) {
      return
    }

    try {
      await this.middleware.handler(req, res)
    } catch (e) {
      this.log.error(e)
    }

    plugins.runHook('server_runMiddleware.start', { server: this, middleware, req, res })
  }

  async onHTTPWorkerResponse (module, worker, req, res) {
    const server = this

    return ({ output, request, response }) => {
      const { plugins } = this.app

      // Remap for easier understanding
      // at some point we should just map them this way by default
      // do not store on module / server objects those are shared between requests
      const serverRequest = req
      const serverResponse = res
      const moduleOutput = output
      const moduleRequest = request
      const moduleResponse = response

      plugins.runHook('worker_onResponse.start', { 
        server,
        module,
        worker,
        serverRequest, 
        serverResponse,
        moduleOutput,
        moduleRequest,
        moduleResponse
      })

      // Set headers on response
      for (const header in moduleResponse._headers) {
        if (Object.hasOwnProperty.call(moduleResponse._headers, header)) {
          const value = moduleResponse._headers[header]
          moduleRequest._skipHeaders = true
          serverResponse.setHeader(header, value)
        }
      }

      // Set status code
      if (moduleResponse._statusCode) {
        moduleRequest._skipStatusCode = true;
        serverResponse.statusCode = moduleResponse._statusCode
      }

      // Handle defaults
      if (!moduleRequest._skipStatusCode) serverResponse.statusCode = 200
      if (!moduleRequest._skipHeaders) serverResponse.setHeader('Content-Type', 'text/html')
      if (!moduleRequest._skipEnd) serverResponse.end(output)

      // We should make a global timings system and move all of this to it
      // // Stop the runtime timer
      // this.timings.run = timer() && timer.seconds()

      // // Output timers if allowed
      // if (app.get('log.timings') && this.timings.compile) {
      //   const timings = {}

      //   timings.msg = `compile time for ${this.filepath}`
      //   timings.filepath = `${this.filepath}`
        
      //   timings.read = `${this.timings.read}s`
      //   timings.tokenize = `${this.timings.tokenize}s`
      //   timings.build = `${this.timings.build}s`
      //   timings.compile = `${this.timings.compile}s`

      //   timings.elapsed = this.timings.compile * 1000

      //   app.log('http').info(timings)
      // }

      plugins.runHook('worker_onResponse.end', { 
        server,
        module,
        worker,
        serverRequest, 
        serverResponse,
        moduleOutput,
        moduleRequest,
        moduleResponse
      })
    }
  }

  async onHTTPWorkerError (module, worker, req, res) {
    const errorHandler = new ErrorHandler(res)
    const server = this

    return (err) => {
      let errMessage = err

      // Todo: move this to a utility function
      if (err.stack && err.stack.indexOf('data:') > -1) {
        let filename = ''
        let message = ''
        let line = 0
        let row = 0

        if (err.message) {
          const splitMessage = err.message ? err.message.split('\n') : ['Unknown']
          message = splitMessage[splitMessage.length - 1]
        }

        if (err.stack) {
          const stackFirstItem = err.stack.split('\n')[1]

          const stackMatchFilename = stackFirstItem.match(regexStackFilename)
          if (stackMatchFilename) {
            filename = stackMatchFilename[1]
          }

          const stackMatchPosition = stackFirstItem.match(regexStackPosition)
          if (stackMatchPosition) {
            line = Number(stackMatchPosition[2])
            row = Number(stackMatchPosition[1])
          }
        }

        errMessage = `Error: ${message}
          at ${filename}:${line}:${row}`
      }

      return errorHandler.InternalServerError(err.message, errMessage)
    }
  }

  async onHTTP2Request () {
    throw new Error('Not Yet Implemented')
  }

  async onHTTP2WorkerResponse () {
    throw new Error('Not Yet Implemented')
  }
}

class Runtime {
  async #run(method) {
    let result = await this.plugins.runHook(`${method}.start`, this)

    if (!result) {
      await this[method]()
    }

    await this.plugins.runHook(`${method}.end`, this)
  }

  async initialize() {
    this.server = null
    this.logger = pino({ name: 'app' })

    // Should this come after configuration load?
    await this.initializePlugins()

    await this.#run(`initializeConfig`)
    await this.#run(`initializeSession`)
    await this.#run(`initializeCompiler`)
    await this.#run(`initializeServer`)
  }

  async initializePlugins() {
    this.plugins = new PluginSystem(this)
    this.pluginsRoot = args.plugins || './plugins'
    await this.plugins.loadPlugins(this.pluginsRoot)
  }

  async initializeSession() {
    if (!this.get('session').enable) {
      return
    }

    if (!this.sessionStore) {
      this.sessionStore = new MemoryStore()
    }

    if (!this.session) {
      this.session = new Session(this.get('session'), this.sessionStore)
    }
  }

  async initializeConfig() {
    this.settings = convict(configOptions)

    if (args.config) {
      const configPath = absolutePath(args.config)
      if (await exists(configPath)) {
        this.configPath = configPath
        this.settings.loadFile(this.configPath)
      }
    }
  }

  async initializeCompiler() {
    this.compiler = new Compiler(this)
    await this.compiler.init()
  }

  async initializeServer() {
    this.server = new Server(this)
    await this.server.init()
  }

  get(property) {
    return this.settings.get(property)
  }

  set(property, value) {
    this.settings.set(property, value)
    return this
  }

  enable(property) {
    return this.set(property, true)
  }
}

(async () => {
  // Initialize CLI

  program
    .name(info.name)
    .description(info.description)
    .version(info.version);

  program
    .addArgument(new Argument('<directory>', 'directory').default('./src').argOptional())
    .option(`-c, --config <path>`, 'specify custom path to config file')
    .option(`-p, --plugins <path>`, 'specify plugins directory')
    .option(`--generate-config [path]`, `generate configuration file with defaults`)

  generateProgramOptions(program, configOptions)

  program.parse()
  args = program.opts()

  // Handle exit worthy cli options
  if (args.generateConfig) {
    return generateConfig(config, {
      path: typeof args.generateConfig === 'string' 
        ? args.generateConfig 
        : 'jsp.ini'
    })
  }

  // Initialize Server Application

  app = new Runtime()
  await app.initialize()

  // Generate Example Config
})()