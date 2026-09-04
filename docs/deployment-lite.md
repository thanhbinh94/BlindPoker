# Triển khai Bind Poker Lite

Tài liệu này dành cho **người build và người vận hành** bản Lite: từ máy dev có mã nguồn cho tới một
máy Windows trong mạng LAN đang chạy exe. Người dùng cuối chỉ cần `release/lite/README-lite.md` —
bản hướng dẫn ngắn đi kèm exe; tài liệu này bổ sung phần build, sao lưu và bảo mật ở mức vận hành.

Xem thêm: spec §22.4 (build), §22.5 (env), §28.2 (deployment), §23 (security).

---

## 1. Build trên máy dev

Yêu cầu: **Windows x64**, **Node 22** (chính xác dòng 22 — blob SEA chỉ nạp được bởi đúng bản Node
đã tạo ra nó), **pnpm 9**.

```bash
pnpm install
pnpm build:lite          # = pnpm --filter @bp/lite run build  (web → server → exe → smoke)
```

Có thể chạy từng phần khi cần: `pnpm --filter @bp/lite build:web`, `build:server`, `build:exe`.

`scripts/build.mjs` làm ba việc, theo đúng thứ tự đó:

| Bước | Công cụ | Kết quả |
| --- | --- | --- |
| `web` | Vite (`web/vite.config.ts`) | `apps/lite/dist/public/**` — `index.html` + `assets/<tên>-<hash>.<ext>`, `base` tương đối, không source map |
| `server` | esbuild, một file CommonJS | `apps/lite/dist/server.cjs` — mọi thứ trừ built-in của Node (`--external:node:*`) |
| `exe` | Node SEA + postject | `apps/lite/release/lite/bind-poker-lite.exe` |

Chi tiết bước `exe`:

1. Liệt kê `dist/public` thành **`dist/assets.json`** (danh sách đường dẫn đã sắp xếp — chính là
   danh mục server đọc lại lúc chạy để biết trong exe có những file nào).
2. Sinh `dist/sea-config.json` từ `scripts/sea-config.template.json`, nhét `assets.json` **và từng
   file** trong `dist/public` vào mục `assets`.
3. `node --experimental-sea-config dist/sea-config.json` → `dist/sea-prep.blob`.
4. Chép `node.exe` đang chạy thành `bind-poker-lite.exe`, rồi `postject` chèn blob vào.
   postject in `The signature seems corrupted!` — bình thường: chèn section làm hỏng chữ ký
   Authenticode của Microsoft trên bản Node gốc. Ký lại (nếu muốn) là việc **sau** bước này.
5. Chép `README-lite.md` và `.env.example` từ `apps/lite/release-src/` sang cạnh exe.
6. `--smoke`: chạy chính exe vừa tạo với `--smoke`, database vào thư mục tạm, in JSON `/health`.
   Mã thoát khác `0` là build hỏng.

Bản build thử `useCodeCache=true` trước (nhanh khởi động hơn); nếu bước sinh blob hoặc smoke thất
bại thì tự lùi về blob thường thay vì làm hỏng release.

Lúc chạy, server phân biệt hai chế độ bằng `process.getBuiltinModule('node:sea')`:

- **Trong exe** (`sea.isSea()`): đọc `assets.json` rồi lấy từng file bằng `sea.getAsset()`.
- **Khi dev**: đọc thư mục — `PUBLIC_DIR` nếu có, mặc định `dist/public` tính từ thư mục làm việc.
  Không có thư mục đó thì API vẫn chạy, chỉ không có giao diện (log một dòng cảnh báo).

### Kiểm tra sau build

```bash
pnpm --filter @bp/lite test      # footprint + smoke
```

- `dist/server.cjs` không được chứa `pg`, `drizzle`, `argon2`, `react-router`.
- Tổng gzip của JS trong `dist/public` ≤ 250 KB, của CSS ≤ 40 KB.
- `bind-poker-lite.exe` ≤ 120 MB (build hiện tại ~81 MB).

Kiểm tra bằng trình duyệt thật (tuỳ chọn, cần tải Chromium ~150 MB một lần):

```bash
pnpm --filter @bp/lite exec playwright install chromium
pnpm --filter @bp/lite e2e
```

E2E dựng `node dist/server.cjs` trên cổng 8090 với `SQLITE_PATH=:memory:`, chơi trọn một ván Blind
(hai người + một bot), tải lại trang giữa ván, và đối chiếu số dư trong database với phiếu kết quả
trên màn hình. Ảnh chụp màn hình rơi vào `apps/lite/e2e/screenshots/` (không commit).

---

## 2. Nội dung `release/lite/`

| File | Vai trò |
| --- | --- |
| `bind-poker-lite.exe` | Server + giao diện web + engine, một file duy nhất |
| `.env.example` | Mọi biến cấu hình kèm giá trị mặc định; đổi tên thành `.env` để dùng |
| `README-lite.md` | Hướng dẫn cho người vận hành tại chỗ (tiếng Việt, kèm tóm tắt tiếng Anh) |

