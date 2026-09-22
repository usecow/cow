<h1>Before the code</h1>
<?js
const beforeImport = 1;
import { basename } from 'node:path';
if (beforeImport && basename('file')) {
  throw new Error('original JSP location');
}
?>
