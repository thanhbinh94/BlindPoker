# Triển khai Blind Luck Poker Lite

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
6. `--smoke`: chạy chính exe vừa tạo với `--smoke`, database vào thư mục tạm (`--smoke` tự dùng
   `SQLITE_PATH` tạm trừ khi bạn đặt tường minh, nên nó không bao giờ tạo hay đụng vào file dữ
   liệu thật; run file cũng bị xoá theo), in JSON `/health`. Mã thoát khác `0` là build hỏng.

Bản build thử `useCodeCache=true` trước (nhanh khởi động hơn); nếu bước sinh blob hoặc smoke thất
bại thì tự lùi về blob thường thay vì làm hỏng release.

Vì thế **build không bit-reproducible**: code cache của V8 gắn với đúng bản Node và máy đã tạo ra
nó, và bước fallback có thể đổi nội dung blob. Dòng `exe: sha256 …` cuối bước build vì vậy là dấu
vân tay của **một file đã phát hành** (dùng để đối chiếu bản chép sang máy chủ), không phải một giá
trị dựng lại được từ cùng một commit. Bước `exe` cũng chỉ chạy trên Windows **x64** — build.mjs
dừng hẳn nếu Node đang chạy không phải x64, để không đặt tên release x64 lên một file arm64.

Lúc chạy, server phân biệt hai chế độ bằng `process.getBuiltinModule('node:sea')`:

- **Trong exe** (`sea.isSea()`): đọc `assets.json` rồi lấy từng file bằng `sea.getAsset()`.
- **Khi dev**: đọc thư mục — `PUBLIC_DIR` nếu có, mặc định `dist/public` tính từ `resolveBaseDir()`
  (thư mục chứa exe khi đóng gói, cwd khi chạy `node dist/server.cjs`) — cùng quy tắc với
  `SQLITE_PATH` và `.env`. Không có thư mục đó thì API vẫn chạy, chỉ không có giao diện
  (log một dòng cảnh báo).

### Kiểm tra sau build

```bash
pnpm --filter @bp/lite test      # footprint + smoke
```

- `dist/server.cjs` không được chứa `pg`, `drizzle`, `argon2`, `react-router`.
- Tổng gzip của JS trong `dist/public` ≤ 250 KB, của CSS ≤ 40 KB.
- `bind-poker-lite.exe` ≤ 120 MB (build hiện tại ~81 MB).

