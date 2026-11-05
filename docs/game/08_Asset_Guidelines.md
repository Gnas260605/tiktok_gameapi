# 08 — Quy chuẩn Asset: TU TIÊN LIVE

> Phiên bản 1.0 · 2026-11-05 · Chủ sở hữu: Agent 4 (Frontend) · Duyệt: Agent 5 (Game Designer)
> Ảnh tham chiếu bộ nam: `docs/game/assets/reference-male-realms.webp` (843×562, lưới 4×2).

## 1. Phong cách

**Anime Xianxia, toàn thân, đứng thẳng, nhìn 3/4 về phía khán giả**, nền trong suốt. Cùng một khuôn mặt và kiểu tóc (búi cao, tóc đen dài) xuyên suốt 8 cảnh giới — người xem phải nhận ra "vẫn là nhân vật của mình" sau mỗi lần đột phá. Thứ thay đổi là **trang phục, màu và hào quang**, mức độ phô trương tăng dần theo cảnh giới.

Quy tắc tăng tiến (đọc từ ảnh tham chiếu):

| Cảnh giới | Ảnh tham chiếu (hàng, cột) | Trang phục | Hào quang | Độ "nặng" thị giác |
|---|---|---|---|---|
| 1 Luyện Khí | (1,1) | Áo trắng–xanh nhạt, đơn giản | Dải linh khí xanh nhạt, quả cầu nước trên tay | Nhẹ |
| 2 Trúc Cơ | (1,2) | Áo xanh ngọc, lớp khoác | Lá cây, dải lục | Nhẹ |
| 3 Kim Đan | (1,3) | Trắng–vàng, viền kim | Vòng kim quang, kim đan sáng trên tay | Vừa |
| 4 Nguyên Anh | (1,4) | Tím–trắng | Khói/linh hồn tím, cầu tím đen | Vừa |
| 5 Hóa Thần | (2,1) | Áo đen–lam, giáp vai | **Thanh long** quấn sau lưng, băng lôi | Mạnh |
| 6 Luyện Hư | (2,2) | Tím đen, pha lê | Hố đen, mảnh không gian, quỹ đạo cầu | Mạnh |
| 7 Hợp Thể | (2,3) | Trắng–vàng, nhiều lớp | Ký hiệu âm dương, mây vàng dưới chân | Rất mạnh |
| 8 Đại Thừa | (2,4) | Đỏ–vàng, vương miện | Tiên quang, lửa phượng, vòng sáng dưới chân | Cực đại |

## 2. Danh mục asset

### 2.1 Nhân vật (16)

| Tên file | Mô tả | Trạng thái |
|---|---|---|
| `char-luyen-khi-male.png` … `char-dai-thua-male.png` | 8 nhân vật nam | Có bản tham chiếu độ phân giải thấp; **cần bản gốc ≥ 1024px chiều cao** |
| `char-luyen-khi-female.png` … `char-dai-thua-female.png` | 8 nhân vật nữ | **Chưa có** |

Mã cảnh giới trong tên file: `luyen-khi`, `truc-co`, `kim-dan`, `nguyen-anh`, `hoa-than`, `luyen-hu`, `hop-the`, `dai-thua`.

Fallback khi thiếu bản nữ: dùng bản nam cùng cảnh giới + khung tên màu hồng ngọc, và ghi `console.warn` một lần. Khi thiếu cả hai: hình bóng vector (silhouette) tô màu cảnh giới — overlay không bao giờ hiện ảnh vỡ.

Brief cho bộ nữ (đưa cho họa sĩ / công cụ tạo ảnh): cùng bảng màu và hào quang với bản nam cùng cảnh giới; tóc đen dài búi nửa đầu; trang phục hán phục tu tiên, không hở hang (nền tảng TikTok); cùng tư thế đứng 3/4, cùng tỷ lệ khung. Cảnh giới 5 vẫn có thanh long, cảnh giới 8 vẫn có phượng hỏa — biểu tượng cảnh giới không đổi theo giới tính.

