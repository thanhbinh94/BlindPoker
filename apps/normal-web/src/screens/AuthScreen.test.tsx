import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type AuthMeDto, type NormalApi } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { LAST_EMAIL_KEY } from '../session.js'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { AuthScreen, type AuthMode } from './AuthScreen.js'

const ME: AuthMeDto = { playerId: 'p1', displayName: 'Bình', balance: 100_000 }
const PASSWORD = 'con-meo-den-1'

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    login: vi.fn().mockResolvedValue(ME),
    register: vi.fn().mockResolvedValue(ME),
    ...overrides,
  } as unknown as NormalApi
}

function setup(api: NormalApi, mode: AuthMode = 'signIn', message: string | null = null) {
  const onSignedIn = vi.fn()
  const onMode = vi.fn()
  const view = renderWithI18n(
    <AuthScreen api={api} mode={mode} onMode={onMode} onSignedIn={onSignedIn} message={message} />,
    makeI18n('vi'),
  )
  return { ...view, onSignedIn, onMode, user: userEvent.setup() }
}

const t = viNormal.auth
const emailBox = (): HTMLInputElement => screen.getByLabelText(t.email) as HTMLInputElement
const passwordBox = (): HTMLInputElement => screen.getByLabelText(t.password) as HTMLInputElement
const nameBox = (): HTMLInputElement => screen.getByLabelText(t.displayName) as HTMLInputElement
const submit = (name: string): HTMLElement => screen.getByRole('button', { name })
const modeLink = (name: string): HTMLElement => screen.getByRole('link', { name })

/** Fills in whatever the given mode needs, so a test can get to the submit button in one line. */
async function fill(user: ReturnType<typeof userEvent.setup>, opts: { name?: string } = {}): Promise<void> {
  await user.type(emailBox(), 'binh@example.com')
  await user.type(passwordBox(), PASSWORD)
  if (opts.name !== undefined) await user.type(nameBox(), opts.name)
}

describe('AuthScreen', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('opens on sign-in: email and password, and no display name', () => {
    setup(stubApi())

    // Two links, not a tab widget: the route is what decides which side of the card is showing.
    expect(modeLink(t.signIn)).toHaveAttribute('aria-current', 'page')
    expect(modeLink(t.signIn)).toHaveAttribute('href', '#/login')
    expect(modeLink(t.register)).not.toHaveAttribute('aria-current')
    expect(modeLink(t.register)).toHaveAttribute('href', '#/register')
    expect(emailBox()).toBeInTheDocument()
    expect(passwordBox()).toBeInTheDocument()
    expect(screen.queryByLabelText(t.displayName)).toBeNull()
  })

  it('marks the register link as the current page when that is the mode', () => {
    setup(stubApi(), 'register')

    expect(modeLink(t.register)).toHaveAttribute('aria-current', 'page')
    expect(modeLink(t.signIn)).not.toHaveAttribute('aria-current')
    expect(nameBox()).toBeInTheDocument()
  })

  it('asks the app to change route rather than switching sides on its own', async () => {
    const { user, onMode } = setup(stubApi())

    await user.click(modeLink(t.register))
    expect(onMode).toHaveBeenCalledWith('register')
    // Still sign-in: the route is the source of truth, and the app has not moved it yet.
    expect(modeLink(t.signIn)).toHaveAttribute('aria-current', 'page')
  })

  it('offers the same move at the foot of the card', async () => {
    const { user, onMode } = setup(stubApi())

    await user.click(screen.getByRole('link', { name: t.toRegister }))
    expect(onMode).toHaveBeenCalledWith('register')
  })

  it('shows the expiry message when the session was refused', () => {
    setup(stubApi(), 'signIn', viNormal.session.expired)

    expect(screen.getByRole('status')).toHaveTextContent(viNormal.session.expired)
  })

  it('prefills the last email this device signed in with', () => {
    localStorage.setItem(LAST_EMAIL_KEY, 'binh@example.com')
    setup(stubApi())

    expect(emailBox()).toHaveValue('binh@example.com')
  })

  it('reveals and re-hides the password without ever storing it', async () => {
    const { user } = setup(stubApi())

    await user.type(passwordBox(), PASSWORD)
    expect(passwordBox()).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: t.showPassword }))
    expect(passwordBox()).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: t.hidePassword }))
    expect(passwordBox()).toHaveAttribute('type', 'password')
    expect(JSON.stringify(localStorage)).not.toContain(PASSWORD)
  })

  it('signs in and hands the account up, remembering only the email', async () => {
    const api = stubApi()
    const { user, onSignedIn } = setup(api)

    await fill(user)
    await user.click(submit(t.submitSignIn))

    await waitFor(() => expect(api.login).toHaveBeenCalledWith({ email: 'binh@example.com', password: PASSWORD }))
    expect(onSignedIn).toHaveBeenCalledWith(ME)
    expect(localStorage.getItem(LAST_EMAIL_KEY)).toBe('binh@example.com')
    // Nothing token-shaped: the session is a cookie this code never sees.
    expect(Object.keys(localStorage)).toEqual([LAST_EMAIL_KEY])
  })

  it('lets the button go again after a success, so a caller may keep the screen mounted', async () => {
    const api = stubApi()
    const { user } = setup(api)

    await fill(user)
    await user.click(submit(t.submitSignIn))

    await waitFor(() => expect(api.login).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(submit(t.submitSignIn)).toBeEnabled())
  })

  it('registers with the normalized display name', async () => {
    const api = stubApi()
    const { user, onSignedIn } = setup(api, 'register')

    await user.type(emailBox(), '  binh@example.com ')
    await user.type(passwordBox(), PASSWORD)
    await user.type(nameBox(), '  Nguyễn   Văn A  ')
    await user.click(submit(t.submitRegister))

    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith({ email: 'binh@example.com', password: PASSWORD, displayName: 'Nguyễn Văn A' }),
    )
    expect(onSignedIn).toHaveBeenCalledWith(ME)
  })

  it.each([
    ['too short', 'A', viNormal.auth.name.length],
    ['too long', 'x'.repeat(21), viNormal.auth.name.length],
    ['using an illegal character', 'Bình@', viNormal.auth.name.chars],
    ['starting with a separator', '.Bình', viNormal.auth.name.edges],
  ])('hints live that the name is %s', async (_label, typed, hint) => {
    const { user } = setup(stubApi(), 'register')

    expect(screen.getByText(t.displayNameHint)).toBeInTheDocument()
    await user.type(nameBox(), typed)

    expect(await screen.findByText(hint)).toBeInTheDocument()
    expect(screen.queryByText(t.displayNameHint)).toBeNull()
  })
})

