# Chạy Just a Normal Poker Normal miễn phí trên Oracle Cloud Always Free

Runbook đầy đủ để đưa bản **Normal** lên Internet — tên miền thật, HTTPS thật, người ngoài vào chơi
được — mà **không mất tiền hằng tháng**, trên một máy ảo ARM của Oracle Cloud Always Free.

Cái này **không** thay thế [`../../docs/deployment-normal.md`](../../docs/deployment-normal.md); nó
là lớp bên dưới. Tài liệu kia nói stack Compose hoạt động thế nào (bốn service, biến môi trường, sao
lưu, sự cố); trang này nói cách có được cái máy để chạy nó, và những chỗ riêng của Oracle mà tài
liệu kia không biết.

Muốn **test nội bộ trong LAN** trước, bằng Node trên máy Windows và không cần Docker: xem
[`../normal-windows/README.md`](../normal-windows/README.md).

| | |
| --- | --- |
| **Máy** | `VM.Standard.A1.Flex` — 2 OCPU ARM, 8 GB RAM, 50 GB đĩa. Nằm trong hạn mức Always Free (tổng 4 OCPU + 24 GB cho cả tài khoản). |
| **Hệ điều hành** | Canonical Ubuntu 24.04, **aarch64**. |
| **Chi phí** | 0 đ, vô thời hạn — miễn ở trong hạn mức. Đọc kỹ mục 11. |
| **Thời gian** | Khoảng 20 phút thao tác, cộng 15–30 phút chờ build image lần đầu. |
| **Bạn cần** | Một thẻ tín dụng/ghi nợ quốc tế để **xác minh danh tính** khi mở tài khoản (Oracle giữ ~1 USD rồi hoàn lại), và một khoá SSH. |

> Tôi không đăng ký tài khoản, không nhập số thẻ và không nhập mật khẩu thay bạn. Mục 1 và 2 là việc
> bạn tự làm trên trình duyệt; từ mục 4 trở đi là lệnh.

---

## 0. Bộ này có gì

| File | Việc của nó |
| --- | --- |
| `bootstrap.sh` | Chuẩn bị máy: firewall, swap, Docker, unattended-upgrades, clone repo. Chạy bằng `sudo`, **chạy lại bao nhiêu lần cũng được**. |
| `backup-cron.example` | Dòng cron sao lưu database hằng đêm. |
| `README.md` | Trang này. |

`bootstrap.sh` **không** khởi động stack, **không** ghi `.env` và **không** đụng tới DNS. Ba thứ đó
cần một bí mật hoặc một quyết định mà script không có quyền tự làm — chúng là mục 6 và 7 ở dưới.

---

## 1. Tài khoản Oracle Cloud

1. Vào <https://signup.oraclecloud.com>, chọn **Home Region** gần Việt Nam — `ap-singapore-1` (Singapore)
   hoặc `ap-tokyo-1` / `ap-osaka-1` (Nhật). **Home region không đổi được về sau**, và Always Free chỉ
   dùng được ở home region.
2. Xác minh bằng thẻ. Oracle tạm giữ khoảng 1 USD rồi hoàn lại; đây là bước xác minh danh tính, không
   phải thanh toán. Tài khoản mở ra ở dạng **Free Trial** (300 USD credit, 30 ngày) và sau đó tự
   chuyển thành **Always Free**.
3. Bật 2FA cho tài khoản. Máy này sẽ có domain công khai và database người chơi trên đó.

**Về "Upgrade to Pay As You Go" (PAYG).** Oracle liên tục mời nâng cấp. Nâng cấp **không** bắt bạn
trả tiền cho phần Always Free — nó vẫn miễn phí — nhưng nó bỏ hai giới hạn khó chịu: tài khoản PAYG
gần như không bao giờ gặp lỗi "Out of capacity" khi tạo A1, và **không bị thu hồi tài nguyên vì
idle** (mục 11). Nếu bạn định để server này chạy lâu dài và có thẻ chịu được rủi ro bị tính tiền khi
lỡ tạo tài nguyên ngoài hạn mức, PAYG là lựa chọn ổn định hơn. Nếu không, cứ ở Always Free và đọc kỹ
mục 11. **Quyết định là của bạn** — cả hai đều chạy được bộ file này.

