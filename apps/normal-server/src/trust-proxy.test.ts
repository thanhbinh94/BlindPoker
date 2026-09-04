import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { createTrustedPeerCheck, isTrustProxyEntry, trustProxyEntries, upgradeAddress } from './trust-proxy.js'

/** Just enough `IncomingMessage` for the two things `upgradeAddress` reads. */
function req(remoteAddress: string | undefined, forwardedFor?: string | string[]): IncomingMessage {
  return {
    socket: { remoteAddress },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  } as unknown as IncomingMessage
}

describe('isTrustProxyEntry', () => {
  it('accepts the named ranges, bare addresses and CIDRs of both families', () => {
    for (const good of ['loopback', 'linklocal', 'uniquelocal', '127.0.0.1', '10.0.0.0/8', '::1', 'fc00::/7', '0.0.0.0/0', '::/0']) {
      expect(isTrustProxyEntry(good), good).toBe(true)
    }
  })

  it('refuses hostnames, hop counts, booleans and out-of-range prefixes', () => {
    for (const bad of ['localhost', 'db', 'true', '1', '2', '10.0.0.0/33', '::1/129', '10.0.0.0/x', '', '999.1.1.1']) {
      expect(isTrustProxyEntry(bad), bad).toBe(false)
    }
  })
})

describe('trustProxyEntries', () => {
  it('trims and drops the empties, so a trailing comma is not an entry', () => {
    expect(trustProxyEntries(' loopback , 10.0.0.0/8 ,, ')).toEqual(['loopback', '10.0.0.0/8'])
  })
})

describe('createTrustedPeerCheck', () => {
  it('trusts nobody when the spec is false', () => {
    const trusted = createTrustedPeerCheck(false)
    for (const address of ['127.0.0.1', '10.0.0.5', '203.0.113.9', undefined]) expect(trusted(address), String(address)).toBe(false)
  })

  it('resolves the named ranges to the same CIDRs proxy-addr uses', () => {
    const unique = createTrustedPeerCheck('uniquelocal')
    for (const inside of ['10.0.0.5', '172.16.4.1', '192.168.1.7', 'fc00::1']) expect(unique(inside), inside).toBe(true)
    for (const outside of ['203.0.113.9', '172.32.0.1', '127.0.0.1', '8.8.8.8']) expect(unique(outside), outside).toBe(false)

    const loopback = createTrustedPeerCheck('loopback')
    expect(loopback('127.0.0.1')).toBe(true)
    expect(loopback('127.9.9.9')).toBe(true)
    expect(loopback('::1')).toBe(true)
    expect(loopback('10.0.0.5')).toBe(false)
  })

  /**
   * The case a hand-rolled matcher gets wrong and the one a Compose bridge network actually
   * produces: Node reports the peer of an IPv4 connection on a dual-stack listener in the
   * IPv4-mapped form. `net.BlockList` already knows it is the IPv4 address it looks like.
   */
  it('sees through the IPv4-mapped form Node reports on a dual-stack listener', () => {
    const unique = createTrustedPeerCheck('uniquelocal')
    expect(unique('::ffff:10.0.0.5')).toBe(true)
    expect(unique('::ffff:203.0.113.9')).toBe(false)
  })

  it('takes a comma-separated list, mixing names, addresses and CIDRs', () => {
    const trusted = createTrustedPeerCheck('loopback,192.0.2.10,198.51.100.0/24')
    expect(trusted('127.0.0.1')).toBe(true)
    expect(trusted('192.0.2.10')).toBe(true)
    expect(trusted('192.0.2.11')).toBe(false)
    expect(trusted('198.51.100.77')).toBe(true)
    expect(trusted('198.51.101.77')).toBe(false)
  })

  it('answers false for a missing or unparseable address rather than throwing', () => {
    const trusted = createTrustedPeerCheck('loopback')
    expect(trusted(undefined)).toBe(false)
    expect(trusted('')).toBe(false)
    expect(trusted('not-an-address')).toBe(false)
  })
})

describe('upgradeAddress', () => {
  const trusted = createTrustedPeerCheck('uniquelocal')

  /**
   * The blocker, restated for the one path Fastify never sees. A caller reaching this server
   * directly writes whatever it likes into `X-Forwarded-For`; because its own address is not
   * trusted, none of it counts and the upgrade limiter keys on the socket peer.
   */
  it('ignores X-Forwarded-For from a peer that is not a trusted proxy', () => {
    expect(upgradeAddress(req('203.0.113.9', '1.2.3.4'), trusted)).toBe('203.0.113.9')
    expect(upgradeAddress(req('203.0.113.9', '1.2.3.4, 5.6.7.8'), trusted)).toBe('203.0.113.9')
    expect(upgradeAddress(req('203.0.113.9'), trusted)).toBe('203.0.113.9')
  })

  /**
   * Through the proxy, the right-most entry the proxy itself appended is the real client — Caddy
   * appends rather than replaces, so everything to the left of it is whatever the client sent.
   */
  it('takes the right-most untrusted hop when the peer is a trusted proxy', () => {
    expect(upgradeAddress(req('10.0.0.5', '203.0.113.9'), trusted)).toBe('203.0.113.9')
    // The client pre-loaded the header; the proxy appended the truth to the end of it.
    expect(upgradeAddress(req('10.0.0.5', '1.2.3.4, 203.0.113.9'), trusted)).toBe('203.0.113.9')
    // Two trusted hops of our own in front of the client.
    expect(upgradeAddress(req('10.0.0.5', '203.0.113.9, 10.0.0.9'), trusted)).toBe('203.0.113.9')
  })

  it('falls back to the peer when a trusted proxy sends no header, and to the left-most when every hop is trusted', () => {
    expect(upgradeAddress(req('10.0.0.5'), trusted)).toBe('10.0.0.5')
    expect(upgradeAddress(req('10.0.0.5', '10.0.0.7, 10.0.0.8'), trusted)).toBe('10.0.0.7')
  })

  it('joins a repeated header the way one comma-separated header would have read', () => {
    expect(upgradeAddress(req('10.0.0.5', ['1.2.3.4', '203.0.113.9']), trusted)).toBe('203.0.113.9')
  })

  it('is the socket peer outright when nothing is trusted', () => {
    expect(upgradeAddress(req('10.0.0.5', '1.2.3.4'), createTrustedPeerCheck(false))).toBe('10.0.0.5')
  })
})
