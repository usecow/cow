import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from './syntax.mjs'
import { escapeHtml } from './web.mjs'
import { requestBuiltinNames } from './request-native.mjs'
import { hostRuntime } from './host-runtime.mjs'

const {version} = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
const css = `
:root{font-family:Arial,Helvetica,sans-serif;color:#222;background:#fff;line-height:1.2;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}body{margin:0}main{width:calc(100% - 16px);max-width:934px;margin:8px auto 28px}
header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-height:74px;padding:6px;background:#9999cc;border:1px solid #666;box-shadow:1px 2px 3px #0003}
h1,h2{text-wrap:balance}h1{font-size:18px;line-height:1.25;margin:9px 0;font-weight:700}h2{font-size:20px;text-align:center;margin:20px 0 12px}
.wordmark{display:flex;align-items:center;justify-content:center;flex:none;width:116px;height:61px;border-radius:50%;background:#777bb3;border:2px solid #65699a;border-top-color:#bfc2e7;border-left-color:#bfc2e7;font-size:43px;line-height:1;font-weight:900;font-style:italic;letter-spacing:-4px;padding-right:5px;color:#111;text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff}
section{margin:16px 0}table{border-collapse:collapse;width:100%;table-layout:fixed;box-shadow:1px 2px 3px #0003}
th,td{text-align:left;vertical-align:top;padding:4px 5px;border:1px solid #666;overflow-wrap:anywhere;font-size:12px}th[scope=row]{font-weight:700;width:33.33%;background:#ccccff}td{background:#ddd;font-variant-numeric:tabular-nums}thead th{background:#9999cc;font-weight:700;text-align:center}thead th:first-child{width:33.33%}
p{margin:0;text-wrap:pretty}.engine,.notice{border:1px solid #666;background:#ddd;padding:6px;font-size:12px;box-shadow:1px 2px 3px #0003}.engine{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:16px;min-height:56px}.engine strong{font-size:25px;color:#555;white-space:nowrap;font-weight:400}.notice{margin-top:16px;line-height:1.4}.notice strong{font-weight:700}
footer{font-size:12px;text-align:center;margin:16px 0;color:#444;line-height:1.4}
@media(max-width:520px){header{align-items:center}h1{font-size:17px}.wordmark{width:87px;height:49px;font-size:34px}th[scope=row],thead th:first-child{width:42%}.engine{flex-wrap:wrap}.engine strong{font-size:20px}}
@media print{main{width:100%;margin:0}section{break-inside:avoid}header,table,.engine,.notice{box-shadow:none}}
`
const styleHash = createHash('sha256').update(css).digest('base64')
export const infoContentSecurityPolicy = `default-src 'none'; style-src 'sha256-${styleHash}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`

// Allowlisted runtime facts only. Never serialize process/env, requests, full
// configuration, module paths, adapter names/options, resource keys or errors.
export function infoSnapshot({worker={},compiler,modules=0,resources={}}={}) {
  const settings = worker.diagnostics || {}
  const host = hostRuntime()
  const value = v => v === undefined ? null : v
  return {
    runtime: {
      cow:version,host:host.name,hostVersion:host.version,engine:host.engine,
      node:host.name === 'node' ? process.versions.node : null,
      v8:host.engine === 'V8' ? process.versions.v8 : null,typescript:ts.version,
      platform:process.platform,architecture:process.arch,
      timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      mode:settings.mode || 'unknown',
      serverAPI:'Cow request runtime; no CGI required',
      execution:'Fresh VM and ordinary module graph per request; persistent workers',
      vmModules:host.name !== 'node' || process.execArgv.includes('--experimental-vm-modules'),
      importMetaResolve:true
    },
    configuration:{
      workers:value(worker.diagnostics?.workers),
      executionTimeoutMs:value(worker.diagnostics?.timeout),
      queueTimeoutMs:value(worker.diagnostics?.queueTimeout),
      maxQueue:value(worker.diagnostics?.maxQueue),
      maxRequestsPerWorker:value(worker.diagnostics?.maxRequestsPerWorker),
      workerHeapLimitMiB:value(worker.diagnostics?.memoryLimitMb),
      bodyLimitBytes:value(settings.bodyLimit),bodyTimeoutMs:value(settings.bodyTimeout),
      bufferedOutputLimitBytes:value(worker.outputLimit),aggregateBufferLimitBytes:value(settings.bufferLimit),
      sourceLimitBytes:value(compiler?.sourceLimit),compileTimeoutMs:value(settings.compileTimeout),
      compiledBufferLimitBytes:value(settings.compiledBufferLimit),
      compilerCache:compiler?.cacheEnabled ?? null,compilerCacheEntries:value(compiler?.maxCacheEntries),
      compilerCacheBytes:value(compiler?.maxCacheBytes),
      nativeResourcesPerWorker:value(worker.resourceLimits?.maxResources),
      nativeAdaptersPerWorker:value(worker.resourceLimits?.maxAdapters),nativeNamespacesPerWorker:value(worker.namespaceLimit)
    },
    capabilities:{
      templates:'JSP (JavaScript), TSP (TypeScript), awaited includes',
      helpers:['cow:web','cow:sqlite','cow:csv','cow:resource'],
      nodeBuiltins:requestBuiltinNames(),
      sqlite:process.versions.sqlite || 'Host node:sqlite support (version not reported)',
      forms:'URL-encoded and multipart forms; bounded, request-owned uploads',
      httpOptionsAsterisk:host.name !== 'bun',
      output:'Buffered by default; explicit awaited stream, sendFile and download',
      errors:'Optional private _error.cow (legacy: _error.jsp / _error.tsp); safe server fallback',
      compatibility:'Listed Node modules expose guarded subsets, not every host API. No PHP source compatibility.'
    },
    snapshot:{ordinaryModules:modules,registeredNativeAdapters:resources.registeredAdapters || 0,
      workerResourceInstances:resources.instances || 0,workerActiveLeases:resources.activeLeases || 0},
    privacy:'Environment variables, paths, request values, cookies, credentials and resource keys are omitted. Protect or remove this page after use.'
  }
}

