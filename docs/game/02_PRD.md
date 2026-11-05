# 02 — Product Requirements: TU TIÊN LIVE

> Phiên bản 1.0 · 2026-11-05 · Chủ sở hữu: Agent 1 (Architect)
> Luật chơi chi tiết nằm ở `01_GDD.md`. Tài liệu này trả lời: **ai dùng, cần gì, thế nào là xong**.

## 1. Bối cảnh

TikUser API đã có: kết nối TikTok LIVE (live + mock), chuẩn hóa 7 loại sự kiện, lưu người xem theo 3 mức chất lượng định danh, lưu sự kiện append-only, WebSocket ticket, overlay game "Leo Chùa" ở `/game`. TU TIÊN LIVE là **game thứ hai** chạy trên cùng nền tảng, khác Leo Chùa ở chỗ tiến trình **lâu dài** và **phụ thuộc quà**.

Ràng buộc từ chủ dự án (spec §29): không viết lại kết nối TikTok, không đoán schema TikTok, không hardcode cấu hình, frontend không quyết định kết quả.

## 2. Người dùng

| Vai trò | Họ là ai | Họ cần |
|---|---|---|
| Người xem (Player) | Khán giả TikTok, dùng điện thoại, chỉ tương tác qua bình luận và quà | Hiểu luật trong 10 giây, thấy quà của mình có tác dụng ngay |
| Chủ phòng (Streamer) | Người phát LIVE, dùng OBS/TikTok LIVE Studio | Overlay chạy ổn suốt 3–5 giờ, không phải can thiệp |
| Quản trị (Admin) | Chủ phòng hoặc trợ lý, dùng trình duyệt PC | Chỉnh thông số, sửa dữ liệu sai, xem lỗi |
| Vận hành (Operator) | Người deploy hệ thống | Log, health check, khôi phục sau restart |

## 3. User stories & tiêu chí chấp nhận

Ký hiệu ưu tiên: **P0** = MVP bắt buộc, **P1** = nên có trong MVP, **P2** = sau MVP.

### 3.1 Tham gia & nhân vật

| ID | Story | Ưu tiên | Tiêu chí chấp nhận |
|---|---|---|---|
| US-01 | Là người xem, tôi gõ `thamgia` để có nhân vật | P0 | Nhân vật Luyện Khí 1 được tạo trong ≤ 1s (p95); overlay hiện thẻ nhập môn có avatar + nickname |
| US-02 | Là người xem cũ, tôi gõ `thamgia` và thấy tiến trình cũ | P0 | Không tạo bản ghi mới; thẻ "trở lại" hiện cảnh giới hiện tại |
| US-03 | Lệnh có dấu/không dấu/có `/` đều chạy | P0 | Bộ test chuẩn hóa ≥ 30 biến thể đều pass |
| US-04 | Tôi chọn nhân vật nam/nữ | P1 | `thamgia nu`, `gioitinh nam` đổi trang phục trên overlay |
| US-05 | Tôi xem thông tin bằng `thongtin`, `tuvi`, `canhgioi`, `xephang` | P0 | Thẻ phản hồi hiện trong ≤ 1s, có chống spam 10s |

### 3.2 Quà & tu vi

| ID | Story | Ưu tiên | Tiêu chí chấp nhận |
|---|---|---|---|
| US-10 | Quà được đổi thành tu vi theo công thức | P0 | `tuvi = diamond × quantity × multiplier`; khớp bảng ví dụ GDD §5.1 |
| US-11 | Quà lớn đưa tôi lên nhiều tầng | P0 | Test "Galaxy từ LK1 → LK5 0/5.000" pass |
| US-12 | Quà không bao giờ bị cộng hai lần | P0 | Gửi lại cùng event 100 lần → đúng 1 giao dịch; ràng buộc unique ở DB |
| US-13 | Quà combo được tính một lần với số lượng chốt | P0 | Chuỗi tap combo 1→15 chỉ tạo 1 giao dịch `repeatCount=15` |
| US-14 | Người chưa tham gia tặng quà vẫn được ghi nhận | P0 | Theo `autoJoinOnGift`; không có quà nào "biến mất" |
| US-15 | Quà không có giá kim cương được ghi chờ xử lý | P1 | Giao dịch `unpriced`, Admin thấy trong danh sách lỗi |

