// Development tool: preview other body fonts on the live site.
// Loaded only when the server runs with COW_SITE_FONTS=1, which also lets the
// page fetch Google Fonts. The choice is kept in localStorage, so it follows
// you from page to page.

// Every family and weight range below was checked against the Google Fonts API.
// Families with static weights (no "..") round the site's in-between weights, such as 350, to the nearest one they have.
const fonts = [
  ["Funnel Sans", null, "Current"],
  ["Outfit", null, "Previous body font"],
  ["DM Sans", "DM+Sans:opsz,wght@9..40,300..700", "Geometric, closest to Outfit"],
  ["Figtree", "Figtree:wght@300..700", "Geometric, closest to Outfit"],
  ["Manrope", "Manrope:wght@300..700", "Geometric, closest to Outfit"],
  ["Plus Jakarta Sans", "Plus+Jakarta+Sans:wght@300..700", "Geometric, closest to Outfit"],
  ["Albert Sans", "Albert+Sans:wght@300..700", "Geometric, closest to Outfit"],
  ["Lexend", "Lexend:wght@300..700", "Geometric, closest to Outfit"],
  ["Lexend Deca", "Lexend+Deca:wght@300..700", "Geometric, closest to Outfit"],
  ["Jost", "Jost:wght@300..700", "Geometric, closest to Outfit"],
  ["Urbanist", "Urbanist:wght@300..700", "Geometric, closest to Outfit"],
  ["Sora", "Sora:wght@300..700", "Geometric, closest to Outfit"],
  ["Red Hat Text", "Red+Hat+Text:wght@300..700", "Geometric, closest to Outfit"],
  ["Kumbh Sans", "Kumbh+Sans:wght@300..700", "Geometric, closest to Outfit"],
  ["Readex Pro", "Readex+Pro:wght@300..700", "Geometric, closest to Outfit"],
  ["Gantari", "Gantari:wght@300..700", "Geometric, closest to Outfit"],
  ["Montserrat", "Montserrat:wght@300..700", "Geometric, closest to Outfit"],
  ["Poppins", "Poppins:wght@300;400;500;600;700", "Geometric, closest to Outfit"],
  ["Nunito Sans", "Nunito+Sans:opsz,wght@6..12,300..700", "Humanist, warm and easy to read"],
  ["Source Sans 3", "Source+Sans+3:wght@300..700", "Humanist, warm and easy to read"],
  ["Atkinson Hyperlegible Next", "Atkinson+Hyperlegible+Next:wght@300..700", "Humanist, warm and easy to read"],
  ["Mulish", "Mulish:wght@300..700", "Humanist, warm and easy to read"],
  ["Karla", "Karla:wght@300..700", "Humanist, warm and easy to read"],
  ["Open Sans", "Open+Sans:wght@300..700", "Humanist, warm and easy to read"],
  ["Lato", "Lato:wght@300;400;500;600;700", "Humanist, warm and easy to read"],
  ["Be Vietnam Pro", "Be+Vietnam+Pro:wght@300;400;500;600;700", "Humanist, warm and easy to read"],
  ["Commissioner", "Commissioner:wght@300..700", "Humanist, warm and easy to read"],
  ["Inclusive Sans", "Inclusive+Sans:wght@300..700", "Humanist, warm and easy to read"],
  ["Afacad", "Afacad:wght@400..700", "Humanist, warm and easy to read"],
  ["Cabin", "Cabin:wght@400..700", "Humanist, warm and easy to read"],
  ["Asap", "Asap:wght@300..700", "Humanist, warm and easy to read"],
  ["Assistant", "Assistant:wght@300..700", "Humanist, warm and easy to read"],
  ["Ysabeau", "Ysabeau:wght@300..700", "Humanist, warm and easy to read"],
  ["Fira Sans", "Fira+Sans:wght@300;400;500;600;700", "Humanist, warm and easy to read"],
  ["Alegreya Sans", "Alegreya+Sans:wght@300;400;500;600;700", "Humanist, warm and easy to read"],
  ["Inter", "Inter:wght@300..700", "Neutral grotesque"],
  ["Geist", "Geist:wght@300..700", "Neutral grotesque"],
  ["Instrument Sans", "Instrument+Sans:wght@400..700", "Neutral grotesque"],
  ["Onest", "Onest:wght@300..700", "Neutral grotesque"],
  ["Hanken Grotesk", "Hanken+Grotesk:wght@300..700", "Neutral grotesque"],
  ["Schibsted Grotesk", "Schibsted+Grotesk:wght@400..700", "Neutral grotesque"],
  ["Public Sans", "Public+Sans:wght@300..700", "Neutral grotesque"],
  ["Work Sans", "Work+Sans:wght@300..700", "Neutral grotesque"],
  ["IBM Plex Sans", "IBM+Plex+Sans:wght@300;400;500;600;700", "Neutral grotesque"],
  ["Wix Madefor Text", "Wix+Madefor+Text:wght@400..700", "Neutral grotesque"],
  ["Reddit Sans", "Reddit+Sans:wght@300..700", "Neutral grotesque"],
  ["Rethink Sans", "Rethink+Sans:wght@400..700", "Neutral grotesque"],
  ["Host Grotesk", "Host+Grotesk:wght@300..700", "Neutral grotesque"],
  ["Mona Sans", "Mona+Sans:wght@300..700", "Neutral grotesque"],
  ["Hubot Sans", "Hubot+Sans:wght@300..700", "Neutral grotesque"],
  ["Ubuntu Sans", "Ubuntu+Sans:wght@300..700", "Neutral grotesque"],
  ["SUSE", "SUSE:wght@300..700", "Neutral grotesque"],
  ["Google Sans Flex", "Google+Sans+Flex:wght@300..700", "Neutral grotesque"],
  ["TikTok Sans", "TikTok+Sans:wght@300..700", "Neutral grotesque"],
  ["Roboto Flex", "Roboto+Flex:wght@300..700", "Neutral grotesque"],
  ["Libre Franklin", "Libre+Franklin:wght@300..700", "Neutral grotesque"],
  ["Archivo", "Archivo:wght@300..700", "Neutral grotesque"],
  ["Golos Text", "Golos+Text:wght@400..700", "Neutral grotesque"],
  ["Noto Sans", "Noto+Sans:wght@300..700", "Neutral grotesque"],
  ["Heebo", "Heebo:wght@300..700", "Neutral grotesque"],
  ["Overpass", "Overpass:wght@300..700", "Neutral grotesque"],
  ["Epilogue", "Epilogue:wght@300..700", "Neutral grotesque"],
  ["Nunito", "Nunito:wght@300..700", "Rounded and friendly"],
  ["Rubik", "Rubik:wght@300..700", "Rounded and friendly"],
  ["Quicksand", "Quicksand:wght@300..700", "Rounded and friendly"],
  ["M PLUS Rounded 1c", "M+PLUS+Rounded+1c:wght@300;400;500;600;700", "Rounded and friendly"],
  ["Parkinsans", "Parkinsans:wght@300..700", "Rounded and friendly"],
  ["Radio Canada Big", "Radio+Canada+Big:wght@400..700", "Rounded and friendly"],
  ["Sen", "Sen:wght@400..700", "Rounded and friendly"],
  ["Familjen Grotesk", "Familjen+Grotesk:wght@400..700", "Rounded and friendly"],
  ["Averia Sans Libre", "Averia+Sans+Libre:wght@300;400;500;600;700", "Rounded and friendly"],
  ["Bricolage Grotesque", "Bricolage+Grotesque:opsz,wght@12..96,300..700", "Sans with character"],
  ["Space Grotesk", "Space+Grotesk:wght@300..700", "Sans with character"],
  ["Source Serif 4", "Source+Serif+4:opsz,wght@8..60,300..700", "Serif"],
  ["Newsreader", "Newsreader:opsz,wght@6..72,300..700", "Serif"],
  ["Literata", "Literata:opsz,wght@7..72,300..700", "Serif"],
  ["Lora", "Lora:wght@400..700", "Serif"],
  ["Fraunces", "Fraunces:opsz,wght@9..144,300..700", "Serif"],
  ["system-ui", null, "System"],
];

