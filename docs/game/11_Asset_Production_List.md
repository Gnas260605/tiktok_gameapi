# 11 — Danh sách asset cần làm (kèm prompt tạo ảnh)

> 2026-11-05 · Bổ sung cho `08_Asset_Guidelines.md` (quy chuẩn) — file này là **danh sách việc** để bạn tự tạo ảnh hoặc thuê vẽ.
> Hiện trạng `public/tutien-assets/`: chỉ có 8 nhân vật nam cắt từ ảnh tham chiếu, mỗi ảnh ~200×280px (cần 768×1152). Không có background, aura, orb hay hiệu ứng nào — overlay đang chạy hoàn toàn bằng fallback.

## Mẹo giúp tạo ảnh dễ và đẹp

1. **Nhân vật**: tạo trên **nền trắng trơn** (như ảnh tham chiếu), script `slice` xóa nền bằng flood-fill.
2. **Hiệu ứng ánh sáng** (aura, sét, sương, vòng sáng, hạt): tạo trên **nền đen tuyền `#000000`**, không cần tách nền. Overlay vẽ chúng bằng chế độ hòa trộn `screen` / `lighter` nên màu đen tự biến mất, glow giữ nguyên mềm mại. Cách này tránh hẳn lỗi viền trắng khi cắt nền.
3. **Background**: tạo ở 1440×2560 (gấp đôi khung 720×1280), xuất bản 720×1280 WebP.
4. **Giữ một phong cách**: luôn dán khối STYLE LOCK bên dưới vào cuối prompt; với nhân vật, dùng chế độ image-to-image / reference với `docs/game/assets/reference-male-realms.webp` để giữ khuôn mặt và kiểu tóc.
5. **Không cần ảnh** cho: đốm linh quang, tia sét chính, số tu vi bay lên — overlay vẽ bằng code.

### STYLE LOCK (dán cuối mọi prompt)

```text
style: anime xianxia illustration, clean confident line art, cel shading with soft painterly highlights,
luminous flowing energy ribbons, ethereal, high detail, consistent with a Chinese cultivation fantasy game,
original design, no text, no watermark, no logo
```

Negative prompt (nếu công cụ hỗ trợ):

```text
text, letters, watermark, signature, logo, frame, border, photo, 3d render, extra limbs, deformed hands,
cropped feet, busy background, copyrighted character
```

## P0 — cần ngay để màn hình đẹp và chứa nhiều người

### A. Background (5 file)

| File | Kích thước tạo → xuất | Nền | Prompt (dán thêm STYLE LOCK) |
|---|---|---|---|
| `bg-sky-dusk.webp` | 1440×2560 → 720×1280 | Kín | `vertical 9:16 sky at dusk above a sea of clouds, deep navy #0E1430 at top fading to soft violet and faint gold at the horizon, a few faint stars, gentle glow, very low detail so characters stand out` |
| `bg-mountains-far.png` | 1440×1200 → 720×600 | Trong suốt (hoặc trắng để cắt) | `distant floating immortal mountains with thin waterfalls and tiny pagodas on peaks, misty blue-violet silhouettes, low contrast, wide panorama, bottom edge fades into clouds` |
| `bg-plaza.png` | 1440×1700 → 720×850 | Trong suốt phía trên | `front view of a mountaintop cultivation sect plaza: a raised circular jade altar in the center, two wide stone terraces below it like steps, carved rune pillars glowing faintly cyan on both sides, curved wooden temple roofs behind, symmetrical composition, empty of people, viewed from slightly above` |
| `fg-mist.png` | 1440×600 → 720×300 | **Đen** (vẽ bằng screen) | `soft drifting white mist band, horizontal, wispy, on pure black background` |
| `bg-cloud-1..4.png` | 1024×384 → 512×192 | **Đen** | `single soft white cloud puff, painterly anime style, on pure black background` (tạo 4 biến thể) |

Sau khi có `bg-plaza.png`: đánh dấu tọa độ 15 chỗ đứng (3 đài cao + 12 bậc thềm) vào `manifest.json` → `seats` (A4 làm).

