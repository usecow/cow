import { icon } from './ui-icons.mjs';

document.documentElement.dataset.enhanced = '';

async function copyText(button, value) {
  const label = button.innerHTML;
  const status = document.getElementById('copy-status');
  try {
    await navigator.clipboard.writeText(value.trim().replace(/^\$ /gm, ''));
    button.innerHTML = 'Copied ' + icon('checkmark', 16);
    if (status) status.textContent = 'Copied to clipboard.';
  } catch {
    button.textContent = 'Select to copy';
    if (status) status.textContent = 'Clipboard unavailable. Select the code and copy it manually.';
  }
  button.disabled = true;
  setTimeout(() => { button.innerHTML = label; button.disabled = false; }, 2000);
}
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', () => {
    const source = document.getElementById(button.dataset.copy);
    if (source) copyText(button, source.textContent);
  });
}

const languageButtons = [...document.querySelectorAll('[data-language]')];
let selectedLanguage = 'js';
for (const button of languageButtons) {
  button.addEventListener('click', () => {
    selectedLanguage = button.dataset.language;
    for (const choice of languageButtons) choice.setAttribute('aria-pressed', String(choice === button));
    document.getElementById('source-js').hidden = selectedLanguage !== 'js';
    document.getElementById('source-ts').hidden = selectedLanguage !== 'ts';
    document.getElementById('language-label').textContent = selectedLanguage === 'js' ? 'JavaScript' : 'TypeScript';
  });
}
document.getElementById('copy-example')?.addEventListener('click', event => {
  copyText(event.currentTarget, document.getElementById('source-' + selectedLanguage).textContent);
});

const runtimeChoices = [...document.querySelectorAll('[data-runtime]')];
for (const button of runtimeChoices) {
  button.addEventListener('click', () => {
    for (const choice of runtimeChoices) choice.setAttribute('aria-pressed', String(choice === button));
    document.getElementById('runtime-command').textContent = 'cow site --runtime ' + button.dataset.runtime;
  });
}

const form = document.querySelector('.example-form');
const preview = document.querySelector('.greeting-preview');
const previewStatus = document.getElementById('preview-status');
const updatePreviewAddress = () => {
  const name = document.getElementById('visitor-name').value || 'world';
  const path = '/hello?' + new URLSearchParams({ name });
  document.getElementById('preview-address').textContent = path;
  previewStatus.textContent = 'Rendering your page…';
  return path;
};
if (preview?.tagName === 'IFRAME') {
  form?.addEventListener('submit', updatePreviewAddress);
  preview.addEventListener('load', () => {
    let rendered = false;
    try { rendered = preview.contentDocument?.body.classList.contains('preview-document'); } catch { /* Navigation was unsuccessful. */ }
    previewStatus.textContent = rendered ? '' : 'Could not load the example. Try again.';
  });
} else if (preview) {
  let latestRequest = 0;
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const request = ++latestRequest;
    try {
      const response = await fetch(updatePreviewAddress());
      if (!response.ok) throw new Error('Example request failed');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const heading = page.querySelector('body.preview-document h1')?.textContent;
      if (!heading) throw new Error('Example output missing');
      if (request !== latestRequest) return;
      preview.querySelector('h1').textContent = heading;
      previewStatus.textContent = '';
    } catch {
      if (request === latestRequest) previewStatus.textContent = 'Could not load the example. Try again.';
    }
  });
}

const docSearch = document.querySelector('[data-doc-search]');
if (docSearch) {
  const cards = [...document.querySelectorAll('[data-doc-card]')];
  const summary = document.getElementById('search-summary');
  const filter = () => {
    const query = docSearch.value.trim().toLowerCase();
    let found = 0;
    for (const card of cards) {
      const visible = card.dataset.search.includes(query);
      card.hidden = !visible;
      if (visible) found++;
    }
    summary.textContent = query ? found + (found === 1 ? ' guide found.' : ' guides found.') : '';
  };
  docSearch.addEventListener('input', filter);
  docSearch.form.addEventListener('submit', event => { event.preventDefault(); filter(); });
  // All cards are present in the enhanced view; server search remains the fallback.
  filter();
}
