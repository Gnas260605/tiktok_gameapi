# AUDIT.md — Báo cáo Kiểm toán Kiến trúc: TU TIÊN LIVE

> **Dự án**: TU TIÊN LIVE (Interactive TikTok LIVE Cultivation RPG)  
> **Cơ sở mã nguồn**: `TikUser API` (`d:\Individua_Project\TikTOk`)  
> **Tác giả**: Agent 1 — System Architect & Orchestrator  
> **Ngày lập**: 2026-11-05  
> **Nhánh git**: `tutien/integration`  
> **Trạng thái**: HOÀN THÀNH (Baseline Verified — 24/24 Test Suites Passing, 245/245 Tests)

---

## 1. Mục đích kiểm toán (Audit Scope & Objectives)

Báo cáo kiểm toán này được lập bởi **Agent 1 (Architect)** nhằm:
1. Đánh giá hiện trạng cơ sở mã nguồn `TikUser API` để xác định các khối kiến trúc có sẵn dùng lại được và các khối kiến trúc cần phát triển mới cho game Tu Tiên Live.
2. Kiểm chứng chính xác đến từng **tên trường** và **số dòng code** đối với các sự kiện cốt lõi (`gift`, `chat`, envelope) trong `src/adapters/tiktok/*`.
3. Kiểm tra và xác nhận độ ổn định của cơ chế deduplication (`events.source_event_id` và `payload_fingerprint`) qua các lần gửi lại/retransmission.
4. Xác định vị trí chính xác (file, dòng code) để cắm điểm móc (`GameEventBus`) kết nối luồng sự kiện mà không làm gián đoạn hay phá vỡ pipeline ingest hiện hành.
5. Rà soát, đối chiếu và đồng bộ các văn bản đặc tả (`03_ERD.md`, `04_OpenAPI.yaml`, `05_Architecture.md`) với hiện trạng code thực tế.

---

## 2. Năng lực hệ thống hiện có (Available Capabilities)

| Thành phần | Đường dẫn mã nguồn | Khả năng hiện hữu & Trạng thái |
|---|---|---|
| **TikTok Connector** | `src/adapters/tiktok/live.connector.ts`<br>`src/adapters/tiktok/mock.connector.ts` | • Kết nối Webcast TikTok Live chính thức qua `tiktok-live-connector` (proto v3).<br>• Tự động reconnect với exponential backoff & jitter.<br>• Bộ giả lập `MockConnector` đầy đủ (`simulateChat`, `simulateGift`, `simulateLike`, ticker tự động) phục vụ kiểm thử đơn vị, tích hợp và E2E không cần mạng internet. |
| **Event Ingestion Pipeline** | `src/services/event/event-ingestion.service.ts` | • Chuẩn hóa dữ liệu sự kiện Canonical.<br>• Định danh người xem 3 mức (`platform_id`, `username_confirmed`, `event_only`) với cơ chế upsert nguyên tử.<br>• Deduplication bộ nhớ đệm (LRU cache theo sliding window).<br>• Lưu trữ bền vững vào PostgreSQL (`events`, `users`).<br>• Tính toán thống kê theo phiên (`live_sessions`). |
| **Realtime WebSocket Gateway** | `src/websocket/websocket-manager.ts`<br>`src/websocket/types.ts` | • Quản lý kết nối WebSocket tập trung với cơ chế cấp vé ngắn hạn (`POST /api/v1/realtime/tickets`).<br>• Phân quyền và subscribe theo `sessionId`.<br>• Heartbeat sweep định kỳ (30s) và idle timeout (60s).<br>• Phát sóng sự kiện (`broadcastEvent`) đến client đã xác thực. |
| **Xác thực & Bảo mật** | `src/middleware/auth.middleware.ts`<br>`src/services/auth/auth.service.ts` | • Xác thực qua header `Authorization: Bearer <key>` hoặc `X-API-Key`.<br>• Tra cứu API Key băm SHA-256 trong bảng `api_keys`.<br>• Gắn context `request.tenant` và `request.apiKey` vào mỗi request. |
| **Cơ sở dữ liệu (Database)** | `prisma/schema.prisma`<br>PostgreSQL 16 | • Kiến trúc Multi-tenant: mọi truy vấn đều có `tenantId`.<br>• Các bảng cốt lõi: `tenants`, `api_keys`, `live_sessions`, `users`, `events`, `tenant_settings`.<br>• Khóa ngoại tổ hợp (`tenantId, id`) bảo vệ cô lập dữ liệu. |
| **Frontend Overlay Demo** | `public/game.html`<br>`src/controllers/dashboard.controller.ts` | • Game Leo Chùa Live Studio (OBS Canvas 2D).<br>• Hệ thống điều khiển Streamer Pro Dock, Top Island, tích hợp Voice Studio AI TTS.<br>• Phục vụ tĩnh bảo mật qua `dashboard.controller.ts`. |
| **Bộ kiểm thử (Test Suite)** | `tests/**` | • 24 bộ test suites, 245/245 tests pass (100% xanh), bao gồm `tests/e2e/fifteen-scenarios.test.ts`. |

