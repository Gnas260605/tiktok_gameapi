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

## 6. Bố cục overlay 720×1280 — Quảng trường tông môn (nhiều người chơi)

Màn hình không chỉ có một người: nó là **quảng trường tông môn** nơi mọi người đang chơi cùng hiện diện, chia 3 tầng hiển thị theo mức độ chi tiết (LOD). Luật chọn ai đứng ở đâu: GDD §13.

```text
┌──────────────────────────── 720 ────────────────────────────┐
│ Logo · "gõ thamgia để nhập môn" · 128 tu sĩ đang tu luyện    │  0–80     thanh trên
├─────────────────────────────────────────────────────────────┤
│                  ☁  bầu trời + núi xa (parallax)  ☁          │
│        ┌──────┐        ┌────────┐        ┌──────┐           │
│        │ TOP2 │        │  TOP 1 │        │ TOP3 │           │  80–560   ĐÀI CAO
│        │220px │        │ 300px  │        │220px │           │  3 nhân vật lớn, aura đầy đủ
│        └──────┘        └────────┘        └──────┘           │
│ ═══════════════ thềm đá tông môn (bậc 1) ══════════════════ │
│  [A] [B] [C] [D] [E] [F]                                     │  560–760  BẬC THỀM
│  [G] [H] [I] [J] [K] [L]       12 ghế · nhân vật 120px       │  aura rút gọn
│ ═══════════════ thềm đá (bậc 2) ═══════════════════════════ │
│  ·  ✦  ·   ✦    ·  ✦   ·   ✦  ·   ✦   ·  ✦  ·               │  760–900  LINH QUANG
│     đốm sáng màu cảnh giới, tối đa 60 người                  │  (người hoạt động còn lại)
├─────────────────────────────────────────────────────────────┤
│ Luồng thông báo (≤ 3 thẻ): quà, lên tầng, nhập môn           │  900–1040
├──────────────┬──────────────────────────────────────────────┤
│ Bảng xếp hạng│ Thẻ người vừa có sự kiện: avatar, cảnh giới,  │  1040–1200
│ top 5 (xoay) │ thanh tu vi                                   │
├──────────────┴──────────────────────────────────────────────┤
│ Safe zone — để trống (UI TikTok che)                         │  1200–1280
└─────────────────────────────────────────────────────────────┘
```

- **Đài cao**: top 3 bảng "Top cảnh giới". Nhân vật toàn thân, aura đủ layer + linh thú (§10).
- **Bậc thềm**: 12 ghế cho người hoạt động gần nhất (ngồi thiền). Ảnh nhân vật thu nhỏ, aura chỉ lớp nền.
- **Linh quang**: mọi người hoạt động trong 5 phút còn lại là một đốm sáng màu cảnh giới, kích thước theo tầng (6–14px). Khi họ tặng quà, đốm sáng bay vọt lên một ghế ở bậc thềm.
- **Spotlight sự kiện lớn** (quà ≥ 100💎, lên ≥ 3 tầng, đột phá): nhân vật phóng to 1,6× ngay tại chỗ, các vùng khác mờ 40% trong 3s rồi trở lại. Không còn khu "một người duy nhất".
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

## 9. Background (nhiều lớp, parallax)

Nền dựng từ 5 lớp chồng nhau, mỗi lớp 720×1280 (hoặc rộng hơn để cuộn), PNG/WebP. Lớp xa chuyển động chậm, lớp gần nhanh hơn — tạo chiều sâu mà không cần video.

| Lớp (dưới → trên) | Tên file | Chuyển động | Ghi chú |
|---|---|---|---|
| 1 Bầu trời | `bg-sky-dusk.webp`, `bg-sky-night.webp`, `bg-sky-storm.webp`, `bg-sky-dawn.webp` | Đứng yên, crossfade khi đổi tâm trạng | Không có chi tiết sắc nét — để nhân vật nổi |
| 2 Núi xa + tiên sơn lơ lửng | `bg-mountains-far.png` | Trôi ngang 1px/2s, lặp | Màu nhạt, độ tương phản thấp |
| 3 Mây | `bg-cloud-1..4.png` | Trôi 4–12px/s, nhiều tốc độ | Tái dùng được hình mây của `/game` nếu cùng phong cách |
| 4 Quảng trường tông môn | `bg-plaza.png` | Đứng yên | Đài cao giữa + 2 bậc thềm đá; tọa độ 15 ghế khai báo trong manifest (`seats`) |
| 5 Sương tiền cảnh | `fg-mist.png` | Trôi chậm, opacity 40–60% | Che chân nhân vật hàng linh quang, tạo cảm giác tiên cảnh |

