# Just a Normal Poker — Sổ tài sản avatar và vòng lặp sinh ảnh qua ChatGPT

Ngày 2026-09-24. Bổ sung cho spec `2026-09-14-avatar-chibi-ai-design.md` (Plan 11). Người dùng chốt: sinh ảnh bằng ChatGPT Plus trong Chrome của họ, Claude điều khiển qua tiện ích Claude in Chrome (đường B), không dùng API OpenAI.

## 1. Mục tiêu

Thay quy trình thủ công (Claude gửi prompt, người dùng dán, tải, lưu, báo) bằng một vòng lặp mà Claude tự chạy: đọc sổ, sinh ảnh còn thiếu trong ChatGPT, tải về, chấm điểm, nạp vào pipeline, ghi trạng thái, lặp. Người dùng chỉ duyệt phong cách theo bảng ghép mỗi đợt.

## 2. Phạm vi

- Mới: `assets/avatar-src/registry.json` (được commit; `.gitignore` của thư mục thêm `!registry.json`), script `apps/normal-web/scripts/avatar-registry.mjs`, tài liệu `docs/avatar-2d.md` (mục mới "Sổ tài sản và vòng lặp sinh ảnh").
- Không đổi: `items.json`, `avatar-bases.json`, manifest, pipeline `avatar-pipeline.mjs` (sổ gọi nó, không sửa nó ngoài việc cần cho ingest vào thư mục tạm, đã có `--out`).
- Không có: độ hiếm, thành tựu, khung hiển thị, hiệu ứng động trong sổ — chúng đã ở nơi khác hoặc đã bị loại theo quyết định 14/09.

## 3. Sổ tài sản `registry.json`

```jsonc
{
  "version": 1,
  "templates": {                       // mẫu prompt; {{look.x}} thay bằng trường của mục, {{ref}} là tên tệp tham chiếu
    "base": "…", "expression": "…", "head": "…", "face": "…", "outfit": "…", "aura": "…", "frame": "…", "bot": "…"
  },
  "assets": [
    {
      "id": "f02",                     // khoá; = tên lớp không có hậu tố _L<n>; biểu cảm: "f02:happy"; bản theo giới: "item_outfit_dealer01:m"
      "kind": "base",                  // base | expression | item | aura | frame | bot
      "slot": null,                    // item: head | face | outfit; aura/frame: chính nó
      "wear": "f",                     // base: f | m; item bản riêng: f | m; còn lại null
      "catalog": "f02",                // id trong avatar-bases.json / items.json (bot: bot_<n>)
      "look": { "hair_style": "…", "hair_color": "…", "eye_color": "…", "skin": "…", "expression": "…" },
                                       // item: { "description", "color", "style" }; expression: { "expression" }
      "reference": "f01_candidate_1.png",   // ảnh đính kèm khi sinh; null với aura/frame
      "prompt": null,                  // null = sinh từ template + look; chuỗi = ghi đè tay
      "file": "f02_candidate_1.png",   // tên tệp ảnh sinh ra trong assets/avatar-src/
      "ingest": { "as": "base:f02", "base": null, "variant": null, "flags": [] },
      "status": "todo",                // todo | generated | ok | ng | rework-<n> | approved | blocked
      "attempts": [                    // ghi mỗi lần sinh
        { "n": 1, "at": "2026-09-24T10:00:00+07:00", "chat": "https://chatgpt.com/c/…", "file": "…", "measure": { … }, "verdict": "ng", "reason": "drift 61 px" }
      ]
    }
  ]
}
```

Luật:
- `reference` trỏ tới một tệp trong `assets/avatar-src/` hoặc tới `id` của một mục khác (dạng `@f02`): mục chỉ **sẵn sàng** khi tham chiếu là tệp có thật hoặc mục kia có trạng thái `ok`/`approved`. Biểu cảm của thân mới tham chiếu `@<base>`.
- `prompt` được sinh lại mỗi lần đọc nếu là `null`, nên đổi template là đổi mọi prompt chưa ghi đè. Sau lần thất bại thứ n, prompt của lần n+1 = prompt + dòng chống lỗi lấy từ `reason` (bảng cố định: `redrawn` → "same image size, same hair, same clothing"; `tears` → "No tears"; `hair_colour` → "same hair colour"; `background` → "transparent background, no checkerboard"; `cropped` → "whole figure inside the image").
- Tối đa 3 lần: sau lần 3 `ng` → `blocked`, vòng lặp bỏ qua, báo người dùng.
- `approved` chỉ do người dùng đặt (qua lệnh `approve <id…>` hoặc trả lời "ok" cho bảng ghép: mọi `ok` của đợt thành `approved`). "<id> ng" từ người dùng → `rework-<n>` với reason `style`.

## 4. Sinh ảnh (Claude điều khiển Chrome)

