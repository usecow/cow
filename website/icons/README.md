# Cow Icons

72 original UI icons, each available in **Stroke**, **Solid**, **Duo Stroke**, and **Duo Solid** (288 SVGs). The website uses the Stroke sprite for UI icons; the circular logo and mascot artwork stay separate.

The navigation set includes eight chunky compass-direction arrows (`arrow-*`), eight simple line arrows (`arrow-line-*`), eight rounded 90-degree bends (`arrow-bend-*`), four chevrons, upload, download, and refresh. Bend names describe shaft entry and arrowhead direction, such as `arrow-bend-top-right`. Line and bend arrows keep their open geometry in every style; Duo Stroke accents the shaft and draws the primary head over its join. Everyday controls include plus, minus, close, and menu. Gallery counts and categories are generated from the registry.

Open `/icons` on the website preview. The icon browser has a compact grid, keyword search, real category counts, alphabetical sorting, and a four-style selector. Select an icon to inspect it and copy or download its SVG. `duotone` remains the backward-compatible API/directory name for Duo Stroke; Duo Solid uses `duotone-solid`.

Site essentials include code, file-code, braces, route, external-link, a plain checkmark, info, warning, loader, sun, and moon. The existing `check` is the circled check; `checkmark` is the standalone tick. Loader is a static SVG master; consuming interfaces can animate it with reduced-motion support.

Site capability icons include `form`, `cookie`, `lock`, `database`, `module`, and `browser` for Cow's built-in capabilities. `user`, `file-json`, and `key` cover profiles, JSON responses, and access in examples and docs. File JSON reuses the established page and fold; module uses a simple package silhouette in Stroke/Solid and a front-facing cube in the duo styles. These are icons for product concepts, not runtime or language logos.

Cookie has one broad bite and three small filled chips with enough space between them at 16px. The chips stay in the same positions across all four styles, with real cutouts in Solid and coloured inlays in Duo Solid. Its normal-weight outer contour is the reference for other enclosed, accent-filled Duo Solid icons.

The **Cow** category includes `cow-mark`, `cow-file`, `spots`, `hoofprint`, `milk-bottle`, and `herd`. The mark is a small UI adaptation of the mascot's asymmetric horns, floppy ear, projecting muzzle, and long neck, not a new logo. It uses an open outline in Stroke and a filled stamp in the other styles. The circular brand logo is a separate asset. Cow mark and herd use simplified shapes with no eyes, nostrils, or facial cutouts. Herd uses an occluded rear head and the shared foreground silhouette; its coordinates are scaled, not its stroke weight. Its rear head is an accent-filled silhouette in Duo Solid. Cow file places the shared head silhouette in the center beneath the fold, with no edge patches. Its stamp is filled in both stroke and duotone, and becomes an identically placed transparent cutout in solid. Milk bottle uses a taller, narrower body, a distinct cap and neck, sloping shoulders, and a curved milk-level line.

The sidebar customizes foreground and duotone accent colours, size (16–48px), stroke width, and absolute stroke width. These are explicit preview/export overrides, not edits to the canonical masters. Solid shapes keep their fixed geometry and disable stroke controls. Changing canvas theme restores that theme's readable default colours. Reset restores the current theme's default customizer settings. The mobile customizer is collapsible.

Downloads embed the chosen colours and geometry settings, without relying on the gallery's CSS variables. Clipboard failure exposes selectable source. Search supports Ctrl/Cmd+K, and the details dialog supports Escape.

## The family resemblance

Friendly curves, rounded ends, generous space. Clover colour is optional. No grain, wobbly outlines, decorative horns added to ordinary controls, or tiny cow spots. Familiar symbols should keep their familiar meaning. Explicit Cow symbols live in their own category; the full mascot remains a separate brand asset.