Tâm trạng bầu trời (do sự kiện quyết định, chỉ là hình ảnh):

| Tâm trạng | Khi nào | Hiệu ứng toàn cảnh |
|---|---|---|
| `dusk` (mặc định) | Bình thường | — |
| `night` | Không có quà 3 phút | Sao lấp lánh, đốm linh quang sáng hơn |
| `storm` | Có phiên độ kiếp `preparing` | Trời tối 60%, mây xoáy (§11), mưa hạt mảnh |
| `dawn` | 8s sau một lần đột phá thành công | Ánh vàng từ đài cao lan ra, rồi về `dusk` |

Brief vẽ: tông môn trên đỉnh núi trong biển mây, kiến trúc gỗ–đá mái cong, cột đá có phù văn phát sáng nhẹ; bảng màu nền xanh đêm `#0E1430` → tím nhạt ở chân trời. Thiết kế nguyên bản, không mô phỏng địa danh hay game có bản quyền.

## 10. Aura theo tu vi (người cao tu vi trông "đáng sợ" hơn)

Aura = **phong cách theo cảnh giới** × **cường độ theo tầng** × **đặc quyền theo thứ hạng**. Ghép từ các layer, không vẽ riêng 80 bản.

### 10.1 Layer

| Layer | File | Có từ | Mô tả |
|---|---|---|---|
| Nền | `aura-<realm>-base.png` (1024²) | Tầng 1 | Quầng sáng mềm màu cảnh giới sau lưng |
| Vòng | `aura-<realm>-ring.png` (1024²) | Tầng 4 (Trung kỳ) | Vòng phù văn xoay quanh người |
| Hạt | `particle-<realm>.png` (64², sheet 4 frame) | Tầng 4 | Hạt bay lên: giọt nước, lá, kim sa, linh hồn, băng lôi, mảnh không gian, âm dương, lông phượng |
| Linh thú / dị tượng | `sig-<realm>.png` (1024×1280, sheet 6 frame) | Cảnh giới 5+ tầng 7 (Hậu kỳ) | Thanh long quấn (5), hố đen + quỹ đạo cầu (6), Thái Cực xoay (7), phượng hỏa xòe cánh (8) |
| Viên mãn | dùng lại `ring` + shader nhấp nháy | Tầng 10 | Aura đập theo nhịp tim 1,2s — báo hiệu "sắp độ kiếp" |

### 10.2 Cường độ

| Giai đoạn | Tầng | Base opacity / scale | Ring | Hạt / giây | Linh thú (cảnh giới 5+) |
|---|---|---|---|---|---|
| Sơ kỳ | 1–3 | 0,45 / 1,00 | — | — | — |
| Trung kỳ | 4–6 | 0,60 / 1,10 | xoay 40s/vòng | 4 | — |
| Hậu kỳ | 7–9 | 0,75 / 1,20 | 25s/vòng | 8 | Bán trong suốt 50% |
| Đại Viên Mãn | 10 | 0,90 / 1,30 + nhịp | 15s/vòng | 14 | Đầy đủ, chuyển động |

Đặc quyền thứ hạng (chỉ ở đài cao): **Top 1** thêm cột sáng mảnh từ trời xuống + tên viền vàng; Top 2–3 tên viền bạc / đồng.

LOD theo vùng hiển thị (giữ 60fps):

| Vùng | Layer được vẽ |
|---|---|
| Đài cao (3 người) | Tất cả |
| Bậc thềm (12 người) | Base + ring (không hạt, không linh thú); linh thú thay bằng icon nhỏ cạnh tên |
| Linh quang | Một đốm sáng màu cảnh giới, glow tăng theo tầng |

Tổng giới hạn: ≤ 120 hạt trên màn hình; vượt thì giảm hạt ở người xếp thấp trước.

