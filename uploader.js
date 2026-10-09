import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import { basenameNoExt } from "./util.js";
import appConfig from "./config.js";

function validateConfig() {
  if (typeof appConfig.tiktok?.aadvid !== "string" || !appConfig.tiktok.aadvid.trim()) {
    throw new Error("Missing tiktok.aadvid (must be a non-empty string)");
  }
  if (typeof appConfig.tiktok.cookie !== "string" || !appConfig.tiktok.cookie.trim()) {
    throw new Error("Missing tiktok.cookie");
  }
}

function apiEndpoint(action) {
  if (!["upload", "create"].includes(action)) throw new Error("Invalid TikTok action");
  validateConfig();
  const url = new URL(`https://ads.tiktok.com/mi/api/v2/i18n/material/image/${action}/`);
  url.searchParams.set("aadvid", appConfig.tiktok.aadvid);
  url.searchParams.set("req_src", "tt4b_creation");
  if (action === "upload") url.searchParams.set("is_compressed", "0");
  return url.toString();
}

function csrfHeaders() {
  const explicit = appConfig.tiktok.csrf_token?.trim();
  const cookieToken = appConfig.tiktok.cookie?.match(/(?:^|;\s*)csrftoken=([^;]*)/)?.[1];
  const token = explicit || cookieToken?.trim();
  return token ? { "x-csrftoken": token } : {};
}

function redactSecrets(value) {
  let text = String(value);
  const cfg = appConfig.tiktok ?? {};
  const secrets = [cfg.cookie, cfg.csrf_token, ...String(cfg.cookie ?? "").split(";").map((part) => {
    const equals = part.indexOf("=");
    return equals < 0 ? "" : part.slice(equals + 1).trim();
  })].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
  return text;
}

function apiError(stage, response, fallback = "Invalid API response") {
  const details = [];
  const data = response?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const field of ["code", "status_code", "error_code", "message", "msg", "error", "description"]) {
      if (["string", "number"].includes(typeof data[field])) {
        const numericCode = ["code", "status_code", "error_code"].includes(field) && /^\d+$/.test(String(data[field]));
        const value = numericCode || typeof data[field] === "number" ? data[field] : redactSecrets(data[field]);
        details.push(`${field}=${value}`);
      }
    }
  } else if (typeof data === "string" && /csrf/i.test(data)) {
    details.push("CSRF token missing or rejected; check tiktok.csrf_token / cookie csrftoken");
  }
  details.push(redactSecrets(fallback));
  const status = Number.isInteger(response?.status) ? `HTTP ${response.status}; ` : "";
  return new Error(`${stage}: ${status}${details.join("; ")}`.slice(0, 1500));
}

async function requestTiktok(stage, config) {
  let response;
  try {
    response = await axios.request({ ...config, timeout: 60000 });
  } catch (error) {
    // Never attach/log Axios errors: their config contains the session cookie.
    throw apiError(stage, error.response, error.code || "Network request failed");
  }
  const body = response.data;
  if (response.status < 200 || response.status >= 300 || !body ||
      typeof body !== "object" || Array.isArray(body) ||
      ["code", "status_code", "error_code"].some((field) =>
        body[field] !== undefined && body[field] !== 0 && body[field] !== "0")) {
    throw apiError(stage, response);
  }
  return response;
}

function requestHeaders() {
  const origin = "https://ads.tiktok.com";
  const referer = new URL("/i18n/creation", origin);
  referer.searchParams.set("aadvid", appConfig.tiktok.aadvid);
  return {
    accept: "application/json, text/plain, */*",
    origin,
    referer: referer.toString(),
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    Cookie: appConfig.tiktok.cookie,
    ...csrfHeaders(),
  };
}

function validateCdnUrl(url, response) {
  try {
    if (typeof url !== "string" || !url.trim() || /[\r\n]/.test(url)) throw new Error();
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
    return url;
  } catch {
    throw apiError("TikTok upload", response, "Missing or invalid data.url CDN URL");
  }
}

export async function uploadToTiktok(filePath) {
  // Validate config before opening the file stream.
  const url = apiEndpoint("upload");
  const data = new FormData();
  const stream = fs.createReadStream(filePath);
  data.append("Filedata", stream);
  let response;
  try {
    response = await requestTiktok("TikTok upload", {
      method: "post", maxBodyLength: Infinity, url,
      headers: { ...requestHeaders(), ...data.getHeaders() }, data,
    });
  } finally {
    stream.destroy();
  }
  const webUri = response.data.data?.image_info?.web_uri;
  if (typeof webUri !== "string" || !webUri.trim()) {
    throw apiError("TikTok upload", response, "Missing data.image_info.web_uri");
  }
  const cdnUrl = validateCdnUrl(response.data.data?.url, response);
  await requestTiktok("TikTok create", {
    method: "post", maxBodyLength: Infinity, url: apiEndpoint("create"),
    headers: { ...requestHeaders(), "content-type": "application/json" },
    data: JSON.stringify({ web_uri: webUri, original_web_uri: webUri,
      name: basenameNoExt(filePath), show_error: true }),
  });
  return { webUri, url: cdnUrl };
}
