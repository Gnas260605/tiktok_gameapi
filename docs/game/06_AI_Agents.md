# 06 — Phân công Claude Agents: TU TIÊN LIVE

> Phiên bản 1.0 · 2026-11-05 · Áp dụng cho Claude Code (và agent khác như Antigravity)
> Mọi agent đọc `CLAUDE.md` gốc + tài liệu `docs/game/01–08` trước khi làm. Khi tài liệu mâu thuẫn: **ERD + OpenAPI** thắng (là hợp đồng), Architect giải quyết và cập nhật tài liệu.

## 1. Luật chung (spec §29, áp dụng cho mọi agent)

1. Đọc code trước khi sửa. Ghi rõ file đã đọc trong báo cáo.
2. Không xóa/viết lại chức năng đang chạy: connector TikTok, ingestion, WebSocket ticket, game Leo Chùa `/game`.
3. Không tạo kết nối TikTok mới. Không đoán tên trường — dùng payload của `mapGiftPayload` / handler `chat` trong `src/adapters/tiktok/live.connector.ts`.
4. Không hardcode thông số gameplay — đọc từ `GameConfigService`.
5. Frontend không quyết định kết quả; không có `Math.random` trong logic gameplay.
6. Không bỏ migration, không bỏ unit test. `pnpm typecheck && pnpm test` xanh trước khi báo xong.
7. Không đánh dấu hoàn thành khi chưa kiểm thử; báo cáo test nào đã chạy và kết quả.
8. Mỗi báo cáo kết thúc bằng: **file đã thay đổi**, **migration**, **test đã thêm**, **rủi ro còn lại**.
9. Mỗi agent chạy trong **git worktree riêng**, một nhánh `claude/tutien-<phase>-<agent>`; không sửa file thuộc quyền agent khác (bảng §3) — cần thì mở yêu cầu cho chủ sở hữu.

## 2. Sáu agent

| Agent | Vai trò | Đầu vào | Đầu ra | Skill nên nạp |
|---|---|---|---|---|
| **A1 Architect** | Kiến trúc, ERD, API contract, quy tắc nghiệp vụ, review chéo | Spec, 01–08 | Cập nhật ERD/OpenAPI, ADR, review mọi PR | `api-and-interface-design`, `documentation-and-adrs`, `engineering:architecture`, `code-review-and-quality` |
| **A2 Backend** | Player, Cultivation, Gift, Breakthrough, Leaderboard, Config, Admin API | ERD, OpenAPI, GDD | `src/services/game`, `src/repositories/game`, controllers, migration | `incremental-implementation`, `test-driven-development`, `api-and-interface-design`, `security-and-hardening` |
| **A3 TikTok Integration** | Móc bus, command parser, gift intent, idempotency, reconciler | Architecture §2, §5, §7 | `game-event-bus.ts`, `game-event-processor.ts`, `command-parser.ts`, sửa tối thiểu `event-ingestion.service.ts` | `source-driven-development`, `debugging-and-error-recovery`, `test-driven-development` |
| **A4 Frontend** | Overlay 720×1280, admin dashboard, animation, leaderboard | OpenAPI, WS frames, Asset Guidelines | `public/tutien/**` | `frontend-design`, `frontend-ui-engineering`, `design:accessibility-review`, `browser-testing-with-devtools` |
| **A5 Game Designer** | Cân bằng tu vi/cảnh giới/quà/độ kiếp, preset cấu hình | GDD, số liệu buổi LIVE thật | Cập nhật GDD §4, §7, §10; `prisma/seed-tutien.ts` (giá trị mặc định); bảng mô phỏng | `idea-refine`, `anthropic-skills:xlsx` (bảng cân bằng) |
| **A6 QA** | Unit, integration, multiplayer, regression, acceptance | TestPlan | `tests/game/**`, báo cáo nghiệm thu | `test-driven-development`, `engineering:testing-strategy`, `browser-testing-with-devtools`, `performance-optimization` |

## 3. Quyền sở hữu file

| Đường dẫn | Chủ | Ghi chú |
|---|---|---|
| `docs/game/**` | A1 | A5 sửa 01_GDD (số liệu), A6 sửa 07_TestPlan |
| `prisma/schema.prisma` (phần game), `prisma/migrations/*tu_tien*` | A2 | A1 duyệt |
| `src/services/game/cultivation-engine.ts` | A2 | A5 review mọi thay đổi công thức |
| `src/services/game/{game-event-bus,game-event-processor,command-parser}.ts` | A3 | |
| `src/services/event/event-ingestion.service.ts` | A3 | Chỉ thêm móc bus; diff ≤ 20 dòng |
| `src/services/game/**` còn lại, `src/repositories/game/**`, `src/controllers/game*.ts` | A2 | |
| `src/websocket/types.ts` | A3 | Thêm `GameFrame`, không đổi frame cũ |
| `public/tutien/**`, `public/tutien-assets/**` | A4 | |
| `scripts/slice-tutien-assets.py` | A4 | |
| `tests/game/**` | A6 | A2/A3 viết unit test cho code của mình trong `tests/game/unit` |

