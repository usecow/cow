import { Plugin } from '../../lib/plugin.mjs'

class ExampleDirPlugin extends Plugin {
  static name = "ExampleDirPlugin"
  static author = "Nijiko Yonskai <nijikokun@gmail.com>"
  static version = "1.0.0"
  static description = "Sets port to 8080"

  init() {
    this.registerHook('initializeConfig.end', this.initializeConfigEnd)
  }

  initializeConfigEnd(app) {
    this.log.info(`Setting "server.port" to 8080`)
    app.settings.set('server.port', 8080)
    this.log.info(`In app server.port=${app.settings.get("server.port")}`)
  }
}

export default ExampleDirPlugin