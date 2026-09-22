<?js
import resourceForRequest from './_resource.mjs'

const resource = await resourceForRequest({
  marker: req.get('marker'),
  key: req.get('key') || 'default'
})
await new Promise((resolve) => setTimeout(resolve, 100))
res.json(resource)
?>
