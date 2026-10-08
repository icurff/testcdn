# TikTok CDN Video Encryption Demo

## About
A small demo inspired by the article  
👉 [Các web phim đã giảm chi phí bằng TikTok như thế nào?](https://voz.vn/t/cac-web-phim-%C4%90a-giam-chi-phi-bang-tiktok-nhu-the-nao.913788)

This project shows how a normal video can be **converted to HLS**, **encrypted with AES-128**, then **embedded into PNG files** that can be uploaded to TikTok — using TikTok’s CDN as a fast, global content delivery layer.

How it works:
- Video/audio streams are copied without re-encoding by default, then split into `.ts` segments and an `.m3u8` playlist. Optional H.264/AAC re-encoding is available.
- Each segment is AES-encrypted, then wrapped inside valid PNG files.
- These PNGs can be served directly (even via TikTok CDN) and decrypted in the player.
- The player reads the disguised PNGs, extracts, decrypts, and streams the video.

This is purely for **educational and research** purposes.

---

## Run
1. Copy the example config and edit values:
```bash
cp config.json.example config.json
# edit config.json
```
2. Build & run with Docker Compose:
```bash
docker compose up -d
```

Then open: [http://localhost:3000](http://localhost:3000)

Upload a video, run the conversion, inspect generated files (playlist, segments, PNGs), and try playback.

## Deploy with Caddy and HTTPS

Production uses `docker-compose.prod.yml` with two services: the Node app on the
private Docker network and Caddy on public ports 80/443. Caddy automatically
obtains and renews the certificate for `test.icurff.me`. The production image
runs Node 22 with `node server.js`; the default Compose file remains the local
development setup with nodemon.

On the server:

1. Point the DNS A record for `test.icurff.me` to the server's public IPv4 address.
   If using an AAAA record, it must point to a working IPv6 address on that server.
2. Allow inbound TCP 80 and 443 in the server/provider firewall. UDP 443 is
   optional for HTTP/3. Keep outbound HTTPS available for certificate issuance
   and TikTok requests.
3. Place your actual `config.json` next to the Compose file and set the domain:

   ```bash
   cp .env.example .env
   mkdir -p outputs tmp
   ```

   Keep existing `outputs/` when migrating videos: it contains playlists and
   AES keys. `config.json` is mounted read-only and excluded from the image.

4. Build and start production:

   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   docker compose -f docker-compose.prod.yml ps
   docker compose -f docker-compose.prod.yml logs --tail=100 caddy
   ```

Open **https://test.icurff.me**. Service workers run in the viewer's browser and
require this secure HTTPS origin. The app's port 3000 is not published in the
production setup. `outputs/` and `tmp/` remain on the host; Caddy certificates
persist in the `caddy_data` volume. Keep that volume when updating containers.

To update code, rebuild with the same production command. After changing the
existing `config.json`, restart the app:

```bash
docker compose -f docker-compose.prod.yml restart app
```

For domain or Caddyfile changes, recreate Caddy so it reads the current `.env`:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate caddy
```

The application currently has no login/access checks on upload or key retrieval.
Add access controls before offering public uploads or private video sharing.

References: [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[official Caddy image storage](https://hub.docker.com/_/caddy).

## Upload troubleshooting

`tiktok.api_mode` supports `business_center` (the default when omitted) and
`ads_manager`. Business Center requires a string `org_id`; Ads Manager requires
a string `aadvid` and the cookie from the corresponding logged-in Ads Manager
session. Keep real session values in the ignored `config.json` file.

Example Ads Manager settings:

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

Both upload and create send `x-csrftoken`, using `csrf_token` when provided,
otherwise the `csrftoken` cookie. Update expired cookies/tokens and restart:

```bash
docker compose restart app
```

Errors distinguish FFmpeg conversion from TikTok upload, include HTTP/API codes,
and redact session secrets. Business Center permission does not follow from
Ads Manager permission. HTML errors mentioning CSRF indicate missing or invalid
tokens. The client does not generate `msToken`, `X-Bogus`, or `X-Gnarly`; an API
request may still be rejected depending on account/session requirements.

Playlists preserve the exact CDN `data.url`, including its signed query. Ads
Manager requires that URL; only Business Center falls back to `orgin_link` plus
the image URI. Signed URLs can expire; automatic renewal/retry is not implemented.

The player waits for `/sw.js?v=2` to control the page before loading HLS. The
worker extracts encrypted segment bytes from PNGs on `*.tiktokcdn.com`; HLS
handles AES decryption. Invalid PNG/AES payloads return 502 instead of raw PNG.
Open the player on localhost or HTTPS; use Ctrl + Shift + R after updating if
needed. Browser HLS/codec support is still required. FFmpeg encoding settings
are H.264 CRF 21 and AAC 128k only when re-encoding is selected.

## Preserve original quality

The upload form defaults to **Giữ nguyên chất lượng — không nén lại**. Requests
without a `mode` field also default to `copy`. FFmpeg uses `-c:v copy -c:a copy`:
the selected video/audio streams are remuxed and AES-encrypted without another
lossy encoding step. PNG wrapping/extraction also preserves the encrypted bytes.
The output is a different container, not a byte-for-byte copy of the source file.
The pipeline uses the first video and optional first audio stream; additional
audio tracks, subtitles and other streams are not included.

Playback depends on the original codecs being supported by MPEG-TS/HLS and the
browser/player. H.264 video and AAC audio are the recommended inputs for this
player. Copy mode does not automatically fall back to re-encoding. Existing
keyframes determine segment boundaries, so the requested segment duration is a
target and a segment can be longer. Bitrate and frame dimensions are retained;
high-bitrate sources can produce large PNG segments and hit CDN upload limits.

Choose the explicit `transcode` option only if you want the previous H.264/AAC
conversion. Videos uploaded before this change retain their previous encoding;
upload the original source again to use copy mode.

## Disclaimer
This project is for learning only.
Do not use it to bypass bandwidth or CDN limitations on third-party platforms.
