import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type LiteApi, type SessionDto } from '../api.js'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import viLite from '../locales/vi/lite.json'
import { NamePrompt } from './NamePrompt.js'

const SESSION: SessionDto = { playerId: 'p1', displayName: 'Bình', token: 'tok-1', balance: 10000 }

function stubApi(overrides: Partial<LiteApi> = {}): LiteApi {
  return {
    config: vi.fn(),
    createSession: vi.fn().mockResolvedValue(SESSION),
    me: vi.fn(),
    daily: vi.fn(),
    claimDaily: vi.fn(),
    relief: vi.fn(),
    ...overrides,
  } as unknown as LiteApi
}

function setup(api: LiteApi, message: string | null = null) {
  const onSession = vi.fn()
  const view = renderWithI18n(<NamePrompt api={api} onSession={onSession} message={message} />, makeI18n('vi'))
  return { ...view, onSession, user: userEvent.setup() }
}

const nameBox = (): HTMLInputElement => screen.getByLabelText(viLite.prompt.name) as HTMLInputElement
const submit = (): HTMLElement => screen.getByRole('button', { name: viLite.prompt.submit })

describe('NamePrompt', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('prints the ticket: title, lead and the naming rules', () => {
    setup(stubApi())

    expect(screen.getByRole('heading', { name: viLite.prompt.title })).toBeInTheDocument()
    expect(screen.getByText(viLite.prompt.lead)).toBeInTheDocument()
    expect(screen.getByText(viLite.prompt.rules)).toBeInTheDocument()
  })

  it('shows the expiry message when the session was refused', () => {
    setup(stubApi(), viLite.session.expired)

    expect(screen.getByRole('status')).toHaveTextContent(viLite.session.expired)
  })

  it.each([
    ['too short', 'A'],
    ['too long', 'x'.repeat(21)],
    ['starting with a separator', '.Bình'],
    ['illegal character', 'Bình@'],
    ['hiding a zero-width character', 'Bì​nh'],
  ])('refuses a name that is %s without calling the server', async (_label, value) => {
    const api = stubApi()
    const { user } = setup(api)

    await user.type(nameBox(), value)
    await user.click(submit())

    expect(await screen.findByText(viLite.prompt.errors.INVALID_NAME)).toBeInTheDocument()
    expect(api.createSession).not.toHaveBeenCalled()
  })

  it('creates the session for a valid name and hands the dto up', async () => {
    const api = stubApi()
    const { user, onSession } = setup(api)

    await user.type(nameBox(), 'Bình')
    await user.click(submit())

    await waitFor(() => expect(api.createSession).toHaveBeenCalledWith('Bình'))
    expect(onSession).toHaveBeenCalledWith(SESSION)
  })

  it('sends the normalized name, so a stray space is corrected rather than refused', async () => {
    const api = stubApi()
    const { user } = setup(api)

    await user.type(nameBox(), '  Nguyễn   Văn A  ')
    await user.click(submit())

    await waitFor(() => expect(api.createSession).toHaveBeenCalledWith('Nguyễn Văn A'))
  })

  it.each([
    ['DISPLAY_NAME_TAKEN', 409, viLite.prompt.errors.DISPLAY_NAME_TAKEN],
    ['RATE_LIMITED', 429, viLite.prompt.errors.RATE_LIMITED],
    ['INVALID_NAME', 400, viLite.prompt.errors.INVALID_NAME],
    ['NETWORK', 0, viLite.prompt.errors.network],
  ])('localises the server refusal %s', async (code, status, text) => {
    const api = stubApi({ createSession: vi.fn().mockRejectedValue(new ApiError(status, code, 'nope')) })
    const { user, onSession } = setup(api)

    await user.type(nameBox(), 'Bình')
    await user.click(submit())

    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(onSession).not.toHaveBeenCalled()
  })

  it('clears a stale refusal once the player edits the name', async () => {
    const api = stubApi({ createSession: vi.fn().mockRejectedValue(new ApiError(409, 'DISPLAY_NAME_TAKEN', 'taken')) })
    const { user } = setup(api)

    await user.type(nameBox(), 'Bình')
    await user.click(submit())
    expect(await screen.findByText(viLite.prompt.errors.DISPLAY_NAME_TAKEN)).toBeInTheDocument()

    await user.type(nameBox(), 'h')

    await waitFor(() => expect(screen.queryByText(viLite.prompt.errors.DISPLAY_NAME_TAKEN)).not.toBeInTheDocument())
  })
})