---

## 2. Tạo máy ảo

Console → **Compute** → **Instances** → **Create instance**.

| Ô | Điền |
| --- | --- |
| Name | `bind-poker` |
| Image | **Canonical Ubuntu 24.04** |
| Shape | **Ampere** → `VM.Standard.A1.Flex` → **2 OCPUs**, **8 GB memory** |
| Networking | VCN mặc định, **Assign a public IPv4 address: Yes** |
| Boot volume | **50 GB** (mặc định 46,6 GB cũng được; hạn mức free là 200 GB tổng) |
| SSH keys | Dán **public key** của bạn, hoặc để Oracle sinh cặp khoá và **tải private key về ngay** — không tải lại được lần thứ hai |

Chưa có khoá thì tạo trên máy bạn trước:

```bash
ssh-keygen -t ed25519 -C "bind-poker oracle" -f ~/.ssh/bind-poker
cat ~/.ssh/bind-poker.pub          # đây là thứ dán vào ô SSH keys
```

Trên Windows, `ssh-keygen` có sẵn trong PowerShell (OpenSSH của Windows 10/11) và trong Git Bash.

### "Out of capacity" — lỗi phổ biến nhất của bước này

Shape A1 miễn phí thường hết hàng, và thông báo là
`Out of host capacity` / `Out of capacity for shape VM.Standard.A1.Flex`. Nó **không** phải lỗi của
bạn. Cách xử lý, theo thứ tự:

1. **Đổi Availability Domain.** Region nào có AD-1/AD-2/AD-3 thì thử lần lượt cả ba (Singapore chỉ
   có một AD, Tokyo có nhiều hơn).
2. **Thử lại vào giờ khác.** Dung lượng được trả về liên tục; sáng sớm và đêm khuya giờ địa phương
   của region thường dễ hơn.
3. **Giảm cấu hình.** 1 OCPU / 6 GB dễ tạo hơn 2 OCPU / 8 GB, và vẫn chạy được stack này — chỉ là
   build image lần đầu lâu hơn đáng kể. Tạo được rồi có thể tăng lại sau (Edit shape, cần reboot).
4. **Nâng lên PAYG** (mục 1). Đây là cách chắc ăn nhất; tài khoản PAYG gần như luôn tạo được A1.
5. Đừng viết script gọi API tạo máy trong vòng lặp. Oracle rate-limit, và tài khoản có thể bị khoá.

Ghi lại **Public IP** của máy sau khi tạo xong. Cả bài này gọi nó là `<IP>`.

---

## 3. Mở cổng trong Security List

Đây là firewall **của Oracle**, nằm ngoài máy ảo, và nó là thứ chặn HTTP mặc định. Bỏ qua bước này
thì Caddy sẽ không bao giờ xin được chứng chỉ.

Console → **Networking** → **Virtual Cloud Networks** → VCN của bạn → **Security Lists** →
`Default Security List` → **Add Ingress Rules**:

| Stateless | Source CIDR | IP Protocol | Destination Port Range | Để làm gì |
| --- | --- | --- | --- | --- |
| No | `0.0.0.0/0` | TCP | `80` | ACME HTTP challenge của Let's Encrypt, và redirect http→https |
| No | `0.0.0.0/0` | TCP | `443` | HTTPS và WebSocket (`wss://`) |

Cổng `22` đã có sẵn trong rule mặc định. **Không** mở `5432` ở đây (mục 10 nói lúc nào thì mở tạm, và
mở như thế nào).

Cổng 80 **không phải tuỳ chọn**: ACME HTTP-01 challenge đi qua nó.

> Oracle có **hai** lớp firewall, và đây mới là lớp thứ nhất. Lớp thứ hai — `iptables` **bên trong**
> Ubuntu, với một rule `REJECT` chặn tất cả ở cuối chuỗi INPUT — là thứ `bootstrap.sh` xử lý ở mục 5.
> Quên lớp nào cũng cho ra cùng một triệu chứng: ssh vào được, mọi thứ khác timeout.

---

## 4. SSH vào máy

