/**
 * Which hops in front of this server are allowed to say who the client is.
 *
 * `TRUST_PROXY` used to be a boolean, and `true` was the deployment's setting. That was a hole, not
 * a convenience: Fastify's `trustProxy: true` means "trust every hop", so `req.ip` becomes the
 * *left-most* entry of `X-Forwarded-For` — a header the client writes. Caddy **appends** the real
 * peer to whatever arrived, it does not replace it, so a request through the shipped Compose
 * topology carrying `X-Forwarded-For: 1.2.3.4` yielded `req.ip === '1.2.3.4'` and every IP-keyed
 * rate limit in this edition (registration, login, the address bucket that exists precisely to stop
 * a caller rotating its cookie) was bypassed by varying one header per request.
 *
 * So the variable carries a *specification* of who to trust instead: `false`, one of the three named
 * ranges, or a comma-separated list of addresses and CIDRs. The string is handed to Fastify
 * unchanged — Fastify splits it on commas and compiles it with `proxy-addr` — and the same string is
 * compiled here for the one place Fastify cannot reach: the WebSocket upgrade, which is a raw
 * `IncomingMessage` on `server.on('upgrade')` and never becomes a `FastifyRequest`.
 *
 * A bare `true` is **refused** by `loadConfig` rather than accepted, because there is no topology in
 * which it is the right answer: behind a proxy the proxy's own address (or `uniquelocal`) is both
 * safer and more precise, and with nothing in front it hands the rate-limit key to the caller. A
 * numeric hop count is not the fix either — Fastify ≥ 5.12 makes one fail closed, which would
 * collapse every client onto the proxy's address and let one caller exhaust everyone's bucket.
 */
import { BlockList, isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'

/**
 * The named ranges `proxy-addr` understands, restated so this module can compile the same spec
 * without depending on Fastify's transitive dependency. Same CIDRs, same names.
 */
export const TRUST_PROXY_RANGES: Record<string, string[]> = {
  loopback: ['127.0.0.0/8', '::1/128'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
}

/** What `TRUST_PROXY` may say, for the error message and for the docs to quote. */
export const TRUST_PROXY_FORMS = `false, ${Object.keys(TRUST_PROXY_RANGES).join(', ')}, or a comma-separated list of addresses/CIDRs (e.g. 10.0.0.0/8,192.168.1.7)`

/** `false` — trust nobody — or the spec string Fastify's `trustProxy` option is given verbatim. */
export type TrustProxy = false | string

/** One entry of the list: a named range, a bare address, or `address/prefix`. */
export function isTrustProxyEntry(entry: string): boolean {
  if (entry in TRUST_PROXY_RANGES) return true
  const slash = entry.lastIndexOf('/')
  const kind = isIP(slash === -1 ? entry : entry.slice(0, slash))
  if (kind === 0) return false
  if (slash === -1) return true
  const prefix = entry.slice(slash + 1)
  if (!/^\d{1,3}$/.test(prefix)) return false
  return Number(prefix) <= (kind === 4 ? 32 : 128)
}

/** The entries of a spec string, trimmed and with the empties dropped. */
export function trustProxyEntries(spec: string): string[] {
  return spec.split(',').map((s) => s.trim()).filter((s) => s !== '')
}

/**
 * `(address) => is this peer allowed to tell us who the client is?`
 *
 * `net.BlockList` rather than hand-rolled bit arithmetic: it is built in, it knows IPv6, and it
 * already treats the IPv4-mapped form Node reports on a dual-stack listener
 * (`::ffff:10.0.0.5`) as the IPv4 address it is — which is the exact case a Compose bridge network
 * produces and the exact case a hand-rolled matcher gets wrong.
 */
export function createTrustedPeerCheck(spec: TrustProxy): (address: string | undefined) => boolean {
  if (spec === false) return () => false
  const list = new BlockList()
  for (const entry of trustProxyEntries(spec)) {
    for (const cidr of TRUST_PROXY_RANGES[entry] ?? [entry]) {
      const slash = cidr.lastIndexOf('/')
      const address = slash === -1 ? cidr : cidr.slice(0, slash)
      const family = isIP(address) === 4 ? 'ipv4' : 'ipv6'
      if (slash === -1) list.addAddress(address, family)
      else list.addSubnet(address, Number(cidr.slice(slash + 1)), family)
    }
  }
  return (address) => {
    if (address === undefined || address === '') return false
    const kind = isIP(address)
    return kind !== 0 && list.check(address, kind === 4 ? 'ipv4' : 'ipv6')
  }
}

/**
 * The client's address behind the trusted hops, for a request Fastify never sees.
 *
 * The same rule `proxy-addr` applies and therefore the same answer `req.ip` gives on the REST
 * surface: start at the socket peer and walk `X-Forwarded-For` from the right, stopping at the first
 * hop that is not trusted. An untrusted peer's header is ignored outright, which is what makes a
 * spoofed `X-Forwarded-For` worthless to a caller reaching this server directly.
 */
export function upgradeAddress(req: IncomingMessage, isTrusted: (address: string | undefined) => boolean): string {
  const peer = req.socket.remoteAddress ?? ''
  if (!isTrusted(peer)) return peer
  const header = req.headers['x-forwarded-for']
  const hops = (Array.isArray(header) ? header.join(',') : (header ?? '')).split(',').map((s) => s.trim()).filter((s) => s !== '')
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i] as string
    if (!isTrusted(hop)) return hop
  }
  // Every hop is trusted (or there were none): the left-most is as far back as the chain goes.
  return hops[0] ?? peer
}