---

## 3. Các thành phần còn thiếu cần phát triển mới (Missing Capabilities)

Hệ thống hiện tại chưa có các thành phần chuyên biệt của Tu Tiên Live:

1. **Cơ sở dữ liệu (Database - A2 phụ trách)**:
   - Thiếu 9 bảng nghiệp vụ Tu Tiên trong `prisma/schema.prisma`:
     - `cultivation_realms`: 8 cảnh giới (Phàm Nhân -> Độ Kiếp), tỷ lệ cơ bản, chi phí tăng tỷ lệ, tài nguyên ảnh nam/nữ.
     - `cultivation_levels`: 80 tầng tu vi, mốc kinh nghiệm yêu cầu (`required_exp` dạng `BigInt`).
     - `game_players`: Hồ sơ tu tiên của người xem (tu vi hiện tại, tổng tu vi, cảnh giới, tầng, số lần độ kiếp, cooldown).
     - `gift_transactions`: Sổ cái giao dịch quà tặng (idempotency key, trạng thái pending/applied/failed, tu vi nhận được, bonus tỷ lệ độ kiếp).
     - `breakthrough_sessions`: Quản lý phiên độ kiếp (thời hạn 30s, tỷ lệ cơ bản, tỷ lệ quà hỗ trợ, snapshot cấu hình).
     - `breakthrough_history`: Lịch sử kết quả độ kiếp (xúc xắc `roll`, phạt hao hụt tu vi khi thất bại).
     - `game_events`: Sổ nhật ký sự kiện game gắn `seq` tăng đơn điệu phục vụ outbox realtime và chống mất frame ở overlay.
     - `game_configurations`: Bảng tham số gameplay lưu động (tỷ lệ, hệ số quy đổi quà, thời gian chờ).
     - `admin_audit_logs`: Nhật ký kiểm toán mọi can thiệp thủ công từ admin.
   - Thiếu 2 cập nhật quan trọng trên bảng cũ:
     - Thêm `@@unique([tenantId, id])` vào bảng `events` (để hỗ trợ FK tổ hợp từ `gift_transactions`).
     - Thêm trường `scopes String[] @default(["*"]) @map("scopes")` vào bảng `api_keys` (phân quyền `game:overlay` và `game:admin`).