```bash
chmod 600 ~/.ssh/bind-poker          # OpenSSH từ chối khoá mà người khác đọc được
ssh -i ~/.ssh/bind-poker ubuntu@<IP>
```

Trên Windows PowerShell thì đường dẫn khoá là `$env:USERPROFILE\.ssh\bind-poker`; nếu ssh báo
`UNPROTECTED PRIVATE KEY FILE`, bỏ quyền kế thừa của file đi:

```powershell
icacls "$env:USERPROFILE\.ssh\bind-poker" /inheritance:r /grant:r "$($env:USERNAME):R"
```

Tài khoản đăng nhập của image Ubuntu là `ubuntu` (không phải `opc`, đó là image Oracle Linux).

---

## 5. Chạy `bootstrap.sh`

Hai cách, chọn một.

**Cách A — repo public, chạy thẳng từ Internet:**

```bash
curl -fsSL https://raw.githubusercontent.com/<user>/<repo>/master/deploy/oracle/bootstrap.sh \
  | sudo bash -s -- https://github.com/<user>/<repo>.git master
```

**Cách B — repo private, hoặc bạn muốn đọc script trước khi chạy (nên):**

```bash
# từ MÁY CỦA BẠN
scp -i ~/.ssh/bind-poker deploy/oracle/bootstrap.sh ubuntu@<IP>:~/

# trên VM
less bootstrap.sh
chmod +x bootstrap.sh
sudo ./bootstrap.sh git@github.com:<user>/<repo>.git master
```

Repo private thì khoá deploy phải nằm sẵn trong `~/.ssh` của user `ubuntu` **trước khi** chạy — script
clone bằng chính user đó.

Tham số: `<REPO_URL>` bắt buộc, `<BRANCH>` mặc định `master`.

### Nó làm gì

Sáu bước, mỗi bước tự kiểm tra rồi in `[done]` hoặc `[skip]`:

1. **iptables** — chấp nhận tcp/80 và tcp/443, **chèn lên trên** rule `REJECT` mặc định của image
   (chèn xuống dưới thì vô tác dụng, vì gói tin đã bị từ chối rồi), rồi lưu bằng
   `netfilter-persistent` để sống qua reboot.
2. **Swap 2 GB** — chỉ khi máy chưa có swap nào. 8 GB RAM chạy stack này thoải mái nhưng **build**
   image thì vừa đủ sát; `pnpm install` + tsc + vite trong builder stage là đỉnh điểm, và bước này
   là thứ ngăn một lần OOM-kill giữa build.
3. **Docker Engine + plugin Compose v2** từ repo apt của chính Docker, kiến trúc lấy từ
   `dpkg --print-architecture` (`arm64` trên A1). Gói `docker.io` của Ubuntu **không** có plugin
   Compose v2, nên không dùng được.
4. **`ubuntu` vào nhóm `docker`**.
5. **unattended-upgrades** — bật cập nhật bảo mật tự động. Mặc định của Ubuntu **không** tự reboot,
   nên nó không đá bạn ra giữa một ván.
6. **Repo** → `/opt/bind-poker` (hoặc `git pull --ff-only` nếu đã có), thuộc sở hữu của `ubuntu`.

Cuối cùng nó in ra các bước tiếp theo.

**Chạy lại được.** Lần chạy thứ hai gần như chỉ toàn `[skip]` cộng một lần `git pull` — đó là cách
để nâng cấp phần hệ thống của máy về sau.

### Đăng nhập lại

```bash
exit
ssh -i ~/.ssh/bind-poker ubuntu@<IP>
docker ps          # không có "permission denied" là đúng
```

Nhóm được đọc **lúc đăng nhập**, nên phiên ssh đang mở vẫn chưa vào nhóm `docker`. Mở phiên mới.

---

## 6. DNS

Caddy xin chứng chỉ Let's Encrypt cho đúng cái tên trong `DOMAIN`, ngay lần khởi động đầu, và Let's
Encrypt sẽ **gọi ngược về** tên đó qua cổng 80. Nghĩa là DNS phải xong **trước** khi `up -d`.

**Có domain:** thêm một bản ghi `A`:

```
play.example.com.    A    <IP>
```

