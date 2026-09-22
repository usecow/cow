<?js
import resourceForRequest from './_resource.mjs'

const options = {
  marker: req.get('marker'),
  key: req.get('key') || 'default',
  failOpen: req.get('failOpen') === 'true',
  failAcquire: req.get('failAcquire') === 'true',
  failRelease: req.get('failRelease') === 'true',
  failClose: req.get('failClose') === 'true',
  hangClose: req.get('hangClose') === 'true'
}
const resource = await resourceForRequest(options)
res.json(resource)
?>
