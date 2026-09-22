<?js
res.status(201)
res.json({
  method: req.method(),
  query: req.get('key'),
  body: req.json()
})
