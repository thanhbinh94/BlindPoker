import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type MeDto, type NormalApi } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import enNormal from '../locales/en/normal.json'
import { THEME_KEY } from '../prefs.js'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { SettingsScreen } from './SettingsScreen.js'

const ME = {
  playerId: 'p1',
  displayName: 'Bình',
  email: 'binh@example.com',
  balance: 123_000,
} as unknown as MeDto

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return { me: vi.fn().mockResolvedValue(ME), ...overrides } as unknown as NormalApi
}

function renderScreen(props: Partial<Parameters<typeof SettingsScreen>[0]> = {}) {
  const api = props.api ?? stubApi()
  const onLanguage = props.onLanguage ?? vi.fn()
  const onSignedOut = props.onSignedOut ?? vi.fn()
  const result = renderWithI18n(
    <SettingsScreen api={api} lang={props.lang ?? 'vi'} onLanguage={onLanguage} onSignedOut={onSignedOut} version={props.version ?? '0.1.0'} />,
    makeI18n(props.lang ?? 'vi'),
  )
  return { ...result, api, onLanguage, onSignedOut }
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('paints the theme, remembers it on the device and marks which one is on', async () => {
    const user = userEvent.setup()
    renderScreen()

    const light = screen.getByRole('button', { name: viNormal.settings.theme.light })
    expect(screen.getByRole('button', { name: viNormal.settings.theme.dark })).toHaveAttribute('aria-pressed', 'true')

    await user.click(light)

    expect(light).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('hands the language change up to the app, which owns it', async () => {
    const user = userEvent.setup()
    const { onLanguage, i18n } = renderScreen()

    await user.click(screen.getByRole('button', { name: i18n.t('common:language.en') }))

    expect(onLanguage).toHaveBeenCalledWith('en')
  })

  it('renders in the language it is given', () => {
    renderScreen({ lang: 'en' })

    expect(screen.getByRole('heading', { name: enNormal.settings.title, level: 1 })).toBeInTheDocument()
  })

  it('shows the account the cookie names, and the build under it', async () => {
    renderScreen({ version: '9.9.9' })

    expect(await screen.findByText('binh@example.com')).toBeInTheDocument()
    expect(screen.getByText(ME.displayName)).toBeInTheDocument()
    expect(screen.getByText('9.9.9')).toBeInTheDocument()
    expect(screen.getByText(viNormal.app.edition)).toBeInTheDocument()
  })

  it('says so when the account cannot be read, and asks again when told to', async () => {
    const me = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(ME)
    const user = userEvent.setup()
    renderScreen({ api: stubApi({ me }) })

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.settings.account.error)

    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByText('binh@example.com')).toBeInTheDocument()
  })

  it('reads an account with no address as such rather than as a blank', async () => {
    renderScreen({ api: stubApi({ me: vi.fn().mockResolvedValue({ ...ME, email: null }) }) })

    expect(await screen.findByText(viNormal.settings.account.noEmail)).toBeInTheDocument()
  })

  it('asks before signing out, and does nothing at all when the answer is no', async () => {
    const user = userEvent.setup()
    const { onSignedOut } = renderScreen()

    await user.click(screen.getByRole('button', { name: viNormal.settings.account.signOut }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: viNormal.settings.signOut.cancel }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSignedOut).not.toHaveBeenCalled()
  })

  it('hands the sign-out to the app once the player confirms it', async () => {
    const user = userEvent.setup()
    const { onSignedOut, api } = renderScreen()

    await user.click(screen.getByRole('button', { name: viNormal.settings.account.signOut }))
    await user.click(screen.getByRole('button', { name: viNormal.settings.signOut.confirm }))

    expect(onSignedOut).toHaveBeenCalledTimes(1)
    // The screen never calls `logout` itself: one session ends in exactly one place, and that place is the app.
    expect((api as { logout?: unknown }).logout).toBeUndefined()
  })
})