Không có script cho bước này; Claude làm bằng công cụ Claude in Chrome theo quy trình cố định, ghi trong mục đó của `docs/avatar-2d.md`:
1. `avatar-registry.mjs next [--limit n]` in các mục sẵn sàng theo thứ tự ưu tiên (item trên F01 → base mới → expression → aura → frame → bot), kèm prompt đã render và đường dẫn tuyệt đối của tệp tham chiếu.
2. Với mỗi mục: mở `https://chatgpt.com/` (chat mới), tải tham chiếu qua ô `input[type=file]` ẩn, dán prompt, gửi, chờ tới khi ảnh của trợ lý xuất hiện (tối đa 4 phút), bấm tải về, ghi URL chat.
3. `avatar-registry.mjs collect <id> --chat <url>` chuyển tệp PNG mới nhất trong thư mục Downloads của Chrome (`C:\Users\<user>\Downloads`, cấu hình `--downloads`) vào `assets/avatar-src/<file>` (ghi đè bản cũ sau khi đổi tên bản cũ thành `<file>.prev<n>.png`), đặt `status: generated`, thêm attempt.
4. Gặp thông báo hết lượt ảnh hoặc CAPTCHA: dừng, ghi `paused_until` vào sổ (`meta.pausedUntil`), báo người dùng.

Tải về là hành động ngoài dự án; người dùng đã duyệt cho toàn bộ vòng lặp (24/09).

## 5. Chấm điểm `avatar-registry.mjs verify [<id…>]`

Chạy trên mọi mục `generated`. Kết luận `ok`/`ng` + `reason` (mã cố định) + số đo, ghi vào attempt và `status`:
- `size`: đúng 1024×1536 (aura/frame: vuông ≥ 1024).
- `background`: alpha 0 ở 4 góc và không có mẫu carô (độ lệch chuẩn màu vùng trong suốt-lẽ-ra bằng 0).
- `drift`: hộp bao lệch tham chiếu ≤ 12 px mỗi cạnh (base mới so với ảnh tham chiếu; expression/item so với thân của nó).
- `heads`: `measure()` 2.0–2.5 (chỉ base, expression, item).
- `hair_colour`: expression/item: màu tóc trung bình vùng đỉnh đầu lệch ≤ 12 so với thân.
- `scope`: expression: tỉ lệ điểm ảnh khác thân ngoài vùng đầu < 1 %; item head/face: khác ngoài vùng cho phép của slot < 1 %; outfit: khác trên đường cằm < 1 %.
- `pipeline`: ingest thử vào thư mục tạm (`--out`), rồi `check` các lớp vừa tạo; bất kỳ tiêu chí nào fail → `ng` với `reason: check:<Cn>`.
- Aura/frame: `size`, `background`, và vòng rỗng ở giữa (alpha trung bình trong bán kính 40 % < 0.05).
`verify` không bao giờ ghi vào `public/avatar/`.

## 6. Nạp và đợt

- `avatar-registry.mjs ingest [<id…>]`: với mục `ok`/`approved` chưa nạp, chạy `avatar-pipeline.mjs ingest` thật với `ingest.as/base/variant/flags`; base mới → thêm mục vào `BASES`/`BASE_WEAR` (manifest.mjs) và `avatar-bases.json` + khoá i18n nếu chưa có (script chỉ kiểm tra và báo, sửa tay ba chỗ đó là việc của implementer/Claude); item bản `m` → thêm `variants.m` vào `items.json`. Ghi `ingested: true`.
- `avatar-registry.mjs status`: bảng đếm theo trạng thái và danh sách `blocked`.
- Đợt = 10 mục. Sau mỗi đợt: `check`, `sheet`, commit "art: batch n", gửi bảng ghép. Người dùng trả lời `<id> ng` hoặc im lặng.

## 7. Nội dung sổ ban đầu

61 mục: `item_outfit_casual01` (sinh lại, reason `strap`), 7 head, 3 face, 8 aura, 6 frame, 8 bot, 4 base (`f02`, `f03`, `m02`, `m03` với `look` theo bảng 21/09) + 20 expression. Prompt template lấy từ các câu lệnh đã dùng (tin 17–21/09) và §4.3 spec 14/09. Bot: template base với `look` robot theo spec 14/09 §7 (8 màu vỏ, mắt LED) tham chiếu `f01_candidate_1.png` để giữ tỉ lệ; mỗi bot 1 ảnh thường + 1 ảnh vui (`bot_<n>:happy`).

## 8. Kiểm thử

Vitest cho: đọc/ghi sổ và xác thực cấu trúc; render prompt từ template + look + dòng chống lỗi; luật `next` (sẵn sàng, ưu tiên, giới hạn 3 lần); từng luật `verify` trên ảnh tổng hợp (đúng/sai mỗi luật); `collect` với thư mục Downloads giả. Phần Chrome không có test tự động: đợt đầu 3 mục do Claude chạy tay và ghi lại vào docs.

## 9. Rủi ro

- Giao diện ChatGPT đổi → Claude cập nhật quy trình §4, sổ không đổi.
- ChatGPT vẽ lại toàn bộ (đã gặp) → `scope`/`drift`/`hair_colour` bắt được, sinh lại với dòng chống lỗi.
- Hết lượt Plus → tạm dừng, không mất trạng thái.
