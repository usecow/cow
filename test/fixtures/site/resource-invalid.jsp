<?js
import resourceForRequest from './_resource.mjs'

await resourceForRequest({
  marker: req.get('marker'),
  callback() {}
})
?>
