# Bind Poker — Triển khai miễn phí: F1 (test nội bộ trên Windows) và F2 (public trên Oracle Cloud Always Free)

Ngày: 2026-09-07. Trạng thái: đã duyệt qua brainstorming; Plan 9 triển khai.
Liên quan: spec chính §22.5 (env), §28.1 (Compose), `docs/deployment-normal.md`, `deploy/normal/*`.

## 1. Mục tiêu
Cho phép chạy bản Normal **không tốn tiền**, theo hai bước:
- **F1 — test nội bộ:** trên một máy Windows trong LAN, bằng Node 22 + Postgres miễn phí (Neon), không Docker, không HTTPS.
- **F2 — public lâu dài:** trên một VM ARM Oracle Cloud Always Free, bằng Docker Compose sẵn có (`deploy/normal/`), HTTPS qua Caddy, DNS công khai.
Không đổi mã ứng dụng; chỉ thêm script, mẫu cấu hình và runbook.

## 2. Phạm vi
| # | Hạng mục | Trong / ngoài |
|---|---|---|
| S1 | `deploy/normal-windows/{run.ps1, stop.ps1, .env.example, README.md}` | Trong |
| S2 | `deploy/oracle/{bootstrap.sh, README.md, backup-cron.example}` | Trong |
| S3 | `docs/deployment-normal.md` trỏ tới hai runbook; `README.md` mục "Chạy thử miễn phí"; `docs/known-limitations.md` (Neon ngủ, Oracle thu hồi idle, image ARM chưa build ở dev) | Trong |
| S4 | Kiểm thử: script Windows chạy được với server PGlite thay Neon; `bootstrap.sh` qua `bash -n` (+ shellcheck nếu có); Dockerfile không đổi | Trong |
| — | Đăng ký tài khoản Oracle/Neon, nhập thẻ/mật khẩu (người dùng tự làm); Vercel; Windows Service cho Normal (dùng `schtasks` như Lite nếu cần, chỉ ghi hướng dẫn) | Ngoài |

## 3. F1 — Windows, LAN
- Yêu cầu: Node 22 trên máy, đã `pnpm build:normal` (có `apps/normal-server/dist` + `apps/normal-web/dist`), một `DATABASE_URL` Postgres (Neon free: `postgres://…neon.tech/…?sslmode=require`; hoặc Postgres cài tay).
- `deploy/normal-windows/.env` (từ `.env.example`): `DATABASE_URL`, `SESSION_SECRET` (≥ 32 ký tự), `PORT=8080`, `HOST=0.0.0.0`, `ALLOWED_ORIGINS=http://localhost:8080,http://<IP-LAN>:8080`, `COOKIE_SECURE=false`, `TRUST_PROXY=false`, `PUBLIC_DIR=../../apps/normal-web/dist` (đường dẫn tương đối từ `apps/normal-server`, script chuẩn hoá thành tuyệt đối), `AUTO_MIGRATE=false`, `ECONOMY_TIMEZONE=Asia/Ho_Chi_Minh`, `LOG_LEVEL=info`.
- `run.ps1`: kiểm Node ≥ 22.13 và các `dist`; đọc `.env` (bỏ dòng `#`, hỗ trợ giá trị có dấu `=`); từ chối placeholder `CHANGE_ME`; tự điền IP LAN vào `ALLOWED_ORIGINS` nếu có `<IP-LAN>`; chạy `node dist/migrate-cli.js` trong `apps/normal-server` rồi `node dist/main.js`; in URL LAN; ghi pid vào `deploy/normal-windows/normal.pid`. Tham số `-NoMigrate`, `-Port`.
- `stop.ps1`: đọc pid, gửi Ctrl+C không được trên Windows → dùng `Stop-Process` (tắt cứng: stack đang trên bàn mất — ghi rõ; Normal không có run-file/`--stop` như Lite) — **quyết định:** chấp nhận cho test nội bộ; runbook khuyên đóng phòng trước khi dừng.
- Firewall: `New-NetFirewallRule -DisplayName "Bind Poker Normal" -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -Action Allow` (ghi trong README, không tự chạy).
- Tunnel tuỳ chọn: `cloudflared tunnel --url http://localhost:8080` → đổi `ALLOWED_ORIGINS` sang URL tunnel, `COOKIE_SECURE=true`, `TRUST_PROXY=loopback`.

