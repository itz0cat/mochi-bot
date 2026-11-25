import time
T0 = time.perf_counter()
import sys, os, re, json, hashlib, ctypes, argparse
from datetime import datetime
from difflib import SequenceMatcher
from PIL import Image, ImageOps

os.environ.setdefault("OMP_THREAD_LIMIT", "2")

DB = os.environ.get("SUBVERIFY_DB") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "seen.json")
MAX_DIST = 10       # fuzzy duplicate strictness (dHash, out of 256 bits)
MAX_AGE_MIN = 30    # screenshot must be this fresh (None = skip clock check)
HEAD_FRAC = 0.42    # top portion of screenshot for channel/subscription header

TIMES = {}

def step(name, start):
    TIMES[name] = TIMES.get(name, 0) + time.perf_counter() - start

def report():
    total = time.perf_counter() - T0
    rows = dict(TIMES)
    rows["other"] = max(0, total - sum(rows.values()))
    print("\n⏱ Timing")
    for name, t in sorted(rows.items(), key=lambda x: -x[1]):
        pct = (t / total * 100) if total > 0 else 0
        print(f"  {name:<22}{t:6.3f}s {pct:4.0f}% " + "█" * int(pct / 5))
    print(f"  {'TOTAL':<22}{total:6.3f}s")

def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("0", "o"))

def dhash(img, size=16):
    g = img.convert("L").resize((size + 1, size), Image.BILINEAR)
    px = g.tobytes()
    bits = 0
    stride = size + 1
    for y in range(size):
        row = px[y * stride:(y + 1) * stride]
        for x in range(size):
            bits = (bits << 1) | (1 if row[x] > row[x + 1] else 0)
    return format(bits, "064x")

def dist(a, b):
    return bin(int(a, 16) ^ int(b, 16)).count("1")

def find_tessdata():
    candidates = [
        os.environ.get("TESSDATA_PREFIX"),
        "/usr/share/tesseract-ocr/5/tessdata",
        "/usr/share/tesseract-ocr/4.00/tessdata",
        "/usr/share/tesseract-ocr/tessdata",
        "/usr/share/tessdata",
        "/usr/local/share/tessdata",
    ]
    for c in candidates:
        if c and os.path.isdir(c):
            return c.encode("utf-8")
    return b"/usr/share/tesseract-ocr/5/tessdata"

def get_tess():
    # shortcut: direct ctypes to libtesseract avoids python-pytesseract/subprocess fork overhead
    tess = None
    lib_names = ["libtesseract.so.5", "libtesseract.so.4", "libtesseract.so"]
    for lib in lib_names:
        try:
            tess = ctypes.CDLL(lib)
            break
        except Exception:
            pass
    if tess is None:
        raise RuntimeError("libtesseract not found")

    tess.TessBaseAPICreate.restype = ctypes.c_void_p
    tess.TessBaseAPIInit3.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
    tess.TessBaseAPISetImage.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
    tess.TessBaseAPISetVariable.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
    tess.TessBaseAPIGetUTF8Text.argtypes = [ctypes.c_void_p]
    tess.TessBaseAPIGetUTF8Text.restype = ctypes.c_void_p
    tess.TessBaseAPIDelete.argtypes = [ctypes.c_void_p]
    tess.TessDeleteText.argtypes = [ctypes.c_void_p]
    api = tess.TessBaseAPICreate()
    tessdata_path = find_tessdata()
    tess.TessBaseAPIInit3(api, tessdata_path, b"eng")
    tess.TessBaseAPISetVariable(api, b"tessedit_do_invert", b"0")
    return tess, api

def run_ocr(tess, api, img):
    raw = img.tobytes()
    tess.TessBaseAPISetImage(api, raw, img.width, img.height, 1, img.width)
    ptr = tess.TessBaseAPIGetUTF8Text(api)
    txt = ctypes.string_at(ptr).decode("utf-8", "ignore") if ptr else ""
    if ptr:
        tess.TessDeleteText(ptr)
    return txt

def prep(img):
    g = ImageOps.grayscale(img) if img.mode != "L" else img
    if sum(g.resize((50, 50), Image.BILINEAR).tobytes()) / 2500 < 110:
        g = ImageOps.invert(g)
    if g.width > 500:
        g = g.resize((480, int(g.height * (480 / g.width))), Image.BILINEAR)
    return g

def file_time(path):
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})", os.path.basename(path))
    if m:
        return datetime(*map(int, m.groups()))
    return datetime.fromtimestamp(os.path.getmtime(path))

