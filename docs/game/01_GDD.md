# 01 — Game Design Document: TU TIÊN LIVE

> Nguồn gốc: `00_TU_TIEN_LIVE_spec.docx` (spec v1.0 của chủ dự án). Tài liệu này cụ thể hóa spec thành luật chơi có số liệu, có công thức và có trường hợp biên, để Backend/Frontend/QA cùng dùng một nguồn.
> Phiên bản tài liệu: 1.0 · Ngày: 2026-11-05 · Chủ sở hữu: Agent 5 (Game Designer), duyệt bởi Agent 1 (Architect)

---

## 1. Tóm tắt một câu

Người xem TikTok LIVE gõ `thamgia` để có một tu sĩ riêng; mỗi món quà được quy đổi thành **tu vi**, tu vi đẩy nhân vật qua **80 tầng / 8 đại cảnh giới**; ở tầng 10 (Đại Viên Mãn) người chơi gõ `do kiep` để mở một phiên **độ kiếp 30 giây**, trong đó quà tặng được cộng vào **tỷ lệ thành công** thay vì tu vi.

## 2. Trụ cột thiết kế

| Trụ cột | Ý nghĩa với gameplay | Hệ quả kỹ thuật |
|---|---|---|
| Tiến trình lâu dài | Nhân vật sống qua nhiều buổi LIVE, quay lại là thấy mình vẫn ở đó | Lưu theo `tenant + user`, không theo `live_session` |
| Hồi hộp có kiểm soát | Độ kiếp là khoảnh khắc "cả phòng nín thở" | Kết quả random ở backend, có log `roll` để truy vết |
| Quà = sức mạnh, minh bạch | Ai cũng hiểu "1 kim cương = 10 tu vi" | Công thức tuyến tính, hiển thị trên overlay |
| Không bao giờ cộng trùng | Mất lòng tin nhanh nhất là cộng sai | Unique constraint ở DB, không dựa vào cache |
| Mọi con số chỉnh được | Chủ phòng cân bằng theo tệp người xem | Không hardcode; mọi hằng số nằm trong `GameConfiguration` |

## 3. Vòng lặp chơi

```text
         ┌────────────── gõ "thamgia" ──────────────┐
         ▼                                           │
   [Tu sĩ Luyện Khí 1] ──tặng quà──▶ +tu vi ──▶ lên tầng (có thể nhiều tầng)
         ▲                                           │
         │                                  đạt tầng 10 + đủ tu vi
         │                                           ▼
   thất bại: −20% tu vi dư,              [Đại Viên Mãn] ── "do kiep"
   cooldown 5 phút  ◀────────────┐                   ▼
         │                       └──── [Phiên độ kiếp 30s: quà → +tỷ lệ]
         │                                           ▼
         └──────────── thành công: cảnh giới +1, tầng 1, trang phục mới
```

Vòng ngắn (giây): tặng quà → hiệu ứng → thanh tu vi nhảy.
Vòng trung (phút): lên tầng, leo bảng xếp hạng.
Vòng dài (nhiều buổi LIVE): đổi cảnh giới, đổi trang phục, danh hiệu.

## 4. Hệ thống cảnh giới

### 4.1 Tám đại cảnh giới

| # | Cảnh giới | Mã (`realm_code`) | Màu chủ đạo | Hiệu ứng đặc trưng | Tỷ lệ độ kiếp cơ bản (lên cảnh giới sau) |
|---|---|---|---|---|---|
| 1 | Luyện Khí | `luyen_khi` | Xanh nhạt | Linh khí, hạt sáng | 90% |
| 2 | Trúc Cơ | `truc_co` | Xanh lục | Lá cây, dây leo | 80% |
| 3 | Kim Đan | `kim_dan` | Vàng | Kim đan xoay, vòng kim quang | 70% |
| 4 | Nguyên Anh | `nguyen_anh` | Tím | Linh hồn, khói tím | 60% |
| 5 | Hóa Thần | `hoa_than` | Xanh lam | Thanh long, băng lôi | 50% |
| 6 | Luyện Hư | `luyen_hu` | Tím đen | Không gian, hố đen | 40% |
| 7 | Hợp Thể | `hop_the` | Trắng vàng | Âm dương, mây vàng | 30% |
| 8 | Đại Thừa | `dai_thua` | Vàng đỏ | Tiên quang, phượng hỏa | — (cấp tối đa v1) |

