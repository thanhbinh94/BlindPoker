import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { renderWithI18n } from '../../test-i18n.js'
import { ReasonDialog, type ReasonDialogProps } from './ReasonDialog.js'

const CONFIRM = 'Xác nhận cộng điểm'

function renderDialog(props: Partial<ReasonDialogProps> = {}) {
  const onConfirm = props.onConfirm ?? vi.fn().mockResolvedValue(undefined)
  const onClose = props.onClose ?? vi.fn()
  const result = renderWithI18n(
    <ReasonDialog open title="Cộng/trừ điểm" fields={{}} confirmLabel={CONFIRM} {...props} onConfirm={onConfirm} onClose={onClose} />,
  )
  return { ...result, onConfirm, onClose }
}

const confirmButton = () => screen.getByRole('button', { name: CONFIRM })
const reasonBox = () => screen.getByLabelText(viNormal.gm.dialog.reason)
const amountBox = () => screen.getByLabelText(viNormal.gm.dialog.amount)

describe('ReasonDialog', () => {
  it('keeps Confirm off until the reason is three characters', async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(confirmButton()).toBeDisabled()
    await user.type(reasonBox(), 'ab')
    expect(confirmButton()).toBeDisabled()
    await user.type(reasonBox(), 'c')
    expect(confirmButton()).toBeEnabled()
  })

  it('does not count spaces toward the reason', async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.type(reasonBox(), '  a  ')

    expect(confirmButton()).toBeDisabled()
  })

  it('with an amount field, wants a non-zero whole number within the cap', async () => {
    const user = userEvent.setup()
    renderDialog({ fields: { amount: true } })
    await user.type(reasonBox(), 'sửa')

    expect(confirmButton()).toBeDisabled()
    for (const bad of ['0', '1.5', '10000001', '-10000001', 'abc']) {
      await user.clear(amountBox())
      await user.type(amountBox(), bad)
      expect(confirmButton(), bad).toBeDisabled()
    }
    for (const good of ['-500', '10000000', '7']) {
      await user.clear(amountBox())
      await user.type(amountBox(), good)
      expect(confirmButton(), good).toBeEnabled()
    }
  })

  it('with an item field, wants an item id', async () => {
    const user = userEvent.setup()
    renderDialog({ fields: { item: true } })
    await user.type(reasonBox(), 'quà')
    expect(confirmButton()).toBeDisabled()

    await user.type(screen.getByLabelText(viNormal.gm.dialog.item), 'hair.bob')

    expect(confirmButton()).toBeEnabled()
  })

  it('hands the trimmed values to onConfirm and closes on success', async () => {
    const user = userEvent.setup()
    const { onConfirm, onClose } = renderDialog({ fields: { amount: true, item: true } })
    await user.type(reasonBox(), '  quà tặng ')
    await user.type(amountBox(), '-500')
    await user.type(screen.getByLabelText(viNormal.gm.dialog.item), ' hair.bob ')

    await user.click(confirmButton())

    expect(onConfirm).toHaveBeenCalledWith({ reason: 'quà tặng', amount: -500, itemId: 'hair.bob' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows the server refusal in words and stays open', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(409, 'INSUFFICIENT_BALANCE', ''))
    const { onClose } = renderDialog({ fields: { amount: true }, onConfirm })
    await user.type(reasonBox(), 'sửa')
    await user.type(amountBox(), '-500')

    await user.click(confirmButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Số dư không đủ để trừ')
    expect(reasonBox()).toHaveAttribute('aria-describedby', alert.id)
    expect(onClose).not.toHaveBeenCalled()
    expect(confirmButton()).toBeEnabled()
  })

  it('names the two refusals only the role action can earn', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(409, 'TARGET_IS_GM', ''))
    renderDialog({ onConfirm })
    await user.type(reasonBox(), 'khóa')
    await user.click(confirmButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.gm.errors.TARGET_IS_GM)
  })

  it('falls back to the generic line for a code it has no words for', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'))
    renderDialog({ onConfirm })
    await user.type(reasonBox(), 'khóa')
    await user.click(confirmButton())

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('starts empty each time it opens', async () => {
    const user = userEvent.setup()
    const { rerender, i18n, onConfirm, onClose } = renderDialog()
    await user.type(reasonBox(), 'khóa')
    const props = { title: 'Cộng/trừ điểm', fields: {}, confirmLabel: CONFIRM, onConfirm, onClose }
    rerender(
      <I18nextProvider i18n={i18n}>
        <ReasonDialog open={false} {...props} />
      </I18nextProvider>,
    )
    rerender(
      <I18nextProvider i18n={i18n}>
        <ReasonDialog open {...props} />
      </I18nextProvider>,
    )

    expect(reasonBox()).toHaveValue('')
  })

  it('shows the body text when it has one, and Cancel closes without confirming', async () => {
    const user = userEvent.setup()
    const { onConfirm, onClose } = renderDialog({ body: viNormal.gm.dialog.lockBody })

    expect(screen.getByText(viNormal.gm.dialog.lockBody)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: viNormal.gm.dialog.cancel }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
