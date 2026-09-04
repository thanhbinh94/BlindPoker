# Triển khai Bind Poker Normal

Tài liệu này dành cho **người vận hành** bản Normal: một stack Docker Compose trên một máy chủ —
ứng dụng, PostgreSQL 16, và Caddy đứng trước lo TLS.

Bản còn lại — một file exe Windows cho mạng LAN — xem [`deployment-lite.md`](deployment-lite.md).
Muốn *sửa code* của server này thì đọc [`normal-server.md`](normal-server.md) (tiếng Anh, dành cho
người phát triển).

Xem thêm: spec §22.4 (build), §22.5 (env), §28.1 (deployment), §23 (security).

---

## 1. Cần những gì

| | |
| --- | --- |
| **Máy chủ** | Linux, 2 vCPU / 2 GB RAM, ~10 GB đĩa. Docker Engine 24+ kèm plugin Compose v2. |
| **DNS** | Bản ghi `A` (và `AAAA` nếu có IPv6) của hostname trỏ về máy chủ và **đã lan truyền xong**. Caddy xin chứng chỉ Let's Encrypt ngay lần khởi động đầu, và bước kiểm tra đó đi qua Internet công cộng. |
| **Cổng** | 80 và 443 phải vào được từ Internet. Cổng 80 không phải tuỳ chọn: ACME HTTP challenge đi qua đó, và redirect http→https cũng vậy. |
| **Mã nguồn** | Một bản checkout của repository này trên máy chủ. Image được build tại chỗ — không có image dựng sẵn để `pull`. |

Database **không** được publish ra ngoài và ứng dụng cũng **không** publish cổng nào lên host.
Caddy là service duy nhất có cổng, và đó là chủ ý.

---

## 2. Lần triển khai đầu tiên

```bash
git clone <repository này> /srv/bind-poker
cd /srv/bind-poker/deploy/normal
cp .env.example .env
$EDITOR .env
```

Ba giá trị trong `.env` không có mặc định và bắt buộc phải điền:

```bash
DOMAIN=poker.example.com

# openssl rand -base64 24
POSTGRES_PASSWORD=…

# openssl rand -base64 48
SESSION_SECRET=…
```

Giá trị mẫu trong `.env.example` là `CHANGE_ME` — cố tình ngắn hơn 32 ký tự, nên nếu quên dòng
`SESSION_SECRET` thì server **dừng** kèm lý do thay vì chạy tiếp với một khoá ký phiên được công bố
công khai trong repository này.

Kiểm tra file được hiểu đúng trước khi khởi động thứ gì. Lệnh sau render toàn bộ stack với mọi biến
đã thay thế, và báo lỗi ngay nếu thiếu một biến bắt buộc:

```bash
docker compose config
```

### ⚠️ Đọc trước khi chạy `up -d --build`: image này **chưa từng được build**

Nói thẳng, vì lần triển khai thật đầu tiên rất có thể là **lần đầu tiên trên đời** những dòng đó
được thực thi. Máy làm ra bộ file này không có Docker daemon chạy được.

**Đã kiểm chứng thật:**

- `docker compose config` — cú pháp compose file, mọi phép thay thế biến, thứ tự `depends_on`, mount
  của Caddyfile, tên volume.
- `pnpm --filter @bp/normal-server deploy --prod <dir>` chạy thật trên pnpm 9.15.9: kết quả có đúng
  bố cục `package.json` + `dist/` + `drizzle/` + `data/` + `node_modules`, `node_modules` chỉ chứa
  sáu dependency production (`@fastify/cookie`, `argon2`, `drizzle-orm`, `fastify`, `pg`, `ws`) và
  **không** có devDependency nào.
- Chạy chính artefact đó độc lập (`node dist/main.js` với `DATABASE_URL` chết): mọi external resolve
  được từ `node_modules` của nó, `packageRoot()` tìm đúng thư mục, `drizzle/meta/_journal.json` đọc
  được. Nói cách khác: **bố cục runtime đã được chứng minh**, chỉ là chưa từng nằm trong một image.
- argon2 0.45.1 có sẵn prebuild musl (`prebuilds/linux-x64/argon2.musl.node`) nên bước cài trên
  Alpine không phải biên dịch từ mã nguồn.