### 2.2 Hiệu ứng (layer tách rời, bật/tắt được)

| Tên file | Dùng cho | Ghi chú |
|---|---|---|
| `aura-<realm>.png` (8) | Hào quang sau lưng nhân vật | Tách khỏi thân để xoay/nhịp thở |
| `orb-<realm>.png` (8) | Quả cầu trên tay | Lơ lửng ±6px |
| `fx-gift-burst.png` | Nhận quà | Sprite sheet 8 frame ngang |
| `fx-levelup-ring.png` | Lên tầng | Vòng sáng phóng to + mờ dần |
| `fx-tribulation-cloud.png` | Độ kiếp | Mây kiếp phủ nửa trên màn hình |
| `fx-lightning-1..4.png` | Độ kiếp | Sét đánh ngẫu nhiên (chỉ hiệu ứng, không ảnh hưởng kết quả) |
| `fx-breakthrough-pillar.png` | Thành công | Cột sáng màu cảnh giới mới |
| `fx-fail-crack.png` | Thất bại | Vết nứt + bụi |
| `ui-frame-<realm>.png` (8) | Khung thẻ tên | 9-slice, viền 24px |
| `ui-exp-bar.png`, `ui-exp-fill-<realm>.png` | Thanh tu vi | 9-slice |
| `ui-rank-1/2/3.png` | Huy hiệu top 3 | 64×64 |

### 2.3 Trạng thái animation (spec §20)

Nhân vật là **ảnh tĩnh nhiều layer**, chuyển động bằng CSS/Canvas transform — không làm sprite từng khung cho thân nhân vật (tiết kiệm 16× khối lượng vẽ).

| Trạng thái | Thân nhân vật | Layer hiệu ứng | Thời lượng |
|---|---|---|---|
| Idle | Nhịp thở `scaleY 1→1.012`, 3,2s | Aura xoay chậm 40s/vòng, orb lơ lửng | Lặp |
| Nhận quà | Nhún 6px | `fx-gift-burst` tại tay + icon quà TikTok bay vào | 0,9s |
| Tu luyện (đang nhận quà liên tục) | Idle + phát sáng viền | Hạt linh khí hút vào người | Lặp khi có quà trong 5s |
| Lên tầng | Nhảy 12px | `fx-levelup-ring` + số tầng mới | 1,4s |
| Đột phá (bắt đầu độ kiếp) | Tối nền 60% | `fx-tribulation-cloud` hạ xuống | 1,2s |
| Độ kiếp (chờ 30s) | Rung nhẹ 1px tăng dần | Sét ngẫu nhiên mỗi 2–4s, đồng hồ đếm | 30s |
| Thất bại | Khuỵu 8°, desaturate 60% | `fx-fail-crack`, rung màn 200ms | 4s |
| Thành công | Đổi sang ảnh cảnh giới mới sau flash trắng | `fx-breakthrough-pillar` + aura mới | 6s |

`prefers-reduced-motion` hoặc `effectsEnabled=false`: bỏ rung, sét, hạt; giữ crossfade và chữ thông báo.

## 3. Thông số kỹ thuật

| Loại | Kích thước | Định dạng | Ngân sách |
|---|---|---|---|
| Nhân vật toàn thân | 768×1152 (2:3), nhân vật chiếm 92% chiều cao, chân chạm đáy −24px | PNG-32 hoặc WebP lossless, alpha | ≤ 600KB/file |
| Aura / orb | 1024×1024 / 256×256 | PNG-32 | ≤ 300KB / 60KB |
| Hiệu ứng sprite | Frame 256×256, ≤ 12 frame ngang | PNG-32 | ≤ 400KB |
| UI 9-slice | Bội số của 8 | PNG-32 | ≤ 40KB |
| Avatar crop (tự sinh) | 256×256 từ vùng đầu–vai | WebP | ≤ 30KB |