Chờ nó lan truyền rồi kiểm tra từ máy bạn — phải ra đúng `<IP>`:

```bash
dig +short play.example.com          # Windows: nslookup play.example.com 1.1.1.1
```

**Chưa có domain — dùng `sslip.io`:** dịch vụ này phân giải bất kỳ tên nào *chứa* một địa chỉ IP về
chính địa chỉ đó, không cần đăng ký gì cả. Thay dấu `.` của IP bằng dấu `-`:

```
IP  152.67.10.42   →   DOMAIN=play.152-67-10-42.sslip.io
```

```bash
dig +short play.152-67-10-42.sslip.io      # → 152.67.10.42
```

Let's Encrypt cấp chứng chỉ cho tên `sslip.io` bình thường. Hai điều cần biết: nó phụ thuộc vào một
dịch vụ miễn phí của người khác, và nếu IP đổi thì tên cũng đổi (kéo theo `DOMAIN`,
`ALLOWED_ORIGINS`, và một lần xin chứng chỉ mới). Để chạy lâu dài thì một domain thật rẻ hơn phiền
phức đó rất nhiều — nhưng để lên sóng trong hôm nay thì `sslip.io` là đủ.

> Muốn giữ IP qua các lần dừng máy: Console → Instance → **Attached VNICs** → IPv4 → đổi public IP
> từ **Ephemeral** sang **Reserved**. IP dự phòng nằm trong hạn mức Always Free.

---

## 7. `.env`

```bash
cd /opt/bind-poker/deploy/normal
cp .env.example .env
nano .env
chmod 600 .env
```

Ba giá trị bắt buộc (spec §4 của thiết kế, và mục 2 của `docs/deployment-normal.md`):

```bash
DOMAIN=play.example.com          # hoặc play.152-67-10-42.sslip.io

# openssl rand -hex 24     ← HEX, không phải base64
POSTGRES_PASSWORD=…

# openssl rand -base64 48
SESSION_SECRET=…

# tuỳ chọn, đã có mặc định đúng
ECONOMY_TIMEZONE=Asia/Ho_Chi_Minh
LOG_LEVEL=info
```

Sinh hai bí mật ngay trên VM:

```bash
openssl rand -hex 24
openssl rand -base64 48
```

**`POSTGRES_PASSWORD` phải là hex.** Compose nội suy nó vào
`postgres://postgres:<pw>@db:5432/bind_poker`; một dấu `/` trong mật khẩu kết thúc phần authority của
URL và `migrate` từ chối khởi động. `openssl rand -base64 24` sinh ra `/` khoảng hai lần trên năm;
`-hex` thì không bao giờ. `SESSION_SECRET` không nằm trong URL nào nên base64 vẫn đúng cho nó.

Ba biến còn lại của stack — `ALLOWED_ORIGINS`, `TRUST_PROXY=uniquelocal`, `COOKIE_SECURE=true` — do
`docker-compose.yml` đặt sẵn và suy ra từ `DOMAIN`. **Đừng** thêm tay vào `.env`.

Kiểm file được hiểu đúng trước khi khởi động thứ gì:

```bash
docker compose config
```

Lệnh này render toàn bộ stack với mọi biến đã thay thế và báo lỗi ngay nếu thiếu một biến bắt buộc.

---

## 8. Build và khởi động lần đầu

```bash
cd /opt/bind-poker/deploy/normal
docker compose up -d --build
```

> Chạy từ **trong** `deploy/normal`. Dạng một dòng
> `docker compose -f /opt/bind-poker/deploy/normal/docker-compose.yml up -d --build` cũng chạy, nhưng
> Compose tìm `.env` theo thư mục dự án, nên hoặc bạn đứng sẵn ở đây, hoặc phải thêm
> `--env-file /opt/bind-poker/deploy/normal/.env`. Cứ `cd` cho gọn.

### ⚠️ Đây rất có thể là lần đầu tiên image này được build, ở bất cứ đâu

Máy làm ra repo này không có Docker daemon chạy được: `docker compose config` đã chạy thật, artefact
`pnpm deploy --prod` đã chạy thật và đã được chạy độc lập, nhưng **`docker build` thì chưa bao giờ**
(`docs/known-limitations.md`, và mục 2 của `docs/deployment-normal.md`). Bạn còn đang build nó cho
**ARM**. Vì vậy: đừng làm bước này lúc nửa đêm, và hãy nhìn nó chạy.

