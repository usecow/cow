<?js
import { appendFile } from 'node:fs/promises'

setTimeout(() => appendFile(req.get('marker'), 'leaked'), 25)
res.send('scheduled')