Mỗi cảnh giới có 10 tầng. Tầng 10 gọi là **Đại Viên Mãn**. Tổng 80 cấp. Đại Thừa tầng 10 là trần của v1: tu vi vẫn được cộng (cho bảng xếp hạng) nhưng không thể độ kiếp.

### 4.2 Tu vi yêu cầu mỗi tầng (giá trị mặc định)

Công thức mặc định (Admin có thể ghi đè từng ô trong bảng `cultivation_levels`):

```
RequiredExp(realm r, tầng l) = RealmBase[r] × l
RealmBase = [1.000, 2.500, 6.250, 15.600, 39.000, 97.600, 244.000, 610.000]
```

Khớp ví dụ của spec: Luyện Khí tầng 3 cần 3.000 tu vi.

| Cảnh giới | Tầng 1 | Tầng 10 | Tổng cả cảnh giới (×55) | ≈ Kim cương cần (hệ số 10) |
|---|---|---|---|---|
| Luyện Khí | 1.000 | 10.000 | 55.000 | 5.500 |
| Trúc Cơ | 2.500 | 25.000 | 137.500 | 13.750 |
| Kim Đan | 6.250 | 62.500 | 343.750 | 34.375 |
| Nguyên Anh | 15.600 | 156.000 | 858.000 | 85.800 |
| Hóa Thần | 39.000 | 390.000 | 2.145.000 | 214.500 |
| Luyện Hư | 97.600 | 976.000 | 5.368.000 | 536.800 |
| Hợp Thể | 244.000 | 2.440.000 | 13.420.000 | 1.342.000 |
| Đại Thừa | 610.000 | 6.100.000 | 33.550.000 | 3.355.000 |

Ghi chú cân bằng: đường cong ×2,5 mỗi cảnh giới giữ cho cảnh giới 1–3 đạt được trong vài buổi LIVE với quà nhỏ, còn 6–8 là mục tiêu dài hạn cho "đại gia". Nếu phòng nhỏ, Admin dùng preset **"Phòng nhỏ"** = chia toàn bộ `RealmBase` cho 10.

### 4.3 Thuật ngữ trạng thái

- `current_exp`: tu vi trong tầng hiện tại (0 ≤ current_exp).
- `total_cultivation`: tổng tu vi từng nhận được, không bao giờ giảm (kể cả khi bị phạt). Dùng cho bảng xếp hạng "Top tu vi".
- **Đại Viên Mãn**: `level = 10` và `current_exp ≥ RequiredExp(r, 10)`.
- **Tu vi dư** (overflow): `current_exp − RequiredExp(r, 10)` khi đang ở tầng 10.

## 5. Tu vi và lên cấp

### 5.1 Công thức tu vi

```
TuViNhan = DiamondValue × GiftQuantity × TuViMultiplier        (mặc định TuViMultiplier = 10)
```

- `DiamondValue` = `data.diamondCount` của gift event (giá 1 đơn vị quà).
- `GiftQuantity` = `data.repeatCount` (đã là số chốt cuối của combo — xem §8).
- Nếu `diamondCount` là `null` (thư viện không trả giá) → **không cộng**, ghi giao dịch `transaction_type = unpriced` để Admin xử lý tay. Không đoán giá.
- Làm tròn: số nguyên, `floor`. Dùng `BIGINT` ở DB.

### 5.2 Thuật toán lên tầng (multi-level)

```text
function applyExp(player, amount):
  player.current_exp += amount
  player.total_cultivation += amount
  levelsGained = []
  loop:
    if player.level == 10: break                 # dừng ở Đại Viên Mãn, phần dư giữ nguyên
    req = RequiredExp(player.realm, player.level)
    if player.current_exp < req: break
    player.current_exp -= req
    player.level += 1
    levelsGained.push(player.level)
  return levelsGained
```

Ví dụ spec: Luyện Khí 3, 2.500/3.000, nhận 1.000 → Luyện Khí 4, 500/4.000.
Ví dụ nhiều tầng: Luyện Khí 1, 0/1.000, nhận Galaxy (1.000 💎 → 10.000 tu vi) → qua tầng 1 (1.000), 2 (2.000), 3 (3.000) = 6.000; còn 4.000 = đủ tầng 4 (4.000) → **Luyện Khí 5, 0/5.000**.