**Dự kiến 15–30 phút** trên 2 OCPU (lâu hơn nhiều trên 1 OCPU). Phần lớn thời gian nằm ở
`pnpm install` trong Alpine, một lượt typecheck TypeScript, và vite build.

Muốn xem từng dòng thay vì thanh tiến trình gộp:

```bash
docker compose build --progress=plain 2>&1 | tee /tmp/build.log
docker compose up -d
```

`--progress=plain` là thứ bạn cần khi có sự cố: mặc định BuildKit thu gọn output của mỗi bước, còn
`plain` in mọi dòng stdout/stderr của từng `RUN` kèm tên bước. `tee` giữ lại để đọc lại và để dán vào
issue.

### Những chỗ có thể hỏng, theo thứ tự khả năng

| Triệu chứng | Nguyên nhân và cách xử lý |
| --- | --- |
| Build chết ở `pnpm install`, thông báo bị cắt ngang / `Killed` / exit 137 | Hết RAM. Kiểm `swapon --show` phải thấy `/swapfile 2G`. Chưa có thì chạy lại `bootstrap.sh`. Vẫn hỏng thì `docker compose build --progress=plain` từng bước và tạm nâng swap lên 4 GB. |
| Build dừng ở bước cài `argon2` với `node-gyp` / `gyp ERR!` | argon2 0.45.1 có prebuild musl cho **cả linux-x64 lẫn linux-arm64** (`prebuilds/linux-arm64/argon2.armv8.musl.node`), nên bình thường arm64 cũng unpack sẵn binary như x86 — không có bước biên dịch nào ở đây. Nếu vẫn thấy `gyp ERR!`, nghĩa là `node-gyp-build` đã từ chối prebuild (lệch Node ABI hoặc lệch libc) và rơi về builder stage's `python3 make g++` như đường dự phòng; đọc dòng log ngay **trên** chỗ hỏng — thiếu header thì `apk add --no-cache linux-headers` trong builder stage là thứ phải thêm. |
| `pnpm deploy --prod /out` báo lỗi lạ, hoặc `/out/node_modules` rỗng | Phiên bản pnpm. Dockerfile ghim `pnpm@9` có lý do: trên pnpm 10, `deploy` từ chối chạy nếu workspace không đặt `inject-workspace-packages=true`, và install script của dependency không chạy mặc định (`onlyBuiltDependencies`) nên bước `node-gyp-build` của argon2 bị bỏ qua **im lặng**. Đừng đổi dòng `npm i -g pnpm@9`. |
| `esbuild: Incompatible host architecture` hoặc lỗi platform trong bước vite | BuildKit bị tắt, nên `Dockerfile.dockerignore` không được đọc và `node_modules` của host bị nuốt vào context. Bật lại: `DOCKER_BUILDKIT=1 docker compose build`. Trên máy này không nên xảy ra — bootstrap cài Docker mới, mặc định đã bật BuildKit. |
| Build xong, `migrate` thoát khác 0 | `docker compose logs migrate`. Thường là sai `POSTGRES_PASSWORD` (`password authentication failed`) hoặc `DATABASE_URL is not a valid URL` (mật khẩu có `/ ? # @` — xem mục 7). `app` **không** khởi động khi `migrate` hỏng, và đó là chủ ý. |
| Mọi thứ chạy, nhưng không có chứng chỉ | `docker compose logs caddy`. Ba nguyên nhân: DNS chưa trỏ đúng (mục 6), cổng 80 chưa mở ở **Security List** (mục 3) hoặc ở **iptables** (mục 5), hoặc đã dính rate limit của Let's Encrypt sau nhiều lần thử hỏng. Sửa nguyên nhân rồi `docker compose restart caddy`. |

Nếu phải bỏ dở và làm lại từ đầu: `docker compose down` (KHÔNG kèm `-v` — `-v` xoá cả database lẫn
chứng chỉ), sửa, rồi `up -d --build` lại. Layer đã build được giữ lại nên lần sau nhanh hơn nhiều.