Database **không** nằm trong đó: `bind-poker.sqlite` được tạo cạnh exe ở lần chạy đầu.

---

## 3. Chép sang máy chủ và chạy

1. Chép cả thư mục `release/lite/` sang máy chủ, vào một thư mục **có quyền ghi**
   (ví dụ `D:\bind-poker\`). Không đặt trong `C:\Program Files\`.
2. (Tuỳ chọn) đổi `.env.example` → `.env` và sửa.
3. Chạy `bind-poker-lite.exe`. Console in `Listening on http://0.0.0.0:8080`.
4. Máy chủ: `http://localhost:8080`. Máy khác trong LAN: `http://<IP-máy-chủ>:8080` (`ipconfig`).
5. Mở firewall nếu Windows chưa hỏi:

   ```powershell
   New-NetFirewallRule -DisplayName "Bind Poker Lite" -Direction Inbound -Protocol TCP `
     -LocalPort 8080 -Action Allow -Profile Private
   ```

   Chỉ profile `Private`.

Kiểm tra sức khoẻ bất cứ lúc nào: `GET /health` trả
`{"status":"ok","uptime":…,"connections":…,"rooms":…,"db":"ok"}`. Trả `503` khi không đọc được
database — đúng thứ để đưa vào giám sát.

---

## 4. Biến môi trường

Đọc theo thứ tự: **biến môi trường của hệ thống** thắng, sau đó tới `.env` **đặt cạnh exe**, cuối
cùng là mặc định. Sửa xong phải khởi động lại. Giá trị sai làm server dừng ngay lúc khởi động kèm
lý do (`PORT must be an integer 0–65535, got abc`).

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `8080` | Cổng HTTP; `0` để hệ điều hành tự chọn |
| `HOST` | `0.0.0.0` | `0.0.0.0` phục vụ cả LAN, `127.0.0.1` chỉ máy chủ |
| `SQLITE_PATH` | `./bind-poker.sqlite` | Đường dẫn file dữ liệu, tính từ thư mục chứa exe; `:memory:` cho test |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `ECONOMY_TIMEZONE` | `Asia/Ho_Chi_Minh` | Múi giờ IANA quyết định mốc "ngày mới" của thưởng hằng ngày |
| `LITE_HAND_LOG` | `false` | `1`/`true`/`yes` để ghi bảng `hand_log`; file dữ liệu phình nhanh hơn |
| `ALLOWED_ORIGINS` | *(trống)* | CSV origin được phép; trống = chỉ cùng host. Chỉ cần khi đứng sau reverse proxy |
| `PUBLIC_DIR` | *(trống)* | Thư mục giao diện thay cho bản nhúng trong exe; tương đối thì tính từ thư mục exe |

---

## 5. Dữ liệu và sao lưu

Toàn bộ tài khoản, số dư, streak, sink và (nếu bật) lịch sử ván nằm trong một file SQLite duy nhất
cạnh exe, kèm hai file phụ `-wal` và `-shm` do chế độ WAL sinh ra.

**Sao lưu — cách chắc chắn nhất:** dừng server, chép cả ba file (`.sqlite`, `.sqlite-wal`,
`.sqlite-shm`) đi nơi khác, chạy lại.

**Sao lưu khi đang chạy:** đừng chép file bằng `copy` — WAL làm bản chép có thể không nhất quán.
Dùng backup online của SQLite, nếu máy có `sqlite3.exe`:

```powershell
sqlite3.exe D:\bind-poker\bind-poker.sqlite ".backup 'D:\backup\bind-poker-2026-09-04.sqlite'"
```

Lệnh này an toàn với server đang ghi và cho ra một file duy nhất, đã gộp WAL.

**Xoá sạch để chơi lại từ đầu:** dừng server, xoá cả ba file, chạy lại — schema được tạo mới.

**Migration:** `PRAGMA user_version` giữ số phiên bản schema; mỗi lần khởi động, server chạy tiếp
những migration còn thiếu trong một transaction. Migration chỉ được thêm, không sửa bản đã phát
hành, nên nâng cấp là một chiều: **hạ cấp về exe cũ không có đường tự động** — hãy sao lưu trước.

---

## 6. Chạy nền

**Task Scheduler (khuyến nghị):**

```powershell
schtasks /Create /TN "BindPokerLite" /TR "D:\bind-poker\bind-poker-lite.exe" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks /Run /TN "BindPokerLite"
schtasks /End /TN "BindPokerLite"
```

**Windows Service:**

```powershell
sc.exe create BindPokerLite binPath= "D:\bind-poker\bind-poker-lite.exe" start= auto DisplayName= "Bind Poker Lite"
sc.exe start BindPokerLite
```

Chú ý dấu cách sau mỗi `=`. Exe không nói giao thức của Service Control Manager nên SCM sẽ báo
"dịch vụ không phản hồi kịp" dù server vẫn chạy — dùng Task Scheduler, hoặc bọc bằng NSSM, nếu
thấy phiền. Tài khoản chạy (mặc định `SYSTEM`) phải có quyền ghi vào thư mục chứa exe.

Dừng bằng `SIGTERM`/`SIGINT` (đóng cửa sổ, `schtasks /End`, `sc.exe stop`) sẽ tắt êm: ván đang
chơi bị huỷ và **hoàn lại điểm**, socket đóng, tối đa 10 giây rồi thoát.

---

## 7. Nâng cấp

1. Sao lưu file `.sqlite` (mục 5).
2. Dừng server.
3. Ghi đè `bind-poker-lite.exe`. **Giữ nguyên** `.env` và các file `.sqlite*`.
4. Chạy lại — migration chạy tự động lúc khởi động.

Ván đang chơi không sống qua lần khởi động lại (spec §32.8): dừng server lúc không ai đang chơi,
hoặc chấp nhận các ván đang dở bị huỷ và hoàn điểm.

---

## 8. Sự cố thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| `EADDRINUSE`, thoát ngay khi khởi động | Cổng đang bị chiếm: `netstat -ano \| findstr :8080`, tắt tiến trình đó hoặc đặt `PORT` khác |
| SmartScreen "Windows protected your PC" | Exe chưa ký số: **More info** → **Run anyway**, hoặc ký release trước khi phát hành |
| `SQLITE_CANTOPEN` / `EACCES` / `EPERM` | Thư mục chứa exe không cho ghi — chuyển đi nơi khác hoặc trỏ `SQLITE_PATH` sang chỗ ghi được |
| Log `no web assets found` | Chạy `dist/server.cjs` ở sai thư mục làm việc: đặt `PUBLIC_DIR`, hoặc chạy từ `apps/lite` |
| `Warning: Currently the require()…`, `ExperimentalWarning` | Vô hại. Cảnh báo của Node về đóng gói một-file; cảnh báo `node:sqlite` đã được lọc riêng |
| Máy khác không vào được | Theo thứ tự: server còn chạy?; `HOST` ≠ `127.0.0.1`?; firewall đã mở?; cùng mạng?; dùng IP chứ không phải `localhost`? |
| Trang trắng sau khi nâng cấp | `Ctrl`+`F5`. `index.html` luôn `no-cache`, chỉ file trong `assets/` (đã gắn hash) mới cache vĩnh viễn |
| Người chơi bị "Phiên chơi đã hết hạn" | Token trong `localStorage` không còn khớp database — thường vì database đã bị xoá/thay. Nhập lại tên mới |

---

## 9. Bảo mật

Lite được thiết kế cho **mạng nội bộ tin cậy**. Những gì có sẵn:

- Header trên mọi phản hồi: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'
  'unsafe-inline'; connect-src 'self' ws: wss:`. Route `/api/*` và `/health` thêm `Cache-Control: no-store`.
- Chống CSRF: mọi `POST`/`PUT`/`PATCH`/`DELETE` phải có `X-Requested-With: bind-poker`. Chỉ
  fetch/XHR đặt được header tuỳ ý, và làm vậy từ origin khác sẽ kích hoạt preflight mà server này
  không trả lời.
- Rate limit: `POST /api/session` giới hạn 10 lần/phút/IP, trả `429` kèm `Retry-After`.
- Token phiên: 32 byte ngẫu nhiên, base64url; database **chỉ lưu SHA-256**, không lưu token gốc.

Những gì **không** có, và hệ quả:

- **Không HTTPS.** Toàn bộ lưu lượng, kể cả bearer token, đi HTTP thuần. Muốn ra Internet thì phải
  đặt sau reverse proxy có TLS (Caddy, nginx, IIS) và khai origin công khai vào `ALLOWED_ORIGINS`.
- **Không mật khẩu.** Tên hiển thị *là* danh tính. Ai vào được địa chỉ là chơi được.
- **Token nằm trong `localStorage` của trình duyệt và không bao giờ hết hạn.** Mất máy là mất
  phiên; xoá dữ liệu trình duyệt cũng vậy, và tên cũ thì không đăng ký lại được.
- Không có vai trò admin, không có kiểm duyệt, không có nhật ký audit.

Kết luận vận hành: **đừng NAT cổng này ra Internet.** Giữ ở profile firewall `Private`.

---

## 10. Giới hạn đã biết

- Chỉ **Windows x64**; không có bản macOS/Linux (dev vẫn chạy được `node dist/server.cjs` ở mọi nền tảng).
- **Một tiến trình**, không nhân bản, không chia sẻ trạng thái — quy mô một mạng LAN, vài chục người.
- Ván đang chơi **không sống qua restart**: khởi động lại là huỷ ván và hoàn điểm.
- Không có màn hình admin: sửa/khoá tài khoản phải thao tác trực tiếp vào file SQLite.
- `hand_log` mặc định tắt; bật lên thì file dữ liệu lớn nhanh hơn nhiều.
