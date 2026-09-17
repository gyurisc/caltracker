import { describe, expect, it } from 'vitest'
import { isPrivateAddress, isPublicPath, mayReach } from './access.ts'

describe('which addresses count as ours', () => {
  it('trusts loopback, however it is spelled', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']) {
      expect(isPrivateAddress(ip)).toBe(true)
    }
  })

  it('trusts the home network the phone sits on', () => {
    expect(isPrivateAddress('192.168.0.149')).toBe(true)
    expect(isPrivateAddress('10.1.2.3')).toBe(true)
    expect(isPrivateAddress('172.16.0.1')).toBe(true)
    expect(isPrivateAddress('172.31.255.254')).toBe(true)
  })

  it('does not trust the internet', () => {
    // A VPS hears from these all day.
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '193.168.0.1']) {
      expect(isPrivateAddress(ip)).toBe(false)
    }
  })

  it('is not fooled by a private-looking prefix', () => {
    // `192.168` is private; `192.169` is not, and string matching would miss it.
    expect(isPrivateAddress('192.169.0.1')).toBe(false)
    expect(isPrivateAddress('1927.168.0.1')).toBe(false)
    expect(isPrivateAddress('10.0.0.1.evil.com')).toBe(false)
  })

  it('refuses nothing at all', () => {
    expect(isPrivateAddress(undefined)).toBe(false)
    expect(isPrivateAddress('')).toBe(false)
  })
})

describe('which paths are public', () => {
  it('opens the stats page and the WHOOP round trip', () => {
    expect(isPublicPath('/stats')).toBe(true)
    expect(isPublicPath('/api/whoop/start')).toBe(true)
    expect(isPublicPath('/api/whoop/callback')).toBe(true)
  })

  it('keeps everything else closed', () => {
    // /api/state is the leak: weight, waist, HRV, every meal, photo ids.
    for (const p of ['/api/state', '/', '/api/log', '/api/seed', '/api/photo/x', '/assets/a.js']) {
      expect(isPublicPath(p)).toBe(false)
    }
  })

  it('is not fooled by a path that merely starts with the word', () => {
    expect(isPublicPath('/statsomething')).toBe(false)
  })
})

describe('the gate as a whole', () => {
  it('lets the internet see the stats page and nothing else', () => {
    expect(mayReach('/stats', '8.8.8.8')).toBe(true)
    expect(mayReach('/api/whoop/callback', '8.8.8.8')).toBe(true)

    expect(mayReach('/', '8.8.8.8')).toBe(false)
    expect(mayReach('/api/state', '8.8.8.8')).toBe(false)
    expect(mayReach('/api/settings', '8.8.8.8')).toBe(false)
    expect(mayReach('/api/photo/2026-09-15-abc', '8.8.8.8')).toBe(false)
  })

  it('lets the phone on the home wifi see everything', () => {
    for (const p of ['/', '/api/state', '/api/photo/x', '/assets/index.js']) {
      expect(mayReach(p, '192.168.0.149')).toBe(true)
    }
  })

  it('lets an ssh tunnel see everything', () => {
    // On a VPS this is the owner's only route in.
    expect(mayReach('/api/state', '::1')).toBe(true)
  })

  it('closes a route nobody remembered to list', () => {
    // The gate runs before every route, so a new endpoint is private until it
    // is deliberately published — forgetting fails closed, not open.
    expect(mayReach('/api/something-added-next-month', '8.8.8.8')).toBe(false)
  })
})