Our geometric starting point is [Lucide's design principles](https://lucide.dev/contribute/icons/design-principles): a 24-unit canvas, 2-unit centered strokes, round caps and joins, at least 1 unit of outer breathing room, simple curves, visual balance, and low detail. Aim for 2 units of clear separation between independent features. Use 2-unit corner radii for large corners, smaller radii for small features. Optical corrections are allowed when they help legibility.

This is not a Lucide fork: no Lucide SVG paths are copied. The filled and two-colour treatments are Cow's extensions, not Lucide specifications.

- **Stroke:** default UI style. Open surfaces with rounded outlines.
- **Solid:** filled silhouettes with real transparent cutouts. Interior details may simplify; position and meaning stay the same. Never fake a hole with white paint.
- **Duo Stroke:** the same 2-unit lines as Stroke, with a second colour on stems, inner marks, or clearly secondary parts. Colour never adds weight or fills the main surface. Simple icons may remain single-tone.
- **Duo Solid:** uses solid silhouettes, real filled planes, and filled details for colour distinction—not a heavier version of Stroke. Enclosed accent-filled surfaces keep a primary 2-unit contour, like Cookie; open symbols do not gain artificial outlines. Never split a shape into arbitrary halves or fill an open symbol just to force a second tone. Both solid styles have fixed weight.

Duo Stroke assignments:

- Terminal: primary window outline, accent prompt and cursor.
- File family: primary page outline and fold; accent text, code, JSON braces, or Cow stamp.
- Folder: primary folder outline, accent inset line; no front-pocket fill.
- Book: primary page outlines, accent spine.
- Copy: accent original open rear-sheet stroke, primary front-sheet outline.
- Search: primary lens rim, accent handle; no lens fill.
- Message: primary bubble outline, accent text stroke.
- Check: primary circle outline, accent check.
- Leaf: primary blade outline, accent vein and stem.
- Heart and play: single-tone outlines, identical to stroke.
- Chunky directional arrows: trailing (left or bottom) outline in the primary colour, leading head outline in the accent, meeting at the shoulders without overlapping caps or heavier lines. Chevrons, plus, minus, close, and menu stay single-tone. Line arrows, bends, and refresh accent the stem and keep the head primary, painted last. Upload and download do the same, with a primary open tray.
- Code: accent slash, primary brackets. Browser: primary frame and top divider, accent inner line. Module: primary front square, accent depth lines painted last without overlap or fill.
- Route: accent endpoint rings, primary route. External-link: primary window, accent arrow.
- Info and warning: primary enclosure, accent punctuation. Sun: accent rays, primary disc outline.
- Braces, checkmark, loader, and moon: single-tone.
- Cow mark, spots, and hoofprint: single-tone. Do not colour one hoof or one patch just to force two tones.
- Cow file: primary page outline and fold, accent centered head stamp, matching the other file icons; milk bottle: accent collar and milk-level line; herd: accent rear head. Duotone reuses the stroke geometry and adds no fills; Cow file's silhouette stamp is already filled in stroke and only changes colour.

Duo Stroke usually recolours existing parts without introducing geometry; module uses a front-facing line-cube variation to match its Duo Solid form. File folds and the browser's top divider remain primary, while their inner marks take the accent. Duo Solid has its own explicit, back-to-front compositions; it does not inherit Duo Stroke's colour assignments.

- Terminal, message, check, info, and warning: secondary container with a normal-weight primary contour, plus primary symbol or text.
- Files: secondary page fill, with a normal-weight primary outline, fold, and interior symbol. Cow file keeps its centered head stamp in the primary colour.
- Folder: secondary rear tab, primary front panel, with the existing inset in the secondary colour. Copy retains its original open primary rear-sheet contour behind an accent front sheet with a primary 2-unit rim.
- Book: secondary pages with a primary contour and spine. Search: filled secondary lens with a normal-weight primary rim and handle.
- Leaf: secondary blade with a primary contour and one continuous primary vein and stem. Milk bottle: primary bottle and cap, secondary liquid volume below a curved surface with a primary level line.
- Route: secondary connector, primary endpoints. Sun: secondary disc, primary rays. Herd: secondary filled rear head behind the primary foreground cow.
- Heart, play, moon, the eight chunky directional arrows, Cow mark, hoofprint, and spots: whole accent silhouettes with a normal-weight primary edge. Cow mark leaves its flat neck base unoutlined, matching User's open shoulder base. Each hoof and spot is treated the same way; nothing is split just to force two colours.
- Upload/download keep the same open tray as every other style: primary tray, secondary arrow. External-link has a filled secondary window with a primary 2-unit contour and arrow reaching beyond its top-right corner. Code and the other unlayered controls stay single-tone in Duo Solid, using the accent colour.
- Form has an accent-filled page with primary contour and fields; JSON file follows the same accent-filled file family. Cookie and database use secondary surfaces with primary contours and details. Lock keeps a primary shackle, body contour, and keyhole line around an accent-filled body; module has an open square front with secondary top/right depth faces and a primary 2-unit contour; browser keeps a secondary window with a primary contour and lines; key has a primary silhouette and an accent-filled head center. User uses an accent silhouette with a primary edge.

A second colour is available, not mandatory. Most closed silhouettes stay single-tone in Duo Stroke; the chunky arrows split their unchanged outline into primary trailing and accent leading sections. Duo Solid can use an accent fill. Its icons without a two-layer composition use the accent alone, including line arrows, bends, chevrons, refresh, and simple controls. Open arrows gain stem/head distinction only in Duo Stroke; they do not gain a false filled surface in Duo Solid.

Directional arrows and chevrons are rotations of shared masters. The four diagonal line arrows use whole-grid endpoints to avoid the extra softness of fractional rotated coordinates. In Solid, line-arrow shafts stop inside their heads so round caps cannot project beyond the arrow tips. The bends are rotations and mirrors of one rounded elbow that fills a balanced 16-unit square inside the grid, covering both turn directions from each side. Upload and download share one open tray. Line-only controls may have the same appearance in solid and stroke; do not invent an enclosing shape or inflate their weight to force a distinction. Expanded straight-line solids retain 2-unit round-ended geometry. Refresh preserves its open arc and rounded arrow tip in all styles.

### Variant construction

Compare the painted bounds, not the path centreline. The solid silhouette must account for the outline's extra 1 unit on each side. Geometric solids have expanded outer contours; organic solids retain the exact outer rim under the fill. In Solid, interior cutouts stay transparent. Duo Solid can reuse those cutouts as coloured details or define a meaningful interior plane or volume. Order overlapping layers deliberately, and keep connected features continuous. Neither style uses background-coloured erasing. Adjust optical weight deliberately, not through accidental shrinkage.

Use the terminal's horizontal rectangle, the file's vertical rectangle, the check's circle, and the play triangle as family references. Search's Solid lens rim and handle both use a 2-unit thickness. Compare other icons against these at actual size and next to the site's Outfit labels. Shared grid dimensions alone do not guarantee equal perceived weight.

Chunky arrows use a soft, enclosed arrowhead with rounded shaft-to-head transitions. Concave master corners need enough radius to stay rounded after the centered outer stroke is added. Simple line arrows use open heads and rounded ends. Document shapes have rounded folds and tabs. Leaf and heart have broad, simple curves. Keep this vocabulary consistent as the set grows.

## Sizes and colour

Design at 24px, use at 20–24px by default, and review 16px at actual size on light and dark surfaces when adding icons. Use the gallery size control to inspect 16/20/24px for all four variants. The larger details preview is not a substitute for actual-size review. These are scalable masters, not separately pixel-hinted 16px assets.

Inline icons inherit `currentColor`. Duotone adds `--cow-icon-accent`, defaulting to deep clover `#456329` for light backgrounds. The secondary colour carries real strokes, so it must have sufficient contrast against the canvas. Canonical masters keep centered 2-unit strokes without `vector-effect="non-scaling-stroke"`; customizer overrides are separate.

The gallery uses dark ink `#191C17` and deep clover `#456329` on light canvases. On dark canvases it uses light ink `#F4F6F0` and clover `#B8DB7C`. Custom colours may reduce legibility; check both stroke colours against the canvas. Export embeds both fill and stroke colour overrides.

Duo Solid defaults to mid-clover `#688E43`, separating adjoining filled parts more clearly than pale clover against white. Check contrast between components as well as against the canvas. Switching styles adapts the default accent, but preserves a user-customized accent. Theme changes and Reset restore the appropriate defaults. The accent picker, preview, copied SVG, downloads, and sprite all support Duo Solid.

[Adobe's refinement guidance](https://adobe.design/ideas/how-to-design-effective-icons-part-2) complements the grid rules: judge optical balance, typography, actual-size rendering, and contrast together. Its alternative stroke alignments are not used here; Cow keeps centered 2-unit strokes.

## Use

No dependencies. Import the rendering helper from the source:

```js
import { cowIcon } from './website/icons/icons.mjs';
const decorative = cowIcon('terminal', { variant: 'duotone', size: 24 });
const filledDuo = cowIcon('cow-file', { variant: 'duotone-solid', size: 24 });
const standalone = cowIcon('heart', { variant: 'solid', label: 'Favourite' });
```

The helper returns SVG markup, decorative by default. Give an icon-only **button** its accessible name on the button and leave its icon decorative. A standalone meaningful icon can receive `label`. Don't use colour or an icon alone to explain an unfamiliar action.

Individual assets live in `website/site/assets/icons/{stroke,solid,duotone,duotone-solid}/`. With `<img>`, set `alt` on the image; parent CSS colours do not pass into external images. Prefer inline SVG when theming.

An external sprite is also available:

```html
<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
  <use href="/assets/icons/sprite.svg#cow-terminal-stroke"></use>
</svg>
```

## Editing

Edit `icons.mjs`, then regenerate the standalone SVGs and the sprite:

```sh
node website/icons/build.mjs
```

The icon browser is a Cow page, `site/icons.cow`, rendered live from `icons.mjs` on each request — no regeneration step. Styling and behaviour are in `site/assets/icons/gallery.css` and `gallery.mjs`.

Check each variant at actual size on light and dark backgrounds. Compare visual weight, check for accidental intersections and gaps, and confirm the symbol reads without its label.
