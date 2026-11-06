// Bilibili, for personal use. The catalog is what its website asks its API
// for: a search, the popular list and the music ranking. A video's audio is
// DASH, AAC in an MP4, which the app doesn't decode, so ffmpeg turns it into
// the MP3 the app plays and serves that on a loopback address. The CDN only
// answers a request that carries a bilibili.com Referer and a desktop
// browser's User-Agent, so ffmpeg is given both. Signing in is a QR code on
// Bilibili's own page, which the Bilibili app scans.

const api = "https://api.bilibili.com";
// Every text the listener reads goes through the host, so the plugin speaks
// the listener's language: the keys here are English, locales/zh-CN.json has
// the Chinese for them.
const t = (text) => host.t(text);

const site = "https://www.bilibili.com";
const loginPage = "https://passport.bilibili.com/login";
const suggestSite = "https://s.search.bilibili.com";

// What Bilibili's pages are asked with. A request without it, or with one it
// doesn't know, is answered with its risk control page instead of the API.
const desktopUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// The sign-in page is told it's in a browser, as it may turn down what it
// takes for a page inside an app.
const browserUA =
  host.platform === "darwin"
    ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15"
    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

// The order Bilibili shuffles its two keys in to sign a request with.
const mixinTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// What Bilibili answered when it decided this wasn't a person, or a browser.
// The visitor id it turned down goes, so the next call asks for a new one.
function riskControl(what) {
  visitor = null;
  return fail(
    "unavailable",
    `${t("Bilibili blocked this request as automated")} (${what}). ${t("Try again in a moment.")}`,
  );
}

// The session's cookies, as a Cookie header, kept in the plugin's storage.
const cookie = () => host.storage.get("cookie") || "";

function cookieValue(header, name) {
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return "";
}

// Who the session is, once it's been asked.
let account_ = undefined;

function endSession() {
  host.storage.remove("cookie");
  account_ = undefined;
}

// What a visitor is given, so that a request without a session still looks
// like one from a browser Bilibili has seen before. Every call the risk
// control answers is answered again with a new one.
let visitor = null;

async function visitorIds() {
  if (visitor) return visitor;
  // Asked for without cookies: it's what the cookies are asked for with.
  const data = await call(`${api}/x/frontend/finger/spi`, { bare: true });
  visitor = { b3: data?.b_3 || "", b4: data?.b_4 || "" };
  return visitor;
}

async function cookieHeader() {
  const session = cookie();
  const parts = session ? [session] : [];
  const v = await visitorIds();
  if (v.b3 && !cookieValue(session, "buvid3")) parts.push(`buvid3=${v.b3}`);
  if (v.b4 && !cookieValue(session, "buvid4")) parts.push(`buvid4=${v.b4}`);
  return parts.join("; ");
}

// A request's answer, as the data it holds, or the reason it holds none.
// A page of Bilibili's risk control comes back as HTTP 412 with HTML in it,
// not as the API's JSON, and some of its refusals are a code instead.
async function call(url, opt = {}, retried = false) {
  const headers = {
    "user-agent": desktopUA,
    referer: `${site}/`,
    origin: site,
    accept: "application/json, text/plain, */*",
  };
  const cookies = opt.bare ? cookie() : await cookieHeader();
  if (cookies) headers.cookie = cookies;
  const init = { method: opt.method || "GET", headers };
  if (opt.body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    init.body = opt.body;
  }
  const res = await fetch(url, init);
  if (res.status === 412) {
    // A fresh visitor id may be what it wanted. One more go, then it's a wall.
    if (!retried) {
      visitor = null;
      return call(url, opt, true);
    }
    throw riskControl("HTTP 412");
  }
  if (res.status === 429) throw fail("unavailable", t("Bilibili asked to slow down: too many requests just now"));
  const text = await res.text();
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    throw fail("unavailable", `${t("Bilibili answered with something other than its API")} (${res.status})`);
  }
  if (answer.code === -412 || answer.code === -352) {
    if (!retried) {
      visitor = null;
      return call(url, opt, true);
    }
    throw riskControl(String(answer.code));
  }
  if (answer.code === -101) {
    // Not signed in, which is an answer for the few calls that ask.
    if (opt.allowSignedOut) return answer.data ?? null;
    if (cookie()) {
      endSession();
      throw fail("signIn", t("The sign-in has expired. Scan the QR code again."));
    }
    throw fail("signIn", t("This one needs a sign-in: press Sign In and scan the QR code with Bilibili."));
  }
  if (answer.code !== 0) {
    throw fail(
      "unavailable",
      `${t("Bilibili said")}: ${answer.message || t("something went wrong")} (${answer.code})`,
    );
  }
  // Most of its answers keep what they hold in data. A search suggestion is
  // one of the few that don't, and is asked for whole.
  return opt.whole ? answer : (answer.data ?? null);
}

