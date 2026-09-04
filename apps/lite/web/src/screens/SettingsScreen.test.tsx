import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import viLite from '../locales/vi/lite.json'
import { THEME_KEY } from '../prefs.js'
import { TOKEN_KEY } from '../session.js'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { SettingsScreen } from './SettingsScreen.js'

const ME = { playerId: 'p-7f3a', displayName: 'Bình' }
/** ui-kit's `game` namespace, quoted rather than imported: the app must not reach into the kit's sources. */
const CONFIRM = 'Xác nhận'
const CANCEL = 'Hủy'

function setup(language: 'vi' | 'en' = 'vi') {
  const onSignedOut = vi.fn()
  const view = renderWithI18n(<SettingsScreen me={ME} balance={12_345} onSignedOut={onSignedOut} version="0.1.0" />, makeI18n(language))
  return { ...view, onSignedOut, user: userEvent.setup() }
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('shows the account, the balance, the player id and the build version', () => {
    setup()

    // The rail hides its own copy of the balance at 640px, so this one has to be here.
    expect(screen.getByText(/12\.345/)).toBeInTheDocument()
    expect(screen.getByText(ME.displayName)).toBeInTheDocument()
    expect(screen.getByText(ME.playerId)).toBeInTheDocument()
    expect(screen.getByText(viLite.settings.playerId)).toBeInTheDocument()
    expect(screen.getByText('0.1.0')).toBeInTheDocument()
  })

  it('applies the light theme to the document root and remembers it', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: viLite.settings.light }))

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(screen.getByRole('button', { name: viLite.settings.light })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: viLite.settings.dark }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('switches the language through i18next and persists it', async () => {
    const { user, i18n } = setup('vi')

    await user.click(screen.getByRole('button', { name: 'English' }))

    await waitFor(() => expect(i18n.language).toBe('en'))
    expect(localStorage.getItem('bp.lang')).toBe('en')
  })

  it('asks before signing out, and only then clears the token', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-1')
    const { user, onSignedOut } = setup()

    await user.click(screen.getByRole('button', { name: viLite.settings.signOut }))

    expect(screen.getByRole('dialog')).toHaveTextContent(viLite.settings.signOutConfirm)
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-1')
    expect(onSignedOut).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: CONFIRM }))

    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })

  it('keeps the session when the confirmation is dismissed', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok-1')
    const { user, onSignedOut } = setup()

    await user.click(screen.getByRole('button', { name: viLite.settings.signOut }))
    await user.click(screen.getByRole('button', { name: CANCEL }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-1')
    expect(onSignedOut).not.toHaveBeenCalled()
  })
})
