const output = document.querySelector('[data-demo-output]');
const form = output?.querySelector('form');
const status = document.getElementById('alt-demo-status');

if (form && status) {
  let latestRequest = 0;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const request = ++latestRequest;
    const button = form.querySelector('button');
    button.disabled = true;
    output.setAttribute('aria-busy', 'true');
    status.textContent = 'Cow is saying hello…';

    try {
      const response = await fetch('/welcome', {
        method: 'POST',
        body: new URLSearchParams(new FormData(form)),
        headers: { Accept: 'text/html' },
      });
      if (!response.ok) throw new Error('Greeting request failed');
      const document = new DOMParser().parseFromString(await response.text(), 'text/html');
      const greeting = document.querySelector('.alt-demo-output h2')?.textContent;
      if (!greeting) throw new Error('Greeting is missing');
      if (request !== latestRequest) return;
      output.querySelector('h2').textContent = greeting;
      status.textContent = 'A little hello, straight from the server.';
    } catch {
      if (request === latestRequest) status.textContent = 'Couldn’t reach Cow. Give it another try.';
    } finally {
      if (request === latestRequest) {
        button.disabled = false;
        output.removeAttribute('aria-busy');
      }
    }
  });
}
