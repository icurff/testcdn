# Báo cáo thay đổi project Free CDN Stream

**Ngày lập:** 08/10/2026 — múi giờ Asia/Saigon.

## 1. Phạm vi và kết quả

Các thay đổi tập trung vào việc chẩn đoán lỗi upload TikTok, bổ sung luồng Ads Manager, xử lý CSRF, sử dụng đúng URL CDN và sửa bước tách dữ liệu PNG khi phát video.

Thư mục làm việc không có repository Git ở thời điểm kiểm tra. Báo cáo đối chiếu với nội dung project ban đầu đã đọc trong phiên làm việc và các thay đổi đã thực hiện; đây không phải bản `git diff` đối chiếu một commit upstream.

Kết quả đã xác minh:

- Upload và đăng ký ảnh qua Ads Manager thành công trong chính container Docker.
- Khôi phục job video bị lỗi với 3 segment, thời lượng 21,9 giây.
- Tải các PNG từ CDN, tách payload và giải mã AES thành các segment MPEG-TS hợp lệ.
- FFmpeg giải mã toàn bộ video/âm thanh đã ghép mà không báo lỗi.
- Bộ kiểm tra tự động báo 18 test pass, 0 fail, bao gồm một test cha.
- Server đã phục vụ các file player và service worker mới qua HTTP 200.

**Giới hạn xác minh:** chưa kiểm tra trực tiếp việc phát trên trình duyệt sau bản sửa cuối, do phiên công cụ không có trình duyệt kết nối. Kiểm tra dữ liệu thật bằng FFmpeg và kiểm tra logic service worker không thay thế hoàn toàn kiểm tra giao diện trình duyệt.

## 2. Các lỗi và nguyên nhân đã xử lý

| Hiện tượng | Nguyên nhân hoặc bằng chứng | Cách xử lý |
|---|---|---|
| `Cannot read properties of undefined (reading 'web_uri')` | Code đọc thẳng `data.image_info.web_uri` dù API không trả thông tin ảnh. | Kiểm tra phản hồi, mã lỗi và trường dữ liệu trước khi sử dụng. |
| Giao diện báo `FFmpeg error` khi upload thất bại | Toàn bộ bước chuyển đổi và upload dùng chung nhãn lỗi FFmpeg. | Gắn tên giai đoạn: `FFmpeg conversion` hoặc `TikTok upload`. |
| TikTok báo “Không có quyền xem hoặc điều hành” | Project gọi Business Center bằng `org_id`, trong khi request upload thành công của người dùng thuộc Ads Manager và dùng `aadvid`. | Bổ sung chế độ Ads Manager, giữ chế độ Business Center để tương thích cấu hình cũ. Việc upload được trên Ads Manager không chứng minh có quyền tương ứng ở Business Center. |
| `HTTP [REDACTED]00; code=4000[REDACTED]` | Bộ che thông tin nhạy cảm thay cả chữ số trùng với giá trị cookie ngắn. | Bảo toàn HTTP status và mã lỗi API dạng số; chỉ che các giá trị cần xử lý trong nội dung thông báo. |
| HTTP 400 trả HTML | Đọc phản hồi thật thấy `Bad Request no csrf token present in data`. | Tự lấy `csrftoken` trong cookie và gửi qua header `x-csrftoken`. Lần thử sau trả HTTP 200, `code=0`. |
| `RangeError: byte length of Int32Array should be a multiple of 4` | Service worker chỉ nhận diện CDN cũ; PNG từ CDN Ads Manager đi thẳng vào bộ giải mã AES. Player còn có thể khởi tạo trước khi service worker kiểm soát trang. | Mở rộng nhận diện CDN, chờ service worker mới kiểm soát trang, kiểm tra độ dài payload AES và không trả PNG thô khi tách thất bại. |

## 3. Chi tiết thay đổi theo file

### 3.1. [uploader.js](uploader.js)

**Trước:** cố định hai endpoint Business Center; header CSRF ở bước create chứa một giá trị viết cứng; bước upload không gửi CSRF; đọc phản hồi mà không kiểm tra cấu trúc; trả về một chuỗi URI ảnh.

**Sau:**