2. **Lõi logic Tu Tiên (Cultivation Domain Engine - A2 phụ trách)**:
   - `src/services/game/cultivation-engine.ts`: Thư viện hàm thuần túy (**Pure Functions**, KHÔNG import Prisma/DB), xử lý:
     - `applyExp`: Cộng dồn tu vi, tự động nhảy tầng, giới hạn trần kinh nghiệm ở đỉnh cảnh giới.
     - `currentChanceBp`: Tính tỷ lệ thành công độ kiếp dựa trên kim cương quà tặng (tính theo Basis Points: 10000 = 100%).
     - `resolveBreakthrough`: Quyết định thành công/thất bại dựa trên xúc xắc ngẫu nhiên mật mã (`crypto.randomInt`), tính toán lượng tu vi phạt khi thất bại.
   - `src/services/game/game-config.service.ts`: Bộ nạp và cache cấu hình theo `(tenantId, revision)`.
   - `src/services/game/player.service.ts`: Quản lý gia nhập tông môn, khởi tạo nhân vật, tra cứu hồ sơ.
   - `src/services/game/breakthrough.service.ts` & `breakthrough-scheduler.ts`: Quản lý vòng đời độ kiếp, timer 30s và cơ chế tự phục hồi sau sự cố khởi động lại máy chủ.
   - `src/services/game/leaderboard.service.ts`: Bảng xếp hạng 5 hạng mục (Cảnh giới, Phú hào, Tốc độ, May mắn, Cống hiến) cache 2 giây.

3. **Cầu nối sự kiện TikTok & Game (Integration - A3 phụ trách)**:
   - `src/services/game/command-parser.ts`: Phân tích lệnh chat tiếng Việt (bỏ dấu NFD, đ->d, lowercase, trim) cho các lệnh: `nhap mon`, `do kiep`, `tu vi`, `top`, `bang xep hang`, v.v.
   - `src/services/game/game-event-bus.ts`: EventEmitter mỏng chuyển tiếp sự kiện an toàn từ `EventIngestionService`.
   - `src/services/game/game-event-processor.ts`: Hàng đợi Promise tuần tự theo `tenantId:userId` (tránh xung đột dữ liệu của cùng một người chơi) với giới hạn concurrency toàn cục.
   - `src/services/game/game-realtime.gateway.ts`: Đóng gói `game_events` thành frame `game.*` (có `seq`) phát qua WebSocket.
   - `src/services/game/game-reconciler.service.ts`: Quét và xử lý bù các quà tặng bị sót trong vòng 24 giờ khi hệ thống khởi động lại.

4. **Giao diện Người dùng (Frontend - A4 phụ trách)**:
   - Script cắt asset nhân vật `scripts/slice-tutien-assets.py` từ hình tham chiếu `docs/game/assets/reference-male-realms.webp`.
   - Overlay tĩnh `public/tutien/index.html` (kích thước chuẩn dọc 720×1280, hỗ trợ chế độ nền trong suốt `?transparent=1`, safe zone 80px, animation 8 trạng thái, đồng hồ đếm ngược 30s khi độ kiếp).
   - Trang quản trị Admin `public/tutien/admin.html` cho streamer quản lý cấu hình, người chơi và giao dịch lỗi.

---

## 4. Kiểm chứng tên trường thực tế & Số dòng mã nguồn

Đã kiểm tra trực tiếp mã nguồn trong `src/adapters/tiktok/live.connector.ts` và `src/adapters/tiktok/mock.connector.ts`. Dưới đây là kết quả kiểm chứng chi tiết:

### 4.1. Sự kiện Quà tặng (`gift`) trong `live.connector.ts`

Hàm `mapGiftPayload(raw: any)` được định nghĩa tại **dòng 385–409**:

