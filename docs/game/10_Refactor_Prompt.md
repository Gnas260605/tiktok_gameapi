# 10 — Prompt làm sạch & refactor codebase (Phase 0)

> Chạy **sau** A1 Audit và **trước** Bước 2 (P2). Lý do: A3 sẽ sửa `event-ingestion.service.ts` và A4 sẽ dùng chung code kết nối WebSocket của frontend. Refactor sau khi các agent đó bắt đầu sẽ gây xung đột merge.
> Một agent duy nhất, nhánh `tutien/p0-refactor`. Dán prompt chung §0 của `09_Antigravity_Prompts.md` trước, rồi dán prompt dưới đây.

## Hiện trạng (Claude rà soát ngày 2026-11-05)

| Vấn đề | Bằng chứng |
|---|---|
| Thư mục chỉ re-export, không ai import | `src/adapters/mock/index.ts`, `src/adapters/tiktok-live/index.ts` |
| Đọc biến môi trường rải rác, không validate | 12 lần `process.env.*` trong `src/`, không có `src/config/` |
| `zod` có trong dependencies nhưng không được dùng | Không file nào trong `src/` import `zod` |
| Kiểu `any` nhiều | 123 chỗ `: any` / `as any` trong `src/` |
| Log lẫn `console.*` và pino | 13 lần `console.log/warn/error` trong `src/` |
| Service quá nhiều trách nhiệm | `event-ingestion.service.ts` 619 dòng: dedup, chuẩn hóa user, thống kê session, lưu DB, broadcast |
| Frontend là 2 file HTML khổng lồ, JS/CSS inline | `public/index.html` 1.610 dòng, `public/game.html` 1.299 dòng; logic ticket + WebSocket lặp ở cả hai |
| Chưa có lint/format | Không có ESLint, Prettier, `.editorconfig` |
| Tài liệu tách đôi, `CLAUDE.md` trỏ sai | `CLAUDE.md` ghi `docs/PRD.md`, `docs/ERD.md`… nhưng chúng nằm ở `tikuser_api_technical_docs/docs/` |
| Script trùng | `migrate` = `prisma:deploy`, `seed` = `prisma:seed` |
| Tên file test không nhất quán | `adversarial_isolation.test.ts` và `adversarial-database.test.ts` |

## Prompt

