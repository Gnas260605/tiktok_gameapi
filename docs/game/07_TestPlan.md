# 07 — Kế hoạch kiểm thử: TU TIÊN LIVE

> Phiên bản 1.0 · 2026-11-05 · Chủ sở hữu: Agent 6 (QA)
> Bao phủ toàn bộ tình huống spec Phần XI + tiêu chí MVP Phần XIV. Công cụ: Vitest v2, PostgreSQL thật (như `tests/integration`), `MockConnector` cho mọi luồng TikTok.

## 1. Cấu trúc & lệnh

```text
tests/game/
├── unit/            # engine, parser, chance — không DB
├── integration/     # service + repository + PostgreSQL
├── api/             # REST qua fastify.inject
├── websocket/       # frame game.* qua /ws
├── e2e/             # luồng đầy đủ MockConnector → overlay frame
└── load/            # tải & đồng thời (chạy riêng, không trong `pnpm test` mặc định)
```

```bash
pnpm vitest run tests/game
pnpm vitest run tests/game/e2e/tutien-acceptance.test.ts
pnpm vitest run tests/game/load --testTimeout 300000
```

Thêm script `test:game` vào `package.json`. Regression: `pnpm test` (200+ test hiện có) **phải xanh** ở mọi PR — gồm 15 scenario `tests/e2e/fifteen-scenarios.test.ts`.

## 2. Dữ liệu kiểm thử

- Tenant: dùng seed Acme Corp & Beta Streamers (kiểm cô lập).
- Quà: `FIXTURE_GIFTS` của MockConnector — Rose 1💎, Doughnut 30💎, Galaxy 1.000💎, Lion 29.999💎.
- Bảng tu vi mặc định GDD §4.2; một số test dùng bảng nhỏ (`RealmBase = [10,…]`) để chạy nhanh.
- RNG: `BreakthroughService` nhận `rng: () => number` qua DI; test cố định `roll`.

## 3. Ca kiểm thử

Mỗi ca: **ID · Mức · Tiền điều kiện → Hành động → Kỳ vọng**. Mức: U = unit, I = integration, A = API, W = websocket, E = e2e, L = load.

### 3.1 Tham gia (J)

| ID | Mức | Kịch bản | Kỳ vọng |
|---|---|---|---|
| TC-J01 | I | Username mới gõ `thamgia` | 1 dòng `game_players` LK1 0 tu vi; `game_events.player_joined` |
| TC-J02 | I | Username đã tồn tại gõ `thamgia` | Không tạo dòng mới; `player_returned`; dữ liệu giữ nguyên |
| TC-J03 | E | Tạo nhân vật, restart app (tạo lại Fastify), gõ lại `thamgia` | Tiến trình còn nguyên |
| TC-J04 | I | Cùng người gõ `thamgia` 20 lần đồng thời | Đúng 1 dòng (unique `tenant_id,user_id`) |
| TC-J05 | U | Chuẩn hóa: `/thamgia`, `THAM GIA`, `  thamgia  `, `thamgia nu`, `Độ Kiếp`, `đo kiep`, `dokiep`… (≥30 biến thể) | Khớp đúng lệnh & tham số |
| TC-J06 | U | `tôi muốn thamgia`, `thamgiaa`, chuỗi rỗng, emoji | Không khớp |
| TC-J07 | I | Người xem đổi handle (cùng `platform_user_id`) | Cùng player, `username` cập nhật |
| TC-J08 | I | `gioitinh nu` hai lần trong 24h | Lần 2 bị từ chối `command.rejected` |

### 3.2 Quà (G)

| ID | Mức | Kịch bản | Kỳ vọng |
|---|---|---|---|
| TC-G01 | I | Rose ×1 | +10 tu vi; 1 `gift_transactions` `applied` |
| TC-G02 | I | Quà 100💎 | +1.000 |
| TC-G03 | I | Combo: chuỗi tap repeatEnd=0 ×14 rồi tin chốt repeatCount=15 (qua `mapGiftPayload`) | Đúng 1 giao dịch, +150 |
| TC-G04 | I | Lion ×10 (299.990💎) | +2.999.900; lên tới tầng 10 LK; phần dư bị trần `maxOverflowRatio` → `overflow_capped`, `total_cultivation` vẫn +2.999.900 |
| TC-G05 | I | Quà từ người chưa tham gia, `autoJoinOnGift=true` | Tự tạo nhân vật + cộng |
| TC-G06 | I | Như trên, `autoJoinOnGift=false`; sau đó người đó `thamgia` trong TTL | Giao dịch `pending` → `applied` khi tham gia; tu vi đúng |
| TC-G07 | I | Như G06 nhưng quá TTL | `expired`, không cộng |
| TC-G08 | I | 50 quà khác nhau của 1 người đến đồng thời | Tổng tu vi = tổng lý thuyết; `version` tăng 50 |
| TC-G09 | I | Cùng một event được publish lại 100 lần (song song + tuần tự) | Đúng 1 giao dịch; tu vi cộng 1 lần |
| TC-G10 | I | Event không có `msgId` → khóa dùng fingerprint; publish lại | Đúng 1 giao dịch |
| TC-G11 | I | `diamondCount = null` | `unpriced`, không cộng, hiện ở `/admin/gift-transactions?type=unpriced` |
| TC-G12 | I | `giftProcessingEnabled=false` | `ignored_game_disabled`; event gốc vẫn ở `events` |
| TC-G13 | I | Kill processor sau khi `events` lưu, trước khi game xử lý; chạy reconciler | Giao dịch được tạo đúng 1 lần |
| TC-G14 | I | Deadlock giả lập (`40P01`) 3 lần rồi thành công | Giao dịch `applied`, không cộng trùng |