// Heading faces. Each was checked against the Google Fonts API. A fourth value of true marks a face that ships one weight,
// so it ignores the site's heading weights and shows as drawn.
const headingFonts = [
  ["Lexend", null, "Current"],
  ["Outfit", null, "Previous heading font"],
  ["Funnel Display", "Funnel+Display:wght@300..800", "Funnel family"],
  ["Funnel Sans", null, "Funnel family"],
  ["Plus Jakarta Sans", "Plus+Jakarta+Sans:wght@300..800", "Geometric and modern"],
  ["Manrope", "Manrope:wght@300..800", "Geometric and modern"],
  ["DM Sans", "DM+Sans:opsz,wght@9..40,300..800", "Geometric and modern"],
  ["Figtree", "Figtree:wght@300..800", "Geometric and modern"],
  ["Sora", "Sora:wght@300..800", "Geometric and modern"],
  ["Urbanist", "Urbanist:wght@300..800", "Geometric and modern"],
  ["Red Hat Display", "Red+Hat+Display:wght@300..800", "Geometric and modern"],
  ["Jost", "Jost:wght@300..800", "Geometric and modern"],
  ["Poppins", "Poppins:wght@400;500;600;700", "Geometric and modern"],
  ["Montserrat", "Montserrat:wght@300..800", "Geometric and modern"],
  ["Raleway", "Raleway:wght@300..800", "Geometric and modern"],
  ["Kumbh Sans", "Kumbh+Sans:wght@300..800", "Geometric and modern"],
  ["League Spartan", "League+Spartan:wght@300..800", "Geometric and modern"],
  ["Syne", "Syne:wght@400..800", "Geometric and modern"],
  ["Unbounded", "Unbounded:wght@300..800", "Geometric and modern"],
  ["Gabarito", "Gabarito:wght@400..800", "Geometric and modern"],
  ["Inter Tight", "Inter+Tight:wght@300..800", "Geometric and modern"],
  ["Geist", "Geist:wght@300..800", "Geometric and modern"],
  ["Onest", "Onest:wght@300..800", "Geometric and modern"],
  ["Albert Sans", "Albert+Sans:wght@300..800", "Geometric and modern"],
  ["Be Vietnam Pro", "Be+Vietnam+Pro:wght@400;500;600;700", "Geometric and modern"],
  ["Epilogue", "Epilogue:wght@300..800", "Geometric and modern"],
  ["Wix Madefor Display", "Wix+Madefor+Display:wght@400..800", "Geometric and modern"],
  ["Josefin Sans", "Josefin+Sans:wght@300..700", "Geometric and modern"],
  ["Afacad Flux", "Afacad+Flux:wght@300..800", "Geometric and modern"],
  ["Nunito", "Nunito:wght@300..800", "Rounded and friendly"],
  ["Quicksand", "Quicksand:wght@300..700", "Rounded and friendly"],
  ["Fredoka", "Fredoka:wght@300..700", "Rounded and friendly"],
  ["Baloo 2", "Baloo+2:wght@400..800", "Rounded and friendly"],
  ["Rubik", "Rubik:wght@300..800", "Rounded and friendly"],
  ["Comfortaa", "Comfortaa:wght@300..700", "Rounded and friendly"],
  ["DynaPuff", "DynaPuff:wght@400..700", "Rounded and friendly"],
  ["Grandstander", "Grandstander:wght@300..800", "Rounded and friendly"],
  ["Sour Gummy", "Sour+Gummy:wght@300..800", "Rounded and friendly"],
  ["Playpen Sans", "Playpen+Sans:wght@300..800", "Rounded and friendly"],
  ["Shantell Sans", "Shantell+Sans:wght@300..800", "Rounded and friendly"],
  ["M PLUS Rounded 1c", "M+PLUS+Rounded+1c:wght@400;500;600;700", "Rounded and friendly"],
  ["Varela Round", "Varela+Round:wght@400;500;600;700", "Rounded and friendly", true],
  ["Sniglet", "Sniglet:wght@400;500;600;700", "Rounded and friendly", true],
  ["Chewy", "Chewy:wght@400;500;600;700", "Rounded and friendly", true],
  ["Bagel Fat One", "Bagel+Fat+One:wght@400;500;600;700", "Rounded and friendly", true],
  ["Lilita One", "Lilita+One:wght@400;500;600;700", "Rounded and friendly", true],
  ["Titan One", "Titan+One:wght@400;500;600;700", "Rounded and friendly", true],
  ["Paytone One", "Paytone+One:wght@400;500;600;700", "Rounded and friendly", true],
  ["Bricolage Grotesque", "Bricolage+Grotesque:opsz,wght@12..96,300..800", "Grotesques with character"],
  ["Space Grotesk", "Space+Grotesk:wght@300..700", "Grotesques with character"],
  ["Familjen Grotesk", "Familjen+Grotesk:wght@400..700", "Grotesques with character"],
  ["Instrument Sans", "Instrument+Sans:wght@400..700", "Grotesques with character"],
  ["Parkinsans", "Parkinsans:wght@300..800", "Grotesques with character"],
  ["Radio Canada Big", "Radio+Canada+Big:wght@400..700", "Grotesques with character"],
  ["Host Grotesk", "Host+Grotesk:wght@300..800", "Grotesques with character"],
  ["Mona Sans", "Mona+Sans:wght@300..800", "Grotesques with character"],
  ["Hubot Sans", "Hubot+Sans:wght@300..800", "Grotesques with character"],
  ["Darker Grotesque", "Darker+Grotesque:wght@300..800", "Grotesques with character"],
  ["Schibsted Grotesk", "Schibsted+Grotesk:wght@400..800", "Grotesques with character"],
  ["Hanken Grotesk", "Hanken+Grotesk:wght@300..800", "Grotesques with character"],
  ["Rethink Sans", "Rethink+Sans:wght@400..800", "Grotesques with character"],
  ["Reddit Sans", "Reddit+Sans:wght@300..800", "Grotesques with character"],
  ["SUSE", "SUSE:wght@300..800", "Grotesques with character"],
  ["Special Gothic", "Special+Gothic:wght@400..700", "Grotesques with character"],
  ["Special Gothic Expanded One", "Special+Gothic+Expanded+One:wght@400;500;600;700", "Grotesques with character", true],
  ["Boldonse", "Boldonse:wght@400;500;600;700", "Grotesques with character", true],
  ["Archivo", "Archivo:wght@300..800", "Grotesques with character"],
  ["Archivo Black", "Archivo+Black:wght@400;500;600;700", "Grotesques with character", true],
  ["Anybody", "Anybody:wght@300..800", "Grotesques with character"],
  ["Golos Text", "Golos+Text:wght@400..800", "Grotesques with character"],
  ["Work Sans", "Work+Sans:wght@300..800", "Grotesques with character"],
  ["Public Sans", "Public+Sans:wght@300..800", "Grotesques with character"],
  ["Libre Franklin", "Libre+Franklin:wght@300..800", "Grotesques with character"],
  ["Anton SC", "Anton+SC:wght@400;500;600;700", "Grotesques with character", true],
  ["Oswald", "Oswald:wght@300..700", "Condensed and tall"],
  ["Barlow Condensed", "Barlow+Condensed:wght@400;500;600;700", "Condensed and tall"],
  ["Big Shoulders Display", "Big+Shoulders+Display:wght@300..800", "Condensed and tall"],
  ["Bebas Neue", "Bebas+Neue:wght@400;500;600;700", "Condensed and tall", true],
  ["Anton", "Anton:wght@400;500;600;700", "Condensed and tall", true],
  ["Fjalla One", "Fjalla+One:wght@400;500;600;700", "Condensed and tall", true],
  ["Archivo Narrow", "Archivo+Narrow:wght@400..700", "Condensed and tall"],
  ["Sofia Sans Condensed", "Sofia+Sans+Condensed:wght@300..800", "Condensed and tall"],
  ["Saira Condensed", "Saira+Condensed:wght@400;500;600;700", "Condensed and tall"],
  ["Roboto Condensed", "Roboto+Condensed:wght@300..800", "Condensed and tall"],
  ["League Gothic", "League+Gothic:wght@400;500;600;700", "Condensed and tall", true],
  ["Fraunces", "Fraunces:opsz,wght@9..144,300..800", "Serif"],
  ["Young Serif", "Young+Serif:wght@400;500;600;700", "Serif", true],
  ["Instrument Serif", "Instrument+Serif:wght@400;500;600;700", "Serif", true],
  ["DM Serif Display", "DM+Serif+Display:wght@400;500;600;700", "Serif", true],
  ["Playfair Display", "Playfair+Display:wght@400..800", "Serif"],
  ["Gloock", "Gloock:wght@400;500;600;700", "Serif", true],
  ["Caprasimo", "Caprasimo:wght@400;500;600;700", "Serif", true],
  ["Abril Fatface", "Abril+Fatface:wght@400;500;600;700", "Serif", true],
  ["Bodoni Moda", "Bodoni+Moda:wght@400..800", "Serif"],
  ["Newsreader", "Newsreader:wght@300..800", "Serif"],
  ["Literata", "Literata:wght@300..800", "Serif"],
  ["Lora", "Lora:wght@400..700", "Serif"],
  ["Source Serif 4", "Source+Serif+4:wght@300..800", "Serif"],
  ["Crimson Pro", "Crimson+Pro:wght@300..800", "Serif"],
  ["EB Garamond", "EB+Garamond:wght@400..800", "Serif"],
  ["Cormorant", "Cormorant:wght@300..700", "Serif"],
  ["Alegreya", "Alegreya:wght@400..800", "Serif"],
  ["Vollkorn", "Vollkorn:wght@400..800", "Serif"],
  ["Libre Baskerville", "Libre+Baskerville:wght@400..700", "Serif"],
  ["Gelasio", "Gelasio:wght@400..700", "Serif"],
  ["Petrona", "Petrona:wght@300..800", "Serif"],
  ["Brygada 1918", "Brygada+1918:wght@400..700", "Serif"],
  ["Yeseva One", "Yeseva+One:wght@400;500;600;700", "Serif", true],
  ["Chonburi", "Chonburi:wght@400;500;600;700", "Serif", true],
  ["Rozha One", "Rozha+One:wght@400;500;600;700", "Serif", true],
  ["Libre Caslon Display", "Libre+Caslon+Display:wght@400;500;600;700", "Serif", true],
  ["Playfair", "Playfair:wght@300..800", "Serif"],
  ["Roboto Serif", "Roboto+Serif:wght@300..800", "Serif"],
  ["Noto Serif Display", "Noto+Serif+Display:wght@300..800", "Serif"],
  ["Bitter", "Bitter:wght@300..800", "Slab"],
  ["Roboto Slab", "Roboto+Slab:wght@300..800", "Slab"],
  ["Zilla Slab", "Zilla+Slab:wght@400;500;600;700", "Slab"],
  ["Arvo", "Arvo:wght@400;500;600;700", "Slab"],
  ["Aleo", "Aleo:wght@300..800", "Slab"],
  ["Besley", "Besley:wght@400..800", "Slab"],
  ["Domine", "Domine:wght@400..700", "Slab"],
  ["Rokkitt", "Rokkitt:wght@300..800", "Slab"],
  ["Bree Serif", "Bree+Serif:wght@400;500;600;700", "Slab", true],
  ["Patua One", "Patua+One:wght@400;500;600;700", "Slab", true],
  ["Alfa Slab One", "Alfa+Slab+One:wght@400;500;600;700", "Slab", true],
  ["Hepta Slab", "Hepta+Slab:wght@300..800", "Slab"],
  ["Josefin Slab", "Josefin+Slab:wght@300..700", "Slab"],
  ["Crete Round", "Crete+Round:wght@400;500;600;700", "Slab", true],
  ["Ultra", "Ultra:wght@400;500;600;700", "Slab", true],
];