### 3.2b Tu vi miễn phí & voice

| ID | Story | Ưu tiên | Tiêu chí chấp nhận |
|---|---|---|---|
| US-16 | Là người xem không tặng quà, tôi vẫn tăng tu vi khi xem, tap tim, bình luận, follow, share | P0 | Theo GDD §14.1; có trần ngày; follow chỉ thưởng 1 lần |
| US-17 | Tôi lên tầng đầu tiên trong vài phút mà không cần tặng quà | P0 | Mục tiêu nhịp độ GDD §15.1 |
| US-18 | Cả phòng tap tim / share để hộ pháp người đang độ kiếp | P0 | Hộ pháp ≤ +5%, hiện thanh hộ pháp trên overlay |
| US-19 | Khoảnh khắc đặc biệt được đọc thành tiếng | P1 | Voice theo GDD §16, nghe được trong OBS, tắt được từng loại |

### 3.3 Độ kiếp

| ID | Story | Ưu tiên | Tiêu chí chấp nhận |
|---|---|---|---|
| US-20 | Ở Đại Viên Mãn tôi gõ `do kiep` để đột phá | P0 | Phiên 30s mở, overlay hiện đồng hồ + tỷ lệ |
| US-21 | Tôi tặng quà để tăng tỷ lệ | P0 | Tỷ lệ trên overlay cập nhật ≤ 1s sau quà; không vượt `maxChance` |
| US-22 | Kết quả do server quyết định và truy vết được | P0 | `roll`, `final_chance_bp`, `config_snapshot` lưu trong lịch sử |
| US-23 | Thành công: cảnh giới mới, trang phục mới | P0 | Tầng 1, tu vi dư được chuyển, hiệu ứng đột phá |
| US-24 | Thất bại: mất 20% tu vi dư, cooldown | P0 | Theo cấu hình; không bao giờ tụt dưới ngưỡng viên mãn |
| US-25 | Restart server không làm mất/hỏng phiên | P0 | Test kill-restart giữa phiên: phiên resolve đúng một lần |

### 3.4 Overlay

| ID | Story | Ưu tiên | Tiêu chí chấp nhận |
|---|---|---|---|
| US-30 | Overlay 720×1280 dùng được trong OBS Browser Source | P0 | Nền trong suốt tùy chọn (`?transparent=1`); không thanh cuộn |
| US-31 | Overlay hiện nhân vật, tên, cảnh giới, tầng, thanh tu vi | P0 | Theo layout `08_Asset_Guidelines.md` §6 |
| US-32 | Hiệu ứng nhận quà, lên tầng, đột phá, thất bại | P0 | Tối đa 1 hiệu ứng toàn màn hình cùng lúc; còn lại xếp hàng |
| US-33 | Bảng xếp hạng 5 loại, xoay vòng | P0 | Xoay mỗi 15s; thứ tự ổn định khi bằng điểm |
| US-34 | Overlay tự kết nối lại | P0 | Mất WS → xin ticket mới, đồng bộ lại trạng thái qua REST trong ≤ 5s |
| US-35 | Chế độ demo không cần LIVE | P1 | `?demo` sinh người chơi + quà giả qua MockConnector |

### 3.5 Admin

| ID | Story | Ưu tiên | Tiêu chí chấp nhận |
|---|---|---|---|
| US-40 | Chỉnh toàn bộ thông số gameplay | P0 | Mọi khóa ở GDD §10; validate miền giá trị; có `version` chống ghi đè |
| US-41 | Tìm người chơi, xem lịch sử quà và độ kiếp | P0 | Tìm theo username/nickname, phân trang cursor |
| US-42 | Điều chỉnh dữ liệu người chơi có audit | P0 | Mỗi chỉnh sửa ghi `admin_audit_logs` với giá trị trước/sau + lý do bắt buộc |
| US-43 | Reset nhân vật có xác nhận | P0 | API yêu cầu `confirmUsername` khớp; ghi audit |
| US-44 | Bật/tắt game, nhận quà, hiệu ứng | P0 | Có hiệu lực ≤ 2s, không cần restart |
| US-45 | Xem trạng thái kết nối TikTok và lỗi xử lý quà | P1 | Danh sách `gift_transactions` trạng thái `failed/unpriced/unjoined` |