---

## 9. Kiểm tra

`$DOMAIN` chỉ nằm trong `.env` — Compose đọc được nhưng shell của bạn thì không, nên nạp nó vào
session trước khi dán mấy lệnh `curl` dưới đây (đang đứng ở `deploy/normal` từ mục 8):

```bash
set -a; . ./.env; set +a
```

```bash
docker compose ps                              # bốn service; app phải "healthy"
curl -fsS https://$DOMAIN/health
# {"status":"ok","uptime":…,"connections":0,"rooms":0,"db":"ok","edition":"normal","version":"0.1.0"}

curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' https://$DOMAIN/
# 200 text/html; charset=utf-8   ← index.html của bundle web, không phải API
```

Rồi mở `https://$DOMAIN` bằng trình duyệt: **Đăng ký** một tài khoản (email, mật khẩu 8–128 ký tự,
tên hiển thị 2–20 ký tự), vào sảnh, **Điểm danh** → **Nhận thưởng**, **Tạo phòng** với một bot và chơi
một ván. Đi hết được vòng đó nghĩa là cookie phiên, WebSocket (`wss://$DOMAIN/ws`), database và
ledger đều đúng.

Chi tiết từng ô, và bảng sự cố đầy đủ: `docs/deployment-normal.md` mục 2 và mục 10.

---

## 10. Pre-flight: chạy test suite trên PostgreSQL **thật**

Việc này nên làm **một lần**, trước khi có người chơi thật, và nó đóng lại một dòng đang mở trong
`docs/known-limitations.md`.

Toàn bộ test của `@bp/normal-server` chạy trên **PGlite** — Postgres biên dịch sang WebAssembly, trong
cùng tiến trình. PGlite chỉ có **một kết nối**, nên hai transaction "đồng thời" ở đó không bao giờ
thật sự chồng lên nhau: `SELECT … FOR UPDATE`, thứ mà **toàn bộ thiết kế tiền** dựa vào, không chứng
minh được gì cả. Những test đó **chỉ thực thi khi có `TEST_DATABASE_URL`**.

Có hai cách. **Cách A gọn hơn và an toàn hơn** — chạy ngay trên VM, không mở cổng nào:

```bash
# trên VM — apt's `nodejs` trên Ubuntu 24.04 là bản 18; repo này khai `engines.node >= 22.13`
# (image cũng build trên node:22-alpine), nên cài bằng NodeSource:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs                                 # hoặc nvm install 22, nếu bạn quen hơn
sudo npm i -g pnpm@9
cd /opt/bind-poker
pnpm install --frozen-lockfile

# một Postgres dùng một lần, chỉ nghe trên loopback của chính VM
docker run --rm -d -p 127.0.0.1:5432:5432 -e POSTGRES_PASSWORD=preflight \
  --name bp-preflight-db postgres:16-alpine

TEST_DATABASE_URL=postgres://postgres:preflight@127.0.0.1:5432/postgres \
  pnpm --filter @bp/normal-server test

docker rm -f bp-preflight-db
```

`createTestDb()` tự tạo `bp_test_<random>` mỗi lần rồi tự drop, nên nó không đụng gì tới database
thật. Yêu cầu: **0 test bị skip** và tất cả pass.

Lưu ý: `pnpm install` đầy đủ ở đây kéo về cả devDependency của mọi package (vài trăm MB) và không
liên quan gì tới image đang chạy. Xong việc thì `rm -rf node_modules */node_modules` nếu muốn dọn.

**Cách B — chạy test từ máy dev, mở tạm cổng 5432 cho đúng một IP.** Chỉ làm khi cách A không tiện,
và nhớ đóng lại:

1. Security List → **Add Ingress Rules**: Source CIDR **`<IP-nhà-bạn>/32`** (không bao giờ là
   `0.0.0.0/0`), TCP, port `5432`.
2. Trên VM, mở cùng cổng đó ở iptables cho đúng IP ấy, và chạy Postgres nghe ra ngoài:

   ```bash
   sudo iptables -I INPUT 1 -p tcp -s <IP-nhà-bạn>/32 --dport 5432 -j ACCEPT
   docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=preflight \
     --name bp-preflight-db postgres:16-alpine
   ```

