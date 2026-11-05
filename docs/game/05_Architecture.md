# 05 — Kiến trúc hệ thống: TU TIÊN LIVE

> Phiên bản 1.0 · 2026-11-05 · Chủ sở hữu: Agent 1 (Architect)
> Nguyên tắc số 1: **game là một consumer mới của pipeline sự kiện đã có**. Không thêm kết nối TikTok, không sửa connector trừ khi có bug.

## 1. Bức tranh tổng thể

```text
 TikTok LIVE ──▶ LiveTikTokConnector / MockConnector         (có sẵn, src/adapters/tiktok)
                        │  CanonicalEvent (chat | gift | ...)
                        ▼
                 EventIngestionService                        (có sẵn, src/services/event)
                 normalize → upsert user → persist `events`
                        │
                        ├──▶ realtimeBroadcaster (frame `event`)  (có sẵn)
                        │
                        └──▶ GameEventBus.publish(persistedEvent, user)   ◀── điểm móc DUY NHẤT (mới)
                                    │
                                    ▼
                        GameEventProcessor (hàng đợi theo người chơi)      (mới, src/services/game)
                          ├─ CommandParser   (chat → GameCommand | null)
                          └─ GiftHandler     (gift → GiftIntent)
                                    │
                                    ▼
                        GameplayService  ◀── REST controllers cũng gọi vào đây
                          ├─ PlayerService
                          ├─ CultivationEngine     (hàm thuần, không I/O)
                          ├─ BreakthroughService + BreakthroughScheduler
                          └─ LeaderboardService
                                    │  1 transaction / 1 intent
                                    ▼
                        PostgreSQL (game_players, gift_transactions, breakthrough_*, game_events)
                                    │  sau COMMIT
                                    ▼
                        GameRealtimeGateway → WebSocketManager.broadcast (frame `game.*`)
                                    │
                                    ▼
                        Overlay /tutien (720×1280)      Admin /tutien/admin
```

Khớp luồng spec §26: Listener = connector; Normalizer = `EventIngestionService`; Event Queue/Processor = `GameEventProcessor`; Gameplay Service; Database; Realtime Gateway; Overlay.

## 2. Vì sao móc sau khi `events` đã lưu

| Phương án | Ưu | Nhược | Quyết định |
|---|---|---|---|
| A. Game nghe trực tiếp connector | Nhanh | Hai nơi chuẩn hóa; vi phạm "không tạo thêm kết nối" | Loại |
| **B. Móc sau persist trong `EventIngestionService`** | Có sẵn `events.id` để làm FK; user đã upsert; một nguồn sự thật | Lỗi game không được làm hỏng ingest | **Chọn** |
| C. Poll bảng `events` | Tách rời hoàn toàn | Trễ, tốn DB | Dùng làm **cơ chế bù** (§7) |

Cách móc: thêm một tham số tùy chọn `gameEventBus?: { publish(e) }` vào constructor `EventIngestionService`, gọi ngay sau `realtimeBroadcaster.broadcast` trong khối try/catch riêng. Không có bus → hành vi y như cũ, toàn bộ test hiện có không đổi.

## 3. Module mới

```text
src/services/game/
├── index.ts
├── game-event-bus.ts            # EventEmitter mỏng, publish không chặn ingest
├── game-event-processor.ts      # hàng đợi theo key player, giới hạn đồng thời
├── command-parser.ts            # chuẩn hóa tiếng Việt, khớp lệnh (thuần)
├── cultivation-engine.ts        # applyExp, computeChance, resolveOutcome (thuần)
├── gameplay.service.ts          # điều phối transaction; API & chat dùng chung
├── player.service.ts
├── breakthrough.service.ts
├── breakthrough-scheduler.ts    # timer + recovery sau restart
├── leaderboard.service.ts
├── game-config.service.ts       # đọc/ghi cấu hình, cache theo tenant + revision
└── game-realtime.gateway.ts     # map game_events → frame WS
src/repositories/game/           # player, gift-tx, breakthrough, config, audit, game-event
src/controllers/game.controller.ts, game-admin.controller.ts
public/tutien/                   # overlay + admin (HTML/CSS/JS tĩnh như /game)
public/tutien-assets/            # ảnh nhân vật & hiệu ứng
```

`cultivation-engine.ts` **không import Prisma**. Mọi quy tắc tính toán ở đây để unit test chạy không cần DB và Game Designer đọc được.

```ts
// Hợp đồng engine (rút gọn)
export interface Progress { realmOrder: number; level: number; currentExp: bigint }
export interface LevelTable { required(realm: number, level: number): bigint }

export function applyExp(p: Progress, amount: bigint, t: LevelTable, overflowCap: bigint):
  { next: Progress; levelsGained: number[]; capped: bigint };

export function currentChanceBp(baseBp: number, bonusDiamonds: bigint,
  bpPer100: number, maxBp: number): number;

export function resolveBreakthrough(p: Progress, finalBp: number, roll: number,
  penaltyRatio: number, t: LevelTable):
  { result: 'success' | 'failure'; next: Progress; penalty: bigint };
```

