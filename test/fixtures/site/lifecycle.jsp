<?js
echo(`before:${res.phase}:${res.headersSent};`)
res.setHeader('x-before-commit', 'yes')
await res.flush()
echo(`after:${res.phase}:${res.headersSent};`)

let errorCode = 'none'
try {
  res.status(201)
} catch (error) {
  errorCode = error.code
}

res.end(`error:${errorCode}`)