Quy tắc: một món quà **không bao giờ** vượt qua ranh giới cảnh giới. Tối đa nó đưa người chơi tới tầng 10; phần dư nằm lại làm tu vi dư.

### 5.3 Trần tu vi dư

Để tránh tích trữ vô hạn trước độ kiếp, `maxOverflowRatio` (mặc định `3.0`): tu vi dư tối đa = 3 × RequiredExp(r, 10). Quà vượt trần vẫn cộng `total_cultivation` (cho bảng xếp hạng) nhưng không cộng `current_exp`; overlay hiện "Tu vi đã viên mãn, hãy độ kiếp!".

## 6. Lệnh chat

Chuẩn hóa trước khi so khớp: `trim` → bỏ `/` đầu → lowercase → bỏ dấu tiếng Việt (NFD + xóa combining marks, `đ→d`) → gộp khoảng trắng. Vì vậy `/Độ Kiếp`, `do kiep`, `dokiep` đều khớp.

| Lệnh (dạng chuẩn hóa) | Bí danh | Ai dùng | Hành động | Phản hồi trên overlay |
|---|---|---|---|---|
| `thamgia` | `tham gia` | Mọi người | Tạo hoặc tải nhân vật | Thẻ "X đã nhập môn" / "X trở lại tông môn" |
| `thamgia nam` / `thamgia nu` | — | Mọi người | Như trên + chọn giới tính | Như trên |
| `gioitinh nam` / `gioitinh nu` | — | Đã tham gia | Đổi giới tính (cooldown 24h) | Nhân vật đổi trang phục |
| `thongtin` | `info` | Đã tham gia | Toàn bộ thông tin | Thẻ nhân vật 6s |
| `tuvi` | — | Đã tham gia | Tu vi hiện tại/yêu cầu | Thẻ ngắn 4s |
| `canhgioi` | — | Đã tham gia | Cảnh giới + tầng | Thẻ ngắn 4s |
| `xephang` | — | Mọi người | Thứ hạng của mình | Thẻ ngắn 4s |
| `top` | — | Mọi người | Mở rộng bảng top 10s | Bảng xếp hạng phóng to |
| `dokiep` | `do kiep` | Đã tham gia | Bắt đầu độ kiếp | Màn hình độ kiếp |

Quy định chống spam:
- Mỗi người: tối đa 1 lệnh xem thông tin / 10 giây (`commandCooldownSeconds`), lệnh thừa bị bỏ qua im lặng.
- Overlay chỉ hiển thị tối đa 3 thẻ phản hồi cùng lúc; thừa thì xếp hàng, quá 20 thẻ chờ thì bỏ thẻ cũ nhất (lệnh xem thông tin không quan trọng bằng quà).
- Chỉ so khớp khi **cả bình luận** là lệnh (có thể kèm tham số). "tôi muốn thamgia" không kích hoạt.

### 6.1 Giới tính

TikTok không cung cấp giới tính. Mặc định lấy theo `defaultGender` (cấu hình; mặc định `male`). Người chơi tự chọn bằng tham số lệnh. Giới tính chỉ ảnh hưởng hình ảnh.

### 6.2 Người chưa tham gia mà tặng quà

Cấu hình `autoJoinOnGift` (mặc định `true`): tạo nhân vật tự động rồi cộng tu vi — người tặng quà không bao giờ bị "mất" quà. Nếu Admin tắt: ghi giao dịch `transaction_type = unjoined`, tu vi được **giữ chờ** và cộng khi người đó gõ `thamgia` trong vòng `pendingGiftTtlHours` (mặc định 72h).

## 7. Độ kiếp

### 7.1 Điều kiện bắt đầu

Tất cả phải đúng, kiểm tra ở backend trong cùng transaction với việc tạo phiên:

1. Đã tham gia, game đang bật (`gameEnabled`).
2. `level = 10` và đạt Đại Viên Mãn.
3. Không phải Đại Thừa (cảnh giới cuối).
4. Không có `breakthrough_session` nào `status ∈ {preparing, resolving}` của người này (unique partial index).
5. `now ≥ breakthrough_cooldown_until`.
6. Số phiên độ kiếp đồng thời toàn phòng < `maxConcurrentBreakthroughs` (mặc định 3) — để overlay không bị rối.