**Chưa từng chạy:** bản thân `docker build`, `pnpm install` bên trong Alpine, quy trình xin chứng chỉ
ACME của Caddy, và `service_completed_successfully` lúc chạy thật.

Vì vậy hãy coi lần triển khai đầu là một lần chạy thử có giám sát: đừng làm nó lúc nửa đêm, và khi
có sự cố thì đọc log **theo đúng thứ tự khởi động** — `docker compose logs migrate` trước, rồi
`app`, rồi `caddy`. Mục 10 liệt kê các triệu chứng thường gặp.

```bash
docker compose up -d --build
docker compose ps
```

Lần build đầu mất vài phút (pnpm install, một lượt typecheck TypeScript, bundle esbuild). Thứ tự
khởi động do compose ép chứ không do canh giờ:

1. `db` khởi động và trở nên healthy (`pg_isready -U postgres -d bind_poker`).
2. `migrate` chạy `node dist/migrate-cli.js` trên đó và **thoát 0**.
3. `app` khởi động.
4. `caddy` khởi động sau khi `app` healthy, xin chứng chỉ cho `$DOMAIN`, rồi bắt đầu proxy.

```bash
curl -fsS https://$DOMAIN/health
# {"ok":true,"edition":"normal","version":"0.1.0","db":"ok","uptimeSec":…}
```

Endpoint đó trả `503` khi tiến trình còn sống nhưng database không trả lời — đúng công dụng của nó,
và cũng là thứ `HEALTHCHECK` của container dùng.

### Nếu chứng chỉ không xuất hiện

`docker compose logs caddy`. Gần như luôn là một trong ba: DNS chưa trỏ về đây, cổng 80 bị firewall
của nhà cung cấp chặn hoặc đã bị một nginx trên host chiếm, hoặc đã dính rate limit của Let's Encrypt
sau nhiều lần thử hỏng. Sửa nguyên nhân rồi `docker compose restart caddy`.

---

## 3. Bốn service

| Service | Image | Cổng | Restart | Ghi chú |
| --- | --- | --- | --- | --- |
| `db` | `postgres:16-alpine` | không | `unless-stopped` | Volume `pgdata`. Healthcheck có nêu tên database (`-d bind_poker`) để một server còn đang initdb không bị coi là healthy. |
| `migrate` | build tại chỗ | không | `no` | Áp migration rồi thoát. Hỏng ở đây thì `app` không khởi động — đó là chủ ý. `HEALTHCHECK` bị tắt vì container này không nghe cổng 8080. |
| `app` | build tại chỗ | không (8080 nội bộ) | `unless-stopped` | `AUTO_MIGRATE=false`, `TRUST_PROXY=true`, `COOKIE_SECURE=true`. |
| `caddy` | `caddy:2-alpine` | 80, 443, 443/udp | `unless-stopped` | Volume `caddy_data` (tài khoản ACME + chứng chỉ) và `caddy_config`. |

**Vì sao `migrate` là một service riêng chứ không phải một bước trong entrypoint của `app`.** `app`
restart khi hỏng. Migration chạy lúc boot sẽ chạy lại ở **mỗi vòng** của một crash-loop, và chạy lại
ở mỗi replica thêm vào sau này. Là service riêng với `restart: "no"`, nó chạy đúng một lần, và
`depends_on: service_completed_successfully` biến "schema đã đúng" thành điều kiện tiên quyết để app
khởi động, thay vì một hy vọng.

App **có thể** tự migrate lúc boot — đặt `AUTO_MIGRATE=true` — và đó là lựa chọn đúng cho một triển
khai một-container ở nơi khác. Ở đây thì không.

---

## 4. Bảng biến môi trường

Compose đặt hết những biến này; bạn chỉ cung cấp những gì `.env.example` liệt kê. Server đọc môi
trường đúng một lần lúc khởi động, báo **mọi** lỗi cùng lúc, và từ chối chạy nếu có bất kỳ lỗi nào —
một giá trị sai không bao giờ bị âm thầm thay bằng mặc định.

