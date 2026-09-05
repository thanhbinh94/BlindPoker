# Bind Poker Lite

Một file `bind-poker-lite.exe` duy nhất. Không cần cài Node.js, không cần database server, không
cần Internet. Chạy trên một máy Windows trong mạng LAN, mọi người trong nhà/quán mở trình duyệt là
chơi được.

- **Server + giao diện web + database** đều nằm trong file exe.
- Dữ liệu lưu vào một file SQLite duy nhất đặt cạnh exe.
- Chỉ cần Windows 10/11 hoặc Windows Server, 64-bit.

---

## 1. Chạy lần đầu

1. Chép `bind-poker-lite.exe` vào một thư mục có quyền ghi — ví dụ `D:\bind-poker\`.
   **Không** để trong `C:\Program Files\` (Windows chặn ghi file dữ liệu ở đó).
2. Nhấn đúp vào `bind-poker-lite.exe`, hoặc mở PowerShell và chạy:

   ```powershell
   cd D:\bind-poker
   .\bind-poker-lite.exe
   ```

3. Cửa sổ sẽ in ra một dòng dạng `Listening on http://0.0.0.0:8080`. Giữ cửa sổ này mở.
4. Trên chính máy đó, mở trình duyệt vào `http://localhost:8080`.
5. Các máy khác trong cùng mạng mở `http://<địa-chỉ-IP-của-máy-chủ>:8080`.
   Xem IP bằng lệnh `ipconfig` (dòng `IPv4 Address`, ví dụ `192.168.1.10`).

Muốn kiểm tra nhanh server có sống không: `.\bind-poker-lite.exe --smoke` — lệnh này khởi động
toàn bộ server trên một cổng tạm (database vào thư mục tạm, **không** đụng tới `bind-poker.sqlite`
thật trừ khi bạn đặt sẵn `SQLITE_PATH`), tự gọi `/health`, in kết quả JSON rồi thoát. Mã thoát `0`
là tốt. Với server **đang chạy**, dùng `.\bind-poker-lite.exe --status`.

---

## 1b. Dừng server cho đúng cách ⚠️

Đọc mục này trước khi tắt máy, cập nhật hay khởi động lại. **Tắt êm** nghĩa là server huỷ các ván
đang chơi, **hoàn lại toàn bộ điểm cược và stack Hold'em** về số dư, rồi mới thoát. **Tắt cứng** là
giết tiến trình ngay lập tức: **stack Hold'em đang trên bàn và pot cộng dồn của Blind B sẽ mất**.
Số dư đã ghi vào database thì luôn an toàn — chỉ phần điểm đang "nằm trên bàn" là mất.

| Cách | Kết quả |
| --- | --- |
| `bind-poker-lite.exe --stop` (chạy ở đúng thư mục chứa exe) | ✅ **Tắt êm.** Cách duy nhất đúng khi server chạy nền |
| `Ctrl` + `C` trong cửa sổ console đang chạy server | ✅ Tắt êm |
| `Ctrl` + `Break` trong cửa sổ đó | ✅ Tắt êm |
| NSSM (`nssm stop BindPokerLite`) | ✅ Tắt êm — NSSM gửi Ctrl+C |
| **Bấm nút X đóng cửa sổ** | ❌ **Tắt cứng.** Windows chỉ cho vài giây rồi giết tiến trình |
| `taskkill /F`, `taskkill` không cờ | ❌ Tắt cứng |
| `schtasks /End /TN "BindPokerLite"` | ❌ Tắt cứng |
| `sc.exe stop BindPokerLite` | ❌ Tắt cứng (exe không nói giao thức SCM) |
| Tắt/khởi động lại máy khi server đang chạy | ❌ Tắt cứng |

```powershell
cd D:\bind-poker
.\bind-poker-lite.exe --stop      # in "stopped Bind Poker Lite gracefully (pid …)"; mã thoát 0
.\bind-poker-lite.exe --status    # in JSON /health của tiến trình đang chạy
```

`--stop` hoạt động thế nào: khi khởi động, server ghi một file nhỏ `bind-poker.run.json` **cạnh
file dữ liệu** (`pid`, cổng, địa chỉ, và một mã ngẫu nhiên 32 byte). `--stop` đọc file đó, gửi một
request tới chính tiến trình ấy qua `localhost`, rồi chờ tối đa 15 giây cho tới khi pid biến mất.
Request này **chỉ được chấp nhận từ chính máy chủ** (địa chỉ loopback) và phải kèm đúng mã trong
file — máy khác trong LAN không tắt được server. File tự xoá khi server thoát êm; nếu bạn thấy nó
còn đó mà server đã chết thì đó là dấu vết của một lần tắt cứng, `--stop` sẽ báo và dọn giúp.

