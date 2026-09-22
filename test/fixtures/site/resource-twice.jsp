<?js
import resourceForRequest from './_resource.mjs'

const options = { marker: req.get('marker'), key: req.get('key') || 'default' }
const [first, second] = await Promise.all([
  resourceForRequest(options),
  resourceForRequest(options)
])
res.json({ same: first === second, use: second.use })
?>
