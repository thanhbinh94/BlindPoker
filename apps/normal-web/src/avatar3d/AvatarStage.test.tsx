import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'
import type { AvatarConfigDto } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { AvatarStage, setStageFactoryForTests } from './AvatarStage.js'
import { fakeStageFactory } from './fake-stage.js'
import { hashConfig } from './hash.js'
import { YAW_LIMIT, YAW_PER_PIXEL, YAW_STEP } from './yaw.js'

/**
 * The component around the stage: what it is called, how it is turned, and what happens where there is
 * no GPU. The stage itself is a double here — `stage.test.ts` drives the real one with a fake renderer,
 * and what is left for this file is exactly the part a player touches.
 */

const CONFIG: AvatarConfigDto = {
  v: 2,
  body: 'female',
  skin: '#efc9a4',
  eyes: '#6b4a2f',
  hairColor: '#d9a441',
  hair: 'hair_bun',
  top: 'clothing_aodai',
  bottom: 'bottom_skirt',
  shoes: 'shoes_sandals',
}

const DESCRIPTION = 'Nhân vật nữ, da Sáng, mắt Nâu.'

const mount = (props: Partial<Parameters<typeof AvatarStage>[0]> = {}) =>
  renderWithI18n(<AvatarStage config={CONFIG} mode="edit" description={DESCRIPTION} {...props} />, makeI18n('vi'))

/**
 * A pointer event jsdom will carry.
 *
 * jsdom 25 implements no `PointerEvent` at all, and Testing Library's `fireEvent.pointerDown` therefore
 * falls back to a plain `Event` — which drops `clientX`, the one property a drag is measured in. A
 * `MouseEvent` under the pointer event's *name* keeps the coordinate and is what React's
 * `onPointerDown` receives.
 */
const pointer = (type: string, clientX: number): MouseEvent => new MouseEvent(type, { bubbles: true, cancelable: true, clientX })

/** The turnable frame: `role="img"`, named by the description. */
const frame = (): HTMLElement => screen.getByRole('img', { name: DESCRIPTION })

/** What `aria-describedby` on the frame points at — the sentence about the arrow keys, or nothing. */
function describedBy(): HTMLElement {
  const id = frame().getAttribute('aria-describedby')
  if (id === null) throw new Error('the frame describes itself with nothing')
  const found = document.getElementById(id)
  if (found === null) throw new Error(`the frame points aria-describedby at ${id}, which is not on the page`)
  return found
}

afterEach(() => setStageFactoryForTests(fakeStageFactory({ supported: false })))

