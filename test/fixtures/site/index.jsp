<?js
import { greeting } from './_message.mjs'
const name = req.get('name') || 'world'
?>
<h1><?= greeting ?>, <?= name ?>!</h1>