const storageKey = 'cow-font-preview';
const root = document.documentElement;
const loaded = new Set();
const read = () => { try { return JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { return {}; } };
const save = state => { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Private mode: the choice lasts for this page only. */ } };

function load(name, list = fonts) {
  const entry = list.find(([font]) => font === name);
  if (!entry?.[1] || loaded.has(name)) return;
  loaded.add(name);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=' + entry[1] + '&display=swap';
  document.head.append(link);
}

const quoted = name => name === 'system-ui' ? 'system-ui' : `"${name}"`;
function apply(state) {
  // The site reads two tokens, --font-body and --font-heading. The preview overrides them in font-picker.css.
  const name = state.font && state.font !== 'Funnel Sans' ? state.font : '';
  if (name) { load(name); root.style.setProperty('--preview-font', quoted(name)); } else root.style.removeProperty('--preview-font');
  root.toggleAttribute('data-font-preview', Boolean(name));
  const heading = state.heading && state.heading !== 'Lexend' ? state.heading : '';
  if (heading) { load(heading, headingFonts); root.style.setProperty('--preview-heading', quoted(heading)); } else root.style.removeProperty('--preview-heading');
  root.toggleAttribute('data-heading-preview', Boolean(heading));
  if (state.size) root.style.setProperty('--preview-size', state.size + '%'); else root.style.removeProperty('--preview-size');
  root.toggleAttribute('data-font-size', Boolean(state.size));
}