describe('AvatarStage', () => {
  it('describes the figure in words and shows it on a canvas', async () => {
    const factory = fakeStageFactory()
    setStageFactoryForTests(factory)
    mount()

    await waitFor(() => expect(factory.stages).toHaveLength(1))
    expect(frame()).toBeInTheDocument()
    // The picture is the canvas, and the canvas says nothing: the description is the whole of what a
    // screen reader gets, so it is on the element that claims to be an image.
    expect(frame().querySelector('canvas')).toHaveAttribute('aria-hidden', 'true')
    await waitFor(() => expect(factory.last().shown).toEqual([hashConfig(CONFIG)]))
  })

  it('tells whoever tabs onto it what the arrow keys do, and what kind of picture it is', async () => {
    const factory = fakeStageFactory()
    setStageFactoryForTests(factory)
    mount()
    await waitFor(() => expect(factory.stages).toHaveLength(1))

    // `img` is a non-interactive role, so a frame that is focusable and turnable has to say so itself:
    // without these two, tabbing onto it announces the outfit and nothing about how to turn it.
    expect(frame()).toHaveAttribute('aria-roledescription', viNormal.wardrobe.figureRole)
    expect(describedBy()).toHaveTextContent(viNormal.wardrobe.rotateHint)
    // In the wardrobe the hint is on screen as well as in the tree.
    expect(describedBy().className).not.toBe('visually-hidden')
  })

  it('keeps the hint for a screen reader on the profile, where there is no line to spare for it', async () => {
    const factory = fakeStageFactory()
    setStageFactoryForTests(factory)
    mount({ mode: 'view' })
    await waitFor(() => expect(factory.stages).toHaveLength(1))

    expect(describedBy()).toHaveTextContent(viNormal.wardrobe.rotateHint)
    // The profile header is a figure beside a name and a balance; the sentence is announced, not drawn.
    expect(describedBy().className).toBe('visually-hidden')
  })

  it('turns the figure while a pointer is dragged across it, and stops at ±60°', async () => {
    const factory = fakeStageFactory()
    setStageFactoryForTests(factory)
    mount()
    await waitFor(() => expect(factory.stages).toHaveLength(1))
    const stage = factory.last()

    fireEvent(frame(), pointer('pointerdown', 100))
    fireEvent(frame(), pointer('pointermove', 140))
    expect(stage.yaw()).toBeCloseTo(40 * YAW_PER_PIXEL, 6)

    // Still the same drag: the yaw follows the pointer's distance from where it went down, not the
    // distance since the last event.
    fireEvent(frame(), pointer('pointermove', 180))
    expect(stage.yaw()).toBeCloseTo(80 * YAW_PER_PIXEL, 6)

    // Far past the end of the range, and the figure stops rather than spinning.
    fireEvent(frame(), pointer('pointermove', 2000))
    expect(stage.yaw()).toBeCloseTo(YAW_LIMIT, 6)

    fireEvent(frame(), pointer('pointerup', 2000))
    // The pointer is up: moving it again turns nothing.
    fireEvent(frame(), pointer('pointermove', 100))
    expect(stage.yaw()).toBeCloseTo(YAW_LIMIT, 6)
  })

  it('turns the figure with the arrow keys and comes back to the front on request', async () => {
    const factory = fakeStageFactory()
    setStageFactoryForTests(factory)
    const user = userEvent.setup()
    mount()
    await waitFor(() => expect(factory.stages).toHaveLength(1))
    const stage = factory.last()

    frame().focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(stage.yaw()).toBeCloseTo(YAW_STEP * 2, 6)
    await user.keyboard('{ArrowLeft}')
    expect(stage.yaw()).toBeCloseTo(YAW_STEP, 6)

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.resetView }))
    expect(stage.yaw()).toBe(0)
  })

  it('shows the figure again whenever the configuration changes, and only then', async () => {
    const factory = fakeStageFactory()
    setStageFactoryForTests(factory)
    const { rerender, i18n } = mount()
    await waitFor(() => expect(factory.stages).toHaveLength(1))
    const stage = factory.last()
    // The provider has to stay: re-rendering the component alone would unmount it and build a *second*
    // stage, which is the very thing this test is checking does not happen.
    const show = (config: AvatarConfigDto): void =>
      rerender(
        <I18nextProvider i18n={i18n}>
          <AvatarStage config={config} mode="edit" description={DESCRIPTION} />
        </I18nextProvider>,
      )

    // A fresh object with the same contents is the same figure — every caller spreads one every render.
    show({ ...CONFIG })
    await waitFor(() => expect(stage.shown).toHaveLength(1))

    const other = { ...CONFIG, hairColor: '#c8323c' }
    show(other)
    await waitFor(() => expect(stage.shown).toEqual([hashConfig(CONFIG), hashConfig(other)]))
    expect(factory.stages).toHaveLength(1)
  })

  it('gives the context back when it leaves the screen', async () => {
    const factory = fakeStageFactory()
    setStageFactoryForTests(factory)
    const { unmount } = mount()
    await waitFor(() => expect(factory.stages).toHaveLength(1))
    const stage = factory.last()

    unmount()
    // The app is allowed two WebGL contexts in total (design §7), so a stage that did not hand its one
    // back would cost the next screen its own.
    expect(stage.disposed()).toBe(true)
  })

  it('draws a portrait instead where there is no WebGL, under the same description', async () => {
    setStageFactoryForTests(fakeStageFactory({ supported: false }))
    mount()

    // `waitFor` rather than `findByRole`: the frame is an image under the same name while the factory is
    // still being asked, so the assertion has to be on the thing that tells them apart.
    await waitFor(() => expect(frame()).toHaveAttribute('data-size', 'lg'))
    expect(frame().querySelector('canvas')).toBeNull()
    // Nothing to turn, so nothing offers to.
    expect(screen.queryByRole('button', { name: viNormal.wardrobe.resetView })).toBeNull()
  })

  it('falls back to the portrait when the figure itself will not load', async () => {
    setStageFactoryForTests(fakeStageFactory({ fails: true }))
    mount()

    await waitFor(() => expect(screen.getByRole('img', { name: DESCRIPTION })).toHaveAttribute('data-size', 'lg'))
  })
})
