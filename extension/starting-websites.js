// Human-facing setup input. This remains a starting-navigation check, not a network policy.
export function parseStartingWebsites(value) {
  if (typeof value !== 'string' && !Array.isArray(value))
    throw Error('Add at least one starting website.');
  const entries = Array.isArray(value) ? value : value.split(/\r?\n/);
  if (entries.some((entry) => typeof entry !== 'string'))
    throw Error('Enter website addresses as text.');
  const websites = entries.map((entry) => String(entry).trim()).filter(Boolean);
  if (!websites.length) throw Error('Add at least one starting website.');
  const origins = websites.map((website) => {
    let url;
    try {
      url = new URL(website.includes('://') ? website : 'https://' + website);
    } catch {
      throw Error('Check the website addresses. Try https://www.google.com.');
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      throw Error('Use http:// or https:// website addresses, without login details.');
    return url.origin;
  });
  return [...new Set(origins)];
}
