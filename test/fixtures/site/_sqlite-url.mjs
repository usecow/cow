import { sqlite } from 'cow:sqlite'

export default await sqlite(new URL('../sqlite-url.sqlite', import.meta.url))