**Danh sách phụ thuộc của Lite chỉ có một nguồn: `apps/lite/package.json`.** `footprint.test.ts`
grep vài gói *cấm* trong bundle — đó là lưới chặn hồi quy, không phải allowlist. Muốn thêm hay bớt
dependency thì sửa manifest; đừng sửa test để nó "đúng".

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
   New-NetFirewallRule -DisplayName "Blind Luck Poker Lite" -Direction Inbound -Protocol TCP `
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
| `RECONNECT_WINDOW_SEC` | `90` | Cửa sổ kết nối lại giữa ván (→ `roomOptions.reconnectWindowMs`); số nguyên 0–3600 |
| `ALLOWED_ORIGINS` | *(trống)* → `same-host` | CSV origin được phép mở WebSocket. Trống = chính sách **same-host**: `Origin` phải trùng `host[:port]` của header `Host` (không phân biệt scheme), client không gửi `Origin` (bot, health probe) vẫn vào được, mọi trang khác bị `403` ngay ở bước upgrade. Khai danh sách khi reverse proxy đổi origin công khai — lúc đó thiếu `Origin` cũng bị từ chối |
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

## 6. Chạy nền và **cách dừng**

### 6.1 Dừng êm hay dừng cứng

Windows không có `kill -TERM`. Đây là điểm khác biệt vận hành quan trọng nhất giữa Lite và Normal,
nên nói thẳng:

| Cách dừng | Tín hiệu | Kết quả |
| --- | --- | --- |
| `bind-poker-lite.exe --stop` | HTTP loopback → `close()` | ✅ **Êm**. Cách duy nhất đúng khi chạy nền |
| `Ctrl`+`C` trong console của server | `SIGINT` | ✅ Êm |
| `Ctrl`+`Break` trong console đó | `SIGBREAK` | ✅ Êm |
| NSSM `stop` với `AppStopMethodConsole` | Ctrl+C | ✅ Êm |
| Bấm X đóng cửa sổ console | `SIGHUP`, rồi Windows giết sau vài giây | ❌ **Cứng** trên thực tế |
| `taskkill` / `taskkill /F` | — | ❌ Cứng |
| `schtasks /End /TN …` | — | ❌ Cứng |
| `sc.exe stop …` | — | ❌ Cứng |
| Shutdown/restart máy khi server đang chạy | — | ❌ Cứng |

Dừng **êm** = `GameServer.shutdown()`: ngừng nhận kết nối mới, huỷ ván đang chơi, **hoàn lại điểm
cược và cash-out mọi chồng trên bàn (Hold'em và Blind) về số dư**, đóng socket với
`SERVER_SHUTDOWN`, đóng listener rồi đóng database — tối đa 10 giây (`SHUTDOWN_BUDGET_MS`) rồi thoát
dù còn dở.

Dừng **cứng** = tiến trình biến mất ngay. Số dư đã ghi trong SQLite vẫn nguyên (mọi bút toán đều
nằm trong transaction), nhưng **mọi chồng đang trên bàn — buy-in Hold'em và hạn mức bàn Blind, tới
250.000 mỗi ghế — cùng pot cộng dồn của Blind B thì mất**: chồng chỉ tồn tại trong bộ nhớ cho tới
lúc người chơi rời ghế, pot cho tới lúc được chia, hoặc cho tới khi server drain.

### 6.2 `--stop` và `--status`

```powershell
D:\bind-poker\bind-poker-lite.exe --stop     # tắt êm, chờ tối đa 15 s, in kết quả, mã thoát 0/1
D:\bind-poker\bind-poker-lite.exe --status   # in JSON /health của tiến trình đang chạy
```

Cơ chế: lúc `listen()`, server ghi **`bind-poker.run.json`** cạnh file dữ liệu (giải theo cùng quy
tắc với `SQLITE_PATH` — cạnh exe khi chạy bản đóng gói) với `{ pid, port, host, token }`, `token`
là 32 byte ngẫu nhiên dạng hex, quyền file `0600` ở nơi hệ thống có khái niệm đó. File bị xoá khi
`close()` chạy. `--stop` đọc file, gọi `POST /api/admin/shutdown` qua loopback với header
`X-Requested-With: bind-poker` và `Authorization: Bearer <token>`, rồi poll `pid` tới 15 giây.

Endpoint đó có ba lớp chặn, theo thứ tự: rate-limit 5 lần/phút → **địa chỉ socket phải là loopback**
(`127.0.0.0/8`, `::1`, `::ffff:127.0.0.1`), nếu không thì `403` → so token bằng `timingSafeEqual`,
sai thì `401`. Máy khác trong LAN, kể cả khi đọc trộm được token, vẫn không tắt được server.

Nếu `bind-poker.run.json` còn nằm đó mà tiến trình đã chết (dấu vết của một lần tắt cứng), `--stop`
báo rõ và xoá file giúp, thoát `0`. Việc xoá luôn đọc lại file và đối chiếu `pid` + `token` trước:
một bản đã khởi động trong luúc đó sẽ không bị dọn mất file của nó.

⚠️ **`--stop` yêu cầu `HOST` là `0.0.0.0` (mặc định) hoặc `127.0.0.1`.** Endpoint chỉ trả lời địa chỉ
loopback, nên nếu bạn đặt `HOST` thành một IP LAN cụ thể (ví dụ `HOST=192.168.1.10`) thì server
không lắng nghe trên loopback nữa và `--stop` sẽ bị từ chối `403` — lúc đó chỉ còn `Ctrl`+`C`
trong console (hoặc NSSM) là tắt êm được. `0.0.0.0` đã phục vụ cả LAN lẫn loopback, nên
bình thường không có lý do để đổi.

Một tiến trình thứ hai dùng chung thư mục dữ liệu sẽ **từ chối khởi động** ("another instance is
already running …") thay vì chiếm file, và `--smoke` không bao giờ ghi run file — nếu không, một
lần kiểm tra nhanh sẽ làm server đang chạy mất đường tắt êm.

Nhưng "pid còn sống" **không** đủ để kết luận: sau một lần tắt cứng, run file vẫn nằm đó và hệ điều
hành có thể cấp lại đúng pid đó cho một tiến trình hoàn toàn khác, khi ấy bản mới sẽ bị chặn oan.
Nên lúc khởi động, ngoài việc kiểm tra pid, server còn gọi `GET /api/config` vào đúng địa chỉ ghi
trong file (host `0.0.0.0` thì hỏi qua loopback) và chỉ từ chối khi nhận được `edition: "lite"`
trong vòng 1 giây. Kết nối bị từ chối thẳng, hoặc trả lời HTTP lỗi, không phải JSON, hay là một
server khác, là bằng chứng chắc chắn rằng run file đã cũ: server ghi một dòng log `overwriting a
stale bind-poker.run.json` kèm lý do rồi chạy bình thường — nhưng hết 1 giây mà không có hồi đáp gì
chỉ là *chưa có bằng chứng gì cả* (một bản Lite đang chạy nhưng bận cũng im lặng y hệt), nên server
thử lại một lần nữa với cùng thời hạn, và nếu vẫn hết giờ thì **từ chối khởi động** hẳn — với một
thông báo lỗi riêng, yêu cầu chạy `--stop` hoặc kiểm tra lại cổng — chứ không bao giờ ghi đè run
file chỉ vì im lặng.

### 6.3 Task Scheduler (khuyến nghị)

```powershell
schtasks /Create /TN "BindPokerLite" /TR "D:\bind-poker\bind-poker-lite.exe" /SC ONSTART /RU SYSTEM /RL HIGHEST /F
schtasks /Run /TN "BindPokerLite"
D:\bind-poker\bind-poker-lite.exe --stop     # KHÔNG dùng schtasks /End
```

### 6.4 NSSM (cách bọc dịch vụ được hỗ trợ)

```powershell
nssm install BindPokerLite D:\bind-poker\bind-poker-lite.exe
nssm set BindPokerLite AppDirectory D:\bind-poker
nssm set BindPokerLite AppStopMethodConsole 15000
nssm start BindPokerLite ; nssm stop BindPokerLite
```

NSSM dừng bằng Ctrl+C nên đi vào đúng đường tắt êm. **Đừng** dùng `sc.exe create` trực tiếp: exe
không nói giao thức Service Control Manager, nên SCM vừa báo "dịch vụ không phản hồi kịp" lúc khởi
động, vừa giết cứng tiến trình khi `sc.exe stop`.

Ở mọi cách, tài khoản chạy (mặc định `SYSTEM`) phải có quyền ghi vào thư mục chứa exe.

---

## 7. Nâng cấp

1. Sao lưu file `.sqlite` (mục 5).
2. `bind-poker-lite.exe --stop` (mục 6.2) — không phải `schtasks /End`, không phải `taskkill`.
3. Ghi đè `bind-poker-lite.exe`. **Giữ nguyên** `.env` và các file `.sqlite*`.
4. Chạy lại — migration chạy tự động lúc khởi động.

Ván đang chơi không sống qua lần khởi động lại (spec §32.8): dừng server lúc không ai đang chơi,
hoặc chấp nhận các ván đang dở bị huỷ và hoàn điểm — `--stop` bảo đảm phần hoàn điểm đó thực sự chạy.

---

## 8. Sự cố thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| `EADDRINUSE`, thoát ngay khi khởi động | Cổng đang bị chiếm: `netstat -ano \| findstr :8080`, tắt bản cũ bằng `--stop` hoặc đặt `PORT` khác. Server in sẵn một dòng gợi ý và, khi chạy từ console thật, chờ một phím trước khi đóng cửa sổ |
| `--stop` báo `no running instance found` | Không có `bind-poker.run.json` cạnh file dữ liệu — server không chạy, hoặc lệnh chạy ở sai thư mục (`cwd` khi dùng `node dist/server.cjs`) |
| Người chơi mất stack sau khi khởi động lại | Lần trước đã tắt cứng (mục 6.1). Dùng `--stop`; số dư trong database không bị ảnh hưởng |
| SmartScreen "Windows protected your PC" | Exe chưa ký số: **More info** → **Run anyway**, hoặc ký release trước khi phát hành |
| `SQLITE_CANTOPEN` / `EACCES` / `EPERM` | Thư mục chứa exe không cho ghi — chuyển đi nơi khác hoặc trỏ `SQLITE_PATH` sang chỗ ghi được |
| Log `no web assets found` | Chạy `dist/server.cjs` ở sai thư mục làm việc: đặt `PUBLIC_DIR`, hoặc chạy từ `apps/lite` |
| `Warning: …`, `ExperimentalWarning: …` | `Warning: Currently the require()…` (đóng gói một-file) và cảnh báo `node:sqlite` được lọc ngay khi exe khởi động (`server/src/warnings.ts`, nạp đầu tiên qua `quiet-start.ts`), kể cả với `--status`/`--stop`. Dòng nào khác vẫn hiện là cảnh báo thật |
| Máy khác không vào được | Theo thứ tự: server còn chạy?; `HOST` ≠ `127.0.0.1`?; firewall đã mở?; cùng mạng?; dùng IP chứ không phải `localhost`? |
| Trang trắng sau khi nâng cấp | `Ctrl`+`F5`. `index.html` luôn `no-cache`, chỉ file trong `assets/` (đã gắn hash) mới cache vĩnh viễn |
| Người chơi bị "Phiên chơi đã hết hạn" | Token trong `localStorage` không còn khớp database — thường vì database đã bị xoá/thay. Nhập lại tên mới |

---

## 9. Bảo mật

Lite được thiết kế cho **mạng nội bộ tin cậy**. Những gì có sẵn:

- Header trên mọi phản hồi: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, và `Content-Security-Policy: default-src 'self'; img-src 'self' data:;
  style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self';
  form-action 'self'; object-src 'none'`. (`connect-src 'self'` bao luôn WebSocket cùng origin theo
  CSP 3, nên `ws:`/`wss:` không còn cần khai riêng.) Route `/api/*` và `/health` thêm
  `Cache-Control: no-store`.
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
