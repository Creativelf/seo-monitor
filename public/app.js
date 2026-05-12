const storageKey = "seo-monitor-sites";
const form = document.querySelector("#siteForm");
const input = document.querySelector("#urlInput");
const siteList = document.querySelector("#siteList");
const checkAllBtn = document.querySelector("#checkAllBtn");
const exportBtn = document.querySelector("#exportBtn");
const toast = document.querySelector("#toast");

const state = {
  activeUrl: "",
  sites: loadSites()
};

if (state.sites.length === 0) {
  state.sites = [
    { url: "https://example.com", history: [] }
  ];
  state.activeUrl = state.sites[0].url;
  saveSites();
} else {
  state.activeUrl = state.sites[0].url;
}

render();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = normalizeUrl(input.value);
  if (!url) return;
  if (!state.sites.some((site) => site.url === url)) {
    state.sites.unshift({ url, history: [] });
  }
  state.activeUrl = url;
  input.value = "";
  saveSites();
  render();
  await checkSite(url);
});

checkAllBtn.addEventListener("click", async () => {
  if (state.sites.length === 0) return;
  for (const site of state.sites) {
    await checkSite(site.url, false);
  }
  showToast("全部站点检测完成");
});

exportBtn.addEventListener("click", () => {
  const rows = [["url", "checkedAt", "score", "statusCode", "loadTimeMs", "title", "descriptionLength", "h1Count", "issues"]];
  state.sites.forEach((site) => {
    site.history.forEach((item) => {
      rows.push([
        site.url,
        item.checkedAt,
        item.score,
        item.statusCode,
        item.loadTimeMs,
        item.title,
        item.descriptionLength,
        item.h1Count,
        item.issues.length
      ]);
    });
  });
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `seo-monitor-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function loadSites() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "[]");
  } catch {
    return [];
  }
}

function saveSites() {
  localStorage.setItem(storageKey, JSON.stringify(state.sites));
}

async function checkSite(url, announce = true) {
  const site = state.sites.find((item) => item.url === url);
  if (!site) return;
  site.loading = true;
  render();
  try {
    const response = await fetch(`/api/check?url=${encodeURIComponent(url)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "检测失败");
    site.history.unshift(result);
    site.history = site.history.slice(0, 12);
    if (announce) showToast(`${hostName(url)} 检测完成，得分 ${result.score}`);
  } catch (error) {
    showToast(`${hostName(url)} 检测失败：${error.message}`);
  } finally {
    site.loading = false;
    saveSites();
    render();
  }
}

function removeSite(url) {
  const index = state.sites.findIndex((site) => site.url === url);
  if (index < 0) return;
  state.sites.splice(index, 1);
  if (state.activeUrl === url) {
    state.activeUrl = state.sites[0]?.url || "";
  }
  saveSites();
  render();
}

function render() {
  renderSiteList();
  renderDetail(activeSite());
}

function activeSite() {
  return state.sites.find((site) => site.url === state.activeUrl) || state.sites[0];
}

function latest(site) {
  return site?.history?.[0];
}

function renderSiteList() {
  siteList.innerHTML = "";
  if (state.sites.length === 0) {
    siteList.innerHTML = `<div class="empty">还没有站点</div>`;
    return;
  }

  state.sites.forEach((site) => {
    const last = latest(site);
    const item = document.createElement("div");
    item.className = `site-item ${site.url === state.activeUrl ? "active" : ""}`;
    item.innerHTML = `
      <div class="site-title">
        <button class="site-url" type="button" data-select="${escapeHtml(site.url)}">${escapeHtml(hostName(site.url))}</button>
        <span class="mini-score">${site.loading ? "..." : last ? last.score : "--"}</span>
      </div>
      <div class="site-actions">
        <button class="check-btn" type="button" data-check="${escapeHtml(site.url)}">检测</button>
        <button class="remove-btn" type="button" data-remove="${escapeHtml(site.url)}" title="删除">x</button>
      </div>
    `;
    siteList.appendChild(item);
  });

  siteList.querySelectorAll("[data-select]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeUrl = button.dataset.select;
      render();
    });
  });
  siteList.querySelectorAll("[data-check]").forEach((button) => {
    button.addEventListener("click", () => checkSite(button.dataset.check));
  });
  siteList.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => removeSite(button.dataset.remove));
  });
}

