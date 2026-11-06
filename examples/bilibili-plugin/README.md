# Bilibili for MyGo Music

An example plugin that talks to a real service: it plays Bilibili videos as music in MyGo Music. It isn't affiliated with or endorsed by Bilibili. It asks Bilibili's own web API, which changes without notice, so it may stop working at any time.

## Install

Install ffmpeg. On macOS:

```bash
brew install ffmpeg
```

Copy this folder to the app's plugin folder, or install it from a repository. It needs the 0.1.8
plugin host or later, which is where `host.webSignIn` and the process permission come from. In Settings > Plugins, allow Bilibili to start programs.

## Signing in

Click **Sign In**. The app opens `https://passport.bilibili.com/login` in a window of its own and the page shows a QR code. Scan it with the Bilibili app on your phone, then confirm on the phone.

The window closes once the page holds `SESSDATA` and `bili_jct` for `https://www.bilibili.com`. The plugin keeps those cookies as one Cookie header in its storage, under `cookie`, and sends it on every call. Signing out forgets it. To end the session on Bilibili's side as well, sign out on the website.

Signed out, search, home, the two lists, and playback all work. Signing in adds your account name and likes.

## What works

- Home. Two lists: 热门 (what Bilibili features today) and 排行榜 (its music ranking).
- Browse. The pages 排行榜 and 热门.
- Search. Videos, as tracks, a page of 20 at a time.
- Playback. The audio of any public video, turned into MP3 as it plays.
- Likes. Reading whether a video is liked, and leaving or taking back a like.

## What doesn't

- Albums and artists. Bilibili has neither, so a search for them comes back empty.
- Timed lyrics. A Bilibili video has no timed words to show, so the lyrics view stays empty.
- A video of several parts plays its first part. Search returns the video, not its parts.
- Videos that need a paid membership, and videos blocked outside the region, answer with an error from Bilibili saying so.

A track's album is the section the video was first listed in during this session, such as 热门 or 搜索. That is the closest thing a Bilibili video has to an album, and it fills the line the app draws under a track.

## How it plays

The audio is DASH: AAC in an MP4, at around 192 kbps, and lossless FLAC for a video that has it and an account that can reach it. There is no MP3 to ask for, so the plugin fetches it and re-encodes it.

1. `GET /x/player/pagelist?bvid=BV...` gives the video's `cid`.
2. `GET /x/player/wbi/playurl?bvid=...&cid=...&fnval=16` gives the DASH streams. The plugin takes the best one: FLAC, then Dolby, then the highest bitrate AAC.
3. ffmpeg reads that URL, with `-headers "Referer: https://www.bilibili.com/\r\nUser-Agent: <desktop Chrome>\r\n"`, and serves libmp3lame MP3 on `http://127.0.0.1:<port>/`, the way the YouTube Music plugin serves its tracks. No more than three play at once, and each stops after ten minutes.

The CDN turns down a request without that Referer and User-Agent. ffmpeg is told both as one `-headers` argument, so it sends them with every range request. The audio URL expires after about two hours; the plugin asks for a new one rather than keeping it.

## The API, and what needed working around

- **wbi signing.** Search and playurl are signed: the keys come from `wbi_img` in `/x/web-interface/nav`, are shuffled by Bilibili's 64 entry table, and the first 32 characters are the key. Every parameter, sorted, plus `wts`, plus `w_rid = md5(query + key)`, goes in the query. The plugin keeps the key for an hour and gets a new one when it expires. `md5` comes from `host.crypto`, not from a copy in JavaScript.
- **A visitor id.** A request with no cookies at all is risk-controlled. `/x/frontend/finger/spi` hands out `buvid3` and `buvid4`, which the plugin adds to the Cookie header when the session doesn't already carry them.
- **Risk control, in three shapes.** Bilibili answers a request it doesn't like with HTTP 412 and an HTML page, with `code -412` or `-352` in its JSON, or with a `v_voucher` and no results. All three become one error with code `unavailable` and a message that says what happened. The plugin retries once with a fresh visitor id first, then reports it. It never crashes, and the next call works.
- **An ended session.** `code -101` while a session is stored means the cookies are stale. The plugin forgets them and asks for a new sign-in with code `signIn`.
- **Search suggestion.** `s.search.bilibili.com/main/suggest` answers in `result`, not in `data`, so it is the one call read whole.
- **Durations.** Search gives a length as `分:秒`, such as `419:2`, and the lists give it in seconds. Both become milliseconds.
- **Titles.** Search returns titles with `<em class="keyword">` around the words that matched. They're stripped, and the HTML entities decoded.

## Permissions

Network, to these hosts only:

- `api.bilibili.com`, where the API is.
- `passport.bilibili.com`, the sign-in page.
- `www.bilibili.com`, and the other `*.bilibili.com` hosts.
- `s.search.bilibili.com`, for search suggestions.
- `*.hdslb.com`, where covers are.

Process, to ffmpeg only: by name on the PATH, and at `/opt/homebrew/bin/ffmpeg` and `/usr/local/bin/ffmpeg`.

## Privacy

The Cookie header goes to Bilibili, and nowhere else. The audio URL, with its signature, goes to ffmpeg. The plugin keeps nothing but the Cookie header in its storage, and signing out removes it.
