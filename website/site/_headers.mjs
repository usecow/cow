export function annotationPreviewEnabled() {
  return process.env.COW_SITE_ANNOTATIONS === '1'
}

// Development only: COW_SITE_FONTS=1 adds the font picker and lets pages load Google Fonts for it.
export function fontPreviewEnabled() {
  return process.env.COW_SITE_FONTS === '1'
}

export function securePage(res) {
  const previewStyles = annotationPreviewEnabled() ? " 'unsafe-inline'" : ''
  const fontStyles = fontPreviewEnabled() ? ' https://fonts.googleapis.com' : ''
  const fontFiles = fontPreviewEnabled() ? ' https://fonts.gstatic.com' : ''
  res.setHeader('content-security-policy', `default-src 'self'; script-src 'self'; style-src 'self'${previewStyles}${fontStyles}; img-src 'self'; font-src 'self'${fontFiles}; frame-src 'self'; frame-ancestors 'self'; form-action 'self'; object-src 'none'; base-uri 'self'`)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
}
