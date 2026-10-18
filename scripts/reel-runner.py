#!/usr/bin/env python3
"""LittleLoop Reel Factory runner (agent id: littleloop_reel_factory).

Runs in GitHub Actions (.github/workflows/reels.yml). Each run:
  1. asks the Ganesha Worker for work (it plans today's reels with sheet rotation + daily cap),
  2. reads any new character sheet image and writes a detailed character bible (Gemini vision),
  3. writes a 2 x 10 s script for the claimed reel (Gemini, JSON, validated by the Worker),
  4. renders scene 1 (10 s, character sheet as reference) and scene 2 (10 s extension of the same
     interaction) with Gemini Omni Flash, then checks the result with ffprobe (9:16, ~20 s, audio),
  5. uploads the finished MP4 to the Worker, which shows it to the owner for approval.
Nothing is posted from here: Instagram publishing happens in the Worker after the owner approves.

Standard library only (+ ffmpeg/ffprobe, preinstalled on GitHub's ubuntu runners).
Env: GANESHA_URL, GANESHA_ADMIN_TOKEN, GEMINI_API_KEY; optional GEMINI_MODEL, OMNI_MODEL,
     OMNI_PRICE_INPUT, OMNI_PRICE_VIDEO_OUT (USD per 1M tokens), GEMINI_PRICE_PER_MTOK ("in,out").
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://generativelanguage.googleapis.com/v1beta"
TEXT_MODEL = (os.environ.get("GEMINI_MODEL") or "gemini-3.8-flash").strip()
OMNI_MODEL = (os.environ.get("OMNI_MODEL") or "gemini-omni-1.1-flash").strip()
# Gemini API pricing page (read 2026-10-18): Omni Flash $1.50 / 1M input, $17.50 / 1M video output.
OMNI_IN = float(os.environ.get("OMNI_PRICE_INPUT") or 1.5)
OMNI_OUT = float(os.environ.get("OMNI_PRICE_VIDEO_OUT") or 17.5)
OMNI_EST_PER_SEC = 0.10  # only used if the API returns no token usage; labelled "estimated"
MAX_UPLOAD = 24 * 1024 * 1024


class Fail(Exception):
    pass


def log(*a):
    print(*a, flush=True)


def env(name, required=True):
    v = (os.environ.get(name) or "").strip()
    if required and not v:
        raise Fail(f"{name} is not set")
    return v


def redact(text):
    out = str(text)
    for k in ("GEMINI_API_KEY", "GANESHA_ADMIN_TOKEN"):
        v = os.environ.get(k)
        if v:
            out = out.replace(v, "[redacted]")
    return out[:800]


def http(method, url, body=None, headers=None, timeout=120, raw=False):
    data = None
    h = dict(headers or {})
    if body is not None and not isinstance(body, (bytes, bytearray)):
        data = json.dumps(body).encode()
        h.setdefault("content-type", "application/json")
    elif body is not None:
        data = bytes(body)
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            payload = res.read()
            return payload if raw else (json.loads(payload) if payload else {})
    except urllib.error.HTTPError as e:
        detail = e.read()[:600].decode("utf-8", "replace")
        raise Fail(redact(f"HTTP {e.code} {method} {url.split('?')[0]}: {detail}")) from None
    except urllib.error.URLError as e:
        raise Fail(redact(f"{method} {url.split('?')[0]} failed: {e.reason}")) from None


# ---------------- Ganesha Worker API ----------------
def ganesha(method, path, body=None, headers=None, timeout=120, raw=False):
    h = {"authorization": f"Bearer {env('GANESHA_ADMIN_TOKEN')}"}
    h.update(headers or {})
    return http(method, env("GANESHA_URL").rstrip("/") + path, body, h, timeout, raw)


def usage(calls, reel_id=None):
    try:
        ganesha("POST", "/api/reels/runner/usage", {"reelId": reel_id, "calls": calls})
    except Fail as e:  # never lose the reel over a ledger write
        log("usage record failed:", e)


# ---------------- Gemini (text + vision) ----------------
def text_price():
    v = os.environ.get("GEMINI_PRICE_PER_MTOK")
    if not v:
        return None
    try:
        i, o = (float(x) for x in v.split(","))
        return i, o
    except ValueError:
        return None


def gemini_json(prompt, image=None, purpose="script", reel_id=None, max_tokens=8192):
    parts = []
    if image:
        parts.append({"inline_data": {"mime_type": image[1], "data": base64.b64encode(image[0]).decode()}})
    parts.append({"text": prompt})
    body = {"contents": [{"role": "user", "parts": parts}], "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": max_tokens, "temperature": 0.9}}
    t0 = time.time()
    try:
        res = http("POST", f"{API}/models/{TEXT_MODEL}:generateContent", body, {"x-goog-api-key": env("GEMINI_API_KEY")}, timeout=180)
    except Fail as e:
        usage([{"model": TEXT_MODEL, "purpose": purpose, "ok": False, "error": str(e), "latency_ms": int((time.time() - t0) * 1000)}], reel_id)
        raise
    um = res.get("usageMetadata") or {}
    tin = um.get("promptTokenCount")
    tout = (um.get("candidatesTokenCount") or 0) + (um.get("thoughtsTokenCount") or 0)
    price = text_price()
    cost = round((tin or 0) / 1e6 * price[0] + tout / 1e6 * price[1], 6) if price else None
    usage([{"model": TEXT_MODEL, "purpose": purpose, "input_tokens": tin, "output_tokens": tout, "cost_usd": cost, "latency_ms": int((time.time() - t0) * 1000)}], reel_id)
    cands = res.get("candidates") or []
    text = "".join(p.get("text", "") for p in ((cands[0].get("content") or {}).get("parts") or [])) if cands else ""
    if not text:
        raise Fail(f"Gemini returned no text (finishReason={cands[0].get('finishReason') if cands else 'none'})")
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`").split("\n", 1)[1] if "\n" in text else text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise Fail("Gemini did not return valid JSON")


SHEET_PROMPT = """You are LittleLoop's continuity supervisor. The image is an official character sheet for an
original animated character used in a kids' (age 2-8) Instagram Reels series.
Write a precise CHARACTER BIBLE that a video model can follow so the character looks identical in every clip.
Describe only what is visible; write "not shown" when unsure. Never invent a brand, logo or text.
Owner notes (trust these over your reading of the image): {notes}

