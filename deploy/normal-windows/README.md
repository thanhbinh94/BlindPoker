# Chạy thử Blind Luck Poker Normal trong mạng LAN (Windows, không Docker, miễn phí)

Bộ script này chạy **bản Normal** — bản có tài khoản, avatar, kho đồ, thành tựu — trên **một máy
Windows** trong mạng nội bộ, dùng một database PostgreSQL miễn phí trên mây. Không cần Docker,
không cần domain, không cần thẻ tín dụng.

Dành cho ai:

- muốn thử bản Normal thật với vài người trong nhà/văn phòng trước khi bỏ tiền thuê máy chủ;
- đã có sẵn mã nguồn và Node.js trên máy.

**Không** dành cho việc mở ra Internet. Kết nối là HTTP thuần, không có HTTPS, và dừng server là
tắt cứng (mục 7). Muốn chạy thật, public, lâu dài thì xem [`docs/deployment-normal.md`](../../docs/deployment-normal.md)
(Docker Compose + Caddy + HTTPS) hoặc [`deploy/oracle/`](../oracle/) (máy ảo miễn phí của Oracle).

Bản đơn giản hơn nhiều — một file `.exe`, không cần database, không có tài khoản — là
[Blind Luck Poker Lite](../../docs/deployment-lite.md). Nếu bạn chỉ muốn cả nhà chơi bài với nhau, hãy
dùng Lite; bộ script này tồn tại để thử **bản Normal**.

---

## 1. Cần những gì

| | |
| --- | --- |
| **Máy chủ** | Một PC Windows 10/11 64-bit, để bật trong suốt buổi chơi. RAM 4 GB là đủ. |
| **Node.js** | Phiên bản **22.13 trở lên**. Kiểm tra bằng `node -v`. Tải bản LTS ở <https://nodejs.org>. |
| **Mã nguồn** | Một bản checkout của repository này, đã chạy `pnpm install`. |
| **Bản build** | Đã chạy `pnpm build:normal` ở thư mục gốc repo (xem mục 3). |
| **Database** | Một chuỗi kết nối PostgreSQL. Mục 2 hướng dẫn lấy miễn phí ở Neon. |
| **Mạng** | Các máy chơi cùng một mạng Wi-Fi/LAN với máy chủ. |

Server phục vụ luôn giao diện web, nên **không cần** chạy thêm gì cho phần frontend.

---

## 2. Lấy một database PostgreSQL miễn phí (Neon)

Neon cho một database Postgres miễn phí vĩnh viễn, đủ dùng cho một buổi test. Bạn tự đăng ký —
script không làm thay và không cần biết mật khẩu của bạn.

1. Mở <https://neon.tech>, bấm **Sign up**, đăng nhập bằng GitHub hoặc Google.
2. Ở màn hình **Create your first project**: đặt **Project name** tuỳ ý (ví dụ `bind-poker`), phần
   **Postgres version** để mặc định, phần **Region** chọn nơi gần bạn nhất (ví dụ
   *Asia Pacific (Singapore)*). Bấm **Create project**.
3. Neon mở thẳng hộp **Connection string**. Trong hộp đó chọn tab **Parameters only** hay **psql**
   đều được — thứ bạn cần là dòng bắt đầu bằng `postgresql://`. Bấm biểu tượng **Copy snippet**.
4. Nếu lỡ đóng màn hình đó: vào **Dashboard** → chọn project → thẻ **Connection Details** ở cột phải
   → **Connection string** → **Copy**.

Neon đưa chuỗi kết thúc bằng `?sslmode=require`. Đổi `require` thành `verify-full` (phần phía sau, nếu có,
như `&channel_binding=require`, giữ nguyên), để được chuỗi dạng:

```text
postgresql://neondb_owner:npg_XXXXXXXX@ep-cool-name-12345678.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full
```

Luôn phải có `sslmode` ở cuối — thiếu nó Neon từ chối kết nối. Vì sao `verify-full`: thư viện `pg` hiện hiểu
`require` là "mã hoá và kiểm tra chứng chỉ", nhưng từ pg v9 `require` sẽ chỉ còn mã hoá, không kiểm tra chứng chỉ
(và server đã in cảnh báo về chuyện này vào `normal.err.log`); `verify-full` giữ đúng mức kiểm tra hiện nay và hết
cảnh báo.