### B. Nhân vật cho nhiều người chơi (16 file)

| File | Kích thước | Nền | Prompt |
|---|---|---|---|
| `char-<realm>-male.png` ×8 | 768×1152 | Trắng | Tạo lại bằng reference từ ảnh tham chiếu (ô tương ứng) — `full body standing pose, three-quarter view, same face and hair (long black hair, high bun) as reference, <mô tả cảnh giới bên dưới>, feet visible, centered, plain white background` |
| `char-<realm>-male-sit.png` ×8 | 384×384 | Trắng | `chibi-proportioned (2.5 heads tall) cultivator sitting cross-legged in meditation on a round cushion, eyes closed, hands in mudra, same outfit and colors as reference: <mô tả cảnh giới>, small soft aura, plain white background` |

Bản ngồi thiền dùng cho **12 ghế bậc thềm** — đây là thứ làm màn hình trông "đông người". Ảnh đứng thu nhỏ trông lộn xộn ở kích thước 120px.

Mô tả từng cảnh giới (thay vào `<mô tả cảnh giới>`):

| Realm | Mô tả |
|---|---|
| `luyen-khi` | `white and pale-blue simple robe, light blue water-like qi ribbons, small glowing water orb in hand` |
| `truc-co` | `jade green layered robe, swirling green leaves and vines of qi, glowing green orb` |
| `kim-dan` | `white robe with gold trim, golden light rings, a radiant golden core orb in hand` |
| `nguyen-anh` | `violet and white robe, purple ghostly soul smoke, dark violet orb` |
| `hoa-than` | `black and azure robe with shoulder armor, an azure ice-lightning dragon coiling behind, crackling blue energy` |
| `luyen-hu` | `deep purple-black robe with crystal accents, small black hole and orbiting dark spheres, spatial fragments` |
| `hop-the` | `layered white and gold robe, floating yin-yang symbols, golden clouds beneath the feet` |
| `dai-thua` | `red and gold robe with a golden crown, phoenix flames and immortal light, glowing golden ring under the feet` |

### C. Aura (8 file)

| File | Kích thước | Nền | Prompt |
|---|---|---|---|
| `aura-<realm>-base.png` ×8 | 1024×1024 | **Đen** | `soft radial glowing aura halo, centered, <màu cảnh giới> light, wispy energy flames radiating outward, no character, on pure black background` |

Màu: luyen-khi `pale cyan #7FD3FF` · truc-co `jade green #3FBF7F` · kim-dan `gold #F2C14E` · nguyen-anh `violet #9B6BFF` · hoa-than `azure #2F8CFF` · luyen-hu `deep purple #A35BFF with black core` · hop-the `white gold #FFF2C2` · dai-thua `red-gold #E8452C to #FFB547`.

### D. Độ kiếp (3 file)

| File | Kích thước | Nền | Prompt |
|---|---|---|---|
| `fx-tribulation-vortex.png` | 1440×720 | **Đen** | `top-down view of a massive swirling dark storm cloud vortex with purple lightning glowing inside, ominous, heavenly tribulation, on pure black background` |
| `fx-lightning-impact.png` | 8 khung × 256² (sheet 2048×256) | **Đen** | `sprite sheet, 8 frames left to right, a bright white-violet lightning strike impact burst on the ground expanding then fading, on pure black background` |
| `fx-shield-gold.png` | 512×512 | **Đen** | `golden protective qi barrier sphere, translucent hexagonal rune pattern, glowing edges, on pure black background` |

### E. UI (14 file)