Lý do từ chối được trả về overlay dưới dạng thẻ ngắn, ví dụ "Chưa viên mãn: 8.200/10.000 tu vi", "Đang hồi phục kinh mạch: còn 3 phút 12 giây".

### 7.2 Vòng đời phiên

```text
preparing (30s, nhận quà tăng tỷ lệ) ──hết giờ──▶ resolving ──▶ succeeded | failed
       │
       └── backend restart: phục hồi từ DB; nếu ends_at đã qua → resolve ngay
```

1. Người chơi gõ `dokiep` → backend tạo phiên `preparing`, `ends_at = now + preparationSeconds` (30).
2. Overlay mở màn hình độ kiếp: nhân vật, mây kiếp, đồng hồ, **tỷ lệ hiện tại** cập nhật trực tiếp.
3. Quà của chính người đó trong cửa sổ này → `gift_bonus` (không cộng tu vi, trừ khi `addExpDuringBreakthrough = true`).
4. Hết giờ → khóa phiên (`resolving`), quà đến sau mốc `ends_at` tính như quà thường.
5. Tính `FinalChance`, random, lưu kết quả, áp dụng hệ quả, phát sự kiện.

### 7.3 Tỷ lệ

```
GiftBonusBp = floor( Σ (diamondCount × repeatCount) × ChanceBpPer100Diamonds[realm] / 100 )
FinalChance = min(BaseChance[realm] + GiftBonus, MaxChance)        MaxChance mặc định 95%
```

Mức tăng mặc định, giảm dần theo cảnh giới để giá trị "mua tỷ lệ" tương xứng với tu vi đã đầu tư:

| Cảnh giới | Base | +1% cần | Ví dụ: Galaxy 1.000 💎 |
|---|---|---|---|
| Luyện Khí | 90% | 10 💎 | +100% → chạm trần 95% |
| Trúc Cơ | 80% | 25 💎 | +40% → 95% |
| Kim Đan | 70% | 60 💎 | +16,7% → 86,7% |
| Nguyên Anh | 60% | 150 💎 | +6,7% → 66,7% |
| Hóa Thần | 50% | 400 💎 | +2,5% → 52,5% |
| Luyện Hư | 40% | 1.000 💎 | +1% → 41% |
| Hợp Thể | 30% | 2.500 💎 | +0,4% → 30,4% |

Lưu tỷ lệ dưới dạng **basis points** (số nguyên, 9500 = 95,00%) để tránh lỗi số thực.

Random: `roll = crypto.randomInt(0, 10000)`; thành công khi `roll < final_chance_bp`. `roll` được lưu vào lịch sử để truy vết và để QA kiểm tra phân phối.

### 7.4 Hệ quả

**Thành công**
- `realm += 1`, `level = 1`, `current_exp = tu vi dư` (trước độ kiếp) rồi chạy lại `applyExp(0)` ở cảnh giới mới — tu vi dư có thể đẩy ngay lên vài tầng.
- Mở khóa trang phục cảnh giới mới (giới tính hiện tại), `breakthrough_success_count += 1`.
- Overlay: hiệu ứng đột phá toàn màn hình 6s + thông báo LIVE "X đột phá Trúc Cơ!".

**Thất bại**
- Giữ nguyên cảnh giới và tầng 10.
- `penalty = floor(tu vi dư × failurePenaltyRatio)` (mặc định 20%). `current_exp −= penalty`. Không bao giờ rơi xuống dưới ngưỡng Đại Viên Mãn: nếu tu vi dư = 0 thì phạt = 0.
- `breakthrough_cooldown_until = now + cooldownSeconds` (mặc định 300).
- Quà đã dùng không hoàn lại (đã ghi rõ trong `gift_transactions`).
- Overlay: hiệu ứng thất bại 4s (nhân vật quỳ, sét đánh, màn hình rung nhẹ).

### 7.5 Trường hợp biên