> **Lưu ý về gói miễn phí:** database sẽ **ngủ** sau khoảng 5 phút không ai dùng. Lần kết nối đầu
> sau khi ngủ mất 1–2 giây, đôi khi lỗi luôn — chạy lại là được. Xem mục 8.

Không thích Neon thì bất kỳ Postgres 14+ nào cũng chạy được, kể cả một bản cài tay ngay trên máy này;
chỉ cần một `DATABASE_URL` hợp lệ.

---

## 3. Build một lần

Mở PowerShell ở thư mục gốc repo:

```powershell
cd D:\bind-poker          # đường dẫn repo của bạn
pnpm install
pnpm build:normal
```

Lệnh này tạo ra `apps/normal-web/dist` (giao diện) và `apps/normal-server/dist` (server).
`run.ps1` kiểm tra cả hai và từ chối chạy nếu thiếu. Sửa code thì phải build lại.

---

## 4. Điền cấu hình

```powershell
cd D:\bind-poker\deploy\normal-windows
Copy-Item .env.example .env
notepad .env
```

Chỉ **hai** dòng bắt buộc phải sửa:

- **`DATABASE_URL`** — dán chuỗi lấy ở mục 2.
- **`SESSION_SECRET`** — một chuỗi ngẫu nhiên ít nhất 32 ký tự. Sinh nhanh bằng PowerShell:

  ```powershell
  [Convert]::ToBase64String((1..36 | ForEach-Object { Get-Random -Max 256 }))
  ```

  (Có `openssl` thì `openssl rand -base64 48` cũng được.)

Các dòng còn lại để nguyên là chạy đúng. `.env` **không được commit** — nó đã nằm trong
`.gitignore` vì chứa mật khẩu database và khoá ký phiên.

Trong `ALLOWED_ORIGINS` có chỗ `<IP-LAN>`: **cứ để nguyên**, `run.ps1` tự thay bằng địa chỉ IPv4
thật của máy này mỗi lần khởi động.

Xem trước cấu hình đã được hiểu đúng chưa, **không chạy gì cả**:

```powershell
.\run.ps1 -DryRun
```

Lệnh này in ra toàn bộ biến sau khi chuẩn hoá (mật khẩu và khoá phiên đã bị che), địa chỉ LAN tìm
được, và hai lệnh sẽ chạy. Đọc dòng `PUBLIC_DIR=` và `ALLOWED_ORIGINS=` để chắc chắn chúng đúng.

---

## 5. Chạy

```powershell
.\run.ps1
```

Script sẽ: kiểm Node và bản build → đọc `.env` → tìm IP LAN → chạy migration
(`node dist/migrate-cli.js`) → khởi động server (`node dist/main.js`) **tách khỏi cửa sổ này**, bằng
một scheduled task của Windows → chờ tới khi server báo đã mở cổng, rồi in ra:

```text
Blind Luck Poker Normal đang chạy — pid 12345, log ở D:\bind-poker\deploy\normal-windows\normal.log
  Máy này:        http://localhost:8080
  Máy khác trong LAN: http://192.168.1.10:8080

Chạy tách nền bằng scheduled task 'BlindLuckPoker-Normal' — đóng cửa sổ này server vẫn chạy (đăng xuất Windows thì dừng). ...
```

Nếu server chết ngay lúc khởi động, script **in ra thông báo lỗi của chính server** rồi thoát với mã
1 — không để bạn ngồi đoán trước một trang trắng.

Tham số có thể dùng:

