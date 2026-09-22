<?js
res.setHeader('content-type', 'application/octet-stream')
res.send(Buffer.from([0, 1, 2, 255]))
