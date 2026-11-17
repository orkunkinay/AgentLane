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
    if (website.includes('*'))
      throw Error('Enter individual website addresses, without wildcards.');
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(website) &&
      !/^https?:\/\//i.test(website) &&
      !/^[^/:]+:\d+(?:\/|$)/.test(website)
    )
      throw Error('Use http:// or https:// website addresses, without login details.');
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

// An explicit mode is required for unrestricted HTTP(S) navigation.
export function parseStartingPolicy(mode, websites) {
  if (mode === 'any') return { mode: 'any', websites: [] };
  if (mode !== 'selected') throw Error('Choose Selected websites or Any website.');
  return { mode: 'selected', websites: parseStartingWebsites(websites) };
}

export function restoreStartingPolicy(saved) {
  // Only a genuinely absent configuration receives the fresh-install default.
  if (!Object.keys(saved).some((key) => ['startingPolicy', 'websites', 'origins'].includes(key)))
    return { mode: 'selected', websites: ['https://www.google.com'] };
  const policy = Object.hasOwn(saved, 'startingPolicy')
    ? saved.startingPolicy
    : { mode: 'selected', websites: saved.websites ?? saved.origins };
  try {
    return parseStartingPolicy(policy?.mode, policy?.websites);
  } catch {
    return { mode: 'selected', websites: [] };
  }
}