| Tham số | Ý nghĩa |
| --- | --- |
| `-DryRun` | Chỉ in cấu hình, lệnh sẽ chạy và cách chạy (task nào, lệnh của task), không đụng vào database, cổng mạng lẫn Task Scheduler. |
| `-NoMigrate` | Bỏ qua bước migration (schema đã có sẵn từ lần chạy trước). |
| `-Port 9090` | Chạy tạm ở cổng khác. **Phải** sửa cổng trong `ALLOWED_ORIGINS` cho khớp trước — nếu không script sẽ từ chối chạy (kể cả `-DryRun`), không chỉ cảnh báo. |
| `-EnvFile ..\a.env` | Dùng một file cấu hình khác. |
| `-LanIp 192.168.1.50` | Bỏ qua bước tự dò card mạng, dùng thẳng địa chỉ này. Xem mục "IP LAN tự dò sai" ngay dưới. |
| `-AutoStart` | Cho task tự chạy mỗi lần bạn **đăng nhập** Windows (trigger *At log on*). Lần chạy sau không có `-AutoStart` thì trigger bị bỏ — task luôn khớp với lần chạy gần nhất. |
| `-Foreground` | Cách chạy cũ: server gắn vào cửa sổ PowerShell này. Chỉ dùng để gỡ lỗi — **đóng cửa sổ là server dừng**, không để lại dòng lỗi nào. |
| `-TaskName Tên` | Đặt tên khác cho scheduled task (mặc định `BlindLuckPoker-Normal`; chỉ chữ, số và `. _ -`). Khi đó `stop.ps1` cũng phải có `-TaskName Tên`. Muốn chạy **hai bản cùng lúc** thì cần **hai bản checkout** (hai thư mục kit), mỗi bản một `-TaskName` và một cổng — hai lần chạy từ cùng một thư mục dùng chung `normal.pid` và log nên bản thứ hai bị từ chối. Hai bản cũng phải dùng **hai database khác nhau** (`DATABASE_URL` khác nhau): mỗi lần khởi động, server xoá bảng `ledger_keys`, nên hai server cùng một database có thể làm một lần ghi tiền bị cộng hai lần. |

Log của server nằm ở `normal.log` và `normal.err.log` cạnh script. Cảnh báo và lỗi của chính cửa sổ
PowerShell ẩn (trước khi `node` chạy — ví dụ không tìm thấy `node`, `.env` hỏng, chưa có mạng) nằm ở
`normal.serve.log`; `run.ps1` in lại nội dung file này khi khởi động.

Mỗi task thuộc về **một thư mục kit**: `run.ps1` chỉ ghi đè, và `stop.ps1` chỉ dừng hay gỡ, task nào có
lệnh chạy đúng `run.ps1 -Serve` ở thư mục của chính nó. Gặp một task cùng tên của chương trình khác
(hoặc của bản checkout khác), cả hai script từ chối và không động vào nó.

**Server chạy tách nền như thế nào.** Trước đây server gắn vào cửa sổ PowerShell đã gọi `run.ps1`:
cửa sổ đó (hoặc phiên chứa nó) đóng là server chết theo, im lặng. Nay `run.ps1` đăng ký một
scheduled task tên `BlindLuckPoker-Normal` rồi chạy nó:

- task chạy dưới **tài khoản Windows của bạn**, chỉ khi bạn đang đăng nhập, **không cần quyền
  admin**, không lưu mật khẩu, không giới hạn thời gian chạy, vẫn chạy khi máy dùng pin;
- lệnh của task là chính `run.ps1` với tham số nội bộ `-Serve`, trong một cửa sổ PowerShell ẩn (lúc
  khởi động có thể thấy một cửa sổ đen nháy lên rồi biến mất — đó là nó). `-Serve` đọc lại `.env`,
  chạy `node dist/main.js` và ghi pid vào `normal.pid`;
- trong định nghĩa task chỉ có đường dẫn (và cổng/IP nếu bạn truyền `-Port`/`-LanIp`), **không có
  mật khẩu hay khoá phiên nào** — chúng vẫn chỉ nằm trong `.env`;
- vì vậy **đóng cửa sổ PowerShell, server vẫn chạy**. Đăng xuất (hoặc tắt máy) thì server dừng; muốn
  nó tự chạy lại khi đăng nhập thì dùng `-AutoStart`.

Xem task: mở **Task Scheduler** (`taskschd.msc`) → **Task Scheduler Library** → `BlindLuckPoker-Normal`
(cột *Status* là *Running* khi server đang chạy, *Last Run Result* là mã thoát lần trước), hoặc:

```powershell
Get-ScheduledTask BlindLuckPoker-Normal | Select-Object TaskName, State
(Get-ScheduledTask BlindLuckPoker-Normal).Actions   # lệnh task chạy — chỉ có đường dẫn
```

Lưu ý: biến môi trường bạn tự đặt trong cửa sổ PowerShell (`$env:...`) **không** theo sang server nữa
— server chạy trong một tiến trình mới do Task Scheduler mở. Mọi cấu hình phải nằm trong `.env`.
Dừng server bằng `.\stop.ps1` (mục 7).