```typescript
// File: src/adapters/tiktok/live.connector.ts (Dòng 385–409)
export function mapGiftPayload(raw: any): Record<string, any> | null {
  const gift = raw?.gift ?? {};
  const extended = raw?.extendedGiftInfo ?? {};
  const giftType = gift.type ?? extended.type;
  const isComboGift = Number(giftType) === 1 || gift.combo === true;

  // LỌC COMBO: Chỉ giữ lại gói chốt khi repeatEnd = 1 (hoặc true)
  if (isComboGift && !Number(raw?.repeatEnd)) return null; // Dòng 391

  const diamondCount = gift.diamondCount ?? extended.diamond_count;
  const repeatCount = Math.max(1, Number(raw?.repeatCount) || 1);
  const unitDiamonds = diamondCount !== undefined ? Number(diamondCount) : null;

  return {
    giftId: String(raw?.giftId || gift.id || 'unknown'),                         // Dòng 398: string
    giftName: gift.name || extended.name || 'Unknown Gift',                       // Dòng 399: string
    diamondCount: unitDiamonds,                                                  // Dòng 400: number | null (đơn giá 1 món quà)
    repeatCount,                                                                 // Dòng 401: number (số lượng combo tích lũy)
    totalDiamonds: unitDiamonds !== null ? unitDiamonds * repeatCount : null,    // Dòng 402: number | null (tổng kim cương)
    repeatEnd: true,                                                             // Dòng 403: boolean (luôn true vì đã lọc ở dòng 391)
    giftType: giftType !== undefined ? Number(giftType) : null,                  // Dòng 404: number | null
    groupId: raw?.groupId ? String(raw.groupId) : null,                          // Dòng 405: string | null
    giftImageUrl: gift.image?.urlList?.[0] || extended.image?.url_list?.[0] || null, // Dòng 406: string | null
    toUserId: raw?.toUser?.id ? String(raw.toUser.id) : null,                    // Dòng 407: string | null
  };
}
```

*Lắng nghe sự kiện quà tại dòng 208–211:*
```typescript
connection.on('gift', (raw: any) => {
  const payload = mapGiftPayload(raw);
  if (payload) this.handleIncomingRawEvent('gift', raw, payload);
});
```

### 4.2. Sự kiện Bình luận (`chat`) trong `live.connector.ts`

Xử lý sự kiện bình luận tại **dòng 196–206**:

```typescript
// File: src/adapters/tiktok/live.connector.ts (Dòng 196–206)
connection.on('chat', (raw: any) => {
  // proto v3 carries the text in `content`; v1 used `comment`
  const text = String(raw?.content ?? raw?.comment ?? '');
  if (!text) return;
  this.handleIncomingRawEvent('chat', raw, {
    comment: text,                                                         // Dòng 201: string
    text,                                                                  // Dòng 202: string (nội dung bình luận chuẩn)
    messageId: raw?.common?.msgId ? String(raw.common.msgId) : null,       // Dòng 203: string | null
    language: raw?.contentLanguage || null,                                // Dòng 204: string | null
  });
});
```

### 4.3. Đóng gói Envelope Canonical (`handleIncomingRawEvent`)

Tại **dòng 305–333** của `live.connector.ts`:
- `canonicalEvent.id` (dòng 319): gán bằng `raw?.common?.msgId ? String(raw.common.msgId) : undefined`.
- `canonicalEvent.eventTimestamp` (dòng 323):
  ```typescript
  const createTime = Number(raw?.common?.createTime) || 0;
  eventTimestamp: createTime > 0 ? new Date(createTime) : new Date()
  ```

### 4.4. Điểm cần lưu ý giữa `live.connector.ts` và `mock.connector.ts`

Trong `src/adapters/tiktok/mock.connector.ts` (dòng 353–367), hàm `simulateGift` hiện trả về:
```typescript
{
  giftId: resolvedGiftId,
  giftName,
  diamondCount: resolvedDiamondCount,
  repeatCount,
  repeatEnd,
  giftType: 1,
  groupId: `group_${Date.now()}`,
}
```
*Lưu ý cho Agent 3 (TikTok Integration)*: `MockConnector` không tự tính trường `totalDiamonds` và không truyền `giftImageUrl`. Do đó, khi `GiftHandler` bóc tách dữ liệu từ `payload`, bắt buộc phải áp dụng fallback:
```typescript
const totalDiamonds = BigInt(
  payload.totalDiamonds ??
  (Number(payload.diamondCount || 0) * Number(payload.repeatCount || 1))
);
const giftImageUrl = payload.giftImageUrl ?? null;
```
Biện pháp này đảm bảo mã nguồn chạy tương thích 100% trên cả stream TikTok LIVE thật lẫn môi trường kiểm thử tự động với `MockConnector`.

---

## 5. Kiểm tra tính ổn định của Khóa Deduplication (`source_event_id` / `payload_fingerprint`)

