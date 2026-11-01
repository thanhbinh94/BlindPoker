import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'
import { createI18n, type Language } from '../i18n/index.js'
import { SOUND_MUTED_KEY, createSoundEngine } from './engine.js'
import { memoryStorage } from './fake-audio.js'
import { MuteButton } from './MuteButton.js'

afterEach(cleanup)

const setup = (lang: Language = 'vi', stored: Record<string, string> = {}) => {
  const storage = memoryStorage(stored)
  const engine = createSoundEngine({ createContext: () => null, storage, isHidden: () => false, emit: () => {} })
  const view = render(
    <I18nextProvider i18n={createI18n({ language: lang, storage: null })}>
      <MuteButton engine={engine} className="extra" />
    </I18nextProvider>,
  )
  return { engine, storage, view }
}

describe('MuteButton', () => {
  it('reads "Tắt tiếng" when sound is on and "Bật tiếng" when muted', () => {
    const { engine } = setup()
    // The label names the action; there is no aria-pressed as well (Ruling 10: "Bật tiếng, pressed" says it twice).
    const button = screen.getByRole('button', { name: 'Tắt tiếng' })
    expect(button).not.toHaveAttribute('aria-pressed')
    expect(button).toHaveAttribute('data-muted', 'false')
    act(() => engine.setMuted(true)) // muted elsewhere (Cài đặt): the button follows
    const muted = screen.getByRole('button', { name: 'Bật tiếng' })
    expect(muted).not.toHaveAttribute('aria-pressed')
    expect(muted).toHaveAttribute('data-muted', 'true')
    cleanup()
    setup('en', { [SOUND_MUTED_KEY]: '1' })
    expect(screen.getByRole('button', { name: 'Unmute' })).not.toHaveAttribute('aria-pressed')
  })

  it('a click toggles and persists', async () => {
    const { engine, storage } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Tắt tiếng' }))
    expect(engine.muted).toBe(true)
    expect(storage.getItem(SOUND_MUTED_KEY)).toBe('1')
    expect(screen.queryByRole('button', { name: 'Tắt tiếng' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Bật tiếng' }))
    expect(engine.muted).toBe(false)
    expect(storage.getItem(SOUND_MUTED_KEY)).toBeNull()
    expect(screen.getByRole('button', { name: 'Tắt tiếng' })).not.toHaveAttribute('aria-pressed')
  })

  it("is one bare button, so the header's right cell can size it", () => {
    const { view } = setup()
    const button = screen.getByRole('button')
    expect(view.container.firstElementChild).toBe(button)
    expect(button).toHaveAttribute('type', 'button')
    expect(button.className).toContain('extra')
  })
})