## 4. Kế hoạch theo phase (spec §28)

Mũi tên = phụ thuộc. Phase cùng hàng có thể song song.

```text
P1 Audit (A1) ──▶ P2 DB & Engine (A2, A5) ──▶ P3 Gift Integration (A3) ──▶ P4 Breakthrough (A2)
                                     │                                          │
                                     └──▶ P5 Character & Effects (A4) ──▶ P6 Overlay (A4) ──▶ P7 Admin (A4, A2)
                                                                                                  │
                                                     P8 Testing & Optimization (A6, mọi agent) ◀──┘
```

| Phase | Agent | Việc | Định nghĩa xong (DoD) |
|---|---|---|---|
| P1 | A1 | Audit code: connector, ingestion, WS, `/game`; xác nhận tên trường gift/chat thực tế | `docs/game/AUDIT.md`: có sẵn / thiếu / kế hoạch sửa; danh sách trường payload kèm dòng code |
| P2 | A2 + A5 | Migration, seed 8 cảnh giới + 80 tầng + cấu hình, `CultivationEngine`, `PlayerService` | `pnpm prisma:migrate` sạch; unit test engine ≥ 95% branch; TC-L* pass |
| P3 | A3 | Móc bus, processor, parser, gift intent, idempotency, reconciler | TC-J*, TC-G* pass; test hiện có (200+) vẫn xanh |
| P4 | A2 | BreakthroughService, scheduler, recovery, REST | TC-B* pass, gồm kill-restart |
| P5 | A4 | Cắt asset, manifest, fallback, layer hiệu ứng | Asset Guidelines §8 checklist đạt |
| P6 | A4 | Overlay `/tutien` + demo mode | TC-O* pass trong OBS Browser Source; 60fps |
| P7 | A4 + A2 | Admin `/tutien/admin` + admin API | US-40…45 pass |
| P8 | A6 | Tải, đồng thời, mất kết nối, regression, nghiệm thu | Mọi tiêu chí PRD §5 tick; báo cáo hiệu năng |

## 5. Giao thức bàn giao

Mỗi agent kết thúc phase bằng một bản bàn giao trong PR description:

```markdown
## Bàn giao P<n> — <agent>
- Hợp đồng đã triển khai: <endpoint / frame / bảng>
- Lệch so với tài liệu: <không | mô tả + đã báo A1>
- File thay đổi: <danh sách>
- Migration: <tên | không>
- Test: <lệnh đã chạy> → <kết quả>
- Người nhận tiếp theo cần biết: <...>
```

A1 review mọi PR theo 3 câu hỏi: (1) đúng hợp đồng ERD/OpenAPI? (2) giữ cô lập tenant? (3) có đường nào cộng tu vi mà không có dòng `gift_transactions`?

## 6. Prompt khởi động mẫu

Dán cho từng agent (thay `<…>`):

```text
Bạn là <A2 Backend Developer> của dự án TU TIÊN LIVE trong repo TikUser API.
Đọc theo thứ tự: CLAUDE.md, docs/game/01_GDD.md, 03_ERD.md, 04_OpenAPI.yaml,
05_Architecture.md, 06_AI_Agents.md (mục của bạn), 07_TestPlan.md.
Nhiệm vụ: Phase <P2>. Chỉ sửa file thuộc quyền của bạn (06 §3).
Làm theo từng lát mỏng: migration → engine + unit test → service → API.
Sau mỗi lát chạy `pnpm typecheck` và test liên quan.
Kết thúc bằng bản bàn giao theo 06 §5. Không báo xong nếu còn test đỏ.
```

## 7. Skill: đã có và cần cài thêm

Đã có trong máy (dùng được ngay): `frontend-design`, `frontend-ui-engineering`, `api-and-interface-design`, `test-driven-development`, `incremental-implementation`, `security-and-hardening`, `performance-optimization`, `browser-testing-with-devtools`, `documentation-and-adrs`, bộ `design:*`, `engineering:*`.

Chưa có: **UI/UX Pro Max** (skill cộng đồng, không phải của Anthropic). Chủ dự án tự cài sau khi tự xem mã nguồn; A4 dùng nó cho bảng màu/typography nếu đã cài, không bắt buộc.