## 4. Xử lý đồng thời

- `GameEventProcessor` giữ một **chuỗi Promise theo `tenantId:userId`** (keyed mutex trong tiến trình): sự kiện của cùng một người chạy tuần tự, của người khác chạy song song (giới hạn `GAME_PROCESSOR_CONCURRENCY`, mặc định 16).
- Trong DB vẫn `SELECT … FOR UPDATE` dòng `game_players` — mutex trong tiến trình chỉ giảm tranh chấp, **không** phải cơ chế đúng đắn (chạy nhiều instance vẫn an toàn).
- Thứ tự khóa cố định: `game_players` → `breakthrough_sessions`.
- Retry: `40P01`, `40001` → jitter 20–200ms, tối đa 5 lần; hết lượt → `gift_transactions.status = failed`, `error_message` ghi lại, Admin retry được.
- Backpressure: hàng đợi > 5.000 việc → log cảnh báo, `processorLagMs` hiện trên `/admin/health`. Không bỏ sự kiện quà; lệnh xem thông tin có thể bỏ.

## 5. Idempotency quà

Khóa được dẫn xuất từ **ý định** (món quà đó), không phải từ lần thử:

```text
idempotency_key = "gift:v1:" + (
    data.messageId / sourceEventId  nếu có       → msgId của TikTok, ổn định qua mọi lần gửi lại
  | events.payload_fingerprint      nếu không    → SHA-256 do EventIngestionService tính
)
```

Quy trình: `INSERT gift_transactions(status='pending')` **trước** mọi thay đổi → unique violation nghĩa là đã xử lý → trả kết quả cũ. Không dùng "SELECT rồi INSERT". Dedup cache trong bộ nhớ của ingestion vẫn chạy như lớp lọc sớm, nhưng không được coi là đảm bảo.

Combo: connector đã chỉ phát tin chốt (`repeatEnd = true`). Processor bỏ qua mọi gift có `repeatEnd !== true` (phòng khi connector đổi hành vi), ghi log `debug`.

Lệnh `dokiep` từ chat: idempotency dựa trên unique partial index "một phiên đang mở / người chơi". Từ REST: header `Idempotency-Key` lưu ở `breakthrough_sessions.request_key` (unique theo tenant) kèm hash body.

## 6. Realtime

Dùng lại `/ws` và luồng ticket hiện có. Overlay subscribe `sessionId` của buổi LIVE. Thêm **loại frame** (cộng thêm vào `ServerMessage` trong `src/websocket/types.ts`):

```ts
interface GameFrame<T extends string, P> {
  type: 'game';
  event: T;
  seq: string;           // game_events.seq — overlay phát hiện mất frame
  sessionId: string;
  at: string;            // ISO time
  data: P;
}
```

| `event` | `data` chính | Overlay làm gì |
|---|---|---|
| `player.joined` / `player.returned` | `player` | Thẻ nhập môn |
| `exp.gained` | `playerId, amount, giftName, giftImageUrl, repeatCount, progress` | Hiệu ứng quà + thanh tu vi |
| `level.up` | `playerId, levels[], progress` | Thông báo lên tầng (gộp nhiều tầng thành 1 thẻ) |
| `level.max` | `playerId` | Gợi ý "gõ do kiep" |
| `breakthrough.started` | `breakthrough` | Mở màn độ kiếp + đồng hồ |
| `breakthrough.bonus` | `breakthroughId, currentChanceBp, giftName` | Cập nhật tỷ lệ |
| `breakthrough.resolved` | `breakthrough, result, player` | Hiệu ứng thành công/thất bại |
| `breakthrough.cancelled` | `breakthroughId` | Đóng màn |
| `command.reply` | `playerId, command, card` | Thẻ phản hồi lệnh |
| `command.rejected` | `playerId, reason` | Thẻ ngắn lý do |
| `leaderboard.updated` | `board, entries` (≤10) | Bảng xếp hạng (throttle 2s/bảng) |
| `config.changed` | `flags` | Bật/tắt hiệu ứng |

Phát sau COMMIT (không bao giờ phát trạng thái chưa lưu). Reconnect: overlay xin ticket mới → `GET /api/v1/game/state` → so `lastSeq` → tiếp tục nghe; frame có `seq ≤ lastSeq` bị bỏ.

Frame `event` gốc vẫn được gửi như cũ — overlay Tu Tiên bỏ qua chúng.

## 7. Độ bền & phục hồi

