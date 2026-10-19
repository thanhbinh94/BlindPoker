import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import viNormal from '../../locales/vi/normal.json'
import { renderWithI18n } from '../../test-i18n.js'
import { CopyId } from './CopyId.js'

type Legacy = { execCommand?: (command: string) => boolean }

/** A page on a plain-HTTP host: there is no `navigator.clipboard` at all. */
function withoutClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
}

function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
  const exec = vi.fn().mockReturnValue(result)
  ;(document as unknown as Legacy).execCommand = exec as unknown as Legacy['execCommand']
  return exec
}

describe('CopyId', () => {
  afterEach(() => {
    delete (document as unknown as Legacy).execCommand
    vi.restoreAllMocks()
  })

  it('puts the id on the clipboard, shows it as the tooltip, and says it was copied', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    renderWithI18n(<CopyId id="p-123" />)

    const button = screen.getByRole('button', { name: viNormal.gm.copyId })
    expect(button).toHaveAttribute('title', 'p-123')
    await user.click(button)

    expect(writeText).toHaveBeenCalledWith('p-123')
    expect(await screen.findByRole('button', { name: viNormal.gm.copied })).toBeInTheDocument()
  })

  it('copies through a throwaway field where there is no clipboard (a plain-HTTP host)', async () => {
    const user = userEvent.setup()
    withoutClipboard()
    const exec = stubExecCommand(true)
    renderWithI18n(<CopyId id="p-123" />)

    await user.click(screen.getByRole('button', { name: viNormal.gm.copyId }))

    expect(exec).toHaveBeenCalledWith('copy')
    expect(await screen.findByRole('button', { name: viNormal.gm.copied })).toBeInTheDocument()
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('tries the field when the clipboard refuses', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    const exec = stubExecCommand(true)
    renderWithI18n(<CopyId id="p-123" />)

    await user.click(screen.getByRole('button', { name: viNormal.gm.copyId }))

    expect(exec).toHaveBeenCalledWith('copy')
    expect(await screen.findByRole('button', { name: viNormal.gm.copied })).toBeInTheDocument()
  })

  it('prints the id, whole, when no way of copying works, so a phone can still select it', async () => {
    const user = userEvent.setup()
    withoutClipboard()
    stubExecCommand(false)
    renderWithI18n(<CopyId id="p-123" />)
    expect(screen.queryByText('p-123')).toBeNull()

    await user.click(screen.getByRole('button', { name: viNormal.gm.copyId }))

    expect(await screen.findByText('p-123')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: viNormal.gm.copyId })).toBeInTheDocument()
  })

  it('prints the id too when the browser has no copy command at all', async () => {
    const user = userEvent.setup()
    withoutClipboard()
    renderWithI18n(<CopyId id="p-123" />)

    await user.click(screen.getByRole('button', { name: viNormal.gm.copyId }))

    expect(await screen.findByText('p-123')).toBeInTheDocument()
  })
})
