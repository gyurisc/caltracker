/**
 * Who may reach what.
 *
 * The public surface is one server-rendered stats page and the WHOOP OAuth
 * round trip. Everything else — the dashboard, `/api/state`, every mutating
 * route — is for the owner only, and the owner reaches it either from the local
 * network or down an SSH tunnel.
 *
 * One rule covers both machines the app runs on, which is why it is a rule
 * about addresses rather than a list of environments:
 *
 *   - On the Mac, the phone on the same wifi is 192.168.x.x — private, allowed.
 *   - On a VPS, traffic off the internet arrives from public addresses — denied
 *     — while an SSH tunnel emerges on loopback and is allowed.
 *
 * This is not authentication and is not a substitute for it. It is a statement
 * about which networks can reach the box at all, which on a VPS behind a
 * firewall is the meaningful boundary.
 */

/** Loopback, link-local, and the RFC1918 / RFC4193 private ranges. */
export function isPrivateAddress(raw: string | undefined | null): boolean {
  if (!raw) return false

  // Strip the IPv4-mapped IPv6 prefix and any zone or port suffix.
  let ip = raw.trim().toLowerCase()
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)
  ip = ip.split('%')[0]!

  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true
  if (ip === 'localhost') return true

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(ip)) return true
  if (/^fe[89ab][0-9a-f]:/.test(ip)) return true

  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const [a, b] = parts.map(Number) as [number, number, number, number]
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false

  if (a === 127) return true            // loopback
  if (a === 10) return true             // 10.0.0.0/8
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 169 && b === 254) return true // link-local
  return false
}

/**
 * Paths anyone may reach.
 *
 * `/stats` is the deliberately reduced public page. The WHOOP routes have to be
 * here because the OAuth redirect lands in a browser that may be anywhere —
 * they carry their own one-time token instead, minted over Telegram.
 */
const PUBLIC_PATHS = [
  '/stats',
  '/health',
  '/api/whoop/start',
  '/api/whoop/callback',
]

export function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.includes(path)) return true
  // The stats page carries its own inline styles, but keep room for an asset.
  return path.startsWith('/stats/')
}

/**
 * The whole decision, in one function, so it can be tested without a socket.
 *
 * `remote` is the peer address the server sees. A forwarded header may stand in
 * for it only when a reverse proxy in front of this is the one setting it —
 * a caller can put anything in `x-forwarded-for`, so trusting it on an
 * internet-facing port would hand out the dashboard to whoever asked nicely.
 */
export function mayReach(path: string, remote: string | undefined | null): boolean {
  return isPublicPath(path) || isPrivateAddress(remote)
}
