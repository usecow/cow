<?js
  import * as db from './db.mjs';
  res.setHeader('Cache-Control', 'None');
  let filePath = 'image.jpg';
  let fileName = 'hello.png';
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Testing</title>
</head>
<body>
  <img src="<?js echo(filePath) ?>" alt="<?js echo(db.name) ?>" title="<?= filePath ?>">
  <p>
    <a href="/foobar">Go to Foobar</a>
  </p>
</body>
</html>

<?= req.url() ?>