function renderDetail(site) {
  const data = latest(site);
  document.querySelector("#pageTitle").textContent = site ? hostName(site.url) : "选择或添加站点";
  document.querySelector("#statusPill").textContent = site?.loading ? "检测中" : data ? healthLabel(data.score) : "待检测";
  document.querySelector("#scoreValue").textContent = data ? data.score : "--";
  document.querySelector("#scoreRing").style.setProperty("--score", data ? data.score : 0);
  document.querySelector("#scoreRing").style.setProperty("--score-color", scoreColor(data?.score || 0));
  document.querySelector("#scoreHint").textContent = data ? `${data.finalUrl}，最后检测 ${formatTime(data.checkedAt)}` : "添加网址后会检查标题、描述、H1、canonical、移动端、索引状态和速度。";
  document.querySelector("#statusCode").textContent = data?.statusCode ?? "--";
  document.querySelector("#loadTime").textContent = data ? `${data.loadTimeMs}ms` : "--";
  document.querySelector("#wordCount").textContent = data?.words ?? "--";
  renderMetrics(data);
  renderIssues(data);
  renderHistory(site);
}

function renderMetrics(data) {
  const container = document.querySelector("#metricsTable");
  if (!data) {
    container.innerHTML = `<div class="empty">暂无检测结果</div>`;
    return;
  }

  const rows = [
    ["Title", data.title || "缺失", `${data.titleLength} 字符`, data.titleLength >= 10 && data.titleLength <= 60],
    ["Description", data.description || "缺失", `${data.descriptionLength} 字符`, data.descriptionLength >= 50 && data.descriptionLength <= 160],
    ["H1", data.h1 || "缺失", `${data.h1Count} 个`, data.h1Count === 1],
    ["Canonical", data.canonical || "缺失", "", Boolean(data.canonical)],
    ["Robots", data.robots, "", !/noindex/i.test(data.robots)],
    ["移动端", data.viewport ? "已设置 viewport" : "缺失 viewport", "", data.viewport],
    ["图片 Alt", `${data.imagesMissingAlt}/${data.imagesTotal} 缺失`, "", data.imagesTotal === 0 || data.imagesMissingAlt === 0],
    ["链接", `内链 ${data.internalLinks}，外链 ${data.externalLinks}`, "", true]
  ];

  container.innerHTML = rows.map(([name, value, note, good]) => `
    <div class="metric-row">
      <div class="metric-name">${name}</div>
      <div class="metric-value">${escapeHtml(String(value))}</div>
      <div class="metric-note">
        ${note ? escapeHtml(String(note)) : ""}
        <span class="badge ${good ? "good" : "warn"}">${good ? "正常" : "关注"}</span>
      </div>
    </div>
  `).join("");
}

function renderIssues(data) {
  const count = data?.issues?.length || 0;
  document.querySelector("#issueCount").textContent = `${count} 项`;
  const container = document.querySelector("#issues");
  if (!data) {
    container.innerHTML = `<div class="empty">检测后会显示问题</div>`;
    return;
  }
  if (count === 0) {
    container.innerHTML = `<div class="empty">没有发现明显问题</div>`;
    return;
  }
  container.innerHTML = data.issues.map((issue) => `
    <div class="issue ${issue.level}">${escapeHtml(issue.text)}</div>
  `).join("");
}

function renderHistory(site) {
  const chart = document.querySelector("#historyChart");
  const history = site?.history || [];
  document.querySelector("#historyMeta").textContent = history.length ? `${history.length} 次记录` : "暂无记录";
  if (history.length === 0) {
    chart.innerHTML = `<div class="empty">暂无趋势数据</div>`;
    return;
  }
  chart.innerHTML = [...history].reverse().map((item) => `
    <div class="bar" style="--value: ${item.score}" title="${formatTime(item.checkedAt)}">
      <span>${item.score}</span>
    </div>
  `).join("");
}

function hostName(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function healthLabel(score) {
  if (score >= 85) return "健康";
  if (score >= 65) return "需优化";
  return "风险";
}

function scoreColor(score) {
  if (score >= 85) return "#1d9a6c";
  if (score >= 65) return "#c77700";
  return "#c43d3d";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
