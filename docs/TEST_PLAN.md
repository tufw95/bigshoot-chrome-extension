# Kế hoạch kiểm thử Bigshoot

## Cài đặt

- [ ] Load unpacked thành công trên Chrome phiên bản 109 trở lên.
- [ ] Icon hiển thị đúng ở 16, 32, 48 và 128 px.
- [ ] Nhấp chuột phải icon có mục **Cài đặt Bigshoot**.
- [ ] Không chạy trên `chrome://extensions` và hiển thị badge lỗi ngắn.

## Chọn element

- [ ] Bấm icon rồi rê chuột: khung xanh bám đúng element.
- [ ] Nhãn hiển thị tên node, kích thước và trạng thái vùng cuộn.
- [ ] Click không kích hoạt link/button của trang.
- [ ] Phím `↑` chọn element cha.
- [ ] Phím `Esc` thoát và trang hoạt động bình thường.

## Chụp ảnh

- [ ] Element nằm hoàn toàn trong viewport được chụp đúng.
- [ ] Element dài hơn viewport được chụp đủ phần dưới.
- [ ] Element nằm dưới fold được chụp đúng mà không cần cuộn tới đáy.
- [ ] Sidebar `overflow: auto` được mở rộng và chụp đủ nội dung cuộn.
- [ ] Trang được khôi phục chiều cao, overflow và layout sau khi chụp sidebar.
- [ ] Phím `F` chụp đủ chiều dài trang.
- [ ] Khoảng đệm trong Settings thay đổi kích thước ảnh như dự kiến.

## Đích đến

- [ ] Chế độ **Lưu về máy** tạo PNG trong `Downloads/Bigshoot`.
- [ ] Tên file không chứa ký tự không hợp lệ và không ghi đè ảnh cũ.
- [ ] Chế độ **Copy vào clipboard** dán được vào Slack, Docs hoặc Preview.
- [ ] Cài đặt được giữ sau khi đóng và mở lại Chrome.

## Trường hợp lỗi

- [ ] Khi DevTools đang mở trên tab, Bigshoot hướng dẫn đóng DevTools.
- [ ] Điều hướng tab trong lúc chụp không để lại debugger kết nối.
- [ ] Element bị xóa trong lúc chọn tạo thông báo lỗi dễ hiểu.
- [ ] Trang rất dài hoặc ảnh vượt giới hạn Chrome thất bại an toàn và khôi phục layout.
