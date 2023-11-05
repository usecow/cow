<?ts

let myName = 123;

res.status(200)
res.setHeader('Content-Type', 'application/json')

echo(JSON.stringify({
  "hello": myName
}))