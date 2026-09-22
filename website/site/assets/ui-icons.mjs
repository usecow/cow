// Use the canonical Cow sprite for both server-rendered and interactive UI.
// Icons are decorative; their surrounding link or button supplies the label.
export function icon(name, size = 20) {
  if (!/^[a-z][a-z0-9-]*$/.test(name) || !Number.isFinite(size) || size <= 0) {
    throw new TypeError('Invalid Cow icon name or size');
  }
  return `<svg class="cow-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="/assets/icons/sprite.svg#cow-${name}-stroke"></use></svg>`;
}