```text
VAI TRÒ: Refactor Engineer — Phase 0 của TU TIÊN LIVE.
Nhánh: git fetch origin && git checkout -B tutien/p0-refactor origin/main
Đọc: CLAUDE.md, docs/game/AUDIT.md (nếu đã có), docs/game/05_Architecture.md, docs/game/10_Refactor_Prompt.md
(bảng "Hiện trạng" là danh sách việc của bạn).

MỤC TIÊU: code dễ đọc, dễ thêm module mới (game TU TIÊN LIVE sẽ là module đầu tiên), dễ nâng cấp
thư viện — mà KHÔNG thay đổi hành vi.

HỢP ĐỒNG KHÔNG ĐƯỢC ĐỔI (Hyrum's law — client đang dựa vào chúng):
- Mọi URL, method, status code, envelope { success, data, meta } / { success:false, error }, tên trường JSON.
- Giao thức WebSocket /ws (ticket, authenticate, subscribe, frame event), mã lỗi.
- Schema DB: KHÔNG tạo migration trong phase này.
- Biến môi trường hiện có giữ tên cũ.
- Đường dẫn /, /game, /docs, /game-assets/:file và giao diện nhìn thấy.

BƯỚC 0 — BASELINE (bắt buộc trước khi sửa gì):
  pnpm install && pnpm typecheck && pnpm test
  Lưu kết quả (số pass/fail, thời gian) vào docs/game/handoffs/P0-refactor.md.
  Chụp hợp đồng: lưu GET /docs/json → tests/contract/openapi.snapshot.json, và viết test
  tests/contract/openapi-contract.test.ts so sánh spec sinh ra với snapshot (chỉ được THÊM, không bớt/đổi).
  Test nào đỏ sẵn từ trước: ghi lại, KHÔNG sửa lén.

LÀM THEO LÁT, MỖI LÁT = 1 COMMIT, typecheck + test xanh sau mỗi lát:

R1. Công cụ: ESLint (typescript-eslint, flat config) + Prettier + .editorconfig; script lint, lint:fix,
    format, format:check. Rule no-explicit-any = warn (chưa error). Commit format toàn repo RIÊNG
    (chỉ format, không đổi logic) để review dễ.
R2. Xóa code chết: src/adapters/mock và src/adapters/tiktok-live (grep src + tests trước, phải 0 import).
    Script trùng: giữ prisma:deploy / prisma:seed, đổi migrate / seed thành alias gọi lại chúng
    (không xóa — có thể có người dùng). Gom tikuser_api_technical_docs/docs/* về docs/
    (PRD.md, ERD.md, API_OPENAPI.yaml, WEBSOCKET_PROTOCOL.md), chuyển AI_IMPLEMENTATION_PROMPT.md
    sang docs/archive/, sửa mọi link trong CLAUDE.md, README.md.
R3. Cấu hình tập trung: src/config/env.ts — schema zod cho TOÀN BỘ biến môi trường, parse một lần lúc
    khởi động, lỗi thì dừng với thông báo rõ biến nào sai. Xuất object config có kiểu, truyền vào
    buildApp(). Thay 12 chỗ process.env. Cập nhật .env.example có chú thích từng biến.
R4. Log thống nhất: thay 13 console.* bằng pino logger được inject (child logger theo module).
    Không log API key, ticket, token.
R5. Tách EventIngestionService (giữ nguyên public API và import path cũ):
      dedup-cache.ts           cache dedup sliding window
      session-stats.tracker.ts thống kê session/user trong bộ nhớ
      event-sink.ts            interface EventSink { onPersisted(event, user): void | Promise<void> }
    Service nhận danh sách sinks; realtime broadcaster trở thành một EventSink. Lỗi của một sink
    không được làm hỏng ingest hay sink khác (try/catch từng sink + log). Đây chính là điểm móc
    GameEventBus mà 05_Architecture §2 cần — sau lát này A3 chỉ cần đăng ký thêm một sink.
    Test mới cho từng phần tách ra; test cũ không sửa.
R6. Giảm any: dữ liệu thô từ upstream TikTok dùng unknown + thu hẹp kiểu tại hàm map
    (mapGiftPayload, handler chat/like...); repository dùng kiểu Prisma. Mục tiêu ≤ 20 any,
    mỗi any còn lại có comment lý do. Không đổi logic map.
R7. Validate ở biên: schema zod (hoặc Fastify JSON schema đang dùng — chọn MỘT, ghi ADR) cho body/query
    mọi controller; lỗi trả đúng envelope BAD_REQUEST hiện tại (cùng code, cùng cấu trúc details).
R8. Composition root: tách việc tạo dependency trong src/app.ts ra src/container.ts
    (createContainer(config, prisma) → repos, services). Thêm kiểu
      interface AppModule { name: string; register(app, container): void | Promise<void> }
    và danh sách module trong src/modules.ts. Các register*Routes hiện có bọc thành module.
    Module mới (TU TIÊN LIVE) sau này chỉ cần thêm một dòng, có thể bật/tắt bằng env
    (GAME_TUTIEN_ENABLED). KHÔNG di chuyển thư mục controllers/services/repositories hiện có.
R9. Frontend: tách <script>/<style> inline của public/index.html và public/game.html ra
    public/js/*.js, public/css/*.css. Code dùng chung (gọi API có key, xin ticket, WebSocket tự
    reconnect + xin ticket mới) → public/js/shared/live-client.js, cả hai trang dùng chung
    (overlay TU TIÊN sẽ dùng lại). Thêm route tĩnh có whitelist cho /js và /css (giống /game-assets,
    chặn path traversal) hoặc @fastify/static giới hạn thư mục. Mở cả hai trang bằng trình duyệt,
    so sánh screenshot trước/sau, console không lỗi, chế độ ?demo của /game vẫn chạy.
R10. Test: đổi tên file test theo kebab-case; gom helper lặp lại vào tests/helpers
    (buildTestApp, seedTenant, createApiKey, wsConnect). Thời gian pnpm test không tăng quá 10%.
R11. Tài liệu: cập nhật cây thư mục trong CLAUDE.md; thêm docs/CONTRIBUTING.md
    ("thêm một module mới trong 5 bước", quy ước đặt tên, lệnh lint/test); thêm ADR vào
    docs/TECH_DECISIONS.md cho R3, R5, R7, R8.

ĐIỀU KIỆN DỪNG & HỎI (ghi vào bàn giao, không tự làm):
- Một thay đổi bắt buộc phải đổi hành vi/hợp đồng.
- Một test cũ phải sửa kỳ vọng mới qua được.
- Nâng major version thư viện (Fastify 5, Prisma 6, Vitest 3...) — KHÔNG làm trong phase này,
  chỉ liệt kê đề xuất nâng cấp + rủi ro trong bàn giao.

ĐỊNH NGHĨA XONG:
- pnpm lint (0 error), pnpm typecheck, pnpm test xanh; test hợp đồng OpenAPI xanh.
- Số any ≤ 20, 0 console.* trong src/, 0 process.env ngoài src/config/.
- event-ingestion.service.ts ≤ 300 dòng; có EventSink.
- Bàn giao docs/game/handoffs/P0-refactor.md: bảng trước/sau (any, console, process.env, dòng code
  file lớn nhất, thời gian test), danh sách commit theo lát, đề xuất nâng cấp thư viện.
- git push -u origin tutien/p0-refactor. Không push main.
```

## Claude sẽ review gì

1. Mỗi commit chỉ làm một lát (diff không trộn format với logic).
2. Test hợp đồng OpenAPI và toàn bộ test cũ xanh, không test cũ nào bị sửa kỳ vọng.
3. `EventSink`: lỗi một sink không chặn ingest (có test).
4. Không có migration, không đổi tên biến môi trường.
5. Hai trang `/` và `/game` hoạt động như cũ trên trình duyệt.