Trong `src/services/event/event-ingestion.service.ts`:
- Thuộc tính `source_event_id` trong bảng `events` được gán từ `eventId` của canonical event (dòng 377).
- Thuộc tính `payload_fingerprint` được tính toán bởi hàm `computeDedupKey` tại **dòng 402–419**:

```typescript
// File: src/services/event/event-ingestion.service.ts (Dòng 402–419)
private computeDedupKey(
  tenantId: string,
  sessionId: string,
  eventId: string,
  eventType: string,
  occurredAt: Date,
  payload: any
): string {
  if (eventId && eventId.trim().length > 0) {
    const raw = `${tenantId}:${sessionId}:${eventId.trim()}`;
    return raw.length <= 128 ? raw : crypto.createHash('sha256').update(raw).digest('hex');
  }

  const timeKey = occurredAt instanceof Date ? occurredAt.getTime() : new Date(occurredAt).getTime();
  const rawFingerprint = `${tenantId}:${sessionId}:${eventType}:${timeKey}:${JSON.stringify(payload)}`;
  return crypto.createHash('sha256').update(rawFingerprint).digest('hex');
}
```

### Đánh giá độ ổn định:
1. **Trường hợp có `eventId` (`raw?.common?.msgId` từ TikTok)**:
   - TikTok sinh ra chuỗi định danh 64-bit duy nhất cho từng message.
   - `raw = ${tenantId}:${sessionId}:${eventId.trim()}` hoàn toàn xác định (**Deterministic**), không phụ thuộc thời gian nhận.
   - **Kết luận**: Ổn định 100% qua mọi lần phát lại, gửi bù hoặc reconnect.

2. **Trường hợp không có `eventId` (hoặc `eventId` rỗng)**:
   - Hệ thống dùng `occurredAt.getTime()` và `JSON.stringify(payload)`.
   - Nếu upstream TikTok cung cấp `createTime > 0`, `occurredAt` giữ nguyên giá trị gốc -> Hash ổn định.
   - Nếu `createTime === 0`, `occurredAt` lấy `new Date()` tại thời điểm nhận -> Hash có thể bị lệch nếu gửi lại sau đó.

### Khuyến nghị thiết kế cho Agent 3 (`gift_transactions.idempotency_key`):
Khóa chống trùng giao dịch quà game trong DB (`gift_transactions.idempotency_key`) phải được dẫn xuất theo thứ tự ưu tiên:
```typescript
const idempotencyKey = `gift:v1:${
  persistedEvent.sourceEventId ||
  persistedEvent.payloadFingerprint ||
  persistedEvent.id
}`;
```
Vì `persistedEvent.id` (UUIDv4) là khóa chính của bảng `events` (đã được lưu thành công vào PostgreSQL trước khi chuyển tới Game Bus), nên khóa này **hoàn toàn đảm bảo tính độc nhất và không thể bị trùng lặp hay ghi nhận hai lần**.

---

## 6. Điểm móc kết nối `GameEventBus` chính xác

### 6.1. Vị trí chính xác
- **Tập tin**: `src/services/event/event-ingestion.service.ts`
- **Dòng code**: **Dòng 391** (nằm ngay sau khối broadcast thời gian thực ở dòng 384–390, và ngay trước lệnh `return persistedEvent;` ở dòng 392).

### 6.2. Hiện trạng mã nguồn tại điểm móc:
```typescript
// File: src/services/event/event-ingestion.service.ts (Dòng 383–396)
      // 5. Broadcast to Real-Time Subscribers if available
      if (this.realtimeBroadcaster && typeof this.realtimeBroadcaster.broadcast === 'function') {
        try {
          this.realtimeBroadcaster.broadcast(tenantId, sessionId, { ...persistedEvent, user: persistedUser });
        } catch (broadcastErr: any) {
          console.warn(`Realtime broadcast failed: ${broadcastErr.message}`);
        }
      }

      // <<< ĐIỂM MÓC GAMEEVENTBUS (DÒNG 391) >>>

      return persistedEvent;
    } catch (err: any) {
      console.error(`Failed to persist canonical event: ${err.message}`);
      throw err;
    }
```