| Sự cố | Cơ chế |
|---|---|
| Process chết giữa transaction | Transaction rollback; `gift_transactions` không có dòng → reconcile (dưới) xử lý lại |
| Process chết sau `events` persist, trước game xử lý | **Reconciler** chạy mỗi 30s và lúc khởi động: tìm `events` loại `gift` trong 24h không có `gift_transactions` tương ứng (LEFT JOIN theo `event_id`) → đưa lại vào processor. Idempotency bảo đảm an toàn |
| Restart giữa phiên độ kiếp | `BreakthroughScheduler.recover()` lúc khởi động: `preparing` chưa đến hạn → đặt timer; quá hạn → resolve ngay |
| Resolve chạy hai lần (2 instance) | `UPDATE … SET status='resolving' WHERE id=$1 AND status='preparing' RETURNING *` — chỉ một bên nhận được dòng; `breakthrough_history.session_id` UNIQUE là chốt chặn cuối |
| Mất kết nối TikTok | Connector tự reconnect (có sẵn); game không phụ thuộc trạng thái kết nối ngoài việc hiển thị |
| Overlay F5 | Đọc `/game/state`, không mất gì |

## 8. Bảo mật

- Scope API key mới: `game:overlay` (GET + `POST /breakthroughs`), `game:admin`. Thêm `requireScope()` preHandler cạnh `auth.middleware.ts`.
- Overlay chạy trong OBS cần API key: dùng key scope `game:overlay`, nhập một lần, lưu `localStorage`; **không** đặt key trong URL (cùng tinh thần cấm key ở query WebSocket).
- Admin page: key `game:admin`, không lưu lâu dài (sessionStorage).
- Text từ chat (nickname, comment) hiển thị bằng `textContent`, không bao giờ `innerHTML`.
- Asset route `/tutien-assets/:file` dùng regex whitelist `^[a-z0-9-]+\.(png|webp)$` như `/game-assets`.
- Random: `crypto.randomInt`, không dùng `Math.random`.

## 9. Hiệu năng

- Bảng tu vi 80 tầng + cấu hình: cache theo tenant, khóa bằng `revision`.
- Bảng xếp hạng: truy vấn trực tiếp nhờ index (§3.1 ERD), cache 2s theo `(tenant, board, scope)`; invalidation lười.
- Một gift = 1 transaction với ~5 câu lệnh; mục tiêu p95 < 40ms ở DB.
- `game_events` dọn theo retention bằng job hằng ngày (cùng chỗ với dọn `events`).

## 10. Cấu hình môi trường mới

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `GAME_TUTIEN_ENABLED` | `false` | Tắt hẳn module (không đăng ký route, không móc bus) |
| `GAME_PROCESSOR_CONCURRENCY` | `16` | |
| `GAME_RECONCILE_INTERVAL_MS` | `30000` | |
| `GAME_RECONCILE_LOOKBACK_HOURS` | `24` | |

Gameplay (tỷ lệ, hệ số…) **không** nằm trong env — chỉ trong `game_configurations`.

## 11. Quyết định kiến trúc (ADR tóm tắt, ghi vào `docs/TECH_DECISIONS.md`)

1. **ADR-G1**: Game là consumer sau-persist của `EventIngestionService` (§2).
2. **ADR-G2**: Idempotency bằng unique constraint DB, khóa dẫn xuất từ `msgId`/fingerprint (§5).
3. **ADR-G3**: Engine thuần tách khỏi I/O (§3).
4. **ADR-G4**: Tỷ lệ dạng basis points, tu vi dạng BIGINT, JSON dạng string.
5. **ADR-G5**: Overlay tĩnh (HTML/CSS/JS + Canvas/DOM) như `/game` — không thêm build tool frontend ở v1.
6. **ADR-G6**: Một instance là đủ cho MVP; thiết kế vẫn an toàn khi chạy nhiều instance nhờ khóa DB.

## 12. Changelog (A1 Audit)

- **2026-11-05 (A1 Architect)**:
  - Xác nhận điểm móc GameEventBus chính xác tại `src/services/event/event-ingestion.service.ts:391` (ngay sau khối broadcast realtime, trước `return persistedEvent;`).
  - Xác nhận tên trường quà thực tế trong `src/adapters/tiktok/live.connector.ts:385-409` (giftId, giftName, diamondCount, repeatCount, totalDiamonds, repeatEnd, giftType, groupId, giftImageUrl, toUserId).
  - Xác nhận tên trường chat thực tế trong `src/adapters/tiktok/live.connector.ts:196-206` (comment, text, messageId, language).
  - Lưu ý cho A3: Khi kiểm thử qua `MockConnector`, `payload.totalDiamonds` có thể vắng mặt; `GiftHandler` cần fallback `totalDiamonds = payload.totalDiamonds ?? (diamondCount * repeatCount)`.