def main(path, user="anonymous", code=None, channel="Itz0Cat", check_dup=True):
    sha = None
    ph = None
    db = None

    if check_dup:
        # Fast SHA-256 duplicate check (<2ms)
        t = time.perf_counter()
        with open(path, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        step("file sha256", t)

        t = time.perf_counter()
        db = json.load(open(DB)) if os.path.exists(DB) else {"sha": {}, "ph": {}}
        db.setdefault("sha", {})
        db.setdefault("ph", {})
        if sha in db["sha"]:
            step("duplicate check", t)
            return f"⚠️ Exact same file already sent by {db['sha'][sha]}"
        step("duplicate check", t)

    # Load image (draft mode for fast JPEG grayscale decode)
    t = time.perf_counter()
    im = Image.open(path)
    if getattr(im, "format", "") == "JPEG":
        im.draft("L", (im.width, im.height))
    head_img = im.crop((0, 0, im.width, int(im.height * HEAD_FRAC)))
    step("image load & crop", t)

    if check_dup:
        t = time.perf_counter()
        ph = dhash(head_img)
        step("dhash", t)

        t = time.perf_counter()
        for old, who in db["ph"].items():
            if dist(ph, old) <= MAX_DIST:
                step("duplicate check", t)
                return f"⚠️ Reused screenshot, matches one from {who}"
        step("duplicate check", t)

    # OCR stage
    t = time.perf_counter()
    tess, api = get_tess()
    step("tesseract init", t)

    t = time.perf_counter()
    g_head = prep(head_img)
    step("header prep", t)

    t = time.perf_counter()
    text = run_ocr(tess, api, g_head)
    step("header OCR", t)

    # Target channel matching (fuzzy ratio >= 0.8)
    target_handle = norm(channel)
    words = text.split()
    if not any(SequenceMatcher(None, norm(w), target_handle).ratio() >= 0.8 for w in words):
        tess.TessBaseAPIDelete(api)
        return f"❌ Channel '{channel}' not found"

    if not re.search(r"\bsubscribed\b", text, re.I):
        tess.TessBaseAPIDelete(api)
        return "❌ Not subscribed"

    if code and code.lower() not in text.lower().replace(" ", ""):
        tess.TessBaseAPIDelete(api)
        return "❌ Required code not visible in screenshot"

    flags = []
    if MAX_AGE_MIN:
        age = (datetime.now() - file_time(path)).total_seconds() / 60
        if age > MAX_AGE_MIN:
            flags.append(f"file is {int(age)} min old")

        clk = None
        m_clock = re.search(r"\b(\d{1,2}):(\d{2})\b", text)
        if m_clock:
            clk = (int(m_clock[1]), int(m_clock[2]))
        else:
            t = time.perf_counter()
            bar = prep(im.crop((0, 0, int(im.width * 0.5), int(im.height * 0.05))))
            bar_txt = run_ocr(tess, api, bar)
            step("clock OCR fallback", t)
            m_bar = re.search(r"(\d{1,2}):(\d{2})", bar_txt)
            if m_bar:
                clk = (int(m_bar[1]), int(m_bar[2]))

        if clk:
            now = datetime.now()
            d = abs((clk[0] % 12) * 60 + clk[1] - ((now.hour % 12) * 60 + now.minute))
            if min(d, 720 - d) > MAX_AGE_MIN:
                flags.append(f"screenshot clock {clk[0]}:{clk[1]:02d} doesn't match now")

    tess.TessBaseAPIDelete(api)

    if check_dup and db is not None:
        t = time.perf_counter()
        db["sha"][sha] = user
        db["ph"][ph] = user
        with open(DB, "w") as f:
            json.dump(db, f)
        step("save db", t)

    return "✅ Subscribed, unique" + (" | ⚠️ " + "; ".join(flags) if flags else "")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fast YouTube subscription screenshot verification")
    parser.add_argument("shot", help="Path to screenshot image")
    parser.add_argument("user", nargs="?", default="anonymous", help="Username / User ID")
    parser.add_argument("code", nargs="?", default=None, help="Optional verification watermark code")
    parser.add_argument("--channel", "-c", default="Itz0Cat", help="Target YouTube channel name/handle (default: Itz0Cat)")
    parser.add_argument("--no-dup", action="store_true", help="Turn off duplicate checking and DB persistence")
    parser.add_argument("--json", action="store_true", help="Output JSON result")

    args = parser.parse_args()
    res_str = ""
    ok = False
    try:
        res_str = main(args.shot, user=args.user, code=args.code, channel=args.channel, check_dup=not args.no_dup)
        ok = res_str.startswith("✅")
        if args.json:
            out = {
                "ok": ok,
                "message": res_str,
                "channel": args.channel
            }
            print(json.dumps(out))
        else:
            print(res_str)
    except Exception as e:
        if args.json:
            print(json.dumps({"ok": False, "message": f"Error: {e}", "channel": args.channel}))
        else:
            print(f"Error: {e}")
    finally:
        if not args.json:
            report()
