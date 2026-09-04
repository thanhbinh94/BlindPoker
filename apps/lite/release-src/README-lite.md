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

3. Cửa sổ sẽ in ra một dòng dạng `Listening on http://0.0.0.0:8080`. Giữ cửa sổ này mở — đóng nó
   là server tắt.
4. Trên chính máy đó, mở trình duyệt vào `http://localhost:8080`.
5. Các máy khác trong cùng mạng mở `http://<địa-chỉ-IP-của-máy-chủ>:8080`.
   Xem IP bằng lệnh `ipconfig` (dòng `IPv4 Address`, ví dụ `192.168.1.10`).

Muốn kiểm tra nhanh server có sống không: `.\bind-poker-lite.exe --smoke` — lệnh này khởi động
toàn bộ server trên một cổng tạm, tự gọi `/health`, in kết quả JSON rồi thoát. Mã thoát `0` là tốt.

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
| `ALLOWED_ORIGINS` | *(trống)* | Danh sách origin được phép gọi API, cách nhau bằng dấu phẩy. Chỉ cần khi đặt sau reverse proxy. |
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
schtasks /End /TN "BindPokerLite"      # dừng
```

**Cách B — Windows Service:**

```powershell
sc.exe create BindPokerLite binPath= "D:\bind-poker\bind-poker-lite.exe" start= auto DisplayName= "Bind Poker Lite"
sc.exe start BindPokerLite
sc.exe stop BindPokerLite
sc.exe delete BindPokerLite
```

Lưu ý dấu cách sau mỗi dấu `=` trong `sc.exe` — thiếu là lệnh báo lỗi. Exe này không nói "ngôn ngữ"
Service Control Manager, nên Windows sẽ báo dịch vụ "không phản hồi kịp" dù server vẫn chạy bình
thường; nếu thấy phiền, dùng Cách A, hoặc bọc exe bằng một công cụ như NSSM.

Ở cả hai cách, tài khoản chạy (mặc định `SYSTEM`) phải có quyền ghi vào thư mục chứa exe.

---

## 6. Nâng cấp

1. Dừng server (đóng cửa sổ, `schtasks /End`, hoặc `sc.exe stop`).
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
| Không rõ server sống hay chết | Mở `http://localhost:8080/health` — trả về JSON `{"status":"ok",...}` là bình thường. |

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
  `bind-poker-lite.exe --smoke` boots everything on a throwaway port, prints the `/health` JSON and
  exits 0 — a quick way to verify a copy works.
- **Configure it:** rename `.env.example` to `.env` next to the exe. Keys: `PORT` (8080), `HOST`
  (0.0.0.0), `SQLITE_PATH` (./bind-poker.sqlite), `LOG_LEVEL` (info), `ECONOMY_TIMEZONE`
  (Asia/Ho_Chi_Minh), `LITE_HAND_LOG` (false), `ALLOWED_ORIGINS`, `PUBLIC_DIR`. Environment
  variables win over the file. Restart after editing.
- **Data:** everything lives in `bind-poker.sqlite` beside the exe. Stop the server before copying
  it for a backup; delete it to start over.
- **Firewall:** allow the exe on Private networks when Windows asks, or add a rule for TCP 8080
  (see section 4). Do not expose it to the Internet.
- **Run at boot:** `schtasks /Create /TN "BindPokerLite" /TR "<path>\bind-poker-lite.exe" /SC ONSTART
  /RU SYSTEM /RL HIGHEST /F`, or `sc.exe create` (section 5). The exe is not a native Windows
  service, so SCM reports a start timeout even though the server is running; Task Scheduler avoids that.
- **Upgrade:** stop, replace the exe, start. Keep the `.sqlite` and `.env` files; schema migrations
  run automatically at startup.
- **Troubleshooting:** port already in use → set `PORT`; SmartScreen "unknown publisher" → More info
  → Run anyway (the build is unsigned); `SQLITE_CANTOPEN`/`EACCES` → the folder is not writable; the
  `Warning: Currently the require() provided to the main script...` and `ExperimentalWarning` lines
  Node prints on every start are harmless.
- **Limits:** Windows x64 only, one process (no clustering), no built-in HTTPS — put a TLS reverse
  proxy in front and list its origin in `ALLOWED_ORIGINS` — and no user accounts.