**IP LAN tự dò sai?** `run.ps1` chọn card mạng theo `InterfaceMetric` thấp nhất trong các card đang
`Up` — đúng ý Windows trên máy bình thường, nhưng máy có Hyper-V (WSL bật tính năng ảo hoá), VPN, hay
VirtualBox host-only network đôi khi có một card ảo với metric thấp hơn card Wi-Fi/Ethernet thật. Nếu
IP script in ra không giống dải mạng nhà bạn (ví dụ `172.x` hay `192.168.56.x` trong khi router nhà
dùng `192.168.1.x`), tìm địa chỉ đúng bằng:

```powershell
ipconfig
# hoặc, đầy đủ hơn:
Get-NetIPAddress -AddressFamily IPv4 | Select-Object InterfaceAlias, IPAddress
```

rồi chạy lại với `-LanIp`, ví dụ `.\run.ps1 -LanIp 192.168.1.10`.

---

## 6. Mở tường lửa để máy khác vào được

Lần đầu chạy, Windows Defender Firewall thường hỏi có cho phép `node.exe` không — chọn
**Private networks** rồi **Allow access**. Nếu lỡ bấm nhầm, hoặc không thấy hộp thoại nào, mở
PowerShell **với quyền Administrator** và chạy một lần:

```powershell
New-NetFirewallRule -DisplayName "Blind Luck Poker Normal" -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -Action Allow
```

Chỉ mở ở profile `Private`. **Đừng** mở cổng này ra Internet: không có HTTPS, mật khẩu người chơi sẽ
đi qua mạng ở dạng rõ.

Sau đó, các máy khác mở `http://<IP-LAN>:8080` — đúng địa chỉ mà `run.ps1` đã in ra. Không dùng
`localhost` từ máy khác.

---

## 7. Dừng server ⚠️

```powershell
.\stop.ps1
```

**Đây là tắt cứng.** Bản Normal chạy trên Windows không có cách dừng êm: nó dừng êm khi nhận
SIGTERM (trong Docker), còn Windows không gửi được tín hiệu đó tới một tiến trình chạy nền, và bản
Normal cũng không có `--stop` như bản Lite.

Hậu quả cụ thể: **mọi chồng đang nằm trên bàn — buy-in Hold'em và cả hạn mức bàn Blind (tới 250.000
mỗi ghế ở mức cược 50.000) — cùng pot cộng dồn của Blind B sẽ mất**. Số dư đã ghi vào database thì
luôn an toàn.

Vì vậy, quy tắc vận hành: **kết thúc hết các ván đang chơi và bảo mọi người rời phòng trước khi chạy
`stop.ps1`** — rời phòng là lúc chồng trên bàn về lại số dư. Kiểm `http://localhost:8080/health` báo
`"rooms":0` (phòng trống tự đóng sau khoảng một phút) rồi mới dừng.

`stop.ps1` đọc pid trong `normal.pid`, kiểm tra pid đó đúng là một tiến trình `node` đang chạy
`dist/main.js` (Windows hay cấp lại pid cũ cho chương trình khác, kể cả một `node` khác — script từ
chối giết nhầm), rồi `Stop-Process -Force` và xoá
file pid. Sau đó, nếu scheduled task `BlindLuckPoker-Normal` vẫn đang chạy, nó dừng luôn task (dừng
task thôi thì không đủ: Task Scheduler chỉ tắt cửa sổ PowerShell ẩn, còn `node` vẫn sống — vì vậy
`node` luôn bị tắt trước). Task **vẫn được giữ lại** để lần `run.ps1` sau dùng tiếp.

Gỡ hẳn task (không dùng bộ kit nữa, hoặc bỏ `-AutoStart` cho chắc):

```powershell
.\stop.ps1 -Remove
```

`stop.ps1` vẫn là **tắt cứng** như mô tả ở trên, dù server chạy bằng task hay `-Foreground` — luôn
đóng hết phòng trước (`/health` báo `"rooms":0`).

---

## 8. Tuỳ chọn: cho người ngoài mạng LAN vào bằng Cloudflare Tunnel