/**
 * Where a refusal lands. A message that only says *that* something was wrong leaves a screen-reader user
 * hunting for the box to go back to, so anything that is a fault in one field is put on that field —
 * `aria-invalid`, the message wired through `aria-describedby`, and the caret moved there. What blames no
 * single box stays on the card as one assertive alert.
 */
describe('AuthScreen — where a refusal lands', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('refuses an empty email on the email box, without calling the server', async () => {
    const api = stubApi()
    const { user } = setup(api)

    await user.type(passwordBox(), PASSWORD)
    await user.click(submit(t.submitSignIn))

    expect(await screen.findByText(t.errors.INVALID_EMAIL)).toBeInTheDocument()
    expect(emailBox()).toHaveAttribute('aria-invalid', 'true')
    expect(emailBox()).toHaveFocus()
    expect(passwordBox()).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.login).not.toHaveBeenCalled()
  })

  it('refuses a short password on the password box, without calling the server', async () => {
    const api = stubApi()
    const { user } = setup(api)

    await user.type(emailBox(), 'binh@example.com')
    await user.type(passwordBox(), 'short')
    await user.click(submit(t.submitSignIn))

    expect(await screen.findByText(t.errors.INVALID_PASSWORD)).toBeInTheDocument()
    expect(passwordBox()).toHaveAttribute('aria-invalid', 'true')
    expect(passwordBox()).toHaveFocus()
    // The message is wired to the box, not merely printed near it.
    expect(passwordBox().getAttribute('aria-describedby')).toContain('bp-auth-password-error')
    expect(emailBox()).not.toHaveAttribute('aria-invalid')
    expect(api.login).not.toHaveBeenCalled()
  })

  it.each([
    ['the whole address', 'binh@example.com', 'Binh@Example.com'],
    ['the part before the @', 'binh-account@example.com', 'BINH-ACCOUNT'],
  ])('refuses %s as a new password on the password box, without calling the server (T2)', async (_, address, typed) => {
    const api = stubApi()
    const { user } = setup(api, 'register')

    await user.type(emailBox(), address)
    await user.type(passwordBox(), typed)
    await user.type(nameBox(), 'Bình')
    await user.click(submit(t.submitRegister))

    expect(await screen.findByText(t.errors.INVALID_PASSWORD)).toBeInTheDocument()
    expect(passwordBox()).toHaveAttribute('aria-invalid', 'true')
    expect(passwordBox()).toHaveFocus()
    expect(api.register).not.toHaveBeenCalled()
  })

  it('leaves the address-as-password question to the server on sign-in', async () => {
    const api = stubApi()
    const { user } = setup(api)

    await user.type(emailBox(), 'binh@example.com')
    await user.type(passwordBox(), 'binh@example.com')
    await user.click(submit(t.submitSignIn))

    await waitFor(() => expect(api.login).toHaveBeenCalledWith({ email: 'binh@example.com', password: 'binh@example.com' }))
  })

  it('refuses an invalid display name on the name box, without calling the server', async () => {
    const api = stubApi()
    const { user } = setup(api, 'register')

    await fill(user, { name: 'A' })
    await user.click(submit(t.submitRegister))

    expect(await screen.findByText(t.errors.INVALID_NAME)).toBeInTheDocument()
    expect(nameBox()).toHaveAttribute('aria-invalid', 'true')
    expect(nameBox()).toHaveFocus()
    expect(api.register).not.toHaveBeenCalled()
  })

  it.each([
    ['INVALID_EMAIL', 400, viNormal.auth.errors.INVALID_EMAIL],
    ['EMAIL_TAKEN', 409, viNormal.auth.errors.EMAIL_TAKEN],
  ])('puts the server refusal %s on the email box', async (code, status, text) => {
    const api = stubApi({ login: vi.fn().mockRejectedValue(new ApiError(status, code, 'nope')) })
    const { user, onSignedIn } = setup(api)

    await fill(user)
    await user.click(submit(t.submitSignIn))

    expect(await screen.findByText(text)).toBeInTheDocument()
    await waitFor(() => expect(emailBox()).toHaveAttribute('aria-invalid', 'true'))
    expect(emailBox()).toHaveFocus()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(localStorage.getItem(LAST_EMAIL_KEY)).toBeNull()
  })

  it('puts the server refusal INVALID_PASSWORD on the password box', async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue(new ApiError(400, 'INVALID_PASSWORD', 'nope')) })
    const { user } = setup(api)

    await fill(user)
    await user.click(submit(t.submitSignIn))

    expect(await screen.findByText(t.errors.INVALID_PASSWORD)).toBeInTheDocument()
    await waitFor(() => expect(passwordBox()).toHaveAttribute('aria-invalid', 'true'))
    expect(passwordBox()).toHaveFocus()
    expect(emailBox()).not.toHaveAttribute('aria-invalid')
  })

  it.each([
    ['INVALID_NAME', 400, viNormal.auth.errors.INVALID_NAME],
    ['DISPLAY_NAME_TAKEN', 409, viNormal.auth.errors.DISPLAY_NAME_TAKEN],
  ])('puts the server refusal %s on the display-name box', async (code, status, text) => {
    const api = stubApi({ register: vi.fn().mockRejectedValue(new ApiError(status, code, 'nope')) })
    const { user } = setup(api, 'register')

    await fill(user, { name: 'Bình' })
    await user.click(submit(t.submitRegister))

    expect(await screen.findByText(text)).toBeInTheDocument()
    await waitFor(() => expect(nameBox()).toHaveAttribute('aria-invalid', 'true'))
    expect(nameBox()).toHaveFocus()
    expect(emailBox()).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['BAD_CREDENTIALS', 401, viNormal.auth.errors.BAD_CREDENTIALS],
    ['FORBIDDEN', 403, viNormal.auth.errors.FORBIDDEN],
    ['NETWORK', 0, viNormal.auth.errors.NETWORK],
  ])('keeps the refusal %s on the card, because it blames no single box', async (code, status, text) => {
    const api = stubApi({ login: vi.fn().mockRejectedValue(new ApiError(status, code, 'nope')) })
    const { user, onSignedIn } = setup(api)

    await fill(user)
    await user.click(submit(t.submitSignIn))

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    // Saying which half of a credential was wrong is how an address gets enumerated.
    expect(emailBox()).not.toHaveAttribute('aria-invalid')
    expect(passwordBox()).not.toHaveAttribute('aria-invalid')
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('says how long to wait when the server rate-limited the attempt', async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'too many', { retryAfterSec: 42 })) })
    const { user } = setup(api)

    await fill(user)
    await user.click(submit(t.submitSignIn))

    expect(await screen.findByRole('alert')).toHaveTextContent('42')
  })

  it('falls back to the generic error for a code it has no words for', async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom')) })
    const { user } = setup(api)

    await fill(user)
    await user.click(submit(t.submitSignIn))

    // `common:errors.INTERNAL`, quoted rather than imported: the app must not reach into the kit's sources.
    expect(await screen.findByRole('alert')).toHaveTextContent('Đã xảy ra lỗi, vui lòng thử lại')
  })

  it('clears a stale refusal, and its invalid mark, once the player edits a field', async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue(new ApiError(409, 'EMAIL_TAKEN', 'taken')) })
    const { user } = setup(api)

    await fill(user)
    await user.click(submit(t.submitSignIn))
    await waitFor(() => expect(emailBox()).toHaveAttribute('aria-invalid', 'true'))

    await user.type(emailBox(), 'x')

    await waitFor(() => expect(emailBox()).not.toHaveAttribute('aria-invalid'))
    expect(screen.queryByText(t.errors.EMAIL_TAKEN)).toBeNull()
  })
})
