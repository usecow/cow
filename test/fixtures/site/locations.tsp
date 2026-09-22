<h1>Before the code</h1>
<?ts
interface Person { name: string }
const person: Person = { name: 'Cow' };
if (person.name) {
  throw new Error('original TSP location');
}
?>
