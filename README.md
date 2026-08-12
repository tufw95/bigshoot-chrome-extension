# Bigshoot

Bigshoot là Chrome extension giúp chụp toàn bộ một DOM element theo cách quen thuộc của **Capture node screenshot** trong DevTools, nhưng nhanh và dễ dùng hơn. Extension có thể mở rộng một vùng cuộn độc lập (ví dụ sidebar) trước khi chụp, sau đó khôi phục trang về đúng trạng thái ban đầu.

## Cách dùng

1. Bấm icon máy ảnh Bigshoot trên thanh công cụ Chrome.
2. Rê chuột để chọn element. Khung xanh hiển thị vùng và kích thước ảnh dự kiến.
3. Click để chụp.
4. Nhấn `F` để chụp toàn trang, `↑` để chọn element cha hoặc `Esc` để hủy.

Để đổi nơi nhận ảnh, nhấp chuột phải vào icon Bigshoot, chọn **Cài đặt Bigshoot**, rồi chọn:

- **Lưu về máy**: tạo PNG trong `Downloads/Bigshoot`.
- **Copy vào clipboard**: dán trực tiếp vào chat, tài liệu hoặc công cụ thiết kế.

## Cài thử từ mã nguồn

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Chọn **Load unpacked**.
4. Chọn thư mục chứa `manifest.json` của dự án này.
5. Ghim Bigshoot lên thanh công cụ.

Chrome không cho extension chạy trên các trang nội bộ như `chrome://`, Chrome Web Store và một số trình xem hệ thống. Nếu đang mở DevTools trên chính tab cần chụp, hãy đóng DevTools trước vì Chrome chỉ cho một debugger kết nối vào tab tại một thời điểm.

## Phát triển

Yêu cầu Node.js 20 trở lên. Dự án không có dependency runtime và không gửi dữ liệu ra ngoài.

```bash
npm run check
npm run package
```

File ZIP sẵn sàng tải lên Chrome Web Store được tạo tại `dist/bigshoot-<version>.zip`.

## Cấu trúc

```text
manifest.json                 Manifest V3 và khai báo quyền
src/background.js             Điều phối chụp, tải xuống và clipboard
src/picker.js                 Giao diện chọn element trong trang
src/options/                  Trang cài đặt
src/offscreen/                Ghi PNG vào clipboard
icons/                        Icon extension
docs/STORE_SUBMISSION.md      Checklist phát hành nội bộ
docs/TEST_PLAN.md             Kịch bản kiểm thử thủ công
```

## Giới hạn kỹ thuật

- Trang hoặc element quá 32.767 px theo một chiều có thể bị giới hạn bởi khả năng dựng ảnh của Chrome/GPU.
- Nội dung lazy-load chỉ xuất hiện sau khi cuộn sẽ cần được tải trước khi chụp.
- Canvas/WebGL, video hoặc iframe khác origin có thể có hành vi khác tùy chính sách bảo mật của trang.
- Với layout thay đổi mạnh khi sidebar được mở rộng, ảnh có thể khác nhẹ so với trạng thái cuộn ban đầu.

## Quyền riêng tư

Bigshoot không thu thập hay truyền dữ liệu. Xem [PRIVACY.md](PRIVACY.md) để biết chi tiết.

## Giấy phép

[MIT](LICENSE)