- Thêm `apiEndpoint(action)` để chọn API theo `tiktok.api_mode`.
- Kiểm tra chế độ hợp lệ, ID tài khoản tương ứng và cookie trước khi mở luồng upload.
- Dùng `URL` và `searchParams` để xây dựng query, thay vì ghép trực tiếp ID vào URL request.
- Điều chỉnh `Origin`, `Referer` và `show_error` theo chế độ API.
- Giữ trường multipart `Filedata` và các trường JSON tạo ảnh phù hợp với request trình duyệt đã cung cấp.
- Thêm `csrfHeaders()`, dùng cho cả upload và create. Thứ tự ưu tiên là `tiktok.csrf_token` nếu có giá trị, sau đó là trường `csrftoken` trong `tiktok.cookie`.
- Loại bỏ CSRF token viết cứng.
- Thêm `requestTiktok()` để xử lý lỗi HTTP, phản hồi không phải object JSON và mã lỗi API khác `0`.
- Thêm `apiError()` để hiển thị giai đoạn, HTTP status, các trường mã lỗi/thông báo được chọn và dấu hiệu thiếu CSRF trong HTML.
- Thêm `redactSecrets()` để che cookie/token trong thông báo. Không đưa nguyên Axios error hoặc request config chứa cookie ra log. Giới hạn thông báo ở 1.500 ký tự.
- Kiểm tra `data.image_info.web_uri` tồn tại, là chuỗi và không rỗng.
- Ưu tiên URL CDN ở `data.url`, giữ nguyên query string. Kiểm tra URL dùng HTTP/HTTPS và không chứa ký tự xuống dòng.
- Ads Manager bắt buộc có `data.url`. Business Center có thể dùng cách ghép `orgin_link + web_uri` khi API không trả URL.
- Bỏ import `path` không được sử dụng.

Giá trị trả về của `uploadToTiktok()` thay đổi từ chuỗi sang object:

```js
{
  webUri: "URI ảnh dùng cho bước create",
  url: "URL CDN dùng trong playlist"
}
```

Đây là thay đổi giao diện hàm. Nơi gọi trong `embed.js` đã được cập nhật tương ứng.

### 3.2. [embed.js](embed.js)

- `sendToTiktok()` nhận object `{ webUri, url }` từ uploader.
- Metadata ghi vào `uploaded.json` giữ `imgURL` là URI ảnh và bổ sung `url` là URL phát thực tế.
- `replaceM3u8()` ưu tiên `data.url`, chỉ ghép tiền tố CDN cũ khi không có URL.
- Dùng hàm callback trong `String.replace()` để chèn URL nguyên vẹn, tránh diễn giải các mẫu thay thế đặc biệt trong chuỗi URL.

Lý do: URL Ads Manager trả về có host, đường dẫn và query ký khác với tiền tố CDN Business Center ban đầu. Ghép URI mới vào tiền tố cũ có thể tạo URL không đúng.

### 3.3. [server.js](server.js)

- Thêm biến `stage` quanh bước chuyển đổi và upload.
- Lỗi trước/khi chạy FFmpeg mang nhãn `FFmpeg conversion failed`.
- Lỗi ở bước đóng gói PNG/upload mang nhãn `TikTok upload failed`.
- Phản hồi lỗi dùng `text/plain` thay vì để thông báo bị hiểu như HTML.

Các tham số nén video, tạo khóa AES, độ dài segment và đường dẫn FFmpeg không được thay đổi.

### 3.4. [public/index.html](public/index.html)

- Khi request upload thành công, tiếp tục hiển thị HTML kết quả có liên kết player.
- Khi request thất bại, dùng `textContent` thay cho `innerHTML` để hiển thị thông báo lỗi dưới dạng văn bản.

### 3.5. [public/sw.js](public/sw.js)

**Trước:** chỉ chặn request đến `p16-ad-sg.tiktokcdn.com`. Nếu tách PNG thất bại, code tải lại và trả nguyên dữ liệu gốc, khiến PNG có thể đi vào bộ giải mã video.

**Sau:**

