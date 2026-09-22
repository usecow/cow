<?js
import { appendFile } from 'node:fs/promises'
import resourceForRequest from './_resource.mjs'

const marker = req.get('marker')
await resourceForRequest({ marker, key: 'cleanup-order' })
cow.onCleanup(() => appendFile(marker, 'cleanup\n'))
res.send('done')
?>