// The keys a request is signed with, from the site itself. They change now
// and then, so they're kept for an hour only.
let signed = null;

async function signingKey() {
  if (signed && Date.now() - signed.at < 3600 * 1000) return signed.key;
  const nav = await call(`${api}/x/web-interface/nav`, { allowSignedOut: true });
  const img = nameOf(nav?.wbi_img?.img_url);
  const sub = nameOf(nav?.wbi_img?.sub_url);
  const source = img + sub;
  const key = mixinTab.map((n) => source[n]).join("").slice(0, 32);
  if (key.length < 32) return "";
  signed = { key, at: Date.now() };
  return key;
}

function nameOf(url) {
  const name = String(url || "").split("/").pop() || "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

// The query a signed request sends: the parameters in order, the time, and
// the digest of both with the key.
async function signedQuery(params) {
  const key = await signingKey();
  const all = { ...params, wts: Math.round(Date.now() / 1000) };
  const query = Object.keys(all)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ""))}`)
    .join("&");
  return key ? `${query}&w_rid=${host.crypto.md5(query + key)}` : query;
}

async function apiCall(path, params = {}, opt = {}) {
  const query = opt.sign ? await signedQuery(params) : new URLSearchParams(params).toString();
  return call(query ? `${api}${path}?${query}` : `${api}${path}`, opt);
}

// What a video is called, on the page that plays it, and who uploaded it.

function text(s) {
  return String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#39;/g, "'")
    .trim();
}

function picture(url) {
  const u = String(url || "");
  if (!u) return "";
  if (u.startsWith("//")) return `https:${u}`;
  return u.replace(/^http:/, "https:");
}

// Bilibili says a length either as seconds or as the "m:ss" its pages show.
function milliseconds(duration) {
  if (typeof duration === "number") return Math.round(duration * 1000);
  const parts = String(duration ?? "").split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return Math.round(parts.reduce((sum, n) => sum * 60 + n, 0) * 1000);
}

// The section a video was first listed in, which is the album a Bilibili
// video has: it has no album of its own.
const seen = new Map();

function trackOf(video, source) {
  const id = video.bvid;
  if (!seen.has(id)) {
    seen.set(id, source);
    if (seen.size > 500) seen.delete(seen.keys().next().value);
  }
  const uploader = text(video.owner?.name || video.author || "");
  const mid = video.owner?.mid ?? video.mid ?? "";
  return {
    id,
    name: text(video.title),
    artists: uploader ? [{ id: String(mid), name: uploader }] : [],
    album: { id: `bilibili:${id}`, name: seen.get(id), imageUrl: picture(video.pic) },
    duration: milliseconds(video.duration),
    url: `${site}/video/${id}`,
  };
}

// Lists.

async function popularTracks(count = 20) {
  const data = await apiCall("/x/web-interface/popular", { ps: count, pn: 1 });
  return (data?.list || []).map((v) => trackOf(v, t("Trending")));
}

async function rankTracks() {
  const data = await apiCall("/x/web-interface/ranking/v2", { rid: 3, type: "all" });
  return (data?.list || []).map((v) => trackOf(v, t("Charts")));
}

export async function home() {
  const [popular, rank] = await Promise.all([popularTracks(), rankTracks()]);
  return {
    title: t("Bilibili"),
    sections: [
      { title: t("Trending"), tracks: popular },
      { title: t("Charts"), tracks: rank },
    ],
  };
}

export async function browse({ page }) {
  if (page === "rank")
    return { title: t("Charts"), sections: [{ title: t("Music charts"), tracks: await rankTracks() }] };
  if (page === "popular")
    return { title: t("Trending"), sections: [{ title: t("Trending"), tracks: await popularTracks() }] };
  throw fail("unavailable", `${t("No such page")}: ${page}`);
}

// Search. Only videos are tracks here: Bilibili has no albums and no artists'
// own pages to give the app.
export async function search({ query, kind, offset }) {
  if (kind !== "tracks") return { [kind]: [], more: false };
  const page = Math.floor(Math.max(0, offset || 0) / 20) + 1;
  const data = await apiCall(
    "/x/web-interface/wbi/search/type",
    { search_type: "video", keyword: query, page, page_size: 20 },
    { sign: true },
  );
  // It answers a request it doesn't trust with a voucher and no results,
  // which is its risk control saying so without an error code.
  if (data?.v_voucher && !data.result) throw riskControl("v_voucher");
  const tracks = (data?.result || []).map((v) => trackOf(v, t("Search")));
  return { tracks, more: tracks.length === 20 && page < (data?.numPages || 1) };
}

export async function suggest({ query }) {
  const data = await call(`${suggestSite}/main/suggest?${new URLSearchParams({ term: query, main_ver: "v1" })}`, {
    whole: true,
  });
  return (data?.result?.tag || []).map((s) => text(s.value || s.term)).filter(Boolean);
}

// Someone's account, which is who the session says it is.

export async function account() {
  if (account_ !== undefined) return account_;
  if (!cookie()) return null;
  const data = await call(`${api}/x/web-interface/nav`, { allowSignedOut: true });
  account_ = data?.isLogin ? { id: String(data.mid), name: text(data.uname), imageUrl: picture(data.face) } : null;
  return account_;
}

// Signing in is on Bilibili's own page, in a window of the app, with a QR
// code the Bilibili app scans. It's done once the page's cookies are the
// session's, which is SESSDATA and the one a request that changes something
// has to carry, bili_jct.
export async function signIn() {
  const { cookie: session } = await host.webSignIn({
    url: loginPage,
    cookiesOf: site,
    until: ["SESSDATA", "bili_jct"],
    userAgent: browserUA,
  });
  if (!session || !cookieValue(session, "SESSDATA")) throw fail("signIn", t("No Bilibili sign-in cookie came back. Scan the QR code again."));
  host.storage.set("cookie", session);
  account_ = undefined;
  const me = await account();
  if (!me) {
    endSession();
    throw fail("signIn", t("Bilibili did not accept this sign-in. Scan the QR code again."));
  }
  return me;
}

export function signOut() {
  endSession();
}

// Liking a video is the like its page has, which a session can leave and
// take back.

export async function isLiked({ ids }) {
  const out = {};
  const list = (ids || []).filter(Boolean);
  if (!list.length || !cookie()) return out;
  const asked = list.slice(0, 60);
  for (let i = 0; i < asked.length; i += 5) {
    const answers = await Promise.all(
      asked.slice(i, i + 5).map(async (id) => {
        try {
          const data = await apiCall("/x/web-interface/archive/has/like", { bvid: id });
          return [id, Number(data) === 1];
        } catch (e) {
          if (e.code === "signIn") throw e;
          return [id, false];
        }
      }),
    );
    for (const [id, liked] of answers) out[id] = liked;
  }
  return out;
}

export async function like({ id, on }) {
  if (!cookie()) throw fail("signIn", t("Liking needs a Bilibili sign-in first."));
  const csrf = cookieValue(cookie(), "bili_jct");
  if (!csrf) throw fail("signIn", t("This sign-in has no bili_jct. Scan the QR code again."));
  const info = await apiCall("/x/web-interface/wbi/view", { bvid: id }, { sign: true });
  if (!info?.aid) throw fail("unavailable", `找不到这个视频：${id}`);
  const body = new URLSearchParams({ aid: String(info.aid), like: on ? "1" : "2", csrf });
  await call(`${api}/x/web-interface/archive/like`, { method: "POST", body: body.toString() });
}

// Bilibili has no timed words to give.

export async function lyrics() {
  return {};
}

// Playing.

const cids = new Map();
const audios = new Map();
const audioLives = 10 * 60 * 1000;

async function cidOf(bvid) {
  const known = cids.get(bvid);
  if (known) return known;
  const pages = await apiCall("/x/player/pagelist", { bvid });
  const first = (pages || [])[0];
  if (!first?.cid) throw fail("unavailable", `这个视频没有音轨：${bvid}`);
  cids.set(bvid, first.cid);
  return first.cid;
}

// The audio streams a video is served as, of which the best is taken: the
// lossless one when it has it, then the highest bitrate.
async function audioOf(bvid) {
  const known = audios.get(bvid);
  if (known && Date.now() - known.at < audioLives) return known;
  const cid = await cidOf(bvid);
  const data = await apiCall("/x/player/wbi/playurl", { bvid, cid, fnval: 16, fnver: 0, fourk: 1 }, { sign: true });
  const dash = data?.dash;
  if (!dash && data?.v_voucher) throw riskControl("v_voucher");
  const streams = [
    ...(dash?.flac?.audio ? [dash.flac.audio] : []),
    ...(dash?.dolby?.audio ? (Array.isArray(dash.dolby.audio) ? dash.dolby.audio : [dash.dolby.audio]) : []),
    ...(dash?.audio || []),
  ].filter((a) => a?.baseUrl || a?.base_url);
  if (!streams.length) throw fail("unavailable", t("This video has no audio track to play."));
  streams.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
  const best = { url: streams[0].baseUrl || streams[0].base_url, at: Date.now(), bandwidth: streams[0].bandwidth || 0 };
  audios.set(bvid, best);
  if (audios.size > 50) audios.delete(audios.keys().next().value);
  return best;
}

const installed = {};

async function program(name, versionFlag) {
  if (installed[name]) return installed[name];
  const places = [name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`];
  for (const path of places) {
    try {
      const proc = host.spawn(path, [versionFlag]);
      proc.closeStdin();
      while ((await proc.readLine()) !== null) {}
      if ((await proc.wait()) === 0) {
        installed[name] = path;
        return path;
      }
    } catch (e) {
      if (/allowed/.test(e.message)) throw fail("setup", t("Allow Bilibili to start programs in the plugin settings."));
    }
  }
  return null;
}