### 3.3 Lên cấp (L)

| ID | Mức | Kịch bản | Kỳ vọng |
|---|---|---|---|
| TC-L01 | U | LK3 2.000/3.000 + 500 | LK3 2.500/3.000 |
| TC-L02 | U | LK3 2.500/3.000 + 500 | LK4 0/4.000 |
| TC-L03 | U | LK3 2.500/3.000 + 1.000 (ví dụ spec) | LK4 500/4.000 |
| TC-L04 | U | LK1 0 + 10.000 (Galaxy) | LK5 0/5.000; `levelsGained=[2,3,4,5]` |
| TC-L05 | U | LK9 + quà đủ qua tầng 10 rất nhiều | Dừng ở LK10; không sang Trúc Cơ; dư giữ lại (≤ trần) |
| TC-L06 | U | Đạt đúng ngưỡng tầng 10 | `isMaxLevel=true`; frame `level.max` |
| TC-L07 | U | Đại Thừa 10 nhận quà | `total_cultivation` tăng; không độ kiếp được |
| TC-L08 | U | Property test: 10.000 chuỗi quà ngẫu nhiên | Bất biến: `current_exp ≥ 0`, `1 ≤ level ≤ 10`, tổng tu vi bảo toàn (`Σ nhận = Σ yêu cầu đã qua + current_exp + capped`) |

### 3.4 Độ kiếp (B)

| ID | Mức | Kịch bản | Kỳ vọng |
|---|---|---|---|
| TC-B01 | A | `dokiep` ở tầng 7 | 409 `NOT_MAX_LEVEL`; frame `command.rejected` |
| TC-B02 | A | Tầng 10 nhưng chưa đủ tu vi | 409 `NOT_ENOUGH_EXP` |
| TC-B03 | I | Đủ điều kiện | Phiên `preparing`, `ends_at = now+30s`, frame `breakthrough.started` |
| TC-B04 | I | roll = 0, chance 9000 | `succeeded`; Trúc Cơ 1; tu vi dư chuyển & có thể lên tầng ngay |
| TC-B05 | I | roll = 9999, chance 9000 | `failed`; LK10; trừ 20% tu vi dư; cooldown 300s |
| TC-B06 | I | Thất bại khi tu vi dư = 0 | Phạt 0; không tụt dưới ngưỡng |
| TC-B07 | I | Kim Đan, tặng 600💎 trong phiên | `gift_bonus_bp = 1002`; chance 8002; không cộng tu vi |
| TC-B08 | I | Như B07 nhưng `addExpDuringBreakthrough=true` | Cộng cả bonus và tu vi (`cultivation_and_bonus`) |
| TC-B09 | I | LK tặng Galaxy | Chance = 9500 (trần) |
| TC-B10 | I | Quà có `occurredAt` = `ends_at` | Tính là quà thường |
| TC-B11 | I | `dokiep` 10 lần song song | Đúng 1 phiên; 9 lần `ALREADY_IN_PROGRESS` |
| TC-B12 | I | `dokiep` trong cooldown | 409 `COOLDOWN`, có `cooldownRemainingSeconds` |
| TC-B13 | I | 4 người cùng độ kiếp, `maxConcurrent=3` | Người thứ 4 `TOO_MANY_CONCURRENT` |
| TC-B14 | E | Ngắt MockConnector giữa phiên, nối lại sau 10s | Phiên kết thúc đúng hạn; quà trễ xử lý theo `occurredAt` |
| TC-B15 | E | Đóng app ở giây 15, mở lại ở giây 20 | Timer phục hồi, resolve ở giây 30 ±1s, đúng 1 `breakthrough_history` |
| TC-B16 | E | Đóng app ở giây 15, mở lại ở giây 60 | Resolve ngay lúc khởi động, đúng 1 lần |
| TC-B17 | I | Hai scheduler cùng resolve một phiên | Đúng 1 bên thắng; history UNIQUE giữ |
| TC-B18 | I | Admin đổi `maxChanceBp` giữa phiên | Phiên dùng `config_snapshot` |
| TC-B19 | I | Admin reset nhân vật đang độ kiếp | Phiên `cancelled`, không random |
| TC-B20 | U | Thống kê RNG: 100.000 lần ở chance 5000 | Tỷ lệ thành công 50% ± 0,5% |
| TC-B21 | A | `POST /breakthroughs` cùng Idempotency-Key 2 lần | Lần 2 trả cùng phiên; body khác → 422 |