- Nhận diện hostname kết thúc bằng `.tiktokcdn.com`, bao gồm các host Ads Manager đã gặp như `p16-ad-site-sign-sg.tiktokcdn.com` và `p19-ad-site-sign-sg.tiktokcdn.com`.
- Tách các chunk `iTXt` thành dữ liệu segment đã mã hóa trước khi trả cho player.
- Kiểm tra payload không rỗng và độ dài chia hết cho 16, phù hợp kích thước khối AES-128.
- Nếu tách thất bại, trả HTTP 502 dạng văn bản thay vì trả PNG thô.
- Giảm các log in URL/request CDN trong quá trình xử lý.

Service worker **không giải mã AES**. Nó chỉ tháo lớp PNG; bộ giải mã HLS của player tiếp tục xử lý AES theo playlist và khóa.

### 3.6. [public/js/inject.js](public/js/inject.js)

**Trước:** đợi sự kiện `window.load` mới đăng ký service worker; không cung cấp cơ chế để player chờ trang được service worker kiểm soát.

**Sau:**

- Bắt đầu đăng ký ngay khi script chạy.
- Tạo promise `window.pngSegmentWorkerReady` để player chờ.
- Đăng ký `/sw.js?v=2`, scope `/`, với `updateViaCache: "none"`.
- Chỉ hoàn tất khi `navigator.serviceWorker.controller.scriptURL` khớp URL worker mới; theo dõi `controllerchange`.
- Giới hạn chờ kiểm soát trang ở 15 giây và hiển thị lỗi rõ ràng nếu không hoàn tất.
- Báo lỗi khi trình duyệt/ngữ cảnh không hỗ trợ service worker; hướng dẫn dùng localhost hoặc HTTPS.
- Gắn xử lý rejection sớm để tránh promise bị báo lỗi chưa được xử lý trước khi player tải xong.

### 3.7. [public/player.html](public/player.html)

- Tải `/js/inject.js?v=2`.
- Chuyển `showPlayer()` sang async và chờ `pngSegmentWorkerReady` trước khi tạo nguồn HLS/khởi tạo Video.js.
- Hiển thị lỗi khởi tạo bằng văn bản trên nền player.

### 3.8. [config.json.example](config.json.example) và cấu hình cục bộ

Thêm ba trường vào cấu hình mẫu:

| Trường | Chức năng |
|---|---|
| `tiktok.api_mode` | Chọn `business_center` hoặc `ads_manager`; mặc định khi thiếu là `business_center`. |
| `tiktok.aadvid` | ID tài khoản quảng cáo cho Ads Manager, lưu dưới dạng chuỗi. |
| `tiktok.csrf_token` | Ghi đè CSRF tùy chọn; để trống sẽ lấy từ cookie `csrftoken`. |

Trong `config.json` đang chạy, đã đặt `api_mode` thành `ads_manager` và điền `aadvid` do người dùng cung cấp. Thao tác này giữ nguyên các giá trị cấu hình khác, không thay cookie bằng dữ liệu mẫu.

Khóa `orgin_link` vẫn giữ cách viết của project gốc để tương thích.

Ví dụ cấu hình đã loại bỏ thông tin tài khoản thật:

```json
{
  "tiktok": {
    "api_mode": "ads_manager",
    "org_id": "",
    "aadvid": "YOUR_AD_ACCOUNT_ID",
    "cookie": "YOUR_ADS_MANAGER_COOKIE",
    "csrf_token": "",
    "orgin_link": "https://p16-ad-sg.tiktokcdn.com/origin/"
  }
}
```

### 3.9. [README.md](README.md)

Thêm phần xử lý lỗi upload, giải thích hai chế độ API, cách cấu hình CSRF, cách dùng URL CDN trả về, khả năng URL hết hạn, giới hạn xử lý tham số trình duyệt và lệnh chạy test uploader.

### 3.10. File kiểm tra mới

- [tests/uploader.test.js](tests/uploader.test.js): kiểm tra API, CSRF, lỗi, URL CDN và cập nhật playlist bằng phản hồi giả lập.
- [tests/player.test.js](tests/player.test.js): kiểm tra service worker, tách PNG/giải mã dữ liệu kiểm thử và quá trình chờ worker kiểm soát trang.

## 4. Endpoint và luồng dữ liệu sau khi sửa