| Tình huống | Xử lý |
|---|---|
| Gõ `dokiep` 5 lần trong 1 giây | Lần đầu tạo phiên; các lần sau va unique index → phản hồi "Đang độ kiếp". |
| Quà đến đúng mốc `ends_at` | So sánh `gift.occurredAt` (thời điểm TikTok) với `ends_at`; `<` vào bonus, `≥` thành quà thường. |
| Mất kết nối TikTok giữa phiên | Phiên vẫn chạy theo giờ backend; kết thúc đúng hạn. Quà đến trễ khi reconnect được xử lý theo `occurredAt`. |
| Backend restart giữa phiên | Khi khởi động, `BreakthroughRecovery` quét phiên `preparing`: chưa hết giờ → đặt lại timer; đã hết → resolve ngay. Resolve dùng `UPDATE ... WHERE status='preparing'` nên chỉ chạy một lần. |
| Admin chỉnh cấu hình giữa phiên | Phiên dùng `config_snapshot` chụp lúc bắt đầu. |
| Admin reset nhân vật đang độ kiếp | Phiên chuyển `cancelled`, không random. |

## 8. Xử lý quà (gameplay view)

Thứ tự xử lý một gift event:

1. Event đã được pipeline hiện có (`EventIngestionService`) lưu vào `events` — game **không** đọc TikTok trực tiếp.
2. Lấy dữ liệu chuẩn hóa từ `data`: `giftId`, `giftName`, `diamondCount`, `repeatCount`, `totalDiamonds`, `repeatEnd`, `giftType` (do `mapGiftPayload` trong `src/adapters/tiktok/live.connector.ts` tạo ra).
3. **Combo**: connector đã bỏ các tin `repeatEnd = 0` của quà combo, chỉ giữ tin chốt có `repeatCount` cuối cùng. Gameplay **chỉ xử lý event có `repeatEnd = true`**, không tự cộng dồn tin trung gian.
4. Tìm/tạo người chơi → xác định ngữ cảnh: đang có phiên độ kiếp `preparing` của chính người này? → bonus; ngược lại → tu vi.
5. Ghi `gift_transactions` với khóa idempotency, cập nhật nhân vật, ghi `game_events`, phát realtime — tất cả trong **một transaction**.

## 9. Bảng xếp hạng

Năm bảng; mọi bảng có **khóa phụ cố định** để thứ tự luôn xác định (không nhảy loạn khi bằng điểm):

| Bảng | Khóa chính | Khóa phụ 1 | Khóa phụ 2 | Khóa cuối |
|---|---|---|---|---|
| Top cảnh giới | `realm_order` ↓ | `level` ↓ | `current_exp` ↓ | `reached_at` ↑ (ai đạt trước xếp trên) |
| Top tầng (tổng cấp) | `(realm−1)×10 + level` ↓ | `current_exp` ↓ | `reached_at` ↑ | `player.id` ↑ |
| Top tu vi | `total_cultivation` ↓ | `reached_at` ↑ | `player.id` ↑ | — |
| Top độ kiếp thành công | `breakthrough_success_count` ↓ | `realm_order` ↓ | `reached_at` ↑ | `player.id` ↑ |
| Top quà tặng | `total_diamonds_gifted` ↓ | `reached_at` ↑ | `player.id` ↑ | — |

`reached_at` = thời điểm chỉ số chính đổi lần cuối. Hai người cùng hạng hiển thị cùng số thứ hạng (dense rank) nhưng vẫn theo thứ tự trên.

Phạm vi: mặc định toàn thời gian của tenant; có thêm `scope=session` (chỉ tính quà/độ kiếp trong buổi LIVE hiện tại) cho bảng "Top quà tặng" của buổi.

## 10. Danh mục cấu hình (mặc định)

| Khóa | Kiểu | Mặc định | Ghi chú |
|---|---|---|---|
| `gameEnabled` | bool | true | Tắt → bỏ qua mọi lệnh/quà (quà vẫn lưu ở `events`) |
| `giftProcessingEnabled` | bool | true | |
| `effectsEnabled` | bool | true | Overlay tắt hiệu ứng nặng |
| `tuViMultiplier` | int | 10 | |
| `realmBase` | int[8] | xem §4.2 | Sinh `cultivation_levels` khi "Áp dụng công thức" |
| `maxOverflowRatio` | decimal | 3.0 | |
| `baseChanceBp` | int[7] | 9000…3000 | |
| `maxChanceBp` | int | 9500 | |
| `chanceBpPer100Diamonds` | int[7] | 1000, 400, 167, 67, 25, 10, 4 | bp cộng thêm cho mỗi 100 💎; xem §7.3 |
| `preparationSeconds` | int | 30 | 10–120 |
| `cooldownSeconds` | int | 300 | |
| `failurePenaltyRatio` | decimal | 0.20 | 0–1 |
| `addExpDuringBreakthrough` | bool | false | |
| `maxConcurrentBreakthroughs` | int | 3 | |
| `autoJoinOnGift` | bool | true | |
| `pendingGiftTtlHours` | int | 72 | |
| `defaultGender` | enum | male | |
| `commandCooldownSeconds` | int | 10 | |