Return JSON: {{"name": "...", "bible": "..."}} where bible is plain text (250-600 words) with these labelled lines:
Species/type & apparent age; Body proportions & height relative to others; Head & face shape; Eyes (shape, colour);
Eyebrows, nose, mouth, teeth; Hair/fur (style, colour, length); Skin/fur tone (with hex codes if clearly visible);
Outfit (each garment, colour, pattern); Shoes; Accessories/props; Signature expressions & poses; Personality as shown;
Art style (2D/3D, rendering, line work, shading, palette); DO-NOT-CHANGE list (8-12 items that must stay identical)."""

SCRIPT_PROMPT = """You are LittleLoop's head writer and director. LittleLoop makes original, safe, joyful animated
Instagram Reels for children aged 2-8 and their parents.

Today's character (use the attached character sheet image as the visual truth):
{bible}

Language for dialogue/narration: {language}
Owner's standing brief (follow it if not empty): {brief}
Avoid repeating these recent episode titles/ideas: {avoid}

Write ONE complete 20-second vertical (9:16) reel made of exactly TWO scenes of 10 seconds each.
Scene 2 continues directly from scene 1's last frame (same location, lighting, art style, camera language),
so the reel plays as one continuous story with a small payoff or gentle lesson at the end.
Rules: original story only (no existing characters, songs, brands, logos or celebrities); nothing scary, violent,
unsafe to imitate, or mocking; no on-screen text, captions, subtitles, logos or watermarks inside the video
(text is added in the edit if needed); dialogue short and clear (max ~18 words per scene); natural sound
effects and a light original instrumental bed; keep the character exactly as in the bible.

Each scene's "video_prompt" must be a complete, self-contained prompt for an AI video model, 120-250 words:
start with "Vertical 9:16 animated shot, 10 seconds." Refer to the character as "the character shown in
<IMAGE_REF_0>" and restate the key DO-NOT-CHANGE details. Include setting, lighting, camera framing and
movement, time-coded action (0-3s, 3-7s, 7-10s), exact dialogue in quotes with who says it, sound effects,
music mood, and the final frame. Scene 2's prompt must begin "Continue seamlessly from the previous clip:".

Return JSON exactly in this shape:
{{
 "title": "...", "logline": "one sentence", "lesson_or_payoff": "...",
 "character_lock": "the 8-12 details that must not change",
 "style_lock": "art style, palette, lighting, camera language shared by both scenes",
 "scenes": [
  {{"n": 1, "duration_s": 10, "setting": "...", "camera": "...",
    "beats": [{{"t": "0-3s", "action": "...", "dialogue": "Speaker: \\"line\\" or empty", "sfx": "..."}}],
    "music": "...", "final_frame": "...", "video_prompt": "..."}},
  {{"n": 2, "duration_s": 10, "setting": "...", "camera": "...", "beats": [...], "music": "...",
    "final_frame": "...", "video_prompt": "..."}}
 ],
 "caption": "Instagram caption for parents, warm, 1-3 short lines, max 300 chars, 1-2 emojis ok",
 "hashtags": ["#LittleLoop", "... 6-10 relevant tags"],
 "safety_check": "one line confirming the kid-safety rules above were followed"
}}"""


FLOW_ADDON = """

