import { Plugin } from '../lib/plugin.mjs'

class ExamplePlugin extends Plugin {
  static name = "ExamplePlugin"
  static author = "Nijiko Yonskai <nijikokun@gmail.com>"
  static version = "1.0.0"
  static description = "ABC"

  init() {
    this.registerHook('initializeConfig.end', this.initializeConfigEnd)
  }

  initializeConfigEnd(app) {
    this.log.info(`Setting "server.port" to 1234`)
    app.settings.set('server.port', 1234)
    this.log.info(`In app server.port=${app.settings.get("server.port")}`)
  }
}

export default ExamplePlugin