Tổng bundle ≤ 25MB (NFR-07). Tải trước 2 cảnh giới đầu + UI; còn lại tải lười khi có người chơi đạt cảnh giới đó.

Anchor: mọi ảnh nhân vật có **điểm neo ở giữa đáy** (chân). Mọi aura có tâm ở ngực nhân vật, tọa độ khai báo trong manifest.

### 3.1 Manifest

`public/tutien-assets/manifest.json` — overlay chỉ đọc asset qua manifest, không ghép tên file trong code:

```json
{
  "version": 1,
  "realms": {
    "luyen-khi": {
      "male":   { "file": "char-luyen-khi-male.png", "anchor": [0.5, 1.0], "chest": [0.5, 0.38] },
      "female": { "file": "char-luyen-khi-female.png", "anchor": [0.5, 1.0], "chest": [0.5, 0.38] },
      "aura": "aura-luyen-khi.png",
      "orb":  { "file": "orb-luyen-khi.png", "hand": [0.78, 0.30] },
      "color": "#7FD3FF"
    }
  }
}
```

`cultivation_realms.character_*_asset` trong DB phải khớp tên file trong manifest; `PATCH /admin/realms` kiểm tra regex `^[a-z0-9-]+\.(png|webp)$`.

## 4. Đặt tên & phục vụ file

- Chỉ chữ thường, số, gạch ngang: `^[a-z0-9-]+\.(png|webp)$`. Không dấu tiếng Việt, không khoảng trắng.
- Thư mục phẳng `public/tutien-assets/` (route `/tutien-assets/:file` whitelist như `/game-assets`, chặn path traversal).
- Ảnh nguồn (PSD, ảnh lưới, ảnh độ phân giải cao) để ở `assets-src/tutien/` — **không** phục vụ ra web.
- Cắt lưới bằng `scripts/slice-tutien-assets.py` (dựa trên `slice-game-assets.py`: hộp tọa độ + xóa nền trắng bằng flood-fill từ viền, giữ vùng trắng bên trong như áo trắng). Script xuất thêm contact sheet QA.

Lưu ý với ảnh tham chiếu hiện tại: mỗi ô chỉ ≈ 210×280px — đủ để làm prototype và avatar, **không đủ** cho khu vực nhân vật 720×1280. Cần bản gốc hoặc upscale có kiểm duyệt trước buổi LIVE thật.

## 5. Bảng màu

| Cảnh giới | Chính | Phụ | Hào quang (glow) | Chữ trên nền màu |
|---|---|---|---|---|
| Luyện Khí | `#7FD3FF` | `#E8F7FF` | `#B9E8FF` | `#0B2A3D` |
| Trúc Cơ | `#3FBF7F` | `#D9F5E6` | `#8BEAB8` | `#0C2E1E` |
| Kim Đan | `#F2C14E` | `#FFF4D6` | `#FFE08A` | `#3A2A05` |
| Nguyên Anh | `#9B6BFF` | `#EEE6FF` | `#C7AEFF` | `#22114A` |
| Hóa Thần | `#2F8CFF` | `#DCEBFF` | `#7FB8FF` | `#071F44` |
| Luyện Hư | `#5B2A9E` | `#1A0F2E` | `#A35BFF` | `#F3EAFF` |
| Hợp Thể | `#F6E7B0` | `#FFFFFF` | `#FFF2C2` | `#3B3015` |
| Đại Thừa | `#E8452C` | `#FFB547` | `#FFD27A` | `#FFF7E8` |

Nền overlay: mực đêm `#0E1430` (không dùng đen tuyền) với gradient trời sao chỉ ở khu vực nhân vật. Mọi chữ trên overlay đạt tương phản ≥ 4.5:1; chữ nhỏ có viền tối 2px để đọc được trên mọi nền game khi `?transparent=1`.