| Chế độ | Upload | Create | Tham số tài khoản |
|---|---|---|---|
| Business Center | `https://business.tiktok.com/api/v3/bm/material/image/upload/` | `https://business.tiktok.com/api/v3/bm/material/image/create/` | `org_id` |
| Ads Manager | `https://ads.tiktok.com/mi/api/v2/i18n/material/image/upload/` | `https://ads.tiktok.com/mi/api/v2/i18n/material/image/create/` | `aadvid` |

Ads Manager bổ sung `req_src=tt4b_creation` ở cả hai request và `is_compressed=0` ở request upload.

Luồng xử lý:

```text
Video nguồn
  → FFmpeg nén lại, chia segment HLS và mã hóa AES-128
  → Nhúng mỗi segment đã mã hóa vào một PNG
  → Upload PNG rồi đăng ký ảnh qua API TikTok
  → Lưu URL CDN trả về vào playlist
  → Player chờ service worker kiểm soát trang
  → Service worker tải PNG và tách payload đã mã hóa
  → Player lấy khóa, giải mã AES và phát video
```

## 5. Kiểm tra và bằng chứng

### 5.1. Kiểm tra tự động

Lệnh đã chạy thành công trong container:

```powershell
docker compose exec -T app node --test tests/player.test.js tests/uploader.test.js
```

Node test runner báo **18 pass, 0 fail**. Số này gồm 13 test con của uploader, 1 test cha của uploader và 4 test player.

Các nhóm hành vi được kiểm tra:

- Chọn endpoint, ID, query và payload create theo chế độ API.
- Ưu tiên CSRF cấu hình riêng hoặc lấy từ cookie, gửi ở cả hai bước.
- Phản hồi thiếu `image_info`, thiếu URL, lỗi API trong HTTP 200 và create bị từ chối.
- Phản hồi HTML, HTTP lỗi, che thông tin phiên đăng nhập và bảo toàn mã số chẩn đoán.
- Giữ nguyên URL CDN có query khi ghi playlist; từ chối URL không phù hợp.
- Nhận diện cả CDN cũ lẫn CDN mới; không chặn các domain có tên gần giống.
- Tách PNG ra đúng ciphertext và giải mã được dữ liệu kiểm thử.
- Trả 502 khi tách payload thất bại, không tải lại PNG làm dữ liệu video.
- Chờ service worker mới ở lần truy cập đầu và khi thay worker cũ.

Lần đầu chạy test trên Windows host không tìm thấy `axios`; test sau đó được chạy trong container, nơi các dependency của ứng dụng đã được cài đặt.

### 5.2. Kiểm tra API và dữ liệu thật

Job đã khôi phục: `6a11e609-5c1a-4ffb-8095-cf27ea5ac94f`.

- Trước khi bổ sung CSRF: HTTP 400, `Content-Type: text/html`, thông báo thiếu CSRF.
- Sau khi gửi CSRF từ cookie: HTTP 200, `code=0`, có `image_info.web_uri` và `data.url`.
- Đã hoàn tất upload/create cho cả 3 PNG và thay các mục segment trong playlist bằng URL CDN.
- Một PNG tải lại từ CDN được so sánh và khớp từng byte với PNG cục bộ.
- Sau bản sửa player, tải lại cả 3 PNG từ CDN, dùng hàm tách payload trong service worker và giải mã bằng khóa/IV của playlist.

| Segment | Dung lượng PNG (byte) | Payload mã hóa (byte) | MPEG-TS sau giải mã (byte) |
|---|---:|---:|---:|
| `seg_00000` | 2.595.083 | 2.580.128 | 2.580.112 |
| `seg_00001` | 3.705.880 | 3.684.624 | 3.684.612 |
| `seg_00002` | 472.653 | 469.632 | 469.624 |
| **Tổng PNG** | **6.773.616** | — | — |

Ba segment có thời lượng lần lượt 10 giây, 10 giây và 1,9 giây. Tất cả dữ liệu MPEG-TS sau giải mã có cấu trúc packet 188 byte hợp lệ. Phản hồi CDN ở lần kiểm tra có `Access-Control-Allow-Origin: *`.

Dữ liệu giải mã được ghép thành file kiểm tra cục bộ và xác minh bằng:

