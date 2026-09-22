<?js
import { writeFile } from 'node:fs/promises'

cow.onCleanup(() => writeFile(req.get('marker'), 'cleaned'))
res.send('finishing')
