/**
 * Registration, sign-in, sign-out — the account half of the Normal edition.
 *
 * Three decisions are worth stating, because each of them is the reason a line looks the way it does.
 *
 * **Registration is one transaction.** An account is a `users` row, a `players` row, a starting
 * balance with the ledger entry that explains it, a stats row, a daily-login row and the default
 * cosmetics. A half-built account is worse than no account: a profile with no balance row, or points
 * with nothing in the ledger to account for them, breaks `Σ balances + Σ sinks` and cannot be
 * repaired without knowing what the missing half was meant to be. The session is created *after* the
 * commit — it points at a user that has to exist first.
 *
 * **Sign-in tells no one whether an address is registered.** An unknown email verifies the presented
 * password against `DUMMY_HASH` and fails with the same `BAD_CREDENTIALS` as a wrong password, at
 * the same cost. Skipping that work would turn the login form into an account-enumeration oracle
 * measurable with a stopwatch, and the answer it leaks is "does this person have an account here",
 * which is not ours to give away.
 *
 * **Every login rotates the session** (spec §23). A successful sign-in always issues a new session
 * and revokes the one the caller arrived with, so a session id captured before a sign-in is dead
 * after it — which is what makes session fixation impossible rather than merely difficult.
 */
import { ECONOMY, validateDisplayName, type PlayerIdentity } from '@bp/core'
import { eq } from 'drizzle-orm'
import type { AppDb } from '../db/client.js'
import { isUniqueViolation, sanitizeDbError } from '../db/pg-errors.js'
import { dailyLogins, inventory, players, playerStats, users } from '../db/schema.js'
import type { AvatarConfigV3 } from '../inventory/avatar.js'
import { creditWithin, type NormalRepositories } from '../repos/index.js'
import { DUMMY_HASH, hashPassword, validatePassword, verifyPassword, type Argon2Params } from './password.js'
import type { SessionService } from './session-service.js'

export type AuthErrorCode =
  | 'EMAIL_TAKEN'
  | 'DISPLAY_NAME_TAKEN'
  | 'INVALID_EMAIL'
  | 'INVALID_PASSWORD'
  | 'INVALID_NAME'
  | 'BAD_CREDENTIALS'

const MESSAGES: Record<AuthErrorCode, string> = {
  EMAIL_TAKEN: 'that email address already has an account',
  DISPLAY_NAME_TAKEN: 'that display name is already taken',
  INVALID_EMAIL: 'a valid email address is required',
  INVALID_PASSWORD: 'a password of 8 to 128 characters, different from your email address, is required',
  INVALID_NAME: 'a display name of 2 to 20 letters, digits, spaces, _ - or . is required',
  BAD_CREDENTIALS: 'that email and password do not match an account',
}

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(MESSAGES[code])
    this.name = 'AuthError'
  }
}

/**
 * What the item catalogue has to offer registration: the ids every new account starts with, and the
 * avatar those ids compose into.
 *
 * Both, rather than just the ids, because `avatar_config` is written in the same INSERT as the
 * inventory rows and the two have to agree — an account granted `hair_short` but wearing nothing
 * would render as a bald figure whose hair it owns.
 */
export interface DefaultItemCatalog {
  defaults(): string[]
  defaultAvatar(): AvatarConfigV3
}

export interface RegisterInput {
  email: string
  password: string
  displayName: string
  userAgent?: string
}

export interface LoginInput {
  email: string
  password: string
  userAgent?: string
  /** The cookie the caller arrived with, if any: its session is revoked as the new one is issued. */
  currentToken?: string | null
}

export interface SessionGrant {
  userId: string
  token: string
  expiresAt: Date
}

export interface AuthService {
  register(input: RegisterInput): Promise<SessionGrant>
  login(input: LoginInput): Promise<SessionGrant>
  logout(token: string): Promise<void>
  /** The WebSocket side of the same cookie: `SessionResolver.fromUpgrade` resolves through here. */
  identityForToken(token: string): Promise<PlayerIdentity | null>
}

export interface AuthServiceDeps {
  db: AppDb
  repos: NormalRepositories
  sessions: SessionService
  catalog: DefaultItemCatalog
  now?: () => number
  /**
   * Lowered by tests so a suite of registrations is not a benchmark. Production leaves it alone and
   * gets `ARGON2_PARAMS`; a hash records its own cost, so nothing else has to know which was used.
   */
  argon2Params?: Argon2Params
  /**
   * Called after a successful sign-in. A hook rather than a bus dependency, so authentication does
   * not have to know the bus exists.
   *
   * Nothing wires it today: the progression layer counts a "login day" from the daily check-in
   * (§10.3 ruling), not from a sign-in, so publishing an event here would have no subscriber. It
   * stays optional for whatever wants the fact later — a "your devices" list, a security e-mail.
   */
  onLogin?: (playerId: string, at: number) => void
}

/**
 * RFC 5321's cap. Exported because the login rate limiter has to bound the address it keys on, and a
 * second opinion about how long an address may be would let an over-long one slip past one of the two.
 */
export const MAX_EMAIL_LENGTH = 254
/**
 * RFC-lite, and deliberately ASCII: the local part is checked against the RFC 5322 "atext" set
 * rather than "anything before an @". `users.email` is stored lowercased and the database CHECKs it
 * against `lower()`, so an address whose case-folding JavaScript and Postgres could disagree on —
 * `İ`, say — must not get as far as the insert, where it would surface as a constraint violation.
 */
const EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const USERS_EMAIL_CONSTRAINT = 'users_email_unique'
const PLAYERS_NAME_CONSTRAINT = 'players_name_key_unique'

/** Trim and lowercase: the one form an address is compared, stored and looked up in. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL.test(email)
}

/** Runs a query, and lets nothing but a sanitized fault out of it. */
async function sanitizing<T>(operation: string, run: () => PromiseLike<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw sanitizeDbError(operation, err)
  }
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const now = deps.now ?? Date.now

  return {
    async register(input) {
      const email = normalizeEmail(input.email)
      if (!isValidEmail(email)) throw new AuthError('INVALID_EMAIL')
      if (!validatePassword(input.password, email).ok) throw new AuthError('INVALID_PASSWORD')
      const name = validateDisplayName(input.displayName)
      if (!name.ok) throw new AuthError('INVALID_NAME')

      // Hashing before the transaction on purpose: argon2 is ~50 ms of deliberate work, and holding
      // a database connection open across it would let a burst of sign-ups exhaust the pool.
      const passwordHash = await hashPassword(input.password, deps.argon2Params)
      const at = new Date(now())
      const defaults = deps.catalog.defaults()
      const avatarConfig = deps.catalog.defaultAvatar()

      let userId: string
      try {
        userId = await deps.db.transaction(async (tx) => {
          const [user] = await tx.insert(users).values({ email, passwordHash, createdAt: at }).returning({ id: users.id })
          const id = user!.id
          await tx.insert(players).values({
            id,
            // `validateDisplayName` already normalized and folded; storing anything else would put
            // a name and a key in the same row that no later lookup could reproduce from each other.
            displayName: name.name,
            nameKey: name.key,
            balance: 0,
            // The default cosmetics, worn — see `DefaultItemCatalog`. Cast because the column is a
            // generic jsonb bag; `readAvatarConfig` is what reads it back as an `AvatarConfigV3`.
            avatarConfig: avatarConfig as unknown as Record<string, unknown>,
            createdAt: at,
          })
          // The starting balance arrives the way every other movement of points does — through the
          // ledger — rather than as a default on the column. `refId` is the account itself: there is
          // exactly one such row per player, and it is findable.
          await creditWithin(tx, [{ playerId: id, delta: ECONOMY.startingBalance, reason: 'starting_balance', refId: id }])
          await tx.insert(playerStats).values({ playerId: id, updatedAt: at })
          await tx.insert(dailyLogins).values({ playerId: id })
          if (defaults.length > 0) {
            await tx.insert(inventory).values(defaults.map((itemId) => ({ playerId: id, itemId, source: 'default', acquiredAt: at })))
          }
          return id
        })
      } catch (err) {
        if (isUniqueViolation(err, USERS_EMAIL_CONSTRAINT)) throw new AuthError('EMAIL_TAKEN')
        if (isUniqueViolation(err, PLAYERS_NAME_CONSTRAINT)) throw new AuthError('DISPLAY_NAME_TAKEN')
        // Anything else is a 500, and a 500 is logged. Drizzle builds its message as
        // `Failed query: … params: …`, and for the `users` insert those parameters are the address
        // and the argon2 hash — offline-cracking material, in a log file, from a statement timeout.
        // `sanitizeDbError` keeps the SQLSTATE and the constraint and drops the rest.
        throw sanitizeDbError('register', err)
      }

      const { token, expiresAt } = await deps.sessions.create(userId, input.userAgent)
      return { userId, token, expiresAt }
    },

    async login(input) {
      const email = normalizeEmail(input.email)
      // Same reasoning as `register`: this statement's parameter is the address, and the update
      // below runs after a password has been verified — neither belongs in a 5xx log line.
      const [account] = await sanitizing('login', () =>
        deps.db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.email, email)),
      )

      // Both branches verify a password against a real argon2id hash, so they cost the same and
      // answer the same. Deleting the `DUMMY_HASH` line would make the unknown address the fast one.
      if (account === undefined) {
        await verifyPassword(await DUMMY_HASH, input.password)
        throw new AuthError('BAD_CREDENTIALS')
      }
      if (!(await verifyPassword(account.passwordHash, input.password))) throw new AuthError('BAD_CREDENTIALS')

      const at = now()
      await sanitizing('login', () => deps.db.update(users).set({ lastLoginAt: new Date(at) }).where(eq(users.id, account.id)))
      // Rotation, §23: the presented session dies whether or not it belonged to this account, and a
      // new one is issued regardless. Revoking first means a crash between the two leaves no session
      // rather than two.
      if (input.currentToken !== undefined && input.currentToken !== null) await deps.sessions.revoke(input.currentToken)
      const { token, expiresAt } = await deps.sessions.create(account.id, input.userAgent)
      deps.onLogin?.(account.id, at)
      return { userId: account.id, token, expiresAt }
    },

    async logout(token) {
      await deps.sessions.revoke(token)
    },

    async identityForToken(token) {
      const session = await deps.sessions.resolve(token)
      if (!session) return null
      const player = await deps.repos.players.findById(session.userId)
      // A session whose player is gone is not an identity: the account was erased under it.
      return player ? { playerId: player.playerId, displayName: player.displayName, isBot: false } : null
    },
  }
}