3. Từ máy dev: `TEST_DATABASE_URL=postgres://postgres:preflight@<IP>:5432/postgres pnpm --filter @bp/normal-server test`
4. **Đóng lại — cả ba thứ:**

   ```bash
   docker rm -f bp-preflight-db
   sudo iptables -D INPUT -p tcp -s <IP-nhà-bạn>/32 --dport 5432 -j ACCEPT
   sudo netfilter-persistent save
   ```

   …và xoá ingress rule 5432 trong Security List.

> Container `db` của stack **không publish cổng nào**, và phải giữ nguyên như vậy. Một Postgres 5432
> mở ra Internet với superuser chỉ có mật khẩu là cách các máy chủ kiểu này bị chiếm. Bước trên dùng
> một container **riêng, dùng một lần**, chứ không phải database thật.

---

## 11. Giới hạn Always Free — đọc trước khi coi đây là chỗ ở lâu dài

**Tài nguyên idle có thể bị thu hồi.** Với tài khoản **Always Free** (chưa nâng PAYG), Oracle có
chính sách thu hồi máy ảo "nhàn rỗi" — tiêu chí công bố là trong 7 ngày liên tục có CPU trung bình
< 20 %, network < 20 % và (với A1) memory < 20 % ở phân vị 95. Một server poker ít người chơi **rất
dễ** rơi vào ngưỡng đó. Khi bị thu hồi, instance bị stop (không xoá đĩa) và bạn phải tự start lại —
nhưng nếu nó xảy ra lúc bạn không để ý thì site đơn giản là chết.

Cách xử lý, theo thứ tự nên làm:

1. **Nâng lên PAYG** (mục 1). Chính sách idle-reclaim **không áp dụng** cho tài khoản PAYG, và phần
   Always Free vẫn miễn phí. Đây là cách sạch nhất.
2. **Giám sát từ bên ngoài.** Một uptime check miễn phí (UptimeRobot, Better Stack, …) gọi
   `https://$DOMAIN/health` mỗi 5 phút. Nó không cứu bạn khỏi bị thu hồi nhưng cho bạn biết ngay khi
   xảy ra — và endpoint đó trả `503` khi database chết, nên nó cũng là cảnh báo sự cố thật.
3. Đừng "chống idle" bằng cách đốt CPU giả. Nó vi phạm tinh thần của hạn mức miễn phí, và Oracle nhìn
   nhiều chỉ số chứ không chỉ CPU.

**Những giới hạn khác đáng biết:**

- **Hạn mức Always Free** cho ARM là tổng **4 OCPU + 24 GB RAM** cho cả tài khoản, và **200 GB** block
  volume. Máy 2/8 ở đây dùng một nửa CPU và một phần ba RAM của hạn mức.
- **Băng thông ra** 10 TB/tháng. Just a Normal Poker đẩy JSON qua WebSocket, không phải video — con số này
  không phải thứ bạn cần lo.
- **Ổ 50 GB** phải chứa image Docker (~1 GB), database, và **các bản dump** nếu bạn để chúng ở đây.
  Mục 12 nói chuyện đó.
- **Backup nằm cùng máy thì không phải backup.** Nếu instance bị thu hồi, bị xoá, hoặc bạn mất quyền
  vào tài khoản, đống dump trên `/var/backups` đi cùng nó.

Tất cả những mục này cũng được ghi trong [`../../docs/known-limitations.md`](../../docs/known-limitations.md).

---

## 12. Sao lưu

`deploy/normal/backup.sh` đã sẵn sàng; việc còn lại là hẹn giờ. Xem
[`backup-cron.example`](backup-cron.example) — file đó có đầy đủ lệnh cài, dòng cron 03:00 giữ 14 bản,
và cách chép dump ra khỏi máy này.

Tóm tắt:

```bash
sudo install -d -o ubuntu -g ubuntu /var/backups/bind-poker
sudo touch /var/log/bind-poker-backup.log && sudo chown ubuntu:ubuntu /var/log/bind-poker-backup.log
crontab -e          # dán dòng cron trong backup-cron.example
crontab -l          # kiểm lại

cd /opt/bind-poker/deploy/normal && BACKUP_DIR=/var/backups/bind-poker ./backup.sh   # chạy thử ngay
```

