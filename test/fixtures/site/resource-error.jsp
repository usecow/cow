<?js
import resourceForRequest from './_resource.mjs'

await resourceForRequest({ marker: req.get('marker'), key: req.get('key') || 'default' })
throw new Error('Failure after resource acquisition')
?>