```powershell
docker compose exec -T app ffmpeg -v error -xerror -i tmp/playback-verification/combined.ts -f null -
```

Lệnh kết thúc với exit code `0`, không báo lỗi giải mã. Đây là kiểm tra tính đọc được của dữ liệu, không phải phép đo chất lượng so với video nguồn.

## 6. Dữ liệu khôi phục và file phát sinh khi chẩn đoán

Ngoài mã nguồn, phiên xử lý có cập nhật/tạo các dữ liệu sau:

- `outputs/6a11e609-5c1a-4ffb-8095-cf27ea5ac94f/master.m3u8`: thay segment cục bộ bằng URL CDN đã upload thành công.
- `outputs/6a11e609-5c1a-4ffb-8095-cf27ea5ac94f/uploaded.json`: metadata kết quả upload của 3 segment.
- `tmp/upload-verification.json`: kết quả upload dùng khi kiểm tra và khôi phục job.
- `tmp/playback-verification/combined.ts`: dữ liệu video đã giải mã để kiểm tra bằng FFmpeg.

Các bước khôi phục job được thực hiện bằng script chẩn đoán trong phiên. **Chưa bổ sung tính năng tự khôi phục/retry job vào giao diện hay server.**

Báo cáo này không chép cookie, khóa AES, CSRF token hoặc URL CDN có chữ ký thật. Các file dữ liệu chạy thực tế vẫn có thể chứa thông tin phiên phát hoặc nội dung video riêng tư.

## 7. Chất lượng video và các phần giữ nguyên

Không thay đổi thiết lập FFmpeg so với code ban đầu:

| Thành phần | Thiết lập hiện tại |
|---|---|
| Codec video | H.264 qua `libx264` |
| Preset | `veryfast` |
| Profile | `main` |
| Chất lượng | `CRF 21` |
| Âm thanh | AAC, `128k`, 2 kênh |
| Mã hóa HLS | AES-128 |

Mã hóa AES, nhúng dữ liệu vào PNG và tháo lớp PNG không tự làm giảm chất lượng. Tuy nhiên, bước FFmpeg nén lại video/âm thanh vốn có trong project gốc là nén mất dữ liệu. Chưa triển khai `-c:v copy` hoặc chế độ giữ nguyên codec nguồn.

Không thêm dependency hoặc thay đổi `package.json`, `package-lock.json`, `Dockerfile`, `docker-compose.yml`, `config.js` hay `util.js` trong các bản sửa này. Đường dẫn FFmpeg vẫn là `/usr/bin/ffmpeg`, phù hợp cách chạy Docker hiện tại.

## 8. Giới hạn còn lại và cách dùng bản sửa

- Cookie/CSRF phụ thuộc phiên đăng nhập. Khi chúng hết hiệu lực, cần cập nhật cấu hình phù hợp.
- Client không tạo hoặc phát lại các tham số `msToken`, `X-Bogus`, `X-Gnarly`. Lần kiểm tra thật đã thành công mà không gửi chúng; không suy rộng kết quả đó cho mọi tài khoản hoặc mọi thời điểm.
- URL CDN có thể hết hạn; project chưa tự gia hạn hoặc thay URL hết hạn.
- Service worker cần môi trường hỗ trợ và ngữ cảnh phù hợp như localhost hoặc HTTPS. Việc phát còn phụ thuộc khả năng HLS/codec của trình duyệt.
- Bản sửa dùng `/sw.js?v=2` và `/js/inject.js?v=2` để cập nhật worker/script cũ. Khi mở lại player sau cập nhật, có thể cần tải lại trang bằng `Ctrl + Shift + R`.
- Bộ che thông tin nhạy cảm vẫn dựa trên thay chuỗi. Mã số chẩn đoán được bảo toàn, nhưng nội dung thông báo văn bản có thể bị che một phần nếu trùng giá trị cookie ngắn.

Sau khi chỉnh cấu hình, khởi động lại ứng dụng:

```powershell
docker compose restart app
```

Mở giao diện tại `http://localhost:3000`. Video đã khôi phục dùng đường dẫn:

```text
http://localhost:3000/player.html?key=6a11e609-5c1a-4ffb-8095-cf27ea5ac94f&v=2
```
