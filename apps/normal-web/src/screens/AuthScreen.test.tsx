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

describe('AuthScreen', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('opens on the sign-in tab: email and password, and no display name', () => {
    setup(stubApi())

    expect(screen.getByRole('tab', { name: t.signIn })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: t.register })).toHaveAttribute('aria-selected', 'false')
    expect(emailBox()).toBeInTheDocument()
    expect(passwordBox()).toBeInTheDocument()
    expect(screen.queryByLabelText(t.displayName)).toBeNull()
  })

  it('asks the app to change route rather than switching tabs on its own', async () => {
    const { user, onMode } = setup(stubApi())

    await user.click(screen.getByRole('tab', { name: t.register }))
    expect(onMode).toHaveBeenCalledWith('register')
    // The tab is still sign-in: the route is the source of truth, and the app has not moved it yet.
    expect(screen.getByRole('tab', { name: t.signIn })).toHaveAttribute('aria-selected', 'true')
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

    await user.type(emailBox(), 'binh@example.com')
    await user.type(passwordBox(), PASSWORD)
    await user.click(submit(t.submitSignIn))

    await waitFor(() => expect(api.login).toHaveBeenCalledWith({ email: 'binh@example.com', password: PASSWORD }))
    expect(onSignedIn).toHaveBeenCalledWith(ME)
    expect(localStorage.getItem(LAST_EMAIL_KEY)).toBe('binh@example.com')
    // Nothing token-shaped: the session is a cookie this code never sees.
    expect(Object.keys(localStorage)).toEqual([LAST_EMAIL_KEY])
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

  it.each([
    ['an empty email', '', PASSWORD, viNormal.auth.errors.INVALID_EMAIL],
    ['a short password', 'binh@example.com', 'short', viNormal.auth.errors.INVALID_PASSWORD],
  ])('refuses %s without calling the server', async (_label, email, password, text) => {
    const api = stubApi()
    const { user } = setup(api)

    if (email !== '') await user.type(emailBox(), email)
    await user.type(passwordBox(), password)
    await user.click(submit(t.submitSignIn))

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(api.login).not.toHaveBeenCalled()
  })

  it('refuses an invalid display name on register without calling the server', async () => {
    const api = stubApi()
    const { user } = setup(api, 'register')

    await user.type(emailBox(), 'binh@example.com')
    await user.type(passwordBox(), PASSWORD)
    await user.type(nameBox(), 'A')
    await user.click(submit(t.submitRegister))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.auth.errors.INVALID_NAME)
    expect(api.register).not.toHaveBeenCalled()
  })

  it.each([
    ['BAD_CREDENTIALS', 401, viNormal.auth.errors.BAD_CREDENTIALS],
    ['INVALID_EMAIL', 400, viNormal.auth.errors.INVALID_EMAIL],
    ['INVALID_PASSWORD', 400, viNormal.auth.errors.INVALID_PASSWORD],
    ['FORBIDDEN', 403, viNormal.auth.errors.FORBIDDEN],
    ['NETWORK', 0, viNormal.auth.errors.NETWORK],
  ])('localises the sign-in refusal %s', async (code, status, text) => {
    const api = stubApi({ login: vi.fn().mockRejectedValue(new ApiError(status, code, 'nope')) })
    const { user, onSignedIn } = setup(api)

    await user.type(emailBox(), 'binh@example.com')
    await user.type(passwordBox(), PASSWORD)
    await user.click(submit(t.submitSignIn))

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(localStorage.getItem(LAST_EMAIL_KEY)).toBeNull()
  })

  it.each([
    ['EMAIL_TAKEN', 409, viNormal.auth.errors.EMAIL_TAKEN],
    ['DISPLAY_NAME_TAKEN', 409, viNormal.auth.errors.DISPLAY_NAME_TAKEN],
    ['INVALID_NAME', 400, viNormal.auth.errors.INVALID_NAME],
  ])('localises the register refusal %s', async (code, status, text) => {
    const api = stubApi({ register: vi.fn().mockRejectedValue(new ApiError(status, code, 'nope')) })
    const { user } = setup(api, 'register')

    await user.type(emailBox(), 'binh@example.com')
    await user.type(passwordBox(), PASSWORD)
    await user.type(nameBox(), 'Bình')
    await user.click(submit(t.submitRegister))

    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })

  it('says how long to wait when the server rate-limited the attempt', async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'too many', { retryAfterSec: 42 })) })
    const { user } = setup(api)

    await user.type(emailBox(), 'binh@example.com')
    await user.type(passwordBox(), PASSWORD)
    await user.click(submit(t.submitSignIn))

    expect(await screen.findByRole('alert')).toHaveTextContent('42')
  })

  it('falls back to the generic error for a code it has no words for', async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom')) })
    const { user } = setup(api)

    await user.type(emailBox(), 'binh@example.com')
    await user.type(passwordBox(), PASSWORD)
    await user.click(submit(t.submitSignIn))

    // `common:errors.INTERNAL`, quoted rather than imported: the app must not reach into the kit's sources.
    expect(await screen.findByRole('alert')).toHaveTextContent('Đã xảy ra lỗi, vui lòng thử lại')
  })

  it('clears a stale refusal once the player edits a field', async () => {
    const api = stubApi({ login: vi.fn().mockRejectedValue(new ApiError(401, 'BAD_CREDENTIALS', 'nope')) })
    const { user } = setup(api)

    await user.type(emailBox(), 'binh@example.com')
    await user.type(passwordBox(), PASSWORD)
    await user.click(submit(t.submitSignIn))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.type(passwordBox(), 'x')
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