const labels = {
  cow:'Cow version',host:'Host runtime',hostVersion:'Host version',engine:'JavaScript engine',node:'Node.js',v8:'V8',typescript:'TypeScript',platform:'Operating system',architecture:'Architecture',timeZone:'Time zone',
  mode:'Mode',serverAPI:'Server API',execution:'Request execution',vmModules:'VM modules',importMetaResolve:'Parent-relative package resolution',
  workers:'Configured workers',executionTimeoutMs:'Execution timeout (ms)',queueTimeoutMs:'Queue timeout (ms)',maxQueue:'Maximum queued requests',
  maxRequestsPerWorker:'Requests before worker recycle (0 = disabled)',workerHeapLimitMiB:'Worker JS heap limit (MiB)',
  bodyLimitBytes:'Request body limit (bytes)',bodyTimeoutMs:'Request body timeout (ms)',bufferedOutputLimitBytes:'Buffered output limit (bytes)',
  aggregateBufferLimitBytes:'Aggregate buffer budget (bytes)',sourceLimitBytes:'Template source limit (bytes)',compileTimeoutMs:'Compile timeout (ms)',
  compiledBufferLimitBytes:'Admitted compiled-template budget (bytes)',compilerCache:'Compiled-template cache',compilerCacheEntries:'Cached templates per compiler',
  compilerCacheBytes:'Compiled cache budget per compiler (bytes)',nativeResourcesPerWorker:'Native resource limit per worker',
  nativeAdaptersPerWorker:'Native adapter limit per worker',nativeNamespacesPerWorker:'Native namespace limit per worker',
  templates:'Templates',helpers:'Bundled helpers / adapter API',nodeBuiltins:'Request-safe Node module entry points',sqlite:'SQLite library version (no connection test)',
  forms:'Forms and uploads',httpOptionsAsterisk:'HTTP server-wide OPTIONS * (route OPTIONS works on all hosts)',output:'Response output',errors:'Site error pages',compatibility:'Compatibility boundary',
  ordinaryModules:'Modules in this request so far',registeredNativeAdapters:'Registered native adapters in this worker',
  workerResourceInstances:'Resource instances in this worker',workerActiveLeases:'Active leases in this worker'
}

export function renderInfo(snapshot) {
  const sections = [['Runtime',snapshot.runtime],['Effective configuration',snapshot.configuration],['Available capabilities',snapshot.capabilities],['Current request / worker snapshot',snapshot.snapshot]]
  const display = value => value === null ? 'Not supplied by this runner' : typeof value === 'boolean' ? (value ? 'Enabled' : 'Disabled') : Array.isArray(value) ? value.join(', ') : value
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Cow runtime information</title><style>${css}</style></head><body><main>
<header><h1>Cow Version ${escapeHtml(snapshot.runtime.cow)}</h1><span class="wordmark" aria-hidden="true">cow</span></header>
${sections.map(([title,rows],index)=>`<section>${index ? `<h2>${escapeHtml(title)}</h2>` : ''}<table aria-label="${escapeHtml(title)}">${index ? '<thead><tr><th scope="col">Directive / information</th><th scope="col">Value</th></tr></thead>' : ''}<tbody>${Object.entries(rows).map(([key,value])=>`<tr><th scope="row">${escapeHtml(labels[key] || key)}</th><td>${escapeHtml(display(value))}</td></tr>`).join('')}</tbody></table>${index === 0 ? `<div class="engine"><p>This runtime uses ${escapeHtml(snapshot.runtime.host)} ${escapeHtml(snapshot.runtime.hostVersion)} and ${escapeHtml(snapshot.runtime.engine)}.<br>Application state is fresh for each request.</p><strong>Cow / ${escapeHtml(snapshot.runtime.engine)}</strong></div>` : ''}</section>`).join('')}
<p class="notice"><strong>Diagnostic privacy:</strong> ${escapeHtml(snapshot.privacy)}</p>
<footer>A point-in-time diagnostic report, not a health check or a database connection test. No external assets, scripts or network probes.</footer>
</main></body></html>`
}

export function sendInfo(res, options, snapshot) {
  if (options === undefined) options = {}
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key=>key!=='format') || !['html','json'].includes(options.format ?? 'html')) {
    throw new TypeError('cow.info accepts only { format: "html" | "json" }')
  }
  res.setHeader('cache-control','no-store')
  res.setHeader('x-content-type-options','nosniff')
  res.setHeader('x-robots-tag','noindex, nofollow')
  res.setHeader('referrer-policy','no-referrer')
  if (!res.getHeader('content-security-policy')) res.setHeader('content-security-policy',infoContentSecurityPolicy)
  if (options.format === 'json') res.json(snapshot)
  res.type('html').send(renderInfo(snapshot))
}
