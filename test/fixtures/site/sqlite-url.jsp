<?js
import database from './_sqlite-url.mjs'

database.exec('CREATE TABLE IF NOT EXISTS requests (value TEXT NOT NULL)')
if (req.get('value')) {
  database.run('INSERT INTO requests (value) VALUES (?)', [req.get('value')])
}
res.json(database.all('SELECT value FROM requests ORDER BY rowid'))
?>