### 6.3. Mã nguồn triển khai chuẩn cho Agent 3:
Thêm tham số thứ 4 tùy chọn vào `constructor` của `EventIngestionService`:
```typescript
constructor(
  private readonly eventRepo: EventRepository,
  private readonly userRepo: UserRepository,
  private readonly realtimeBroadcaster?: RealtimeBroadcaster,
  private readonly gameEventBus?: GameEventBus // Tùy chọn, không bắt buộc
) {}
```

Tại dòng 391, chèn đoạn mã gọi bus trong khối `try/catch` độc lập:
```typescript
// 6. Forward to Game Event Bus if registered
if (this.gameEventBus && typeof this.gameEventBus.publish === 'function') {
  try {
    this.gameEventBus.publish(tenantId, sessionId, persistedEvent, persistedUser);
  } catch (busErr: any) {
    console.warn(`GameEventBus publish failed for tenant ${tenantId}: ${busErr.message}`);
  }
}
```

### 6.4. Lý do chọn vị trí này (Architectural Decision):
1. **Đã có `persistedEvent.id`**: Khóa ngoại `gift_transactions.event_id` trỏ đến `events.id` luôn hợp lệ.
2. **Người dùng đã chuẩn hóa**: `persistedUser` đã được upsert đầy đủ định danh (`platform_user_id`, `unique_id`, `nickname`).
3. **Cô lập lỗi hoàn toàn**: Bất kỳ ngoại lệ nào phát sinh từ phía Game Engine / Event Bus đều được bắt gọn trong `try/catch`, không bao giờ làm gián đoạn tiến trình lưu trữ sự kiện TikTok lõi.
4. **Tương thích ngược 100%**: Khi không truyền `gameEventBus`, hệ thống hoạt động hoàn toàn nguyên bản; toàn bộ 245 bài test hiện hành vẫn tiếp tục xanh.

---

## 7. Phân tích rủi ro & Kế hoạch kiểm soát (Risk & Mitigation)

| Rủi ro | Mức độ | Hậu quả tiềm ẩn | Biện pháp kiểm soát của Kiến trúc |
|---|:---:|---|---|
| **Tranh chấp dữ liệu người chơi khi quà dồn dập (Concurrency/Race Condition)** | Cao | Người xem tặng nhiều combo quà trong 1 giây có thể gây ghi đè tu vi, sai lệch cảnh giới. | 1. Trong tiến trình: `GameEventProcessor` tạo hàng đợi Promise theo chuỗi key `tenantId:userId`.<br>2. Trong DB: Luôn khóa dòng `game_players` bằng `SELECT ... FOR UPDATE` trong transaction.<br>3. Thứ tự khóa nhất quán: `game_players` trước, `breakthrough_sessions` sau.<br>4. Retry tự động với exponential backoff & jitter khi gặp mã lỗi PostgreSQL `40P01` (deadlock) hoặc `40001` (serialization). |
| **Thất thoát hoặc cộng đúp quà (Double-Spend / Missed Gifts)** | Nghiêm trọng | Người xem mất tiền nhưng không nhận được tu vi, hoặc nhận gấp đôi tu vi khi stream giật lag. | 1. Idempotency cấp DB: Thực hiện `INSERT INTO gift_transactions(..., idempotency_key, status='pending')` TRƯỚC mọi xử lý.<br>2. Nếu dính Unique Violation -> dừng ngay và trả kết quả cũ.<br>3. Khởi động Reconciler định kỳ quét bảng `events` (tìm event quà chưa có trong `gift_transactions` suốt 24h) để xử lý bù. |
| **Sập server giữa phiên Độ Kiếp (Crash during Breakthrough)** | Trung bình | Người xem bị kẹt ở trạng thái "đang độ kiếp", timer 30s bị mất do RAM bị xóa. | `BreakthroughScheduler.recover()` khi khởi động server: quét các phiên có `status = 'preparing'`. Nếu quá `ends_at` -> lập tức xúc xắc giải quyết kết quả; nếu chưa quá hạn -> tái kích hoạt timer cho khoảng thời gian còn lại. |
| **Sai lệch tu vi không rõ nguyên nhân (Exp Drift)** | Nghiêm trọng | Không thể truy vết nguồn gốc tu vi của người chơi. | **Tuân thủ triệt để NFR-06 & Luật 3 của §0b**: Mọi thay đổi trên `game_players.current_exp` BẮT BUỘC phải đi kèm một bản ghi phát sinh trong `gift_transactions` hoặc `admin_audit_logs`. Tuyệt đối không cho phép cập nhật exp trực tiếp mà không có chứng từ giao dịch. |
| **Tấn công XSS qua tên người dùng hoặc bình luận TikTok** | Cao | Mã độc chèn vào nickname/comment hiển thị lên OBS làm lộ API Key hoặc crash overlay. | Quy tắc bất di bất dịch cho Agent 4: Tất cả các trường văn bản từ TikTok (`username`, `nickname`, `comment`) trên giao diện Overlay `/tutien` BẮT BUỘC phải gán qua `.textContent`, tuyệt đối KHÔNG dùng `.innerHTML`. |
| **Tràn bộ nhớ / Rò rỉ tài nguyên (Memory Leak) ở Overlay** | Trung bình | OBS chạy liên tục 4–8 tiếng bị giật lag, tụt fps. | Giới hạn hàng đợi hiệu ứng trên màn hình (tối đa 1 animation toàn màn hình tại một thời điểm, hàng đợi thông báo <= 3 thẻ), dọn dẹp audio elements và spritesheet textures đã sử dụng. |

