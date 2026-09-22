<?js
import { sqlite } from 'cow:sqlite'

const database = await sqlite(req.get('database'))
const action = req.get('action') || 'list'
database.exec('CREATE TABLE IF NOT EXISTS entries (value TEXT NOT NULL)')

if (action === 'insert') {
  database.run('INSERT INTO entries (value) VALUES (?)', [req.get('value') || 'saved'])
}
if (action === 'named') {
  database.run('INSERT INTO entries (value) VALUES ($value)', {
    value: req.get('value') || 'named'
  })
}
if (action === 'transaction') {
  await database.transaction(async (transaction) => {
    transaction.run('INSERT INTO entries (value) VALUES (?)', [
      req.get('value') || 'transaction'
    ])
    await Promise.resolve()
  }, { mode: 'immediate' })
}
if (action === 'rollback') {
  try {
    await database.transaction(async (transaction) => {
      transaction.run('INSERT INTO entries (value) VALUES (?)', ['must roll back'])
      throw new Error('expected rollback')
    })
  } catch (error) {
    if (error.message !== 'expected rollback') throw error
  }
}
if (action === 'leak') {
  database.begin()
  database.run('INSERT INTO entries (value) VALUES (?)', ['must roll back'])
}
if (action === 'hold') {
  await new Promise((resolve) => setTimeout(resolve, 100))
}
if (action === 'error') {
  database.get('SELECT * FROM a_table_that_does_not_exist')
}

res.json(database.all('SELECT value FROM entries ORDER BY rowid'))
?>
