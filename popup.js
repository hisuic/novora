// ====== 設定（定数） ======
const MAX_STORE   = 1000;   // 保存上限
const TIMEOUT_MS  = 12000;  // fetch タイムアウト
const TOP_N       = 40;     // ポップアップで表示する件数（拡大）

// ====== DOM ======
const list = document.getElementById("list");
const foot = document.getElementById("foot");
const btn  = document.getElementById("refresh");

// ====== ユーティリティ ======
const withTimeout = (p, ms = TIMEOUT_MS) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

function relTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function safeTime(s) {
  const t = Date.parse(s || "");
  return Number.isFinite(t) ? t : Date.now();
}

// ====== フィード設定の読み込み ======
async function loadFeedsConfig() {
  // 1) ユーザーの feeds.json を優先
  try {
    const res1 = await fetch(chrome.runtime.getURL("feeds.json"), { cache: "no-store" });
    if (res1.ok) return await res1.json();
  } catch (_) {}

  // 2) 同梱の feeds.example.json にフォールバック
  try {
    const res2 = await fetch(chrome.runtime.getURL("feeds.example.json"), { cache: "no-store" });
    if (res2.ok) return await res2.json();
  } catch (_) {}

  // 3) それでもダメなら内蔵デフォルト
  return [
    { name: "ITmedia AIT",      url: "https://rss.itmedia.co.jp/rss/2.0/ait.xml" },
    { name: "Publickey",        url: "https://www.publickey1.jp/atom.xml" },
    { name: "Internet Watch",   url: "https://internet.watch.impress.co.jp/data/rss/iw.xml" },
    { name: "PC Watch",         url: "https://pc.watch.impress.co.jp/data/rss/pcw.xml" },
    { name: "TechCrunch",       url: "https://techcrunch.com/feed/" },
    { name: "GIGAZINE",         url: "https://gigazine.net/news/rss_2.0/" }
  ];
}

// ====== RSS/Atom パース ======
function parseFeed(xmlText, source) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const out = [];

  // RSS 2.0 / RDF
  doc.querySelectorAll("channel > item, item").forEach((item) => {
    const title = item.querySelector("title")?.textContent?.trim() || "(no title)";
    const link =
      item.querySelector("link")?.textContent?.trim() ||
      item.querySelector("link")?.getAttribute?.("href") || "";
    const pub = item.querySelector("pubDate, dc\\:date, date")?.textContent?.trim();
    const guid = item.querySelector("guid")?.textContent?.trim();
    const id = guid || link || title;
    if (title && link) {
      out.push({ id, source, title, link, publishedAt: safeTime(pub) });
    }
  });

  // Atom
  doc.querySelectorAll("feed > entry").forEach((en) => {
    const title = en.querySelector("title")?.textContent?.trim() || "(no title)";
    const link =
      en.querySelector("link[rel='alternate']")?.getAttribute("href") ||
      en.querySelector("link")?.getAttribute?.("href") || "";
    const updated =
      en.querySelector("updated")?.textContent?.trim() ||
      en.querySelector("published")?.textContent?.trim();
    const id = en.querySelector("id")?.textContent?.trim() || link || title;
    if (title && link) {
      out.push({ id, source, title, link, publishedAt: safeTime(updated) });
    }
  });

  return out;
}

// ====== 描画 ======
function render(items = [], lastUpdated = 0) {
  list.innerHTML = "";

  const top = items.slice(0, TOP_N);

  if (top.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "まだ記事がありません。Refresh を押すか、数秒待ってください。";
    list.appendChild(li);
  } else {
    for (const it of top) {
      // <li><a>...</a></li>
      const li = document.createElement("li");
      const a  = document.createElement("a");
      a.href = it.link;
      a.target = "_blank";
      a.rel = "noopener";

      // title
      const titleEl = document.createElement("div");
      titleEl.className = "title";
      titleEl.textContent = it.title;

      // meta: source badge + time
      const meta = document.createElement("div");
      meta.className = "meta";

      const src = document.createElement("span");
      src.className = "source";           // ← CSSのチップ化を効かせる
      src.textContent = it.source || "";

      const time = document.createElement("span");
      time.className = "stamp";           // ← 等幅数字などの装飾を効かせる
      time.textContent = relTime(it.publishedAt);

      meta.appendChild(src);
      meta.appendChild(time);

      a.appendChild(titleEl);
      a.appendChild(meta);
      li.appendChild(a);

      // 左クリックはバックグラウンドで開く（既存仕様を保持）
      li.addEventListener("click", async (e) => {
        if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault();
          try { await chrome.tabs.create({ url: it.link, active: false }); } catch(_) {}
        }
      });
      // 中クリック（auxiliaryclick）にも対応（念のため）
      li.addEventListener("auxclick", async (e) => {
        if (e.button === 1) {
          e.preventDefault();
          try { await chrome.tabs.create({ url: it.link, active: false }); } catch(_) {}
        }
      });

      list.appendChild(li);
    }
  }

  if (lastUpdated) {
    const d = new Date(lastUpdated);
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    foot.textContent = `Last updated: ${y}-${mm}-${dd} ${hh}:${mi}`;
  } else {
    foot.textContent = "";
  }
}

// ====== ストレージ I/O ======
async function loadItems() {
  const { items = [], lastUpdated = 0 } = await chrome.storage.local.get(["items", "lastUpdated"]);
  return { items, lastUpdated };
}

async function saveItems(items) {
  const unique = Array.from(
    new Map(items.map((it) => [(it.link || it.id), it])).values()
  ).sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));

  if (unique.length > MAX_STORE) unique.length = MAX_STORE;

  await chrome.storage.local.set({ items: unique, lastUpdated: Date.now() });
  return unique;
}

// ====== 取得（外部ファイルで定義されたフィードを利用） ======
async function fetchAllFeeds({ noCache = false } = {}) {
  const FEEDS = await loadFeedsConfig();

  const settled = await Promise.allSettled(
    FEEDS.map(async (f) => {
      try {
        const res = await withTimeout(
          fetch(f.url, { cache: noCache ? "reload" : "no-store" }),
          TIMEOUT_MS
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const txt = await res.text();
        return parseFeed(txt, f.name);
      } catch (e) {
        console.warn(`[feed fail] ${f.name}:`, e);
        return [];
      }
    })
  );

  return settled
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value);
}

async function refreshNow(opts = {}) {
  btn.disabled = true;
  try {
    const items = await fetchAllFeeds(opts);
    const saved = await saveItems(items);

    // 未読数更新（lastSeenAt より新しいものをカウント）
    const { lastSeenAt = 0 } = await chrome.storage.local.get(["lastSeenAt"]);
    const unread = saved.filter((it) => (it.publishedAt || 0) > (lastSeenAt || 0)).length;
    await chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 255] });
    await chrome.action.setBadgeText({ text: unread ? String(Math.min(unread, 99)) : "" });

    render(saved, Date.now());
  } finally {
    btn.disabled = false;
  }
}

// ====== 起動処理 ======
btn.addEventListener("click", () => refreshNow());

// キーボードショートカット：R で更新、Shift+R で “強めの更新”（キャッシュ無視）
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "r") {
    e.preventDefault();
    refreshNow({ noCache: e.shiftKey });
  }
});

(async () => {
  await chrome.storage.local.set({ lastSeenAt: Date.now() });
  await chrome.action.setBadgeText({ text: "" });

  const { items, lastUpdated } = await loadItems();
  render(items, lastUpdated);

  // 空なら即更新
  const hasItems = list.children.length > 0 && !list.querySelector(".empty");
  if (!hasItems) {
    await refreshNow();
  }
})();

