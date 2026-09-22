<?js
const module = await import('./_dynamic.mjs')
res.send(module.default)