| File | Kích thước | Nền | Prompt / ghi chú |
|---|---|---|---|
| `ui-card-frame.png` | 512×256 | Trong suốt | `ornate dark navy panel with thin gold xianxia cloud-pattern border, empty center, 9-slice friendly (pattern only on edges)` |
| `ui-seat-cushion.png` | 256×128 | Trong suốt | `round meditation cushion on stone, small glowing rune circle on the floor around it, front view` |
| `ui-rank-1.png`, `-2`, `-3` | 128×128 | Trong suốt | `gold / silver / bronze jade medallion with a cloud motif and a number <1|2|3>` (số có thể vẽ bằng code nếu công cụ viết chữ lỗi) |
| `icon-<realm>.png` ×8 | 128×128 | Trong suốt | Biểu tượng cảnh giới: giọt nước, lá, đan, linh hồn, rồng, hố đen, âm dương, phượng — `flat glowing emblem icon, <biểu tượng>, <màu>, simple shape readable at 24px` |
| `avatar-default.png` | 256×256 | Trong suốt | `silhouette of a cultivator head and shoulders in a circle, soft blue glow` — dùng khi ảnh đại diện TikTok lỗi |

### F. Hiệu ứng sự kiện (3 file)

| File | Kích thước | Nền | Prompt |
|---|---|---|---|
| `fx-gift-burst.png` | sheet 8 × 256² | **Đen** | `sprite sheet 8 frames, burst of golden sparkles and petals exploding outward then fading` |
| `fx-levelup-ring.png` | 1024×1024 | **Đen** | `expanding thin ring of glowing runes with light rays, cyan-white` |
| `fx-breakthrough-pillar.png` | 512×1440 | **Đen** | `vertical pillar of heavenly light beam from sky to ground, bright core, soft rays, white with faint gold` (tô màu cảnh giới bằng code) |

**Tổng P0: 49 file** (5 background + 16 nhân vật + 8 aura + 3 độ kiếp + 14 UI + 3 hiệu ứng).

## P1 — làm đẹp thêm

| Nhóm | File | Số lượng | Prompt ngắn |
|---|---|---|---|
| Bầu trời phụ | `bg-sky-night`, `bg-sky-storm`, `bg-sky-dawn` | 3 | như `bg-sky-dusk`, đổi: `starry night` / `dark stormy purple sky with distant lightning` / `golden sunrise light flooding the clouds` |
| Vòng phù văn | `aura-<realm>-ring.png` | 8 | `thin circular ring of floating glowing runes, <màu>, on pure black background` |
| Hạt | `particle-<realm>.png` (sheet 4 × 64²) | 8 | `4 tiny glowing particles: <giọt nước / lá / kim sa / linh hồn / tia băng lôi / mảnh pha lê không gian / âm dương nhỏ / lông phượng lửa>, on pure black` |
| Linh thú | `sig-hoa-than` (rồng), `sig-luyen-hu` (hố đen), `sig-hop-the` (Thái Cực), `sig-dai-thua` (phượng) | 4 | `<linh thú> made of glowing energy, coiling in a circle, semi-transparent, on pure black background`, 1024×1280 |
| Orb | `orb-<realm>.png` | 8 | `small glowing energy orb, <màu>, on pure black`, 256² |
| Thất bại | `fx-fail-crack.png` | 1 | `cracked ground with dust and dark smoke burst, on pure black` |

**Tổng P1: 32 file.**

## P2 — bộ nữ & âm thanh

- 8 `char-<realm>-female.png` + 8 `char-<realm>-female-sit.png` — brief ở `08_Asset_Guidelines.md` §2.1.
- Âm thanh: danh sách ở `08_Asset_Guidelines.md` §12.

## Cách bàn giao ảnh cho Antigravity

1. Bỏ ảnh gốc vào `assets-src/tutien/<nhóm>/` (không phục vụ ra web).
2. Nhờ A4 chạy `scripts/slice-tutien-assets.py`: xóa nền trắng cho nhân vật, resize, xuất WebP/PNG đúng tên vào `public/tutien-assets/`, cập nhật `manifest.json`, xuất contact sheet QA.
3. Ảnh nền đen **không** xóa nền — giữ nguyên, overlay dùng `screen`.
4. Kiểm checklist `08_Asset_Guidelines.md` §8 và §11.4.

## Quyền sử dụng

Ảnh tạo bằng công cụ AI: dùng công cụ có điều khoản cho phép dùng thương mại, và không dùng tên game, phim, nhân vật có bản quyền trong prompt. Bạn là người xác nhận quyền sử dụng cuối cùng trước khi lên LIVE.