## 4. Yêu cầu phi chức năng

| Mã | Yêu cầu | Mục tiêu |
|---|---|---|
| NFR-01 | Độ trễ quà → overlay | p95 ≤ 800ms (từ lúc connector nhận đến lúc frame `game.exp_gained` gửi đi) |
| NFR-02 | Thông lượng | 200 gift/s và 1.000 chat/s trong 60s không mất sự kiện, không cộng trùng |
| NFR-03 | Đồng thời | 500 người chơi hoạt động, 3 phiên độ kiếp song song |
| NFR-04 | Bền vững | Không mất dữ liệu khi restart; mọi thay đổi tu vi đi kèm 1 dòng giao dịch |
| NFR-05 | Cô lập tenant | Mọi bảng mới có `tenant_id` + FK tổ hợp; truy cập chéo → 404 |
| NFR-06 | Truy vết | Từ 1 dòng `player.current_exp` truy ngược ra mọi `gift_transactions` và `events` gốc |
| NFR-07 | Overlay | 60fps trên PC tầm trung; bundle ảnh ≤ 25MB; chạy liên tục 5 giờ không rò bộ nhớ (> 300MB) |
| NFR-08 | Bảo mật | Overlay dùng API key scope `game:overlay` (chỉ đọc); Admin dùng `game:admin` |

## 5. Phạm vi MVP (đối chiếu spec Phần XIV)

Hoàn thành khi **tất cả** dòng dưới đây có test nghiệm thu pass (xem `07_TestPlan.md`):

- [ ] Kết nối TikTok LIVE (tái sử dụng, không viết lại)
- [ ] Tham gia bằng username, nhân vật lưu lâu dài
- [ ] Quà → tu vi, 8 cảnh giới × 10 tầng, tự lên tầng (kể cả nhiều tầng)
- [ ] Độ kiếp thành công/thất bại, quà tăng tỷ lệ
- [ ] Nhân vật đổi theo cảnh giới (16 bộ trang phục, hoặc fallback khi thiếu)
- [ ] Hiệu ứng nhận quà và đột phá
- [ ] LIVE overlay + 5 bảng xếp hạng
- [ ] Admin dashboard
- [ ] Không cộng trùng gift event, không mất dữ liệu khi restart
- [ ] Tu vi miễn phí (xem, tap, follow, share, chat) có trần ngày + hộ pháp khi độ kiếp
- [ ] Voice đọc các sự kiện đặc biệt

## 6. Ngoài phạm vi

Xem GDD §12. Thêm: ứng dụng mobile riêng, thanh toán ngoài TikTok, đa ngôn ngữ (v1 chỉ tiếng Việt).

## 7. Rủi ro

| Rủi ro | Khả năng | Tác động | Giảm thiểu |
|---|---|---|---|
| Thư viện TikTok đổi schema gift | Trung bình | Cao | Game chỉ đọc payload đã chuẩn hóa; test hợp đồng trên `mapGiftPayload` |
| `msgId` thiếu → khó định danh quà | Thấp | Cao | Khóa idempotency fallback = fingerprint ổn định (Architecture §5) |
| Thiếu 8 nhân vật nữ | Cao (hiện chỉ có bộ nam) | Trung bình | Fallback dùng bộ nam + khung màu; xem Asset Guidelines §2 |
| Cân bằng sai làm người xem nản | Trung bình | Trung bình | Preset "Phòng nhỏ", theo dõi chỉ số GDD §11 |
| Quy định TikTok về trò chơi có yếu tố may rủi | Thấp | Cao | Không có phần thưởng quy đổi ra tiền; chủ phòng tự chịu trách nhiệm tuân thủ chính sách nền tảng |
