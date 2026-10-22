import { expect, test } from '@playwright/test'
import { account, register, signIn } from '../support.js'
import { balanceOf, closeAll, postApi, type Player } from './ops-helpers.js'

/**
 * Operation test plan §4 (S) and §5.A / §5.B / §5.I — accounts, the shared chrome, the daily reward. Every test
 * title starts with the case ids it covers, so the run's report reads straight into the plan's result sheet.
 */

test.describe.configure({ mode: 'serial' })

let main: Player

test.afterAll(async () => {
  await closeAll([main])
})

test('S-01 S-02 S-03 I-01 I-02 I-03: first visit, first sign-in, first reward', async ({ browser }) => {
  // S-01: the sign-in page, and the tab, carry the name.
  const probe = await browser.newPage()
  await probe.goto('/#/login')
  await expect(probe.getByRole('heading', { name: 'Blind Luck Poker' })).toBeVisible()
  await expect(probe).toHaveTitle('Blind Luck Poker')
  await probe.close()

  // S-02 + I-01 (first half): `../support.js`'s `register` itself asserts the app opens on the daily page for a
  // fresh account (unlike `registerPatiently`, which only needs a signed-in player).
  const context = await browser.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', colorScheme: 'dark' })
  const page = await context.newPage()
  const who = account('Ops')
  await register(page, who)
  main = { who, context, page }
  expect(await balanceOf(page), 'a new account starts at 100.000').toBe(100_000)

  // S-03 + I-02: claim once, the button locks, the rail's dot goes; a second claim is refused by the server.
  await page.goto('/#/daily')
  const claim = page.getByRole('button', { name: 'Nhận thưởng' })
  await expect(claim).toBeEnabled()
  await expect(page.getByText(/^Lần điểm danh thứ 1 của tháng \d{2}\/\d{4} · không cần liên tiếp$/u)).toBeVisible()
  await claim.click()
  await expect(claim).toBeDisabled()
  await expect.poll(() => balanceOf(page)).toBe(105_000)
  // The dot goes on the daily page itself, the moment the claim lands (finding T1 of the 2026-09-28 run: it used to
  // stay until the player left the page), and stays gone in the lobby.
  await expect(page.getByText('Có quà chưa nhận')).toHaveCount(0)
  await expect(page).toHaveURL(/#\/daily$/)
  await page.goto('/#/lobby')
  await expect(page.getByText('Có quà chưa nhận')).toHaveCount(0)
  await page.goto('/#/daily')
  const again = await postApi(page, '/api/rewards/daily/claim')
  expect(again.status, 'a second claim the same day is refused').toBe(409)

  // I-03: the next day starts at 00:00, Vietnam time, and reads like every other moment on screen.
  await expect(page.getByText(/^Lần điểm danh tiếp theo: 00:00, \d{1,2} thg \d{1,2}$/)).toBeVisible()

  // I-01 (second half): signing in again the same day stays in the lobby.
  const second = await browser.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' })
  const again2 = await second.newPage()
  await signIn(again2, main.who)
  await expect(again2).toHaveURL(/#\/lobby$/)
  await second.close()
})

test('A-01 A-02 A-03: the register form refuses bad input and names the field', async ({ page }) => {
  await page.goto('/#/register')
  const email = page.getByLabel('Email', { exact: true })
  const password = page.getByLabel('Mật khẩu', { exact: true })
  const name = page.getByLabel('Tên hiển thị', { exact: true })
  const submit = page.getByRole('button', { name: 'Tạo tài khoản' })

  // A-01: seven characters.
  await email.fill('short@ops.test')
  await password.fill('1234567')
  await name.fill('Ngan Ops')
  await submit.click()
  await expect(password).toHaveAttribute('aria-invalid', 'true')
  await expect(page).toHaveURL(/#\/register$/)

  // A-02: the password is the address's local part (the rule `validatePassword` enforces today).
  await email.fill('shortops@ops.test')
  await password.fill('shortops')
  await submit.click()
  await expect(password).toHaveAttribute('aria-invalid', 'true')
  await expect(page).toHaveURL(/#\/register$/)

  // A-03: a name of one character, of twenty-one, with an "@".
  await password.fill('a good ops password')
  for (const bad of ['N', 'N'.repeat(21), 'ops@name']) {
    await name.fill(bad)
    await submit.click()
    await expect(name, `"${bad}" is refused`).toHaveAttribute('aria-invalid', 'true')
    await expect(page).toHaveURL(/#\/register$/)
  }
})

test('A-02 (T2): the whole email address as the password is refused', async ({ page }) => {
  // Finding T2 of the 2026-09-28 run: the form says "khác với email của bạn", but only the address's local part used
  // to be refused. Now the whole address is too — by the form (the shared rule in `@bp/core`) and by the server.
  const address = `whole${Date.now() % 100_000}@ops.test`
  await page.goto('/#/register')
  await page.getByLabel('Email', { exact: true }).fill(address)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(address)
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(`Whole ${Date.now() % 100_000}`)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveAttribute('aria-invalid', 'true', { timeout: 5_000 })
  await expect(page.getByText('Mật khẩu cần 8–128 ký tự và không trùng với email')).toBeVisible()
  await expect(page).toHaveURL(/#\/register$/)
  // And the server refuses it on its own, for a client that skips the form.
  const direct = await postApi(page, '/api/auth/register', { email: address, password: address.toUpperCase(), displayName: `Whole B ${Date.now() % 100_000}` })
  expect(direct.status, 'the server refuses the whole address as a password').toBe(400)
})

test('A-04: an email or a name already taken is refused in words', async ({ page }) => {
  await page.goto('/#/register')
  await page.getByLabel('Email', { exact: true }).fill(main.who.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill('another good password')
  await page.getByLabel('Tên hiển thị', { exact: true }).fill('Ops Taken A')
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page.getByText('Email này đã được đăng ký')).toBeVisible()

  await page.getByLabel('Email', { exact: true }).fill(`${Date.now()}@ops.test`)
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(main.who.displayName)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page.getByText('Tên hiển thị đã có người dùng')).toBeVisible()
})

test('A-05 A-06 A-07: a wrong password says nothing about the account; sign-out holds; a second device agrees', async ({ browser }) => {
  // A-05: wrong password, and an address with no account, get the same words.
  const page = await browser.newPage()
  await page.goto('/#/login')
  await page.getByLabel('Email', { exact: true }).fill(main.who.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill('not the password')
  await page.getByRole('button', { name: 'Vào sảnh' }).click()
  await expect(page.getByText('Email hoặc mật khẩu không đúng')).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill('nobody-here@ops.test')
  await page.getByRole('button', { name: 'Vào sảnh' }).click()
  await expect(page.getByText('Email hoặc mật khẩu không đúng')).toBeVisible()
  await page.close()

  // A-07: the same account on a second "device" sees the same balance.
  const other = await browser.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' })
  const second = await other.newPage()
  await signIn(second, main.who)
  expect(await balanceOf(second)).toBe(await balanceOf(main.page))

  // A-06: sign out there, then Back — the account screens are gone with the cookie.
  await second.goto('/#/profile')
  await expect(second.getByRole('heading', { name: 'Hồ sơ', level: 1 })).toBeVisible()
  await second.goto('/#/settings')
  await second.getByRole('button', { name: 'Đăng xuất', exact: true }).click()
  await second.getByRole('button', { name: 'Đăng xuất ngay' }).click()
  await expect(second.getByRole('button', { name: 'Vào sảnh' })).toBeVisible()
  await second.goBack()
  await second.goBack()
  await expect(second.getByRole('heading', { name: 'Hồ sơ', level: 1 })).toHaveCount(0)
  await expect(second.getByRole('button', { name: 'Vào sảnh' })).toBeVisible()
  await other.close()
})

test('A-08 B-02 B-03 S-07 S-08: language and theme stick; every account screen opens and survives a reload', async ({ browser }) => {
  // A-08: English chosen on the sign-in page is the language after signing in.
  const context = await browser.newContext({ locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' })
  const page = await context.newPage()
  await page.goto('/#/login')
  await page.getByRole('button', { name: 'English' }).click()
  await expect(page.getByRole('button', { name: 'Enter the lobby' })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(main.who.email)
  await page.getByLabel('Password', { exact: true }).fill(main.who.password)
  await page.getByRole('button', { name: 'Enter the lobby' }).click()
  await expect(page.getByRole('heading', { name: 'Rooms', level: 1 })).toBeVisible()

  // B-03: the lobby, the create dialog and the rail are English.
  await page.getByRole('button', { name: 'Create room' }).click()
  await expect(page.getByRole('dialog', { name: /Create/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('link', { name: /Settings/ })).toBeVisible()

  // B-02: light theme, remembered across a reload.
  await page.goto('/#/settings')
  await page.getByRole('button', { name: 'Light' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Dark' }).click()
  await page.getByRole('button', { name: 'Tiếng Việt' }).first().click()

  // S-07 + S-08: every account screen opens with its heading, and a reload lands on the same screen.
  const screens: [string, string][] = [
    ['/profile', 'Hồ sơ'],
    ['/avatar', 'Phòng thay đồ'],
    ['/achievements', 'Thành tựu'],
    ['/settings', 'Cài đặt'],
    ['/daily', 'Điểm danh hằng ngày'],
  ]
  for (const [route, heading] of screens) {
    await page.goto(`/#${route}`)
    await expect(page.getByRole('heading', { name: heading, level: 1 }), `${route} opens`).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: heading, level: 1 }), `${route} survives a reload`).toBeVisible()
  }

  // S-07, review 2026-09-29 No5: the inventory folded into the wardrobe, and its old address is the wardrobe now —
  // with the address bar saying so, in place of the old entry: "Back" returns to where the player came from, not to
  // `#/inventory` (which would send them forward again).
  await page.goto('/#/profile')
  await page.goto('/#/inventory')
  await expect(page.getByRole('heading', { name: 'Phòng thay đồ', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/#\/avatar$/)
  await page.goBack()
  await expect(page).toHaveURL(/#\/profile$/)
  await context.close()
})
