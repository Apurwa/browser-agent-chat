const STRIP_PREFIXES = ['www', 'app', 'dashboard', 'staging', 'dev', 'admin', 'portal'];

export function deriveProjectName(rawUrl: string): string {
  // Add protocol if missing so URL constructor works
  let urlStr = rawUrl.trim();
  if (!/^https?:\/\//i.test(urlStr)) {
    urlStr = `https://${urlStr}`;
  }

  let hostname: string;
  let port = '';
  try {
    const parsed = new URL(urlStr);
    hostname = parsed.hostname;
    port = parsed.port;
  } catch {
    return rawUrl.trim();
  }

  // Handle localhost and IP addresses
  if (hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const base = hostname.charAt(0).toUpperCase() + hostname.slice(1);
    return port ? `${base} ${port}` : base;
  }

  // Split hostname into parts and strip common prefixes
  const parts = hostname.split('.');
  while (parts.length > 2 && STRIP_PREFIXES.includes(parts[0])) {
    parts.shift();
  }

  // Take the first remaining part (domain name without TLD)
  const name = parts.length >= 2 ? parts[0] : parts[parts.length - 1];

  // Capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}