Màu không phải tín hiệu duy nhất: mỗi cảnh giới có thêm **biểu tượng** riêng (giọt nước, lá, đan, linh hồn, rồng, hố đen, âm dương, phượng) hiện cạnh tên cảnh giới — người mù màu vẫn phân biệt.

## 6. Bố cục overlay 720×1280

```text
┌──────────────────────────── 720 ────────────────────────────┐
│  Logo TU TIÊN LIVE        Hướng dẫn: gõ "thamgia" để nhập môn │  0–96   thanh trên
├───────────────┬─────────────────────────────────────────────┤
│ BẢNG XẾP HẠNG │                                             │
│ (xoay 15s)    │          KHU VỰC NHÂN VẬT (spotlight)        │
│ 1 ▓ name  KĐ7 │          người vừa nhận quà / độ kiếp        │  96–860
│ 2 ▓ name  TC9 │          ảnh 768×1152 thu về ~500×750        │
│ …  (10 dòng)  │                                             │
│ 232 px        │                                             │
├───────────────┴─────────────────────────────────────────────┤
│  [avatar] Nickname        Kim Đan · Tầng 7                   │  860–1010 thẻ người chơi
│  ████████████████░░░░░░░░  43.750 / 62.500 tu vi             │
├─────────────────────────────────────────────────────────────┤
│  Luồng thông báo: quà, lên tầng, nhập môn (tối đa 3 thẻ)     │  1010–1200
├─────────────────────────────────────────────────────────────┤
│  Safe zone — để trống (UI TikTok che: bình luận, nút quà)    │  1200–1280
└─────────────────────────────────────────────────────────────┘
```

- Spotlight đổi sang người vừa có sự kiện quan trọng (quà ≥ 100💎, lên tầng, độ kiếp); giữ tối thiểu 6s mỗi người; khi rảnh 30s thì xoay qua top 3.
- Khi độ kiếp: khu vực nhân vật + thẻ người chơi chuyển chế độ độ kiếp — đồng hồ tròn 30s, **tỷ lệ % cỡ chữ lớn nhất màn hình**, dòng "Tặng quà để tăng tỷ lệ".
- Lề an toàn 24px hai bên; không đặt chữ quan trọng ở 80px cuối.

## 7. Typography

| Vai trò | Font | Lý do |
|---|---|---|
| Tên cảnh giới, thông báo đột phá, tỷ lệ % | **Noto Serif Display** (700/900) | Có đủ dấu tiếng Việt, nét thư pháp cổ điển hợp Xianxia |
| UI, nickname, số tu vi | **Be Vietnam Pro** (500/700) | Thiết kế cho tiếng Việt, chữ số tabular rõ trên màn hình điện thoại |

Thang cỡ (px ở khung 720): 14 · 18 · 24 · 32 · 48 · 72. Số tu vi dùng `font-variant-numeric: tabular-nums` để thanh không nhảy. Định dạng số kiểu Việt: `43.750`.

## 8. Checklist nghiệm thu asset

- [ ] 16 file nhân vật đúng tên, đúng kích thước 768×1152, alpha sạch (không viền trắng — kiểm trên nền `#FF00FF`)
- [ ] Cùng khuôn mặt/kiểu tóc xuyên 8 cảnh giới (so contact sheet)
- [ ] Biểu tượng cảnh giới 5 (rồng) và 8 (phượng) có mặt ở cả nam và nữ
- [ ] Aura và orb tách layer, khớp tọa độ manifest
- [ ] Tổng bundle ≤ 25MB; từng file trong ngân sách §3
- [ ] Manifest hợp lệ; mọi tên file khớp regex; overlay tải không lỗi 404
- [ ] Fallback hoạt động khi xóa một file bất kỳ (TC-O05)
- [ ] Quyền sử dụng: chủ dự án xác nhận bản quyền/giấy phép của toàn bộ ảnh (tự vẽ, thuê vẽ, hoặc công cụ AI cho phép dùng thương mại); không dùng nhân vật, logo hay hình ảnh của game/phim có bản quyền
