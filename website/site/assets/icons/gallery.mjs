const $ = selector => document.querySelector(selector);
const tiles = [...document.querySelectorAll('.icon-tile')];
const grid = $('.icon-grid'), dialog = $('#icon-dialog');
const state = { variant:'stroke', color:'#f4f6f0', accent:'#b8db7c', size:24, weight:2, absolute:false, category:'All', selected:null };
const isSolid = () => state.variant === 'solid' || state.variant === 'duotone-solid';
const styleLabels = { stroke:'Stroke', solid:'Solid', duotone:'Duo Stroke', 'duotone-solid':'Duo Solid' };
let accentCustomized = false;
const defaultAccent = () => state.variant === 'duotone-solid' ? '#688e43' : ($('#theme').value === 'dark' ? '#b8db7c' : '#456329');
const hex = /^#[\da-f]{6}$/i;
$('#toggle-controls').addEventListener('click', event => {
  const open = $('.sidebar').classList.toggle('customizing');
  event.currentTarget.setAttribute('aria-expanded', open);
  event.currentTarget.textContent = open ? 'Hide customizer' : 'Customize icons';
});
function makeIcon(name) {
  const svg = document.getElementById(name + '-' + state.variant).content.firstElementChild.cloneNode(true);
  svg.setAttribute('width', state.size); svg.setAttribute('height', state.size);
  if (!isSolid()) {
    svg.querySelectorAll('[stroke-width]').forEach(node => node.setAttribute('stroke-width', state.weight));
    if (state.absolute) svg.querySelectorAll('path,rect,circle').forEach(node => node.setAttribute('vector-effect', 'non-scaling-stroke'));
  }
  return svg;
}
function exportSvg() {
  const svg = makeIcon(state.selected);
  svg.setAttribute('color', state.color);
  for (const attribute of ['fill', 'stroke']) {
    svg.querySelectorAll('[' + attribute + ']').forEach(node => {
      if (node.getAttribute(attribute).startsWith('var(')) node.setAttribute(attribute, state.accent);
    });
  }
  return new XMLSerializer().serializeToString(svg);
}
function updateDialog() {
  if (!state.selected) return;
  $('#dialog-title').textContent = tiles.find(tile => tile.dataset.name === state.selected).dataset.label;
  $('#icon-preview').replaceChildren(makeIcon(state.selected));
  $('#dialog-variant').textContent = styleLabels[state.variant];
  $('#dialog-size').textContent = state.size + 'px' + (isSolid() ? '' : ' · ' + state.weight + 'px stroke');
  $('#svg-source').value = exportSvg();
}
function renderIcons() {
  document.documentElement.style.setProperty('--icon-color', state.color);
  document.documentElement.style.setProperty('--cow-icon-accent', state.accent);
  for (const tile of tiles) tile.replaceChildren(makeIcon(tile.dataset.name));
  $('#accent-control').hidden = !state.variant.startsWith('duotone');
  $('#weight').disabled = $('#absolute').disabled = isSolid();
  $('#solid-note').hidden = !isSolid();
  $('#weight-value').textContent = state.weight + 'px'; $('#size-value').textContent = state.size + 'px';
  updateDialog();
}
function filterIcons() {
  const query = $('#search').value.toLowerCase().trim();
  let count = 0;
  for (const tile of tiles) {
    tile.hidden = !(state.category === 'All' || tile.dataset.category === state.category) || !tile.dataset.search.includes(query);
    if (!tile.hidden) count++;
  }
  $('#category-title').textContent = state.category === 'All' ? 'All icons' : state.category;
  $('#result-count').textContent = count + (count === 1 ? ' icon' : ' icons');
  $('#empty').hidden = count !== 0; $('.grid-note').hidden = count === 0;
  document.querySelectorAll('.category').forEach(button => { const active = button.dataset.category === state.category; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
}
document.querySelectorAll('[name=variant]').forEach(input => input.addEventListener('change', () => {
  state.variant = input.value;
  if (!accentCustomized) state.accent = $('#accent').value = $('#accent-hex').value = defaultAccent();
  renderIcons();
}));
for (const key of ['color','accent']) {
  const picker = $('#' + key), text = $('#' + key + '-hex');
  picker.addEventListener('input', () => { if (key === 'accent') accentCustomized = true; state[key] = text.value = picker.value; text.removeAttribute('aria-invalid'); renderIcons(); });
  text.addEventListener('input', () => { const valid = hex.test(text.value); text.setAttribute('aria-invalid', !valid); if (valid) { if (key === 'accent') accentCustomized = true; state[key] = picker.value = text.value; renderIcons(); } });
}
for (const key of ['size','weight']) $('#' + key).addEventListener('input', event => { state[key] = Number(event.target.value); renderIcons(); });
$('#absolute').addEventListener('change', event => { state.absolute = event.target.checked; renderIcons(); });
$('#search').addEventListener('input', filterIcons);
document.querySelectorAll('.category').forEach(button => button.addEventListener('click', () => { state.category = button.dataset.category; filterIcons(); }));
$('#clear-search').addEventListener('click', () => { state.category = 'All'; $('#search').value = ''; filterIcons(); $('#search').focus(); });
$('#sort').addEventListener('change', event => { const order = event.target.value; [...tiles].sort((a,b) => order === 'default' ? Number(a.dataset.order)-Number(b.dataset.order) : a.dataset.label.localeCompare(b.dataset.label)*(order === 'za' ? -1 : 1)).forEach(tile => grid.append(tile)); });
function setPalette() {
  const dark = $('#theme').value === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  state.color = dark ? '#f4f6f0' : '#191c17'; state.accent = defaultAccent(); accentCustomized = false;
  for (const key of ['color','accent']) { $('#' + key).value = $('#' + key + '-hex').value = state[key]; $('#' + key + '-hex').removeAttribute('aria-invalid'); }
  renderIcons();
}
$('#theme').addEventListener('change', setPalette);
$('#reset').addEventListener('click', () => { Object.assign(state, {variant:'stroke',size:24,weight:2,absolute:false}); $('[name=variant][value=stroke]').checked = true; $('#size').value = 24; $('#weight').value = 2; $('#absolute').checked = false; setPalette(); });
for (const tile of tiles) tile.addEventListener('click', () => { state.selected = tile.dataset.name; $('#copy-status').textContent = ''; updateDialog(); dialog.showModal(); });
$('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
$('#copy-svg').addEventListener('click', async () => { try { await navigator.clipboard.writeText(exportSvg()); $('#copy-status').textContent = 'SVG copied.'; } catch { dialog.querySelector('details').open = true; $('#svg-source').focus(); $('#svg-source').select(); $('#copy-status').textContent = 'Copy the selected source below.'; } });
$('#download-svg').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([exportSvg()], {type:'image/svg+xml'})); const link = document.createElement('a'); link.href = url; link.download = 'cow-' + state.selected + '-' + state.variant + '.svg'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !dialog.open) { event.preventDefault(); $('#search').focus(); $('#search').select(); } });
renderIcons();