const styles = document.createElement('link');
styles.rel = 'stylesheet';
styles.href = '/assets/font-picker.css';
document.head.append(styles);

const state = read();
apply(state);

const panel = document.createElement('form');
panel.className = 'font-picker';
panel.setAttribute('aria-label', 'Font preview');
if (state.closed) panel.dataset.closed = '';

const toggle = document.createElement('button');
toggle.type = 'button';
toggle.className = 'font-picker-toggle';
toggle.textContent = 'Aa';
toggle.setAttribute('aria-label', 'Show or hide the font preview');
toggle.setAttribute('aria-expanded', String(!state.closed));

const body = document.createElement('div');
body.className = 'font-picker-body';

function field(title, list, current, fallback) {
  const label = document.createElement('label');
  const text = document.createTextNode(title);
  const select = document.createElement('select');
  let group;
  for (const [name, , kind, single] of list) {
    if (!group || group.label !== kind) { group = document.createElement('optgroup'); group.label = kind; select.append(group); }
    const option = document.createElement('option');
    option.value = name;
    option.textContent = single ? name + ' (one weight)' : name;
    group.append(option);
  }
  select.value = list.some(([name]) => name === current) ? current : fallback;
  label.append(text, select);
  const step = document.createElement('div');
  step.className = 'font-picker-step';
  const previous = Object.assign(document.createElement('button'), { type: 'button', textContent: '← Previous' });
  const next = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Next →' });
  step.append(previous, next);
  const names = list.map(([name]) => name);
  const showPosition = () => { text.textContent = title + ' (' + (names.indexOf(select.value) + 1) + ' of ' + names.length + ')'; };
  const move = offset => { select.value = names[(names.indexOf(select.value) + offset + names.length) % names.length]; update(); };
  previous.addEventListener('click', () => move(-1));
  next.addEventListener('click', () => move(1));
  select.addEventListener('change', () => update());
  showPosition();
  return { label, step, select, showPosition };
}

