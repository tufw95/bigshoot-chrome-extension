# Đưa Bigshoot lên Chrome Web Store cho nội bộ

Tài liệu này dành cho cách phân phối **Private** tới người dùng trong cùng Google Workspace organization.

## 1. Chuẩn bị gói

```bash
npm run package
```

Kết quả: `dist/bigshoot-1.0.0.zip`.

Trước mỗi phiên bản mới, cập nhật đồng thời:

- `version` trong `manifest.json`.
- `version` trong `package.json`.
- `CHANGELOG.md`.

Chrome Web Store không chấp nhận tải lại cùng một số phiên bản.

## 2. Tạo listing

1. Đăng nhập [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Chọn **New item** và tải file ZIP trong `dist/`.
3. Điền nội dung listing theo phần gợi ý bên dưới.
4. Trong **Distribution**, chọn **Private**.
5. Chọn Google Workspace domain hoặc nhóm tester được phép cài.
6. Hoàn tất phần **Privacy practices** và gửi duyệt.

Tài khoản developer cần trả phí đăng ký một lần theo yêu cầu hiện tại của Chrome Web Store. Với distribution theo domain, quản trị viên Google Workspace có thể cần cho phép extension trong Admin Console.

## 3. Nội dung listing gợi ý

**Tên**

> Bigshoot — Chụp theo element

**Mô tả ngắn**

> Chụp toàn bộ một element, vùng cuộn hoặc cả trang chỉ bằng một cú nhấp.

**Mô tả chi tiết**

> Bigshoot mang trải nghiệm Capture node screenshot của Chrome DevTools ra thanh công cụ trình duyệt. Bấm icon, rê chuột tới element và click để tạo ảnh PNG. Bigshoot có thể mở rộng vùng cuộn độc lập như sidebar để chụp cả nội dung nằm bên dưới, hoặc chụp toàn trang bằng phím F. Ảnh được lưu vào máy hoặc sao chép vào clipboard theo cài đặt. Dữ liệu không được gửi tới máy chủ.

**Danh mục đề xuất**

> Tools

**Ngôn ngữ**

> Vietnamese

**Mục đích duy nhất (single purpose)**

> Cho phép người dùng chủ động chụp ảnh PNG của một element DOM, một vùng cuộn hoặc toàn bộ trang web đang mở.

## 4. Giải trình quyền

Chrome Web Store yêu cầu giải thích rõ từng quyền nhạy cảm:

| Quyền | Lý do |
| --- | --- |
| `activeTab` | Chỉ cấp quyền tạm thời trên tab sau khi người dùng bấm icon Bigshoot. |
| `scripting` | Chèn công cụ chọn element và đo vùng chụp vào tab đang hoạt động. |
| `debugger` | Gọi Chrome DevTools Protocol `Page.captureScreenshot` để chụp nội dung nằm ngoài viewport, tương đương Capture node screenshot. Kết nối được gỡ ngay sau mỗi lần chụp. |
| `downloads` | Lưu ảnh PNG vào máy khi người dùng chọn chế độ tải xuống. |
| `clipboardWrite` | Sao chép ảnh PNG vào clipboard khi người dùng chọn chế độ clipboard. |
| `offscreen` | Tạo tài liệu nền tối thiểu để sử dụng Clipboard API trong Manifest V3. |
| `storage` | Lưu lựa chọn đích đến và khoảng đệm. |
| `contextMenus` | Hiển thị mục Cài đặt Bigshoot khi nhấp chuột phải vào icon. |

Không khai báo host permission cố định. Bigshoot chỉ truy cập tab hiện tại sau hành động rõ ràng của người dùng.

## 5. Privacy practices

Khai báo đề xuất:

- Không thu thập dữ liệu người dùng.
- Không bán dữ liệu.
- Không sử dụng dữ liệu ngoài mục đích duy nhất.
- Không truyền ảnh hoặc nội dung trang tới máy chủ.
- Không sử dụng remote code; toàn bộ JavaScript nằm trong gói extension.

Đăng chính sách trong `PRIVACY.md` ở một URL công khai. Nếu repository là private, hãy dùng một trang nội bộ mà người dùng và reviewer truy cập được, hoặc tạo một GitHub Pages/public gist chỉ chứa chính sách này.

## 6. Tài sản cần tải lên

- Icon: PNG 128 × 128 từ `icons/icon-128.png`.
- Screenshot picker: `store-assets/screenshots/picker-1280x800.png`.
- Screenshot Settings: `store-assets/screenshots/settings-1280x800.png`.
- Promotional tile nếu dashboard yêu cầu ở thời điểm gửi duyệt.

Hai ảnh đi kèm đã đúng kích thước 1280 × 800 và không chứa dữ liệu nhạy cảm. Có thể bổ sung ảnh kết quả sidebar dài nếu muốn mô tả rõ hơn trong listing.

## 7. Phân phối bằng Google Admin Console

Sau khi phiên bản Private được duyệt:

1. Mở Google Admin Console.
2. Vào **Devices → Chrome → Apps & extensions → Users & browsers**.
3. Chọn organizational unit hoặc group.
4. Thêm extension từ Chrome Web Store bằng item ID.
5. Chọn **Allow install** hoặc **Force install** theo chính sách nội bộ.

Tên menu có thể thay đổi nhẹ theo phiên bản Admin Console và loại Google Workspace subscription.
