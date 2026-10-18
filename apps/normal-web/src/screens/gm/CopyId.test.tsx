import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import viNormal from '../../locales/vi/normal.json'
import { renderWithI18n } from '../../test-i18n.js'
import { CopyId } from './CopyId.js'

describe('CopyId', () => {
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

  it('keeps its label when the clipboard refuses', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    renderWithI18n(<CopyId id="p-123" />)

    await user.click(screen.getByRole('button', { name: viNormal.gm.copyId }))

    expect(screen.getByRole('button', { name: viNormal.gm.copyId })).toBeInTheDocument()
  })
})