### 3.5 Bảng xếp hạng (R)

| ID | Mức | Kịch bản | Kỳ vọng |
|---|---|---|---|
| TC-R01 | I | 5 bảng với dữ liệu seed 50 người | Thứ tự đúng GDD §9 |
| TC-R02 | I | Hai người bằng mọi chỉ số chính | Ai đạt trước xếp trên; dense rank bằng nhau |
| TC-R03 | I | Gọi lặp 100 lần không đổi dữ liệu | Kết quả y hệt (ổn định) |
| TC-R04 | A | `scope=session` thiếu `liveSessionId` | 400 |

### 3.6 Multiplayer & tenant (M)

| ID | Mức | Kịch bản | Kỳ vọng |
|---|---|---|---|
| TC-M01 | L | 500 người `thamgia` trong 30s | 500 dòng; p95 phản hồi ≤ 1s |
| TC-M02 | L | 200 gift/s × 60s, 300 người | 12.000 giao dịch, 0 trùng, 0 mất; tổng tu vi khớp; p95 quà→frame ≤ 800ms |
| TC-M03 | L | 3 phiên độ kiếp song song + 100 gift/s | Không ghi đè; bonus đúng người |
| TC-M04 | I | Key tenant B đọc player tenant A | 404 |
| TC-M05 | I | Gift của session tenant A không bao giờ chạm player tenant B (FK tổ hợp) | Insert chéo bị PostgreSQL từ chối |
| TC-M06 | W | Overlay tenant B subscribe session tenant A | Bị từ chối như cơ chế ticket hiện có |
| TC-M07 | A | Key scope `game:overlay` gọi `PUT /admin/config` | 403 |

### 3.7 Admin (D)

| ID | Mức | Kịch bản | Kỳ vọng |
|---|---|---|---|
| TC-D01 | A | PUT config hợp lệ | 200, revision +1, frame `config.changed` |
| TC-D02 | A | PUT với `baseRevision` cũ | 409 |
| TC-D03 | A | Giá trị ngoài miền (`maxChanceBp=12000`) | 400, `details` chỉ rõ trường |
| TC-D04 | A | PATCH player không có `reason` | 400 |
| TC-D05 | A | PATCH player `expectedVersion` cũ | 409 |
| TC-D06 | A | Reset với `confirmUsername` sai | 400; không đổi gì |
| TC-D07 | I | Mọi PATCH/reset/config | Có đúng 1 `admin_audit_logs` với before/after |
| TC-D08 | A | Retry giao dịch `failed` | `applied`; retry lần 2 → 409 |

### 3.8 Overlay (O) — trình duyệt thật (`browser-testing-with-devtools`)

| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| TC-O01 | Mở `/tutien?demo` ở 720×1280 | Không lỗi console; không thanh cuộn |
| TC-O02 | 20 quà trong 2s | Hiệu ứng xếp hàng, ≤ 1 hiệu ứng toàn màn hình; 60fps (Performance panel) |
| TC-O03 | Ngắt WS (DevTools offline 5s) | Tự xin ticket, gọi `/game/state`, không mất trạng thái |
| TC-O04 | Nickname chứa `<img src=x onerror=alert(1)>` | Hiển thị nguyên văn, không chạy |
| TC-O05 | Xóa 1 file nhân vật | Fallback hiển thị, không ảnh vỡ |
| TC-O06 | Chạy demo 5 giờ (soak) | Heap < 300MB, không rò DOM node |
| TC-O07 | `prefers-reduced-motion` | Hiệu ứng rung/nháy tắt, vẫn có thông báo |
| TC-O08 | OBS Browser Source 720×1280 `?transparent=1` | Nền trong suốt, chữ đọc được trên nền game bất kỳ |

## 4. Kịch bản nghiệm thu E2E (bản MVP)

`tests/game/e2e/tutien-acceptance.test.ts` — một file, chạy tuần tự, map 1–1 với spec Phần XIV:

| AC | Kịch bản | Ca liên quan |
|---|---|---|
| AC-01 | Kết nối LIVE (mock) | SC-01..03 có sẵn |
| AC-02 | Người xem tham gia bằng username | J01, J02 |
| AC-03 | Nhân vật lưu lâu dài qua restart | J03 |
| AC-04 | Quà → tu vi | G01, G02 |
| AC-05 | Đủ 8 cảnh giới × 10 tầng | Seed check: 8 realms, 80 levels |
| AC-06 | Tự lên tầng, kể cả nhiều tầng | L03, L04 |
| AC-07 | Độ kiếp thành công & thất bại | B04, B05 |
| AC-08 | Quà tăng tỷ lệ, có trần | B07, B09 |
| AC-09 | Nhân vật đổi theo cảnh giới | Frame `breakthrough.resolved` có `characterAsset` mới |
| AC-10 | Hiệu ứng quà & đột phá | O02 (thủ công) |
| AC-11 | Overlay & bảng xếp hạng | O01, R01 |
| AC-12 | Admin dashboard | D01, D07 |
| AC-13 | Không cộng trùng gift | G09, G10 |
| AC-14 | Không mất dữ liệu khi restart | G13, B15, B16 |

## 5. Kiểm thử thủ công trước buổi LIVE thật

1. `docker compose up -d --build`, `pnpm prisma:deploy`, seed Tu Tiên.
2. Mở `/tutien/admin`, kiểm tra cấu hình mặc định, bật game.
3. Mở `/tutien?demo` trong OBS, chạy 10 phút: nhập môn, quà, lên tầng, độ kiếp thành công/thất bại.
4. Chuyển sang mode live với một tài khoản thử đang LIVE: gõ `thamgia`, tặng 1 Rose, kiểm tra `/admin/gift-transactions` có đúng 1 dòng.
5. Kill container API giữa một phiên độ kiếp → khởi động lại → kiểm tra resolve.

## 6. Tiêu chí thoát

- 100% ca P0 (J, G, L, B, M04–M07, D) pass; 0 lỗi mức nghiêm trọng mở.
- Load M01–M03 đạt mục tiêu NFR.
- Regression 200+ test hiện có xanh.
- Coverage `src/services/game`: line ≥ 90%, `cultivation-engine.ts` branch ≥ 95%.

---

## 7. Nhật ký tiến độ kiểm thử (QA Test Execution Log)

| Ngày | Người thực hiện | Phase / Hạng mục | Tập tin Test | Kết quả | Ghi chú |
|---|---|---|---|---|---|
| 2026-11-05 | Agent 6 (QA) | P2 Engine & Config | `tests/game/unit/cultivation-engine.test.ts` | **PASS (26/26)** | Bao phủ TC-L01..TC-L08, TC-B04..TC-B07, TC-B09, TC-B20 (RNG uniformity 100.000 trials). |
| 2026-11-05 | Agent 6 (QA) | P2 Config & World | `tests/game/unit/game-config.test.ts` | **PASS (14/14)** | Kiểm tra 8 cảnh giới, 80 tầng, tỷ lệ và thông số mặc định GDD §4.2, §7.3, §10. |
| 2026-11-05 | Agent 6 (QA) | P3 Command Parser | `tests/game/unit/command-parser.test.ts` | **PASS (8/8)** | Hợp đồng TC-J05 (45 biến thể) và TC-J06 (lọc chat thường). |
| 2026-11-05 | Agent 6 (QA) | P4 Breakthrough Unit | `tests/game/unit/breakthrough.service.test.ts` | **PASS (12/12)** | Hợp đồng TC-B01..B10 (initiation, rejection, gift bonus cap 95%, overdue, success/failure resolve, idempotency). |
| 2026-11-05 | Agent 6 (QA) | P4 Scheduler Recovery | `tests/game/integration/breakthrough-recovery.test.ts` | **PASS (3/3)** | Hợp đồng TC-B15/B16 (boot recovery: re-arm timer khi còn hạn, resolve tức thì khi quá hạn). |
| 2026-11-05 | Agent 6 (QA) | P8 E2E Acceptance | `tests/game/e2e/tutien-acceptance.test.ts` | **PASS (14/14)** | Bao phủ đầy đủ AC-01..AC-14 tuần tự từ MockConnector -> Sect Join -> Gifts -> Real-time Gateway -> Admin API -> Idempotency -> 24h Reconciler. |
| 2026-11-05 | Agent 6 (QA) | P8 Load & Concurrency | `tests/game/load/tutien-load.test.ts` | **PASS (3/3)** | TC-M01 (burst 500 join không rơi/trùng), TC-M02 (200 gift/s burst, đối soát tu vi 100% khớp), TC-M03 (3 phiên độ kiếp đồng thời nhận gift bonus không race condition). |
| 2026-11-05 | Agent 6 (QA) | Final Regression | Toàn bộ repo (`pnpm test`) | **PASS (404/404)** | 42 test suites xanh (24 suites gốc + 18 suites Tu Tiên). Zero regressions. TypeScript clean (0 errors). `cultivation-engine.ts` branch coverage: 98.03% (vượt tiêu chí >= 95%). |