RENDERING IN GOOGLE FLOW: the video is made in Google Flow (Veo 3.1), whose clips are 4/6/8 seconds.
Also return "flow_clips": exactly 3 prompts, durations 8, 6 and 6 seconds, that together play the two
scenes as one continuous 20-second take: clip 1 = scene 1 0-8s; clip 2 = scene 1 8-10s then scene 2 0-4s;
clip 3 = scene 2 4-10s ending on the final frame. Clip 1 starts "Vertical 9:16 animated shot, 8 seconds."
and uses the character from the reference image (Flow ingredient). Clips 2 and 3 start "Continue seamlessly
from the previous clip's last frame:" and say their duration. Each clip prompt 100-200 words: restate the
DO-NOT-CHANGE details, setting, lighting, camera framing/movement, time-coded action, exact dialogue in quotes
with the speaker, SFX, music mood; no on-screen text, captions or logos.
Add to the JSON: "flow_clips": [{"n": 1, "duration_s": 8, "prompt": "..."}, {"n": 2, "duration_s": 6, "prompt": "..."}, {"n": 3, "duration_s": 6, "prompt": "..."}]"""


# ---------------- joining Google Flow clips ----------------
def normalize(src, out):
    """Same size/fps/audio layout for every clip so they join cleanly (silent track if a clip has none)."""
    meta = probe(src)
    vf = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p"
    if meta["audio"]:
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", src, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-ar", "48000", "-ac", "2", out]
    else:
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", src, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-shortest", "-vf", vf,
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", out]
    subprocess.run(cmd, check=True)
    return meta


def join_flow(job):
    rid = job["reel"]["id"]
    with tempfile.TemporaryDirectory() as work:
        parts, metas = [], []
        for n in job["clips"]:
            raw = os.path.join(work, f"raw{n}")
            with open(raw, "wb") as f:
                f.write(ganesha("GET", f"/api/reels/runner/{rid}/clips/{n}", raw=True, timeout=300))
            norm = os.path.join(work, f"clip{n}.mp4")
            m = normalize(raw, norm)
            if not m["width"] or not m["height"] or m["height"] <= m["width"]:
                raise Fail(f"clip {n} is {m['width']}x{m['height']}, not vertical 9:16 — set 9:16 in Flow")
            metas.append(m)
            parts.append(norm)
        lst = os.path.join(work, "list.txt")
        with open(lst, "w") as f:
            f.write("".join(f"file '{p}'\n" for p in parts))
        joined = os.path.join(work, "joined.mp4")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", joined], check=True)
        final = os.path.join(work, "final.mp4")
        finalize(joined, final)
        meta = probe(final)
        expected = job.get("expectedSeconds") or 20
        if not (expected - 2.5 <= meta["duration"] <= expected + 2):
            raise Fail(f"joined video is {meta['duration']}s, expected ~{expected}s — check the clip lengths in Flow (8 + 6 + 6 s)")
        meta["source"] = "Google Flow clips"
        meta["clipSeconds"] = [m["duration"] for m in metas]
        meta["qc"] = f"passed: {meta['duration']} s, 9:16{'' if all(m['audio'] for m in metas) else ', some clips had no sound (silent track added)'} (identity/story still need your eyes)"
        with open(final, "rb") as f:
            data = f.read()
        q = urllib.parse.urlencode({"meta": json.dumps(meta)})
        ganesha("PUT", f"/api/reels/runner/{rid}/video?{q}", data, {"content-type": "video/mp4"}, timeout=300)
        log(f"[{rid}] Flow clips joined and uploaded for approval: {meta}")


# ---------------- Gemini Omni Flash (video) ----------------
def find_videos(obj, out):
    if isinstance(obj, dict):
        if obj.get("type") == "video" and (obj.get("uri") or obj.get("data")):
            out.append(obj)
        for v in obj.values():
            find_videos(v, out)
    elif isinstance(obj, list):
        for v in obj:
            find_videos(v, out)
    return out


def omni_cost(res, seconds):
    u = res.get("usage") or {}
    tin = u.get("total_input_tokens")
    tout = u.get("total_output_tokens")
    if tin is None and tout is None:
        return None, None, round(seconds * OMNI_EST_PER_SEC, 4), True
    return tin, tout, round((tin or 0) / 1e6 * OMNI_IN + (tout or 0) / 1e6 * OMNI_OUT, 6), False


def download_video(item, path):
    if item.get("data"):
        data = base64.b64decode(item["data"])
    else:
        uri = item["uri"]
        key = {"x-goog-api-key": env("GEMINI_API_KEY")}
        if not uri.startswith("http"):
            name = uri.split("files/")[-1].split(":")[0].split("?")[0]
            for _ in range(60):  # wait for ACTIVE (docs: poll the file, then download)
                meta = http("GET", f"{API}/files/{name}", headers=key)
                if meta.get("state") in (None, "ACTIVE"):
                    break
                if meta.get("state") == "FAILED":
                    raise Fail("Generated video file failed processing")
                time.sleep(5)
            uri = f"{API}/files/{name}:download?alt=media"
        elif "files/" in uri and ":download" not in uri:
            name = uri.split("files/")[-1].split(":")[0].split("?")[0]
            uri = f"{API}/files/{name}:download?alt=media"
        data = http("GET", uri, headers=key, timeout=600, raw=True)
    if len(data) < 10_000:
        raise Fail(f"Downloaded video is only {len(data)} bytes")
    with open(path, "wb") as f:
        f.write(data)


def omni_generate(parts, previous=None, purpose="scene", reel_id=None):
    body = {
        "model": OMNI_MODEL,
        "input": parts,
        "response_format": {"type": "video", "aspect_ratio": "9:16", "duration": "10s", "resolution": "720p", "delivery": "uri"},
    }
    if previous:
        body["previous_interaction_id"] = previous
    key = {"x-goog-api-key": env("GEMINI_API_KEY")}
    t0 = time.time()
    try:
        res = http("POST", f"{API}/interactions", body, key, timeout=900)
        # If the API answers before the video is done, poll the stored interaction.
        for _ in range(120):
            if res.get("status") in (None, "completed") and find_videos(res, []):
                break
            if res.get("status") in ("failed", "cancelled", "incomplete"):
                raise Fail(f"Video generation {res.get('status')}: {json.dumps(res.get('errors') or res.get('error') or '')[:400]}")
            if not res.get("id"):
                raise Fail("Video API returned no interaction id and no video")
            time.sleep(10)
            res = http("GET", f"{API}/interactions/{res['id']}", headers=key, timeout=300)
        videos = find_videos(res, [])
        if not videos:
            raise Fail("No video in the response (blocked by safety filters or a regional restriction on extensions)")
    except Fail as e:
        usage([{"model": OMNI_MODEL, "purpose": purpose, "ok": False, "error": str(e), "latency_ms": int((time.time() - t0) * 1000)}], reel_id)
        raise
    tin, tout, cost, estimated = omni_cost(res, 10)
    usage([{"model": OMNI_MODEL, "purpose": purpose + ("_estimated_cost" if estimated else ""), "input_tokens": tin, "output_tokens": tout, "cost_usd": cost, "latency_ms": int((time.time() - t0) * 1000)}], reel_id)
    return res.get("id"), videos[-1]


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path], capture_output=True, text=True, check=True)
    j = json.loads(out.stdout)
    v = next((s for s in j.get("streams", []) if s.get("codec_type") == "video"), {})
    return {"duration": round(float(j.get("format", {}).get("duration", 0)), 2), "width": v.get("width"), "height": v.get("height"), "audio": any(s.get("codec_type") == "audio" for s in j.get("streams", []))}


def concat(a, b, out):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", a, "-i", b, "-filter_complex",
                    "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]", "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", out], check=True)


def finalize(src, out):
    """Instagram-friendly encode: H.264 + AAC, faststart, <= 24 MB."""
    for crf in (20, 24, 28):
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", src, "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out], check=True)
        if os.path.getsize(out) <= MAX_UPLOAD:
            return
    raise Fail("Video stays above 24 MB after re-encoding")


def render(job, sheet_img, work):
    reel = job["reel"]
    rid = reel["id"]
    s1, s2 = reel["script"]["scenes"]
    ref = {"type": "image", "data": base64.b64encode(sheet_img[0]).decode(), "mime_type": sheet_img[1]}
    log(f"[{rid}] rendering scene 1 ...")
    iid1, v1 = omni_generate([ref, {"type": "text", "text": s1["video_prompt"]}], purpose="video_scene1", reel_id=rid)
    p1 = os.path.join(work, "scene1.mp4")
    download_video(v1, p1)
    log(f"[{rid}] scene 1: {probe(p1)}")
    log(f"[{rid}] rendering scene 2 (extension) ...")
    _, v2 = omni_generate([ref, {"type": "text", "text": s2["video_prompt"]}], previous=iid1, purpose="video_scene2", reel_id=rid)
    p2 = os.path.join(work, "scene2.mp4")
    download_video(v2, p2)
    m2 = probe(p2)
    log(f"[{rid}] scene 2 output: {m2}")
    joined = p2
    if m2["duration"] < 15:  # the extension came back as the new 10 s only: join the two scenes
        joined = os.path.join(work, "joined.mp4")
        concat(p1, p2, joined)
    final = os.path.join(work, "final.mp4")
    finalize(joined, final)
    meta = probe(final)
    problems = []
    if not (18 <= meta["duration"] <= 21.5):
        problems.append(f"duration {meta['duration']}s (expected ~20s)")
    if not meta["width"] or not meta["height"] or abs(meta["height"] / meta["width"] - 16 / 9) > 0.05:
        problems.append(f"frame {meta['width']}x{meta['height']} is not 9:16")
    if not meta["audio"]:
        problems.append("no audio track")
    if problems:
        raise Fail("QC failed: " + "; ".join(problems))
    meta["qc"] = "passed: ~20 s, 9:16, audio present (identity/story still need your eyes)"
    return final, meta


def run():
    claim = ganesha("POST", "/api/reels/runner/claim")
    log("plan:", json.dumps(claim.get("plan")))
    for sheet in claim.get("pendingSheets") or []:
        log(f"reading character sheet {sheet['name']} ...")
        try:
            img = ganesha("GET", f"/api/reels/sheets/{sheet['id']}/image", raw=True)
            res = gemini_json(SHEET_PROMPT.format(notes=sheet.get("notes") or "none"), image=(img, sheet["mime"]), purpose="sheet_bible", max_tokens=4096)
            bible = str(res.get("bible") or "").strip()
            ganesha("PUT", f"/api/reels/runner/sheets/{sheet['id']}/details", {"details": bible})
        except Fail as e:
            log("sheet failed:", e)
            ganesha("PUT", f"/api/reels/runner/sheets/{sheet['id']}/details", {"error": str(e)})
    job = claim.get("job")
    if not job:
        log("No reel to render." if claim.get("enabled") else "Reel factory is switched off.")
        return 0
    rid = job["reel"]["id"]
    flow = job.get("mode") == "flow"
    try:
        if job.get("type") == "join":
            join_flow(job)
            return 0
        sheet = job.get("sheet") or {}
        if not sheet.get("details"):
            raise Fail("Character sheet has no character bible yet")
        img = (ganesha("GET", f"/api/reels/sheets/{sheet['id']}/image", raw=True), sheet["mime"])
        if not job["reel"].get("script"):
            log(f"[{rid}] writing script with {sheet['name']} ...")
            prompt = SCRIPT_PROMPT.format(bible=sheet["details"], language=job.get("language") or "simple English",
                                          brief=job.get("brief") or "none", avoid=", ".join(job.get("avoidTitles") or []) or "none")
            script = gemini_json(prompt + (FLOW_ADDON if flow else ""), image=img, purpose="script", reel_id=rid, max_tokens=12288)
            ganesha("PUT", f"/api/reels/runner/{rid}/script", {"script": script})
            job["reel"]["script"] = script
            log(f"[{rid}] script: {script.get('title')}")
        if flow:
            log(f"[{rid}] Flow mode: script ready; clips are made in Google Flow and uploaded with the reel's link.")
            return 0
        with tempfile.TemporaryDirectory() as work:
            final, meta = render(job, img, work)
            with open(final, "rb") as f:
                data = f.read()
            q = urllib.parse.urlencode({"meta": json.dumps(meta)})
            ganesha("PUT", f"/api/reels/runner/{rid}/video?{q}", data, {"content-type": "video/mp4"}, timeout=300)
        log(f"[{rid}] uploaded for approval: {meta}")
        return 0
    except (Fail, subprocess.CalledProcessError, KeyError, ValueError) as e:
        msg = redact(e)
        log(f"[{rid}] failed: {msg}")
        try:
            ganesha("POST", f"/api/reels/runner/{rid}/fail", {"error": msg})
        except Fail as e2:
            log("could not report failure:", e2)
        return 1


if __name__ == "__main__":
    try:
        sys.exit(run())
    except Fail as e:
        log("runner error:", e)
        sys.exit(1)
