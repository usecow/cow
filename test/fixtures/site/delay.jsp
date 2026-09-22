<?js
await new Promise((resolve) => setTimeout(resolve, 50))
res.send('completed before shutdown')