// ffmpeg serves the MP3 itself, to the one request that comes for it, so a
// track starts before all of it is there. No more than a few wait at a time.
const serving = [];
const servingAtMost = 3;
const servedWithin = 10 * 60 * 1000;

async function serve(audioUrl, bitRate) {
  const ffmpeg = await program("ffmpeg", "-version");
  if (!ffmpeg) throw fail("setup", t("Playing needs ffmpeg: install it with brew install ffmpeg, or put it on PATH."));
  while (serving.length >= servingAtMost) serving.shift().kill();
  const port = 20000 + Math.floor(Math.random() * 40000);
  const proc = host.spawn(ffmpeg, [
    "-nostdin", "-hide_banner", "-nostats",
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-rw_timeout", "15000000",
    // What the CDN checks before it answers: the page the request would be
    // from, and a browser it knows.
    "-headers", `Referer: ${site}/\r\nUser-Agent: ${desktopUA}\r\n`,
    "-i", audioUrl,
    "-vn", "-c:a", "libmp3lame", "-b:a", `${bitRate}k`, "-id3v2_version", "0", "-write_xing", "0",
    "-f", "mp3", "-listen", "1", `http://127.0.0.1:${port}/`,
  ]);
  proc.closeStdin();
  let stopped = false;
  serving.push(proc);
  const timer = setTimeout(() => proc.kill(), servedWithin);
  proc.wait().then(() => {
    stopped = true;
    clearTimeout(timer);
    const at = serving.indexOf(proc);
    if (at >= 0) serving.splice(at, 1);
  });
  // It says what it's reading right before it opens the port. Trying the port
  // isn't a way to find out: it would take the one request ffmpeg answers.
  const until = Date.now() + 20000;
  while (!proc.errorOutput().includes("Input #0")) {
    if (stopped) throw new Error(`ffmpeg 停了：${proc.errorOutput().trim().split("\n").pop()}`);
    if (Date.now() > until) {
      proc.kill();
      throw new Error(t("The audio did not start"));
    }
    await sleep(30);
  }
  await sleep(100);
  return `http://127.0.0.1:${port}/`;
}

export async function stream({ id, quality }) {
  const bitRate = quality === "standard" ? 128 : 192;
  let audio = await audioOf(id);
  let url;
  try {
    url = await serve(audio.url, bitRate);
  } catch (e) {
    // An address stops working, or the CDN turns down one it gave out a
    // moment ago: ask for a new one before giving up.
    if (e.code === "setup") throw e;
    audios.delete(id);
    audio = await audioOf(id);
    url = await serve(audio.url, bitRate);
  }
  return { url, type: "mp3", quality: bitRate === 128 ? "standard" : "high", bitRate: bitRate * 1000 };
}
