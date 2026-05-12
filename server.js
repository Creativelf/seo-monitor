import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const root = new URL("./public/", import.meta.url);
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const maxBytes = 1024 * 1024 * 2;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data));
}

function normalizeTarget(input) {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("只支持 HTTP 或 HTTPS 地址");
  }
  return url;
}

function fetchPage(targetUrl, redirects = 0) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const client = targetUrl.protocol === "http:" ? http : https;
    const request = client.get(targetUrl, {
      timeout: 12000,
      headers: {
        "user-agent": "SEO-Monitor/1.0 (+local audit tool)",
        "accept": "text/html,application/xhtml+xml"
      }
    }, (response) => {
      const chunks = [];
      let size = 0;

      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location && redirects < 4) {
        response.resume();
        const nextUrl = new URL(response.headers.location, targetUrl);
        fetchPage(nextUrl, redirects + 1).then((nextPage) => {
          resolve({
            ...nextPage,
            loadTimeMs: Date.now() - startedAt
          });
        }, reject);
        return;
      }

      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error("页面超过 2MB，已停止读取"));
          return;
        }
        chunks.push(chunk);
      });

      response.on("end", () => {
        resolve({
          html: Buffer.concat(chunks).toString("utf8"),
          statusCode: response.statusCode || 0,
          headers: response.headers,
          finalUrl: targetUrl.toString(),
          loadTimeMs: Date.now() - startedAt,
          bytes: size
        });
      });
    });

    request.on("timeout", () => request.destroy(new Error("请求超时")));
    request.on("error", reject);
  });
}

function attr(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(pattern);
  return match ? decodeEntities(match[2] || match[3] || match[4] || "") : "";
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textBetween(html, tagName) {
  const match = html.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? stripTags(match[1]).trim().replace(/\s+/g, " ") : "";
}

function stripTags(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "));
}

function collectTags(html, tagName) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi"))].map((match) => match[0]);
}

function metaContent(html, name) {
  const metas = collectTags(html, "meta");
  const lowerName = name.toLowerCase();
  const found = metas.find((tag) => attr(tag, "name").toLowerCase() === lowerName || attr(tag, "property").toLowerCase() === lowerName);
  return found ? attr(found, "content").trim() : "";
}

function linkHref(html, relName) {
  const links = collectTags(html, "link");
  const found = links.find((tag) => attr(tag, "rel").toLowerCase().split(/\s+/).includes(relName));
  return found ? attr(found, "href").trim() : "";
}

function scoreMetric(condition, points) {
  return condition ? points : 0;
}

function analyzePage(page, requestedUrl) {
  const html = page.html;
  const title = textBetween(html, "title");
  const description = metaContent(html, "description");
  const robots = metaContent(html, "robots");
  const canonical = linkHref(html, "canonical");
  const viewport = metaContent(html, "viewport");
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => stripTags(match[1]).trim().replace(/\s+/g, " ")).filter(Boolean);
  const imageTags = collectTags(html, "img");
  const imagesTotal = imageTags.length;
  const imagesMissingAlt = imageTags.filter((tag) => !attr(tag, "alt").trim()).length;
  const anchors = collectTags(html, "a");
  const internalLinks = anchors.filter((tag) => {
    const href = attr(tag, "href");
    return href && !/^https?:\/\//i.test(href);
  }).length;
  const externalLinks = anchors.length - internalLinks;
  const words = stripTags(html).trim().split(/\s+/).filter(Boolean).length;
  const hasNoindex = /\bnoindex\b/i.test(robots);
  const titleOk = title.length >= 10 && title.length <= 60;
  const descriptionOk = description.length >= 50 && description.length <= 160;
  const h1Ok = h1s.length === 1;
  const statusOk = page.statusCode >= 200 && page.statusCode < 400;
  const loadOk = page.loadTimeMs <= 2500;
  const imageAltOk = imagesTotal === 0 || imagesMissingAlt === 0;

  const score = Math.min(100,
    scoreMetric(statusOk, 18) +
    scoreMetric(titleOk, 14) +
    scoreMetric(descriptionOk, 14) +
    scoreMetric(h1Ok, 12) +
    scoreMetric(Boolean(canonical), 9) +
    scoreMetric(Boolean(viewport), 8) +
    scoreMetric(!hasNoindex, 10) +
    scoreMetric(loadOk, 8) +
    scoreMetric(imageAltOk, 7)
  );

  const issues = [];
  if (!statusOk) issues.push({ level: "high", text: `页面状态码为 ${page.statusCode}，搜索引擎可能无法稳定抓取。` });
  if (!title) issues.push({ level: "high", text: "缺少 title 标签。" });
  else if (!titleOk) issues.push({ level: "medium", text: `title 长度为 ${title.length}，建议控制在 10-60 个字符。` });
  if (!description) issues.push({ level: "medium", text: "缺少 meta description。" });
  else if (!descriptionOk) issues.push({ level: "medium", text: `description 长度为 ${description.length}，建议控制在 50-160 个字符。` });
  if (h1s.length === 0) issues.push({ level: "high", text: "缺少 H1 标题。" });
  if (h1s.length > 1) issues.push({ level: "medium", text: `发现 ${h1s.length} 个 H1，建议保留一个核心 H1。` });
  if (!canonical) issues.push({ level: "low", text: "缺少 canonical 链接，重复页面风险更高。" });
  if (!viewport) issues.push({ level: "low", text: "缺少 viewport，移动端体验可能受影响。" });
  if (hasNoindex) issues.push({ level: "high", text: "robots meta 包含 noindex，页面不会被索引。" });
  if (!loadOk) issues.push({ level: "medium", text: `加载耗时 ${page.loadTimeMs}ms，建议压到 2500ms 以内。` });
  if (!imageAltOk) issues.push({ level: "low", text: `${imagesMissingAlt}/${imagesTotal} 张图片缺少 alt。` });

  return {
    url: requestedUrl,
    finalUrl: page.finalUrl,
    checkedAt: new Date().toISOString(),
    score,
    statusCode: page.statusCode,
    loadTimeMs: page.loadTimeMs,
    bytes: page.bytes,
    title,
    titleLength: title.length,
    description,
    descriptionLength: description.length,
    h1Count: h1s.length,
    h1: h1s[0] || "",
    canonical,
    robots: robots || "未设置",
    viewport: Boolean(viewport),
    words,
    imagesTotal,
    imagesMissingAlt,
    internalLinks,
    externalLinks,
    issues
  };
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url || "/", `http://${req.headers.host}`).pathname;
  const safePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const fileUrl = new URL(safePath, root);
  if (!fileUrl.href.startsWith(root.href)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(fileUrl);
    const ext = extname(fileUrl.pathname);
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "GET" && requestUrl.pathname === "/api/check") {
    try {
      const input = requestUrl.searchParams.get("url") || "";
      if (!input.trim()) {
        sendJson(res, 400, { error: "请输入要检测的网址" });
        return;
      }
      const targetUrl = normalizeTarget(input.trim());
      const page = await fetchPage(targetUrl);
      sendJson(res, 200, analyzePage(page, targetUrl.toString()));
    } catch (error) {
      sendJson(res, 500, { error: error.message || "检测失败" });
    }
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(port, host, () => {
  console.log(`SEO monitor running at http://${host}:${port}`);
});