## 11. Độ kiếp: mây kiếp và tia sét

Sét là **hình ảnh thuần túy**. Kết quả đã được backend quyết định; overlay chỉ biên đạo cho khớp với kết quả nhận về ở frame `breakthrough.resolved`.

### 11.1 Asset

| File | Kích thước | Dùng |
|---|---|---|
| `fx-tribulation-vortex.png` | 1024×512 | Mây xoáy trên đầu người độ kiếp, xoay 20s/vòng, tối dần theo thời gian |
| `fx-lightning-bolt-1..4.png` | 256×1024 | Tia sét vẽ sẵn — dùng khi `effectsEnabled=lite` hoặc máy yếu |
| `fx-lightning-impact.png` | Sheet 8×256² | Chớp nổ chỗ sét đánh |
| `fx-shield-gold.png` | 512² | Kim quang hộ thể — bật lên mỗi khi có quà tăng tỷ lệ |
| `fx-breakthrough-pillar.png`, `fx-fail-crack.png` | xem §2.2 | Kết thúc |

Tia sét chính được **vẽ thủ tục trên Canvas** (đường gấp khúc chia đôi đệ quy + nhánh phụ, glow bằng `shadowBlur` và `globalCompositeOperation='lighter'`): mỗi tia một hình khác nhau, không tốn dung lượng. Ảnh `fx-lightning-bolt-*` chỉ là bản dự phòng.

### 11.2 Màu và số đạo sét theo cảnh giới

| Cảnh giới đang độ kiếp | Tên kiếp (hiển thị) | Số đạo sét trong 30s | Màu lõi / glow |
|---|---|---|---|
| Luyện Khí, Trúc Cơ | Tam Cửu Lôi Kiếp | 3 | `#FFFFFF` / `#7FD3FF` |
| Kim Đan, Nguyên Anh | Lục Cửu Lôi Kiếp | 6 | `#FFFFFF` / `#C7AEFF` |
| Hóa Thần, Luyện Hư | Cửu Cửu Thiên Kiếp | 9 | `#F3EAFF` / `#A35BFF` |
| Hợp Thể | Tử Tiêu Thần Lôi | 9 + tia cuối đỏ tía | `#FFF2C2` / `#E8452C` |

### 11.3 Biên đạo 30 giây

```text
0s      trời chuyển storm, mây xoáy hạ xuống, nhân vật bay lên giữa màn hình (1,6×)
0–28s   N đạo sét rải đều (±1,5s ngẫu nhiên), mỗi đạo: chớp trắng 80ms + rung 1–3px
        quà đến → kim quang hộ thể bật, tia sét kế tiếp bị chặn tóe lửa, % tăng nảy số
28–30s  im lặng, mây sáng dần, % khóa lại (chờ frame resolved)
resolved:
  thành công → đạo sét cuối bị nhân vật hấp thụ → flash trắng → đổi ảnh cảnh giới mới
               → cột sáng + bầu trời dawn 8s
  thất bại   → đạo sét cuối đánh trúng → fx-fail-crack, desaturate, rung 200ms
```

Nhiều người độ kiếp cùng lúc (tối đa `maxConcurrentBreakthroughs` = 3): người có cảnh giới cao nhất nhận biên đạo toàn màn hình; những người còn lại có mây xoáy nhỏ + sét mảnh ngay tại ghế của họ, đồng hồ và % hiện trên đầu.

`prefers-reduced-motion` hoặc `effectsEnabled=false`: không chớp trắng, không rung; sét thay bằng một đường sáng mờ dần; vẫn hiện đồng hồ, % và kết quả.

### 11.4 Checklist bổ sung

- [ ] 4 bầu trời + 4 lớp parallax + `bg-plaza` có tọa độ 15 ghế trong manifest
- [ ] 8 bộ aura (`base`, `ring`, `particle`) + 4 linh thú cảnh giới 5–8
- [ ] Bộ sét: vortex, 4 bolt dự phòng, impact, shield
- [ ] 60fps với 3 người đài cao + 12 bậc thềm + 60 linh quang + 1 phiên độ kiếp (Performance panel)
- [ ] Không chớp sáng quá 3 lần/giây (an toàn cho người nhạy cảm ánh sáng)