Hai thứ **không** nằm trong dump nhưng phải giữ cùng nó: `SESSION_SECRET` (mất là mọi phiên trong bản
khôi phục chết) và volume `caddy_data` (tài khoản ACME + chứng chỉ). Chi tiết:
`docs/deployment-normal.md` mục 6.

---

## 13. Cập nhật

```bash
cd /opt/bind-poker/deploy/normal
./backup.sh                                   # 1. luôn luôn, và ngay trước khi nâng cấp
git -C /opt/bind-poker pull --ff-only         # 2.
docker compose up -d --build                  # 3. build lại, chạy lại migrate, tạo lại app
docker compose logs -f app
```

Lần build thứ hai trở đi nhanh hơn nhiều — layer `pnpm install` được dùng lại nếu manifest không đổi.

**Ván đang chơi không sống qua lần khởi động lại.** Chúng bị huỷ và mọi khoản cược được hoàn, nên
không ai mất điểm, nhưng người đang ngồi bàn sẽ thấy ván biến mất. Nâng cấp lúc bàn trống nếu được.

Muốn cập nhật cả phần hệ thống của máy (Docker, gói apt, firewall) thì chạy lại `bootstrap.sh` —
nó chỉ làm những gì còn thiếu:

```bash
sudo /opt/bind-poker/deploy/oracle/bootstrap.sh https://github.com/<user>/<repo>.git master
```

---

## 14. Lùi lại khi hỏng

Quy trình đầy đủ nằm ở [`../normal/restore.md`](../normal/restore.md) — đọc nó **trước** khi cần, chứ
không phải lúc đang cần. Đường ngắn nhất:

```bash
cd /opt/bind-poker/deploy/normal
docker compose stop app
./backup.sh                                   # kể cả khi bạn tin dữ liệu hiện tại là bỏ đi
docker compose exec -T db pg_restore -U postgres -d bind_poker --clean --if-exists --no-owner \
  < /var/backups/bind-poker/bp-<ngày>-<giờ>.dump
git -C /opt/bind-poker checkout <tag hoặc commit cũ>
docker compose up -d --build
```

**Không có down-migration.** Lùi schema nghĩa là khôi phục dump *đã lấy trước khi nâng cấp* rồi chạy
image cũ — đó là lý do bước 1 của mục 13 không phải tuỳ chọn.

---

## 15. Bảng tra nhanh sự cố riêng của Oracle

| Triệu chứng | Nguyên nhân |
| --- | --- |
| ssh vào được, `curl http://<IP>` timeout | Một trong hai lớp firewall. Security List (mục 3) **và** iptables trong máy (mục 5). Kiểm lớp thứ hai: `sudo iptables -L INPUT -n --line-numbers` — hai dòng ACCEPT cho 80/443 phải nằm **trên** dòng `REJECT`. |
| Cổng mở đúng, nhưng sau reboot lại đóng | `netfilter-persistent save` chưa chạy. Chạy lại `bootstrap.sh`. |
| `docker: permission denied … /var/run/docker.sock` | Phiên ssh mở **trước** khi vào nhóm `docker`. Thoát và ssh lại. |
| `Out of capacity` khi tạo instance | Mục 2. Đổi AD, thử giờ khác, giảm shape, hoặc nâng PAYG. |
| Máy tự tắt sau vài ngày yên ắng | Idle-reclaim của Always Free. Mục 11. |
| Build image bị `Killed` giữa chừng | Hết RAM. Kiểm `swapon --show`; xem bảng ở mục 8. |
| Chứng chỉ không xuất hiện | DNS, cổng 80, hoặc rate limit ACME. Mục 8, dòng cuối bảng. |
| `502 Bad Gateway` từ Caddy | `app` không nghe. `docker compose logs app`. |
| Đĩa đầy | `docker system prune -a` dọn image và layer cũ; kiểm `du -sh /var/backups/bind-poker`. |

Mọi triệu chứng **không** riêng của Oracle nằm ở `docs/deployment-normal.md` mục 10.