## 11. Chỉ số thành công (để Game Designer theo dõi)

- Tỷ lệ người bình luận gõ `thamgia` ≥ 15% trong buổi đầu.
- ≥ 40% người tham gia lên ít nhất 1 tầng trong buổi đầu.
- Tỷ lệ độ kiếp thực tế lệch ≤ 2 điểm % so với `final_chance` trung bình trên 1.000 lần (kiểm tra RNG).
- Doanh thu kim cương / buổi so với buổi trước khi có game (do chủ phòng tự so sánh).

## 12. Ngoài phạm vi v1

Hộ pháp (người khác tặng quà cho phiên độ kiếp của bạn), tông môn/bang hội, PvP, vật phẩm/đan dược, cảnh giới sau Đại Thừa, đổi tu vi ra phần thưởng thật. Ghi lại đây để không ai "tiện tay" làm trước.

## 13. Nhiều người chơi cùng lúc

Gameplay vốn đã nhiều người: mỗi người xem có nhân vật riêng, quà của ai cộng cho người đó, backend xử lý song song (Architecture §4). Phần cần thiết kế là **ai được hiển thị ở đâu** trên màn hình 720×1280 khi có hàng trăm người. Bố cục: Asset Guidelines §6.

### 13.1 Ba vùng hiển thị

| Vùng | Sức chứa | Ai được vào | Rời khi |
|---|---|---|---|
| Đài cao | 3 | Top 3 "Top cảnh giới" (toàn thời gian, chỉ tính người đang hoạt động trong buổi; nếu < 3 thì lấy top toàn thời gian) | Bị vượt hạng |
| Bậc thềm | 12 | Người có sự kiện gần nhất (quà, lên tầng, lệnh `thongtin`) | Bị người mới đẩy ra; giữ chỗ tối thiểu 20s |
| Linh quang | 60 | Mọi người hoạt động trong 5 phút còn lại | Không hoạt động 5 phút |

"Hoạt động" = có chat, quà hoặc lệnh trong `activeWindowSeconds` (mặc định 300).

Luật thay ghế ở bậc thềm: người mới vào ghế trống; hết ghế thì thay người **lâu chưa hoạt động nhất đã ngồi ≥ 20s**; nếu tất cả đều ngồi < 20s thì người mới xếp hàng chờ (tối đa 10, thừa thì chỉ hiện ở luồng thông báo). Quà ≥ 100💎 được chen hàng.

### 13.2 Gộp sự kiện khi đông

- Quà của cùng một người trong 1,5s được gộp thành một thẻ: "Lan ×5 quà · +3.200 tu vi".
- Lên nhiều tầng trong một lần → một thẻ "Kim Đan 3 → 7".
- Nhập môn: > 5 người trong 3s → một thẻ "12 đạo hữu vừa nhập môn" + đốm linh quang bay vào.
- Hiệu ứng toàn màn hình (spotlight, đột phá): một hàng đợi chung, tối đa 1 cái cùng lúc, ưu tiên: đột phá > độ kiếp bắt đầu > quà ≥ 1.000💎 > lên ≥ 3 tầng.

### 13.3 Ai quyết định

Việc xếp chỗ là **hiển thị**, không ảnh hưởng gameplay nên do overlay tính. Backend cung cấp dữ liệu: `GET /api/v1/game/state` trả `activePlayers` (tối đa 75 người hoạt động gần nhất, kèm `lastActiveAt`) và top 3; frame `game.*` cập nhật dần. Hai overlay mở cùng lúc có thể xếp ghế khác nhau một chút — chấp nhận được.

### 13.4 Cấu hình thêm

| Khóa | Mặc định |
|---|---|
| `activeWindowSeconds` | 300 |
| `stepSeats` | 12 (6–18) |
| `maxSpiritLights` | 60 |
| `seatMinHoldSeconds` | 20 |
