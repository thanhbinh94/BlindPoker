/**
 * `bootstrap.sh` is the one file in this repository that nothing here can run. It wants a root
 * shell on an ARM Ubuntu machine with `apt-get`, `iptables` and `systemd`; the development machine
 * is Windows and has none of them. So what a test *can* hold up is exactly two things, and this
 * file is careful not to claim more than that:
 *
 *   1. It parses. `bash -n` catches the whole class of edit that turns a working script into a
 *      half-executed one — an unbalanced `fi`, a heredoc whose terminator drifted, a quote left
 *      open. On a script that will be piped into `sudo bash` on somebody's server, that is worth a
 *      test on its own.
 *   2. Its idempotency guards are still there. Every step of the script checks the world before it
 *      touches it, and the whole promise of the file ("re-running it is safe") rests on those
 *      checks. They are grepped for by name below, so deleting one to "simplify" a step turns this
 *      red instead of turning the second run destructive on somebody's live host.
 *
 * It cannot tell you the script *works*. `docs/known-limitations.md` says so in the same words.
 *
 * **Finding a bash.** `bash` on a Windows PATH is usually `C:\Windows\System32\bash.exe`, the WSL
 * launcher, which fails outright when no distribution is installed — and would mangle a Windows
 * path if one were. So the probe tries candidates in turn and keeps the first that can actually
 * syntax-check a fragment, and the script is fed to it **on stdin** rather than by path, which
 * sidesteps Windows→POSIX path translation entirely. If none of them works the two checks skip;
 * on Linux and macOS the first candidate always wins.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./bootstrap.sh', import.meta.url)), 'utf8')

const CANDIDATES =
  process.platform === 'win32'
    ? ['bash', 'C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']
    : ['bash']

/** `bash -n <script-on-stdin>`: a syntax check that neither runs the script nor names a path. */
const parse = (bin: string, script: string): void => {
  execFileSync(bin, ['-n'], { input: script, stdio: ['pipe', 'ignore', 'pipe'] })
}

const bash = CANDIDATES.find((bin) => {
  try {
    parse(bin, 'if true; then :; fi\n')
    return true
  } catch {
    return false
  }
})

describe('deploy/oracle/bootstrap.sh', () => {
  it.runIf(bash)('parses under bash -n', () => {
    expect(() => parse(bash!, source)).not.toThrow()
  })

  // Without this, a probe that found a `bash` which exits 0 on everything would make the check
  // above pass on a script with a missing `fi` — green, and worth nothing.
  it.runIf(bash)('and the check is a real one: bad syntax fails', () => {
    expect(() => parse(bash!, 'if true; then :\n')).toThrow()
  })

  it('shebangs bash and stops at the first failure', () => {
    expect(source.startsWith('#!/usr/bin/env bash\n')).toBe(true)
    expect(source).toContain('set -euo pipefail')
  })

  it('has no CRLF — Ubuntu would read the shebang as `bash\\r`', () => {
    expect(source).not.toContain('\r')
  })

  it.each([
    // Swap: created only when the machine has none at all, so a second run never stacks a second
    // swapfile onto a host that already has one.
    ['swapon --show'],
    // The Docker apt source is written for the architecture dpkg reports, not for a hard-coded
    // `arm64` — the same script has to be right on an A1.Flex and on an x86 Always Free shape.
    ['dpkg --print-architecture'],
    // The firewall rules are saved, or they are gone at the next reboot.
    ['netfilter-persistent'],
    // `iptables -C` is the "is this rule already here?" test. Losing it means every run inserts
    // another copy of the same two ACCEPT rules.
    ['iptables -C INPUT'],
    // Debian's install-time questions are pre-answered. Under `curl … | sudo bash`, stdin is the
    // script, and a prompt there consumes the rest of it rather than waiting for anybody.
    ['DEBIAN_FRONTEND=noninteractive'],
    ['debconf-set-selections'],
    // The checkout is updated rather than re-cloned, and git runs as the login user so that the
    // second run does not meet a "dubious ownership" refusal on a directory root does not own.
    ['git clone'],
    ['merge --ff-only'],
    ['runuser -u'],
    // Group membership and unattended upgrades, both checked before being applied.
    ['usermod -aG docker'],
    ['unattended-upgrades'],
  ])('keeps the guard: %s', (needle) => {
    expect(source).toContain(needle)
  })

  it('takes REPO_URL as a required argument and defaults BRANCH to master', () => {
    expect(source).toContain('REPO_URL="${1:-}"')
    expect(source).toContain('BRANCH="${2:-master}"')
  })

  it('clones into /opt/bind-poker', () => {
    expect(source).toContain('CHECKOUT_DIR=/opt/bind-poker')
  })

  it('prints what every step did or skipped', () => {
    expect(source).toContain("did()  { printf '  [done] %s\\n' \"$*\"; }")
    expect(source).toContain("skip() { printf '  [skip] %s\\n' \"$*\"; }")
    // Every step reports both ways round, so a re-run reads as a list of skips rather than silence.
    expect(source.match(/\bdid "/g)?.length ?? 0).toBeGreaterThanOrEqual(10)
    expect(source.match(/\bskip "/g)?.length ?? 0).toBeGreaterThanOrEqual(10)
  })
})