**`--stop` cần `HOST` là `0.0.0.0` (mặc định) hoặc `127.0.0.1`.** Nếu bạn đổi `HOST` thành một IP
LAN cụ thể thì server không còn lắng nghe trên máy nội bộ, và lệnh này sẽ bị từ chối — khi đó
chỉ còn `Ctrl`+`C` trong cửa sổ console (hoặc NSSM) là tắt êm được.

Chạy hai bản exe cùng một thư mục dữ liệu là không được: bản thứ hai sẽ báo "another instance is
already running" và thoát, để không giật mất `bind-poker.run.json` của bản đang chạy. `--smoke`
cũng không bao giờ đụng tới file đó, nên kiểm tra nhanh lúc server đang chạy là an toàn. Bản mới
chỉ dừng lại khi **hỏi đúng địa chỉ trong file và nhận được câu trả lời của một server Lite**; nếu
file chỉ là dấu vết của một lần tắt cứng (không ai trả lời ở đó nữa) thì server ghi một dòng
`overwriting a stale bind-poker.run.json` rồi chạy tiếp — bạn không bị chặn oan vì Windows tình cờ
cấp lại pid cũ cho một chương trình khác.

Quy tắc vận hành: **luôn chạy `--stop` trước khi cập nhật, khởi động lại hoặc tắt máy.**

---

## 2. Tuỳ chỉnh bằng file `.env`

Đổi tên `.env.example` thành `.env`, đặt **cạnh exe**, sửa rồi khởi động lại. Mọi biến đều tuỳ
chọn; biến môi trường của hệ thống được ưu tiên hơn file `.env`.

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `8080` | Cổng HTTP. Đặt `0` để hệ điều hành tự chọn cổng trống. |
| `HOST` | `0.0.0.0` | `0.0.0.0` mở cho cả mạng LAN; `127.0.0.1` chỉ cho phép máy chủ. |
| `SQLITE_PATH` | `./bind-poker.sqlite` | Vị trí file dữ liệu, tính từ thư mục chứa exe. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` hoặc `error`. |
| `ECONOMY_TIMEZONE` | `Asia/Ho_Chi_Minh` | Múi giờ (IANA) quyết định lúc nào sang "ngày mới" để nhận thưởng hằng ngày. |
| `LITE_HAND_LOG` | `false` | `true` để ghi lịch sử từng ván vào database. File dữ liệu sẽ phình nhanh hơn. |
| `RECONNECT_WINDOW_SEC` | `90` | Giây chờ một người rớt mạng giữa ván trước khi ghế bị bỏ bài thay. |
| `ALLOWED_ORIGINS` | *(trống)* | Danh sách origin được phép mở WebSocket, cách nhau bằng dấu phẩy. Bỏ trống = chỉ chấp nhận trang đến từ chính máy chủ này. Chỉ cần khi đặt sau reverse proxy. |
| `PUBLIC_DIR` | *(trống)* | Thư mục giao diện web thay thế bản đã nhúng trong exe. |

Giá trị sai (ví dụ `PORT=abc`) làm server dừng ngay khi khởi động kèm thông báo lý do.

---

## 3. Dữ liệu

Toàn bộ tài khoản, số dư và lịch sử nằm trong **`bind-poker.sqlite`** đặt cạnh exe (cùng hai file
phụ `-wal` và `-shm` mà SQLite tự tạo).

- **Sao lưu:** tắt server, chép cả ba file đi nơi khác. Chép khi server đang chạy có thể ra bản
  không nhất quán.
- **Xoá sạch để chơi lại từ đầu:** tắt server, xoá ba file đó, chạy lại — server tự tạo database mới.
- Thư mục chứa exe phải có quyền ghi cho tài khoản đang chạy nó.

---

## 4. Mở cổng trên tường lửa

Lần chạy đầu, Windows Defender Firewall thường hỏi có cho phép không — chọn **Private networks**
rồi **Allow access**. Nếu lỡ bấm nhầm, mở PowerShell **với quyền Administrator** và chạy:

```powershell
New-NetFirewallRule -DisplayName "Bind Poker Lite" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

Chỉ mở ở profile `Private`. Đừng mở cổng này ra Internet: xem mục Giới hạn ở cuối.

---

## 5. Chạy nền như một dịch vụ

Để server tự chạy khi máy khởi động, không cần ai đăng nhập, chọn **một** trong hai cách.