| Biến | Ai đặt | Mặc định | Ý nghĩa |
| --- | --- | --- | --- |
| `DATABASE_URL` | compose, suy từ `POSTGRES_PASSWORD` | bắt buộc | `postgres://` hoặc `postgresql://`. Scheme được kiểm lúc khởi động. |
| `SESSION_SECRET` | `.env` | bắt buộc | Khoá HMAC sinh ra id phiên; tối thiểu 32 ký tự. **Đổi nó là đăng xuất tất cả.** Không bao giờ xuất hiện trong log. |
| `ALLOWED_ORIGINS` | compose, suy từ `DOMAIN` | bắt buộc | Danh sách origin tuyệt đối ngăn cách bằng dấu phẩy (`https://host[:port]`, không path, không dấu `/` cuối). WebSocket upgrade từ nơi khác bị từ chối. |
| `PORT` / `HOST` | — | `8080` / `0.0.0.0` | Bên trong container. Đổi thì phải đổi cả Caddyfile. |
| `AUTO_MIGRATE` | compose | `true` | Ở đây là `false`: `migrate` giữ việc đó. Giá trị không nhận ra làm process dừng chứ không lấy mặc định. |
| `COOKIE_SECURE` | compose | `true` | Gắn `Secure` vào cookie phiên. Chỉ đặt `false` cho người dev chạy `http://localhost`. |
| `TRUST_PROXY` | compose | `false` | Ở đây là `true`, vì Caddy đặt `X-Forwarded-*`. Xem mục 9. |
| `ECONOMY_TIMEZONE` | `.env` | `Asia/Ho_Chi_Minh` | Múi giờ IANA quyết định mốc "ngày mới" của thưởng hằng ngày. |
| `LOG_LEVEL` | `.env` | `info` | `debug` \| `info` \| `warn` \| `error`. |
| `RECONNECT_WINDOW_SEC` | — | `90` | Cửa sổ kết nối lại cho người đang ngồi ghế trước khi bàn tự fold hộ (0–3600). |
| `PUBLIC_DIR` | — | *(trống)* | Bundle web để phục vụ ở `/`. Trống = chỉ API, đúng hiện trạng của stack này cho tới khi Plan 6 giao `normal-web`. |

`.env` cũng được đọc từ thư mục làm việc của app, nhưng **biến môi trường thật luôn thắng** — một
deployment có thể đặt tất cả bằng biến container và không cần file nào.

---

## 5. Vận hành hằng ngày

```bash
cd /srv/bind-poker/deploy/normal

docker compose ps                    # cái gì đang chạy, và sức khoẻ ra sao
docker compose logs -f app           # mỗi dòng một object JSON, ra stdout
docker compose logs --since 1h db
docker compose restart app           # đổi .env → restart, hoặc `up -d` để tạo lại container
docker compose exec -T db psql -U postgres -d bind_poker
```

`docker compose stop app` là **dừng êm**: server bắt `SIGTERM`, ngừng nhận kết nối mới, huỷ ván đang
chơi và **hoàn lại toàn bộ điểm cược cùng stack Hold'em qua ledger**, đóng socket, rồi đóng pool. Nó
tự cho mình 15 giây trước khi thoát khác 0. `docker compose kill` bỏ qua tất cả những việc đó: số dư
đã ghi vẫn an toàn (mọi bút toán nằm trong transaction) nhưng stack đang trên bàn thì mất.

### Vài truy vấn kinh tế hữu ích

```sql
-- Bất biến tiền (spec §18.4): tổng số dư người chơi cộng tổng sink là hằng số.
select (select coalesce(sum(balance),0) from players) as balances,
       (select coalesce(sum(amount),0) from point_transactions where player_id is null) as sinks;

-- Điểm chảy đi đâu.
select reason, count(*), sum(amount) from point_transactions group by reason order by 3;

-- Bậc rút ngẫu nhiên của thưởng hằng ngày cạn item tới mức nào.
select count(*) from point_transactions where reason = 'daily_item_fallback';
```

---

## 6. Sao lưu

```bash
cd /srv/bind-poker/deploy/normal
./backup.sh
```