---

## 8. Đối chiếu tài liệu & Nhật ký thay đổi (Documentation Reconciliation & Changelog)

Sau khi đối chiếu chi tiết giữa hiện trạng mã nguồn và bộ tài liệu kỹ thuật (`03_ERD.md`, `04_OpenAPI.yaml`, `05_Architecture.md`), xác nhận kết quả:

### 8.1. Đánh giá tính nhất quán
- **`03_ERD.md`**: Thiết kế 9 bảng và các ràng buộc toàn vẹn dữ liệu là hoàn toàn tương thích và khả thi. Cần lưu ý bổ sung index tổ hợp `@@unique([tenantId, realmOrder])` trên bảng `cultivation_realms` để khóa ngoại từ `game_players` và `cultivation_levels` tham chiếu hợp lệ trong Prisma DSL.
- **`04_OpenAPI.yaml`**: Chuẩn hóa envelope `{ success, data }` và `{ success: false, error }`, phân quyền theo scope `game:overlay` và `game:admin`, phân trang bằng cursor hoàn toàn khớp với phong cách kiến trúc hiện tại của `TikUser API`.
- **`05_Architecture.md`**: Luồng xử lý sự kiện qua `GameEventBus` tại dòng 391 của `EventIngestionService` là giải pháp tối ưu nhất, bảo toàn tính toàn vẹn của mã nguồn hiện có.

### 8.2. Changelog
1. **Xác nhận số dòng thực tế**: Cập nhật chính xác vị trí dòng trong `live.connector.ts` (quà tặng tại 385–409, chat tại 196–206, canonical ID tại 319) và điểm móc bus tại dòng 391 của `event-ingestion.service.ts`.
2. **Khuyến nghị bổ sung cho `MockConnector`**: Ghi nhận lưu ý về việc tính toán `totalDiamonds` fallback cho Agent 3 để đảm bảo bộ test của Agent 6 chạy trơn tru với `MockConnector`.
3. **Phê chuẩn chuyển tiếp sang Bước 2**: Toàn bộ điều kiện tiên quyết của **Phase 1 — Audit** đã được thỏa mãn. Hệ thống sẵn sàng cho việc phân chia công việc cho Agent 2 (Backend), Agent 4 (Frontend), Agent 5 (Game Designer) và Agent 6 (QA) theo đúng quy trình tại §6.

---
*Báo cáo được phê duyệt bởi **A1 Architect** — Sẵn sàng bàn giao.*