const bodyField = field('Body font', fonts, state.font, 'Funnel Sans');
const headingField = field('Heading font', headingFonts, state.heading, 'Lexend');
const select = bodyField.select, headingSelect = headingField.select;

const size = document.createElement('label');
size.textContent = 'Text size';
const sizeRange = Object.assign(document.createElement('input'), { type: 'range', min: '90', max: '115', step: '1', value: String(state.size || 100) });
const sizeValue = document.createElement('output');
sizeValue.textContent = (state.size || 100) + '%';
size.append(sizeRange, sizeValue);

const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Reset to the site fonts' });
reset.className = 'font-picker-reset';

function update() {
  state.font = select.value;
  state.heading = headingSelect.value;
  bodyField.showPosition();
  headingField.showPosition();
  delete state.headings;
  state.size = Number(sizeRange.value) === 100 ? 0 : Number(sizeRange.value);
  sizeValue.textContent = sizeRange.value + '%';
  save(state);
  apply(state);
}
sizeRange.addEventListener('input', update);
reset.addEventListener('click', () => { select.value = 'Funnel Sans'; headingSelect.value = 'Lexend'; sizeRange.value = '100'; update(); });
toggle.addEventListener('click', () => {
  state.closed = !state.closed;
  panel.toggleAttribute('data-closed', state.closed);
  toggle.setAttribute('aria-expanded', String(!state.closed));
  save(state);
});
panel.addEventListener('submit', event => event.preventDefault());

body.append(bodyField.label, bodyField.step, headingField.label, headingField.step, size, reset);
panel.append(toggle, body);
// Outside <body>, so the text-size preview does not scale the panel itself.
document.documentElement.append(panel);
