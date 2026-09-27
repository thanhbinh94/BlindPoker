import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithI18n } from '../test-i18n.js'
import viNormal from '../locales/vi/normal.json'
import { UpdateBoundary } from './UpdateBoundary.js'

function Throws({ error }: { error: unknown }): never {
  throw error
}

describe('UpdateBoundary (bug 4)', () => {
  // React logs every error a boundary catches; the boundary *is* the behaviour under test, so mute the noise.
  let consoleError: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => consoleError.mockRestore())

  it('renders its children while nothing is wrong', () => {
    renderWithI18n(
      <UpdateBoundary>
        <p>{'ok'}</p>
      </UpdateBoundary>
    )
    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('says a new version is out when a chunk could not load, and reloads on the button', async () => {
    const onReload = vi.fn()
    renderWithI18n(
      <UpdateBoundary onReload={onReload}>
        <Throws error={new TypeError('Failed to fetch dynamically imported module: /assets/ProfileScreen-abc.js')} />
      </UpdateBoundary>
    )
    expect(screen.getByRole('alert')).toHaveTextContent(viNormal.screens.newVersion)
    await userEvent.click(screen.getByRole('button', { name: viNormal.screens.reload }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('says the page could not be opened for any other failure — never a blank page', () => {
    renderWithI18n(
      <UpdateBoundary onReload={vi.fn()}>
        <Throws error={new Error('boom')} />
      </UpdateBoundary>
    )
    expect(screen.getByRole('alert')).toHaveTextContent(viNormal.screens.failed)
  })
})