## 4. F2 — Oracle Cloud Always Free
- VM `VM.Standard.A1.Flex` 2 OCPU / 8 GB / 50 GB, Ubuntu 24.04 aarch64, region SG/JP; Security List ingress TCP 22, 80, 443; SSH khoá.
- `bootstrap.sh` (chạy bằng `sudo` trên VM, idempotent): mở iptables 80/443 và lưu (`netfilter-persistent`); swap 2 GB nếu chưa có; cài Docker Engine + Compose plugin từ repo Docker (arm64); thêm `ubuntu` vào nhóm docker; `unattended-upgrades`; cài `git`; clone/pull repo vào `/opt/bind-poker` (URL repo là tham số); in các bước tiếp theo.
- Deploy: `deploy/normal/.env` (`DOMAIN`, `POSTGRES_PASSWORD`, `SESSION_SECRET`, `ALLOWED_ORIGINS=https://$DOMAIN`, `TRUST_PROXY=uniquelocal`, `COOKIE_SECURE=true`, `ECONOMY_TIMEZONE`), `docker compose -f deploy/normal/docker-compose.yml up -d --build` — image build ARM tại chỗ (lần build image thật đầu tiên của dự án: runbook dự phòng lỗi build, nêu cách xem log `docker compose build --progress=plain`).
- DNS: bản ghi A `play.<domain>` → IP public; chưa có domain thì `DOMAIN=play.<IP-với-dấu-gạch>.sslip.io` (ví dụ `play.1-2-3-4.sslip.io`).
- Vận hành: `backup-cron.example` (cron 03:00 chạy `backup.sh`, giữ 14 bản), cập nhật `git pull && docker compose up -d --build`, rollback theo `restore.md`, kiểm `/health`, xem log. Pre-flight: chạy `pnpm --filter @bp/normal-server test` với `TEST_DATABASE_URL` trỏ vào Postgres trong VM (mở tạm cổng 5432 chỉ cho IP dev, hoặc chạy test ngay trên VM) — đóng mục "chưa chạy trên Postgres thật" của bảng nghiệm thu.
- Lưu ý Always Free: tài nguyên idle có thể bị thu hồi nếu tài khoản không PAYG; ghi trong README và known-limitations.

## 5. Kiểm thử (S4)
- `deploy/normal-windows/run.test.ts`? Không: script PowerShell được kiểm bằng cách chạy thật trên máy dev với `DATABASE_URL` giả — không có Postgres ở dev, nên test ở mức: `run.ps1 -DryRun` in ra cấu hình đã chuẩn hoá và lệnh sẽ chạy (được kiểm bằng một test Vitest gọi `pwsh`/`powershell` và so sánh đầu ra; skip nếu không có PowerShell). Chạy thật với Neon do người dùng làm theo runbook.
- `bootstrap.sh`: `bash -n`; shellcheck nếu có trên máy (ghi kết quả); không chạy thật ở dev.
- Không thay đổi Dockerfile/Compose ngoài việc thêm ghi chú ARM nếu cần.

## 6. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Image chưa từng build thật; ARM lần đầu | Runbook có bước xem log và các lỗi có thể gặp (argon2 prebuild, pnpm deploy); dự phòng builder cài toolchain |
| Neon free ngủ | Ghi rõ; kết nối đầu chậm 1–2 s |
| Oracle hết hàng A1 / thu hồi idle | Thử lại theo giờ, đổi AD; nâng PAYG |
| Dừng Normal trên Windows là tắt cứng | Chỉ dùng cho test nội bộ; đóng phòng trước khi dừng |

## Phụ lục — Quyết định
- D1: F1 chạy HTTP trong LAN, không tunnel mặc định (test nội bộ).
- D2: F2 dùng Compose sẵn có, build ARM tại VM, HTTPS qua Caddy; `sslip.io` khi chưa có domain.
- D3: Không thêm Windows Service cho Normal; không thêm cơ chế dừng êm (chỉ ghi giới hạn).
- D4: Đăng ký dịch vụ do người dùng làm; tôi không nhập thẻ/mật khẩu thay.