Ghi ra `backups/bp-<ngày>-<giờ>.dump` (`pg_dump -Fc`, custom format có nén), từ chối giữ file rỗng,
và xoá các bản cũ hơn 14 ngày. Nó không dừng gì cả: `pg_dump` chạy trong một transaction, nên bản
dump là ảnh chụp của đúng một thời điểm kể cả khi đang có người chơi giữa ván.

Trên máy chủ thật nên trỏ ra ngoài thư mục checkout (script đã đọc sẵn biến này) — dump sẽ không bị
`git clean` cuốn đi và không bị mang theo bởi bất cứ thứ gì đóng gói thư mục mã nguồn:

```bash
BACKUP_DIR=/var/backups/bind-poker ./backup.sh
```

Chạy hằng ngày, 03:15:

```cron
15 3 * * * cd /srv/bind-poker/deploy/normal && BACKUP_DIR=/var/backups/bind-poker ./backup.sh >> /var/log/bind-poker-backup.log 2>&1
```

(Thư mục `backups/` mặc định và `backup.log` đều đã nằm trong `.gitignore`, nhưng chúng vẫn là bản
sao đầy đủ của mọi tài khoản, hash mật khẩu và dòng ledger — đừng để chúng trong cây git.)

**Sao lưu nằm cùng máy chủ thì không phải sao lưu.** Chép dump đi nơi khác — `rsync` sang máy khác,
một object store, bất cứ thứ gì sống sót khi mất máy này.

Hai thứ **không** nằm trong dump nhưng cần có để dựng lại dữ liệu ở nơi khác:

- **`SESSION_SECRET`** — khoá đã ký các id phiên. Không có nó thì mọi phiên trong database khôi phục
  đều chết. (Mật khẩu thì không sao: hash argon2 tự mang salt.)
- **`caddy_data`** — tài khoản ACME và chứng chỉ. Mất nó chỉ tốn một lần xin lại, nhưng Let's Encrypt
  có rate limit, nên vẫn nên giữ.

Khôi phục: [`../deploy/normal/restore.md`](../deploy/normal/restore.md). Đọc nó **trước** khi cần
đến, không phải lúc đang cần.

---

## 7. Nâng cấp

```bash
cd /srv/bind-poker/deploy/normal
./backup.sh                          # 1. luôn luôn, và ngay trước khi nâng cấp
git -C /srv/bind-poker pull          # 2.
docker compose up -d --build         # 3. build lại, chạy lại migrate, tạo lại app
docker compose logs -f app
```

`migrate` chạy lại như một phần của bước 3, trước khi `app` khởi động; drizzle ghi lại những
migration đã áp, nên một schema không đổi khiến bước đó thành no-op.

**Ván đang chơi không sống qua lần khởi động lại** (spec §32.8). Chúng bị huỷ và mọi khoản cược được
hoàn, nên không ai mất điểm — nhưng người đang ngồi bàn sẽ thấy ván biến mất. Nâng cấp lúc bàn trống
nếu có thể.

**Không có down-migration.** Lùi lại nghĩa là khôi phục bản dump ở bước 1 rồi chạy image cũ; quy
trình nằm ở cuối `restore.md`. Đó là lý do bước 1 không phải tuỳ chọn.

---

## 8. Đổi mật khẩu database

`POSTGRES_PASSWORD` được `initdb` đọc ở **lần đầu tiên** volume `pgdata` được dùng, và không bao giờ
đọc lại. Sửa `.env` sau đó chỉ đổi thứ app dùng để **kết nối**, không đổi thứ database mong đợi — và
app sẽ không xác thực được. Đổi cả hai, theo đúng thứ tự này:

```bash
docker compose exec -T db psql -U postgres -c "alter role postgres with password 'NEW'"
$EDITOR .env            # POSTGRES_PASSWORD=NEW
docker compose up -d    # tạo lại app và migrate với DATABASE_URL mới
```

---

## 9. Bảo mật

- **Chỉ HTTPS.** Cookie phiên là `HttpOnly; Secure; SameSite=Lax`, và `COOKIE_SECURE=true` nghĩa là
  trình duyệt sẽ không gửi nó qua HTTP thuần. Không có cấu hình HTTP nào chạy được.