**Cách A — Task Scheduler (đơn giản hơn, khuyến nghị):**

```powershell
schtasks /Create /TN "BindPokerLite" /TR "D:\bind-poker\bind-poker-lite.exe" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks /Run /TN "BindPokerLite"      # chạy ngay, không cần khởi động lại máy
```

**Dừng thì dùng `--stop`, đừng dùng `schtasks /End`** (`/End` là tắt cứng, mất stack đang chơi):

```powershell
D:\bind-poker\bind-poker-lite.exe --stop
```

**Cách B — NSSM (nếu bắt buộc phải là một Windows Service):**

```powershell
nssm install BindPokerLite D:\bind-poker\bind-poker-lite.exe
nssm set BindPokerLite AppDirectory D:\bind-poker
nssm set BindPokerLite AppStopMethodConsole 15000    # gửi Ctrl+C và chờ 15 giây → tắt êm
nssm start BindPokerLite
nssm stop BindPokerLite
```

NSSM là công cụ bọc dịch vụ **được hỗ trợ** cho bản Lite, vì nó gửi Ctrl+C khi dừng — đúng thứ
server hiểu. Đừng dùng `sc.exe create` trực tiếp: exe này không nói "ngôn ngữ" Service Control
Manager, nên Windows vừa báo dịch vụ "không phản hồi kịp" lúc khởi động, vừa **giết cứng** tiến
trình khi `sc.exe stop` — mất stack Hold'em và pot cộng dồn.

Ở cả hai cách, tài khoản chạy (mặc định `SYSTEM`) phải có quyền ghi vào thư mục chứa exe.

---

## 6. Nâng cấp

1. Dừng server bằng `bind-poker-lite.exe --stop` (mục 1b). Đừng đóng cửa sổ hay `taskkill`.
2. Ghi đè `bind-poker-lite.exe` bằng bản mới. **Giữ nguyên** `bind-poker.sqlite` và `.env`.
3. Chạy lại. Database được nâng cấp cấu trúc tự động khi khởi động.

Nên sao lưu file `.sqlite` trước khi nâng cấp — hạ cấp về bản cũ thì không có đường tự động.

---

