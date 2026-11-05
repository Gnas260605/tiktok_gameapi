# 01 — Game Design Document: TU TIÊN LIVE

> Nguồn gốc: `00_TU_TIEN_LIVE_spec.docx` (spec v1.0 của chủ dự án). Tài liệu này cụ thể hóa spec thành luật chơi có số liệu, có công thức và có trường hợp biên, để Backend/Frontend/QA cùng dùng một nguồn.
> Phiên bản tài liệu: 1.0 · Ngày: 2026-11-05 · Chủ sở hữu: Agent 5 (Game Designer), duyệt bởi Agent 1 (Architect)

---

## 1. Tóm tắt một câu

Người xem TikTok LIVE gõ `thamgia` để có một tu sĩ riêng; quà tặng (nhanh) và tap tim, xem, follow, share (chậm, có trần ngày) được quy đổi thành **tu vi**, tu vi đẩy nhân vật qua **80 tầng / 8 đại cảnh giới**; ở tầng 10 (Đại Viên Mãn) người chơi gõ `do kiep` để mở một phiên **độ kiếp 30 giây**, trong đó quà tặng được cộng vào **tỷ lệ thành công** thay vì tu vi.

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
RequiredExp(realm r, tầng l) = RealmBase[r] × (1 + 0,2 × (l − 1))      → tầng 10 = 2,8 × tầng 1
RealmBase = [1.000, 2.500, 6.250, 15.600, 39.000, 97.600, 244.000, 610.000]
Tổng một cảnh giới = 19 × RealmBase[r]
```

| Cảnh giới | Tầng 1 | Tầng 10 | Tổng cả cảnh giới | ≈ Kim cương (hệ số 10) | Buổi LIVE: chỉ miễn phí | Buổi: 300💎/buổi | Buổi: 30.000💎/buổi |
|---|---|---|---|---|---|---|---|
| Luyện Khí | 1.000 | 2.800 | 19.000 | 1.900 | 19 | 5 | < 1 |
| Trúc Cơ | 2.500 | 7.000 | 47.500 | 4.750 | 30 | 10 | < 1 |
| Kim Đan | 6.250 | 17.500 | 118.750 | 11.875 | 46 | 21 | < 1 |
| Nguyên Anh | 15.600 | 43.680 | 296.400 | 29.640 | 72 | 42 | 1 |
| Hóa Thần | 39.000 | 109.200 | 741.000 | 74.100 | 113 | 78 | 2,4 |
| Luyện Hư | 97.600 | 273.280 | 1.854.400 | 185.440 | 177 | 138 | 6 |
| Hợp Thể | 244.000 | 683.200 | 4.636.000 | 463.600 | 276 | 234 | 15 |
| Đại Thừa | 610.000 | 1.708.000 | 11.590.000 | 1.159.000 | 432 | 388 | 35 |

"Buổi" = một buổi LIVE với người xem tương tác đủ để chạm trần linh khí miễn phí (§14), mỗi cột tính riêng cho từng cảnh giới. Tổng 8 cảnh giới ≈ 19,3 triệu tu vi ≈ 1,93 triệu 💎.

**Lý do đổi so với spec** (spec ghi rõ bảng là "giá trị minh họa"): đường cong tuyến tính `base × l` làm tầng 10 đắt gấp 10 lần tầng 1, người chơi miễn phí phải chờ 6–7 buổi mới lên một tầng ở cuối mỗi cảnh giới — dễ chán. Đường cong mới `×2,8` giữ cảm giác "tầng nào cũng gần", còn độ khó dồn vào bước nhảy cảnh giới (×2,5) và độ kiếp. Ví dụ của spec ("Luyện Khí 3, 2.500/3.000") vẫn tái hiện được bằng preset **"Spec tuyến tính"**.

Preset có sẵn trong Admin:
- **Mặc định** (bảng trên).
- **Phòng nhỏ**: chia `RealmBase` cho 5 (phòng ít quà).
- **Spec tuyến tính**: `RealmBase[r] × l`, đúng ví dụ spec.

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

Ví dụ (bảng mặc định): Luyện Khí 3, 1.000/1.400, nhận 1.000 → Luyện Khí 4, 600/1.600.
Ví dụ nhiều tầng: Luyện Khí 1, 0/1.000, nhận Galaxy (1.000 💎 → 10.000 tu vi) → qua tầng 1–6 (1.000 + 1.200 + 1.400 + 1.600 + 1.800 + 2.000 = 9.000); còn 1.000 < 2.200 → **Luyện Khí 7, 1.000/2.200**.
Ví dụ spec (preset "Spec tuyến tính"): Luyện Khí 3, 2.500/3.000, nhận 1.000 → Luyện Khí 4, 500/4.000.

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
5. Tính `FinalChance` (gồm cả hộ pháp của cả phòng, §14.2), random, lưu kết quả, áp dụng hệ quả, phát sự kiện.

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

Tông môn/bang hội, PvP, vật phẩm/đan dược, cảnh giới sau Đại Thừa, đổi tu vi ra phần thưởng thật. Ghi lại đây để không ai "tiện tay" làm trước.

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


## 14. Linh khí miễn phí: tu vi không cần tặng quà

Người không tặng quà vẫn tu luyện được bằng cách **xem, tap tim, bình luận, follow, share**. Quà vẫn là đường nhanh nhất. Linh khí miễn phí giữ cho mọi người có lý do ở lại và tương tác, và tương tác cũng là thứ giúp LIVE được TikTok đề xuất nhiều hơn.

### 14.1 Nguồn và mức thưởng

Mức thưởng tính bằng **đơn vị linh khí**, đổi ra tu vi theo cảnh giới hiện tại:

```
TuViMienPhi = DonViLinhKhi × FreeScale[realm]
FreeScale   = 1,6^(realm − 1) = [1; 1,6; 2,56; 4,1; 6,55; 10,49; 16,78; 26,84]
```

`FreeScale` tăng chậm hơn `RealmBase` (×1,6 so với ×2,5 mỗi cảnh giới). Đây là lựa chọn cân bằng có chủ đích: đầu game người chơi miễn phí lên tầng đều đặn, càng lên cao càng cần quà.

| Nguồn | Sự kiện TikTok (đã có trong connector) | Đơn vị | Giới hạn | Tính vào trần ngày? |
|---|---|---|---|---|
| Nhập môn lần đầu | lệnh `thamgia` | 300 | 1 lần trọn đời | Không |
| Follow chủ phòng | `follow` | 500 | 1 lần trọn đời mỗi người chơi (unfollow rồi follow lại không được thêm) | Không |
| Điểm danh | `member` hoặc tương tác đầu tiên trong ngày | 50 | 1 lần / ngày | Có |
| Tĩnh tọa (xem live) | Máy chủ tự cộng mỗi 60 giây nếu người đó có chat/tap/quà trong 5 phút gần nhất | 8 / phút | 60 phút / ngày (480) | Có |
| Tap tim | `like` (trường `likeCount` = số tap trong đợt) | 1 / tap | 300 / ngày | Có |
| Bình luận thường | `chat` không phải lệnh, từ 2 ký tự | 5 | 1 lần / 30 giây, 100 / ngày | Có |
| Share LIVE | `share` | 60 | 3 lần / ngày (180) | Có |

**Trần ngày** (`freeDailyCapUnits`) = 1.000 đơn vị. Tổng các nguồn (1.110) cố ý lớn hơn trần một chút, để người chơi không phải làm đủ mọi thứ mới chạm trần.

**Chuỗi điểm danh**: mỗi ngày liên tiếp có điểm danh thì trần ngày tăng 10%, tối đa +50% (từ ngày thứ 6 trần là 1.500). Bỏ một ngày thì chuỗi về 0. Đây là lý do để người xem quay lại buổi sau.

"Ngày" tính theo múi giờ cấu hình `gameTimezone` (mặc định `Asia/Ho_Chi_Minh`), không theo buổi LIVE. Vì vậy chủ phòng tắt rồi mở LIVE lại cũng không làm người chơi nhận thêm.

Vì sao "xem live" phải suy ra từ tương tác: TikTok chỉ gửi sự kiện khi có người **vào** phòng, không gửi khi họ **rời** đi, và không cho biết thời gian xem của từng người. Tĩnh tọa vì vậy chỉ cộng cho người còn tương tác trong 5 phút gần nhất. Một lần tap tim là đủ giữ trạng thái tĩnh tọa, nên người xem thật không bị thiệt.

### 14.2 Hộ pháp khi độ kiếp (cả phòng cùng chơi)

Trong 30 giây độ kiếp của bất kỳ ai, **mọi người xem** đều giúp được:

| Hành động | Thêm tỷ lệ | Trần |
|---|---|---|
| Mỗi 100 tap tim (cộng dồn cả phòng) | +0,2% (20 bp) | Tổng hộ pháp tối đa +5% (500 bp) |
| Mỗi lượt share | +1% (100 bp) | Tính chung trần hộ pháp |
| Quà của **người khác** | Như quà của chính người độ kiếp nhưng chỉ tính 50% | Tính chung trần hộ pháp |

```
FinalChance = min(BaseChance + GiftBonus(quà của chính người đó) + CrowdBonus(≤ 500 bp), MaxChance)
```

Overlay hiện "Cả phòng tap tim để hộ pháp cho {tên}!" kèm thanh hộ pháp riêng. Người hộ pháp nhiều nhất trong phiên được nêu tên khi thành công. Tap và share dùng để hộ pháp **vẫn** được tính linh khí cho chính người tap.

Mục này thay phần "hộ pháp" từng nằm trong danh sách ngoài phạm vi ở §12. Tông môn, PvP và vật phẩm vẫn ngoài phạm vi.

### 14.3 Chống gian lận

- Mỗi nguồn có khóa idempotency riêng (Architecture §12). Trần ngày được kiểm tra trong cùng transaction với việc cộng tu vi.
- Tap tim được gộp theo từng người trong cửa sổ 3 giây rồi mới ghi DB một lần, vì TikTok gửi rất nhiều sự kiện like.
- Người bị `banned` không nhận gì. Admin có thể đặt mức thưởng của từng nguồn về 0.
- Người chơi có định danh yếu (`event_only`, không có `platform_user_id`) chỉ nhận 50% linh khí và không nhận thưởng follow, để hạn chế lạm dụng bằng tài khoản ảo.

## 15. Nhịp độ: không chán, không phải chơi quá lâu

### 15.1 Mục tiêu nhịp độ (A5 dùng để kiểm tra cân bằng)

| Mốc | Mục tiêu |
|---|---|
| Lần lên tầng đầu tiên | Trong 5 phút tương tác với người miễn phí (nhập môn 300 + follow 500 + vài tap là đủ 1.000) |
| Người miễn phí ở Luyện Khí | Lên ít nhất 1 tầng mỗi 1–2 buổi |
| Người miễn phí chạm trần ngày | Trong khoảng 60 phút xem có tương tác, **không cần ngồi cả buổi** |
| Độ kiếp đầu tiên (Luyện Khí → Trúc Cơ) | Người miễn phí: khoảng 3–4 tuần. Người tặng 300💎/buổi: khoảng 5 buổi |
| Đại Thừa | Chỉ người tặng quà lớn đều đặn (khoảng 35 buổi ở mức 30.000💎/buổi) |

### 15.2 Cơ chế chống chán

- **Luôn có thứ để nhìn**: thanh tu vi nhích lên ngay khi tap, số tu vi bay lên được gộp mỗi 1,5 giây.
- **Khi đã chạm trần ngày**: overlay báo "Linh khí hôm nay đã viên mãn. Quay lại buổi sau, chuỗi điểm danh +10%". Người chơi biết lúc nào nên dừng và có lý do quay lại.
- **Mục tiêu gần**: thẻ người chơi luôn ghi rõ số tu vi còn thiếu để lên tầng sau.
- **Khoảnh khắc chung**: độ kiếp có hộ pháp, nên cả phòng có việc để làm, kể cả người không chơi.

### 15.3 Cấu hình thêm

| Khóa | Mặc định |
|---|---|
| `freeEnabled` | true |
| `freeScaleGrowth` | 1.6 |
| `freeDailyCapUnits` | 1000 |
| `freeStreakBonusPerDay` / `freeStreakBonusMax` | 0.10 / 0.50 |
| `freeUnits` | `{ join: 300, follow: 500, checkin: 50, presencePerMinute: 8, presenceMaxMinutes: 60, like: 1, likeDailyMax: 300, chat: 5, chatCooldownSeconds: 30, chatDailyMax: 100, share: 60, shareDailyMax: 3 }` |
| `presenceActivityWindowSeconds` | 300 |
| `weakIdentityFreeRatio` | 0.5 |
| `crowdBonusMaxBp` | 500 |
| `crowdBpPer100Likes` / `crowdBpPerShare` / `crowdOtherGiftRatio` | 20 / 100 / 0.5 |
| `gameTimezone` | `Asia/Ho_Chi_Minh` |

## 16. Voice: đọc thông báo cho hành động đặc biệt

### 16.1 Khi nào đọc

Chỉ đọc những khoảnh khắc đáng chú ý. Đọc mọi thứ sẽ ồn và gây khó chịu.

| Sự kiện | Câu mẫu (giọng kể chuyện tu tiên) | Ưu tiên |
|---|---|---|
| Độ kiếp bắt đầu | "Thiên kiếp giáng lâm! {tên} đang độ kiếp {cảnh giới sau}. Cả phòng tap tim hộ pháp!" | 1 |
| Đếm ngược | "Mười giây!", rồi "Ba, hai, một" (chỉ với người đang được hiển thị toàn màn hình) | 1 |
| Độ kiếp thành công | "Chúc mừng {tên} đột phá {cảnh giới}! Thiên địa chấn động!" | 1 |
| Độ kiếp thất bại | "Kiếp lôi quá mạnh. {tên} độ kiếp thất bại, hãy tĩnh dưỡng rồi thử lại." | 1 |
| Lên Top 1 | "{tên} đã đứng đầu tông môn!" | 2 |
| Quà từ `voiceGiftThreshold` (mặc định 1.000💎) | "Đa tạ {tên} ban tặng {tên quà}! Tu vi tăng vọt!" | 2 |
| Đạt Đại Viên Mãn | "{tên} đã viên mãn {cảnh giới}. Gõ độ kiếp để đột phá!" | 3 |
| Lên từ 3 tầng trong một lần | "{tên} liên tiếp phá {n} tầng!" | 3 |
| Follow / share (gộp 10 giây) | "Cảm ơn {tên} và {n} đạo hữu đã theo dõi!" | 4 |
| Nhập môn (gộp 10 giây) | "Chào mừng {n} đạo hữu mới nhập môn!" | 4 |

Câu mẫu nằm trong cấu hình (`voiceLines`) để Admin sửa được. Mỗi sự kiện có 2–3 biến thể để không lặp lại.

### 16.2 Quy tắc phát

- Mỗi lúc chỉ đọc **một** câu. Hàng đợi tối đa 3 câu; khi đầy thì bỏ câu ưu tiên thấp. Câu ưu tiên 1 được chen lên đầu.
- Hai câu cách nhau ít nhất 1,5 giây. Mỗi sự kiện ưu tiên 3–4 đọc tối đa 1 lần mỗi 20 giây.
- Khi đang đọc, nhạc nền (nếu có) giảm xuống 30%.
- **Tên người chơi**: đọc `nickname` đã lọc. Bỏ emoji và ký tự lạ, cắt tối đa 20 ký tự, thay link hoặc số điện thoại bằng "đạo hữu". Tên chứa từ trong danh sách chặn (`voiceBlocklist`) thì đọc "một vị đạo hữu". Không bao giờ đọc nội dung bình luận.
- Chủ phòng có thể tắt từng loại voice hoặc tắt hẳn (`voiceEnabled`) trong Admin, có hiệu lực ngay.

### 16.3 Cấu hình

| Khóa | Mặc định |
|---|---|
| `voiceEnabled` | true |
| `voiceProvider` | `browser` (miễn phí, chất lượng tùy máy) hoặc `cloud` (Architecture §13) |
| `voiceName`, `voiceRate`, `voiceVolume` | giọng nữ `vi-VN` · 1.0 · 0.9 |
| `voiceGiftThreshold` | 1000 💎 |
| `voiceEvents` | bật/tắt từng sự kiện ở §16.1 |
| `voiceLines` | câu mẫu theo sự kiện |
| `voiceBlocklist` | danh sách từ chặn |
