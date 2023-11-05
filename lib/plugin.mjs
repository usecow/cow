import { relativePath, absolutePath } from './utils.mjs'
import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'

export class PluginSystem {
  hooks = {}

  constructor(app) {
    this.app = app
    this.log = app.logger.child({ name: 'plugins' })
    this.hooks = {}
  }

  async loadPlugins(path) {
    const entries = await fs.readdir(absolutePath(path), { withFileTypes: true })
    const results = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          const packageJsonPath = resolve(path, entry.name, 'package.json')
          const packageJson = JSON.parse(await fs.readFile(packageJsonPath))

          if (packageJson.main) {
            // Check if the file exists, here we construct an absolute path because
            // node reads files relative to the process.cwd() and not __dirname
            const absolutePluginPath = resolve(path, entry.name, packageJson.main)
            await fs.access(absolutePluginPath)

            // If the file exists, import the plugin module, here we construct a
            // relative path since import reads files relative to __dirname and
            // not process.cwd()
            const relativePluginPath = relativePath(absolutePluginPath)
            const { default: plugin } = await import(relativePluginPath)

            // Register
            this.registerPlugin(plugin)

            // Push success message, todo: timings
            this.log.info(`Loaded plugin ${plugin.name} v${plugin.version}`)
          }
        } catch (error) {
          this.log.error(`Error loading plugin ${entry.name}: ${error.message}`, error)
        }
      }

      if (entry.name.endsWith('.mjs')) {
        try {
          // Check if the file exists, here we construct an absolute path because
          // node reads files relative to the process.cwd() and not __dirname
          const absolutePluginPath = resolve(path, entry.name)
          await fs.access(absolutePluginPath)
          
          // If the file exists, import the plugin module, here we construct a
          // relative path since import reads files relative to __dirname and
          // not process.cwd()
          const relativePluginPath = relativePath(absolutePluginPath)
          const { default: plugin } = await import(relativePluginPath)

          // Register
          this.registerPlugin(plugin)

          // Log result, todo: timings
          this.log.info(`Loaded plugin ${plugin.name} v${plugin.version}`)
        } catch (error) {
          this.log.error(`Error loading plugin ${entry.name}: ${error.message}`, error)
        }
      }
    }

    return results
  }

  registerPlugin(pluginClass) {
    try {
      const plugin = new pluginClass()
      plugin.app = this.app
      plugin.log = this.app.logger.child({ name: pluginClass.name })

      const hooks = plugin.getHooks()
      for (const hookName of Object.keys(hooks)) {
        this.registerHook(hookName, hooks[hookName])
      }
    } catch (e) {
      throw new Error(`Failed to register plugin: ${e.message}`)
    }
  }

  registerHook(hookName, callback) {
    if (!this.hooks[hookName]) {
      this.hooks[hookName] = []
    }

    this.hooks[hookName].push(callback)
  }

  async runHook(hookName, data) {
    const hooks = this.hooks[hookName]
    if (!hooks || hooks.length === 0) {
      return
    }

    for (const hook of hooks) {
      await hook(data)
    }
  }
}

/**
 * Base plugin class for plugin developers to extend JSR.
 * 
 * @example
 *  import { Plugin } from '../plugin.mjs'
 * 
 *  class GetAppSettings extends Plugin {
 *    static name = "GetAppSettings"
 *    static author = "Nijiko Yonskai <nijikokun@gmail.com>"
 *    static version = "1.0.0"
 *    static description = "ABC"
 * 
 *    init() {
 *      this.registerHook('initializeConfig.end', this.initializeConfigEnd)
 *    }
 *  
 *    initializeConfigEnd(app) {
 *      console.log('app settings', JSON.stringify(app.settings.getProperties()))
 *    }
 *  }
 * 
 *  export default GetAppSettings
 */
export class Plugin {
  hooks = {}

  static name = ""
  static author = ""
  static version = ""
  static description = ""

  constructor() {
    this.init()
  }

  registerHook(hookName, callback) {
    this.hooks[hookName] = callback.bind(this)
  }

  init() {
    throw new Error('Plugins must implement and register hooks inside init().')
  }

  getHooks() {
    return this.hooks
  }

  getPluginInfo() {
    return {
      name: this.name,
      author: this.author,
      version: this.version,
      description: this.description,
      hooks: Object.keys(this.hooks)
    }
  }
}