## 7. Sự cố thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| `EADDRINUSE` / server thoát ngay khi khởi động | Cổng 8080 đang bị chương trình khác chiếm. Tìm bằng `netstat -ano \| findstr :8080`, rồi tắt chương trình đó hoặc đặt `PORT=8081` trong `.env`. |
| Màn hình xanh **"Windows protected your PC"** (SmartScreen) | Bản phát hành chưa ký số nên Windows cảnh báo "unknown publisher". Bấm **More info** → **Run anyway**. |
| `SQLITE_CANTOPEN`, `EACCES`, `EPERM` | Thư mục chứa exe không cho ghi. Chuyển exe sang thư mục khác (ví dụ `D:\bind-poker\`) hoặc trỏ `SQLITE_PATH` tới nơi có quyền ghi. |
| Dòng `Warning: Currently the require() provided to the main script...` hoặc `ExperimentalWarning: ...` | Vô hại, bỏ qua. Đó là thông báo của Node.js về cách đóng gói một-file và về tính năng đang thử nghiệm mà server sử dụng; chúng luôn xuất hiện và không phải lỗi. |
| Máy khác không vào được | Kiểm tra theo thứ tự: server có đang chạy không; `HOST` không phải `127.0.0.1`; tường lửa đã mở cổng (mục 4); hai máy cùng một mạng; dùng đúng IP chứ không phải `localhost`. |
| Trình duyệt hiện trang trắng | Ép tải lại bỏ cache bằng `Ctrl` + `F5`. Nếu vẫn trắng, xem log trong cửa sổ server. |
| Không rõ server sống hay chết | Chạy `.\bind-poker-lite.exe --status`, hoặc mở `http://localhost:8080/health` — trả về JSON `{"status":"ok",...}` là bình thường. |
| `--stop` báo `no running instance found` | Không có `bind-poker.run.json` cạnh file dữ liệu: server không chạy, hoặc bạn đang chạy lệnh ở sai thư mục (`cd` vào thư mục chứa exe rồi thử lại). |
| Sau một lần tắt cứng, người chơi mất stack đang trên bàn | Đúng như mô tả ở mục 1b — dùng `--stop` từ lần sau. Số dư trong database không bị ảnh hưởng. |

---

## 8. Giới hạn

- **Chỉ chạy trên Windows 64-bit.** Không có bản macOS hay Linux.
- **Một tiến trình duy nhất**, không nhân bản được. Nó phục vụ tốt quy mô một mạng LAN — vài chục
  người chơi — chứ không phải quy mô Internet.
- **Không có HTTPS.** Kết nối là HTTP thuần, phù hợp với mạng nội bộ tin cậy. Muốn mở ra ngoài
  Internet thì phải đặt sau một reverse proxy có TLS (Caddy, nginx, IIS...) và khai báo địa chỉ
  công khai vào `ALLOWED_ORIGINS`.
- **Không có tài khoản/mật khẩu.** Ai vào được địa chỉ là chơi được — đúng như thiết kế cho mạng LAN.
- Tắt máy chủ là mọi người mất kết nối; dữ liệu thì vẫn còn nguyên trong file SQLite.

---

## English summary

Bind Poker Lite is a single Windows x64 executable containing the server, the web UI and its
database. There is nothing to install.

- **Run it:** put `bind-poker-lite.exe` in a writable folder (not `C:\Program Files`), double-click
  it or run it from PowerShell, then open `http://localhost:8080` on the same machine and
  `http://<server-ip>:8080` from any other machine on the LAN (`ipconfig` shows the IP).
  `bind-poker-lite.exe --smoke` boots everything on a throwaway port and a throwaway database,
  prints the `/health` JSON and exits 0 — a quick way to verify a copy works.
- **Stop it — this matters (section 1b):** only `bind-poker-lite.exe --stop`, `Ctrl`+`C` /
  `Ctrl`+`Break` in the server's own console, and a service wrapper that sends Ctrl+C (NSSM with
  `AppStopMethodConsole`) stop gracefully — cancelling live hands and **refunding every wagered
  point and Hold'em stack**. Closing the console window, `taskkill`, `schtasks /End` and `sc stop`
  are hard kills: in-flight Hold'em stacks and Blind carry-over pots are lost. Recorded balances are
  safe either way. `--stop` reads `bind-poker.run.json` (written next to the data file at startup,
  holding the pid, port and a 32-byte token), posts the shutdown over the loopback — the endpoint
  refuses anything that is not a local caller with that token — and waits up to 15 s for the process
  to exit. It therefore needs `HOST` to be `0.0.0.0` (the default) or `127.0.0.1`: a server bound to
  one specific LAN address is not listening locally and can only be stopped with Ctrl+C or NSSM.
  A second instance on the same data directory refuses to start rather than take the run file over —
  but only after the recorded address answers as Lite, so a stale file left by a hard kill (whose pid
  the OS has since reused) is overwritten instead of blocking you. `--smoke` never writes one.
  `bind-poker-lite.exe --status` prints the running instance's `/health`.
- **Configure it:** rename `.env.example` to `.env` next to the exe. Keys: `PORT` (8080), `HOST`
  (0.0.0.0), `SQLITE_PATH` (./bind-poker.sqlite), `LOG_LEVEL` (info), `ECONOMY_TIMEZONE`
  (Asia/Ho_Chi_Minh), `LITE_HAND_LOG` (false), `RECONNECT_WINDOW_SEC` (90), `ALLOWED_ORIGINS`,
  `PUBLIC_DIR`. Environment
  variables win over the file. Restart after editing.
- **Data:** everything lives in `bind-poker.sqlite` beside the exe. Stop the server before copying
  it for a backup; delete it to start over.
- **Firewall:** allow the exe on Private networks when Windows asks, or add a rule for TCP 8080
  (see section 4). Do not expose it to the Internet.
- **Run at boot:** `schtasks /Create /TN "BindPokerLite" /TR "<path>\bind-poker-lite.exe" /SC ONSTART
  /RU SYSTEM /RL HIGHEST /F` and stop it with `--stop` (not `schtasks /End`), or wrap it with NSSM
  and `AppStopMethodConsole` (section 5). The exe is not a native Windows service, so `sc.exe create`
  both reports a start timeout and hard-kills on `sc stop`.
- **Upgrade:** `--stop`, replace the exe, start. Keep the `.sqlite` and `.env` files; schema
  migrations run automatically at startup.
- **Troubleshooting:** port already in use → set `PORT`; SmartScreen "unknown publisher" → More info
  → Run anyway (the build is unsigned); `SQLITE_CANTOPEN`/`EACCES` → the folder is not writable; the
  `Warning: Currently the require() provided to the main script...` and `ExperimentalWarning` lines
  Node prints on every start are harmless.
- **Limits:** Windows x64 only, one process (no clustering), no built-in HTTPS — put a TLS reverse
  proxy in front and list its origin in `ALLOWED_ORIGINS` — and no user accounts.