- **`TRUST_PROXY=true` chỉ đúng khi đứng sau Caddy.** Nó làm server tin `X-Forwarded-For`. Nếu có
  thứ gì chạm được tới app **vòng qua** proxy thì bất kỳ ai cũng tự chọn được địa chỉ mà rate limit
  đang đếm theo, và chọn một cái mới cho mỗi request. Đó là lý do `app` không publish cổng nào —
  đừng thêm vào "để debug".
- **Rate limit là per-instance và nằm trong RAM.** 10 lần đăng ký/phút/IP, 5 lần đăng nhập/phút/IP+email,
  `/api/*` mutating 60/phút/phiên **và** 120/phút/địa chỉ, đọc 240/phút/IP. Chúng bảo vệ tiến trình
  chứ không bảo vệ tài khoản: nhiều replica thì mỗi bản có bộ đếm riêng. Chặn brute-force mật khẩu
  chủ yếu là nhờ argon2id (m=64 MiB, t=3, p=1) chứ không phải mấy con số này.
- **Secret nằm trong `.env` và không ở đâu khác.** `chmod 600 .env`. Cả `DATABASE_URL` lẫn
  `SESSION_SECRET` đều không bao giờ được ghi ra log, kể cả dòng khởi động — nhưng vẫn nên kiểm lại
  trước khi dán log vào một issue.
- **App chạy bằng user `node`**, không phải root, và không ghi gì vào filesystem của chính nó.
- **`db` không publish cổng nào.** Muốn vào thì `docker compose exec db psql`, hoặc một SSH tunnel.
  Mở 5432 ra Internet với một superuser chỉ có mật khẩu là cách các máy chủ này bị chiếm.
- **Không có màn hình admin và không có audit log.** Kiểm duyệt là SQL trực tiếp vào database
  (spec §12.5).

---

## 10. Sự cố thường gặp

| Hiện tượng | Nguyên nhân và cách xử lý |
| --- | --- |
| `docker compose config` báo `POSTGRES_PASSWORD is required` | Không có `.env` trong `deploy/normal`, hoặc biến để trống. Compose từ chối trước khi khởi động bất cứ thứ gì, và đó là chủ ý. |
| `app` dừng với `SESSION_SECRET must be at least 32 characters, got 9` | Bạn đã copy `.env.example` mà quên đổi `CHANGE_ME`. Đúng như thiết kế — sinh một khoá thật (mục 2). |
| `migrate` thoát khác 0, `app` không bao giờ khởi động | `docker compose logs migrate`. Thường là sai mật khẩu (`password authentication failed`) hoặc một migration xung đột với dữ liệu đã có. Việc `app` nằm im là đúng — một server chạy trên schema áp dở còn tệ hơn. |
| `app` in `Invalid configuration:` rồi thoát | Danh sách bên dưới nêu **mọi** lỗi cùng lúc. Sửa hết rồi `docker compose up -d`. |
| App đã lên, `/health` trả `"db":"down"` | Pool không tới được `db`. Kiểm `docker compose ps db` và log của nó; app tự phục hồi khi database trả lời lại. |
| Caddy trả `502 Bad Gateway` | `app` không nghe. `docker compose logs app` — hỏng lúc boot, hoặc vẫn đang khởi động. |
| Chứng chỉ mãi không có | Xem mục 2. DNS, cổng 80, hoặc rate limit ACME. |
| WebSocket kết nối rồi đóng ngay | `ALLOWED_ORIGINS` không chứa origin mà trang được phục vụ từ đó. Nó suy ra từ `DOMAIN`; trình duyệt ở `https://www.example.com` cần đúng origin đó trong danh sách. |
| Mọi người bị đăng xuất sau một lần deploy | `SESSION_SECRET` đã đổi. Nó phải ổn định qua các lần triển khai. |
| `docker compose down -v` | Xoá `pgdata` **và** `caddy_data`. Tức là toàn bộ database. `down` không kèm `-v` mới là thứ bạn định làm. |
| Build hỏng ở bước `pnpm install` trong Alpine | Đây là một trong những phần chưa từng chạy (xem cảnh báo ở mục 2). Đọc dòng log ngay phía trên chỗ hỏng; nếu là argon2 thì stage builder đã có sẵn `python3 make g++` cho đường biên dịch, và nguyên nhân thường là hết RAM trên máy chủ nhỏ. |