Muốn một người bạn ở xa vào chơi mà không mở cổng router, dùng
[`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
(miễn phí, không cần domain). Mở một cửa sổ PowerShell **thứ hai**, để server vẫn chạy:

```powershell
cloudflared tunnel --url http://localhost:8080
```

`cloudflared` in ra một URL dạng `https://random-words-1234.trycloudflare.com`. Có URL đó rồi thì
**dừng server, sửa ba dòng trong `.env`, chạy lại**:

```ini
ALLOWED_ORIGINS=https://random-words-1234.trycloudflare.com
COOKIE_SECURE=true
TRUST_PROXY=loopback
```

Vì sao ba dòng:

- `ALLOWED_ORIGINS` — server chỉ nhận API và WebSocket từ origin nó biết; bây giờ origin là URL tunnel.
- `COOKIE_SECURE=true` — đã có HTTPS thật, cookie phiên nên được đánh dấu `Secure`.
- `TRUST_PROXY=loopback` — `cloudflared` chạy ngay trên máy này và nối vào qua `127.0.0.1`, nên
  chỉ tin `X-Forwarded-For` từ loopback. **Đừng** đặt `TRUST_PROXY=true`: server từ chối giá trị đó,
  vì tin mọi hop nghĩa là để client tự khai địa chỉ IP và mọi giới hạn theo IP thành vô nghĩa.

URL của tunnel miễn phí đổi mỗi lần chạy `cloudflared`, nên mỗi lần lại phải sửa `ALLOWED_ORIGINS`.
Đóng `cloudflared` là URL biến mất.

Lưu ý: `PORT` vẫn là `8080` (đó là cổng `cloudflared` nối vào) trong khi origin ở trên là cổng `443` —
`run.ps1` không coi đây là lỗi khi có `https://` trong `ALLOWED_ORIGINS` hoặc `TRUST_PROXY` khác
`false`, vì đó chính là dấu hiệu có proxy/tunnel đứng trước. Việc **cổng phải khớp** ở mục 9 chỉ áp
dụng cho trường hợp chạy LAN trực tiếp, không có proxy.

---

## 9. Sự cố thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| `[error] Thiếu ...\dist\main.js — chạy 'pnpm build:normal'` | Chưa build, hoặc build lỗi. Về thư mục gốc repo chạy lại `pnpm build:normal` và đọc kỹ lỗi ở đó. |
| `[error] ... vẫn còn giá trị mẫu CHANGE_ME` | Bạn chép `.env.example` nhưng chưa điền `DATABASE_URL` và/hoặc `SESSION_SECRET`. Xem mục 4. |
| `[error] SESSION_SECRET dài N ký tự, cần ít nhất 32` | Dùng lệnh sinh chuỗi ngẫu nhiên ở mục 4. |
| `[error] Không thấy file cấu hình ...\.env` | Chưa `Copy-Item .env.example .env`, hoặc bạn đang đứng ở sai thư mục. |
| `[error] migrate-cli thoát với mã 1` kèm `ECONNREFUSED` / `ETIMEDOUT` | Database không trả lời. Neon vừa ngủ dậy — **chạy lại lệnh một lần nữa**. Nếu vẫn lỗi: kiểm tra `DATABASE_URL` có đủ đuôi `?sslmode=verify-full`, và máy có Internet. |
| `[error] ... DATABASE_URL is not a valid URL` | Mật khẩu chứa ký tự `/ ? # @` chưa được percent-encode. Ở Neon, bấm **Reset password** để lấy mật khẩu mới. |
| `[error] Server thoát ngay khi khởi động` kèm `EADDRINUSE` | Cổng 8080 đang bị chương trình khác chiếm. Tìm bằng `netstat -ano \| findstr :8080`, rồi tắt chương trình đó, hoặc chạy `.\run.ps1 -Port 9090` **và** sửa cổng trong `ALLOWED_ORIGINS`. |
| `[error] ALLOWED_ORIGINS chưa được đặt` | Điền `ALLOWED_ORIGINS` trong `.env` — xem mẫu ở `.env.example`. |
| `[error] ALLOWED_ORIGINS có origin không hợp lệ` | Một origin không đúng dạng `http(s)://host:port` — thường là dấu `/` thừa ở cuối (dán từ thanh địa chỉ trình duyệt) hoặc có thêm đường dẫn. Sửa lại, không path, không dấu `/` cuối. |
| `[error] ALLOWED_ORIGINS không có origin nào ở cổng N` | Chỉ xảy ra ở chạy LAN trực tiếp (không proxy): cổng hiệu lực (mặc định hoặc `-Port`) không khớp origin nào trong `ALLOWED_ORIGINS`. Sửa `ALLOWED_ORIGINS` cho khớp, hoặc chạy `-Port` đúng cổng đã có trong đó. Chạy sau Cloudflare Tunnel (mục 8) không gặp lỗi này — `https://` hoặc `TRUST_PROXY` khác `false` bỏ qua kiểm tra. |
| `[warn] PUBLIC_DIR=... không có index.html` | Giao diện chưa được build. `pnpm build:normal` ở thư mục gốc repo. Server vẫn chạy nhưng mở trình duyệt chỉ thấy lỗi. |
| `[warn] Không xác định được địa chỉ IPv4 LAN` | Máy không có card mạng nào đang hoạt động, hoặc chỉ có địa chỉ `169.254.*` (Wi-Fi/LAN chưa nhận được IP). Nối mạng lại rồi chạy lại; hoặc điền tay IP vào `ALLOWED_ORIGINS` thay cho `<IP-LAN>`, hoặc dùng `-LanIp`. |
| IP LAN script in ra không giống dải mạng thật (ví dụ `172.x`, `192.168.56.x`) | Máy có card ảo (Hyper-V/WSL/VPN/VirtualBox) với metric thấp hơn card thật. Xem mục 5 ("IP LAN tự dò sai?") và dùng `-LanIp`. |
| `[error] Đã có một server đang chạy (pid N)` | Lần chạy trước chưa dừng. `.\stop.ps1` rồi chạy lại. |
| `[error] Scheduled task 'BlindLuckPoker-Normal' đang chạy` | Server đã chạy tách nền từ trước (có thể `normal.pid` đã bị xoá). `.\stop.ps1` — nó tìm được `node` của task kể cả khi thiếu `normal.pid` — rồi chạy lại. |
| `[error] Cổng 8080 đã có một server khác trả lời` | Một server khác (bản khác của repo, một cửa sổ `-Foreground`, …) đang giữ cổng. Tìm nó bằng `Get-NetTCPConnection -LocalPort 8080 -State Listen` (cột `OwningProcess` là pid), hoặc chạy ở `-Port` khác. |
| `[error] Không đăng ký được scheduled task` | Máy bị chính sách công ty chặn Task Scheduler, hoặc dịch vụ Task Scheduler tắt. Chạy `.\run.ps1 -Foreground` và **để cửa sổ đó mở** suốt buổi chơi. |
| `[error] Đã có một scheduled task tên '...' nhưng nó không chạy ...run.ps1 -Serve` | Tên đó đang được một task khác dùng (chương trình khác, hoặc bộ kit ở thư mục khác). Script không ghi đè. Chạy lại với `-TaskName <tên khác>` (và `stop.ps1 -TaskName <tên đó>`). |
| Server tắt khi đăng xuất Windows | Đúng thiết kế: task chạy trong phiên đăng nhập của bạn. Đăng nhập lại rồi `.\run.ps1`, hoặc chạy một lần `.\run.ps1 -AutoStart` để lần sau tự chạy. |
| Máy khác không vào được | Kiểm tra theo thứ tự: tường lửa (mục 6); `HOST=0.0.0.0` trong `.env`; hai máy cùng một mạng; dùng đúng IP script đã in, không phải `localhost`. |
| Vào được trang nhưng đăng nhập xong lại bị đăng xuất | `COOKIE_SECURE` đang là `true` mà bạn đang dùng `http://`. Đặt lại `COOKIE_SECURE=false` cho mạng LAN. |
| Trang trắng, hoặc giao diện cũ | `Ctrl` + `F5` để tải lại bỏ cache. Vẫn trắng thì xem `normal.err.log`. |
| Task có chạy (hoặc tự chạy khi đăng nhập) mà server không lên | Xem `normal.serve.log` cạnh script — lỗi của cửa sổ PowerShell ẩn trước khi `node` chạy nằm ở đó — rồi `normal.err.log`. |
| Không biết server còn sống không | Mở `http://localhost:8080/health` — trả về JSON là bình thường. Hoặc xem cuối `normal.log`. |
| Người chơi mất stack sau khi dừng server | Đúng như mô tả ở mục 7. Số dư trong database không bị ảnh hưởng. |

---

## 9b. Tài khoản test có đầy đủ tủ đồ

Để kiểm tra tủ đồ, mặc đồ và chân dung trên ghế mà không phải cày 40 món, cấp toàn bộ catalogue
cho một tài khoản đã đăng ký (chỉ ghi vào `inventory`, không đụng tới điểm):

```powershell
$env:DATABASE_URL = ((Get-Content .env) -match '^DATABASE_URL=' | Select-Object -First 1) -replace '^DATABASE_URL=', ''
node ..\..\apps\normal-server\dist\grant-wardrobe-cli.js neon.test@example.com
```

Thêm `--dry-run` để chỉ xem sẽ cấp gì. Chạy lại lần nữa không cấp trùng. Sau khi đổi catalogue
(thêm món mới) chạy lại để tài khoản test nhận đủ. Mỗi món cấp kiểu này mang nguồn `dev-grant`
để phân biệt với món kiếm được thật.

---

## 9c. Đổi quà điểm danh theo tháng

Quà vật phẩm của điểm danh (ngày 7, 14, 21, 28 của chuỗi) nằm trong `apps/normal-server/data/daily-gifts.json`: phần
`default` là quà của mọi tháng, phần `months` ghi đè từng ngày cho một tháng `YYYY-MM`. Ví dụ, tặng lại "Khung vàng" vào
ngày 28 tháng 05/2027:

```json
"2027-05": { "28": { "fixed": ["badge_monthly", "title_devoted", "frame_gold"] } }
```

Danh sách `fixed` của một tháng là danh sách **đầy đủ**: muốn giữ "Huy hiệu tháng" và "Chuyên cần" thì phải ghi lại cả
hai.

1. Sửa file ở bản checkout chính (làm trên một nhánh rồi gộp như mọi thay đổi khác).
2. Kiểm tra: `pnpm --filter @bp/normal-server exec vitest run src/economy/daily-gifts.test.ts`. Test đọc đúng file này
   cùng catalogue thật và chỉ ra chỗ sai.
3. Đợi `/health` báo `"rooms":0`, rồi chạy `.\stop.ps1` và `.\run.ps1 -NoMigrate`. Nếu chỉ sửa file này thì không cần
   `pnpm build:normal` (server đọc thư mục `data/` lúc khởi động), và không cần migration.
4. Nếu file sai mà bạn vẫn chạy `run.ps1`, server từ chối khởi động: nó dừng ngay và `normal.err.log` ghi
   `invalid daily gift schedule …: …`. Sửa file rồi chạy lại.

Chi tiết (tiếng Anh): `docs/normal-server.md`, mục "Changing the daily gifts".

---

## 9d. Trao quyền quản trị (GM)

Quản trị viên (GM) xem được mọi người chơi và mọi phòng, cộng/trừ điểm, cấp món, khóa tài khoản và đóng phòng ở màn
"Quản trị" (Cài đặt, hàng "Quản trị"). GM đầu tiên phải do bạn trao ngay trên máy chủ, vì chỉ GM mới trao quyền cho người
khác được. Tài khoản phải **đã đăng ký** trên trang web trước:

```powershell
$env:DATABASE_URL = ((Get-Content .env) -match '^DATABASE_URL=' | Select-Object -First 1) -replace '^DATABASE_URL=', ''
node ..\..\apps\normal-server\dist\grant-gm-cli.js ten@example.com
```

Chạy lại lần nữa không đổi gì. Thêm `--revoke` để thu quyền (không thu được quyền của GM cuối cùng). Mỗi lần trao hay thu
đều vào nhật ký với lý do `cli`. Người đó cần tải lại trang (F5) hoặc đăng nhập lại để thấy hàng "Quản trị". GM dùng chung
mật khẩu với tài khoản chơi, nên đặt cho tài khoản ấy một mật khẩu dài và không dùng ở nơi khác.

Bản cập nhật có Plan 25 thêm migration `0004_gm`, nên lần chạy `run.ps1` đầu tiên sau khi cập nhật phải **bỏ** `-NoMigrate`
(migration chỉ thêm cột và bảng, không đụng dữ liệu cũ).

---

## 10. Giới hạn

- **Không có HTTPS.** Mật khẩu đi qua mạng ở dạng rõ. Chỉ dùng trong mạng bạn tin được.
- **Dừng là tắt cứng** (mục 7).
- **Một tiến trình duy nhất.** Không nhân bản, không tự khởi động lại khi crash. Chỉ tự chạy khi
  **đăng nhập** Windows nếu bạn dùng `-AutoStart` (không phải khi bật máy mà chưa ai đăng nhập), và
  dừng khi đăng xuất. Máy sập là mọi người mất kết nối; dữ liệu vẫn nằm nguyên trong Postgres.
- **Neon free ngủ** sau vài phút rảnh, và có hạn mức dung lượng/băng thông. Đủ cho một buổi test,
  không đủ cho vận hành lâu dài.
- Muốn chạy thật thì đọc [`docs/deployment-normal.md`](../../docs/deployment-normal.md).
