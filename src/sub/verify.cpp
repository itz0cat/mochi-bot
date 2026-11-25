#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <cmath>
#include <algorithm>
#include <sys/stat.h>
#include <openssl/sha.h>
#include <leptonica/allheaders.h>
#include <tesseract/baseapi.h>

using namespace std;
using namespace std::chrono;

static auto g_t0 = high_resolution_clock::now();
static vector<pair<string, double>> g_times;

void add_time(const string& name, high_resolution_clock::time_point t) {
    double dt = duration<double>(high_resolution_clock::now() - t).count();
    g_times.push_back({name, dt});
}

void report() {
    double total = duration<double>(high_resolution_clock::now() - g_t0).count();
    cout << "\n⏱ Timing\n";
    for (const auto& [name, dt] : g_times) {
        double pct = (total > 0) ? (dt / total * 100.0) : 0.0;
        int bars = (int)(pct / 5.0);
        cout << "  " << left << setw(22) << name 
             << fixed << setprecision(3) << setw(6) << dt << "s "
             << setw(4) << (int)pct << "% ";
        for (int i = 0; i < bars; ++i) cout << "█";
        cout << "\n";
    }
    cout << "  " << left << setw(22) << "TOTAL" 
         << fixed << setprecision(3) << setw(6) << total << "s\n";
}

string norm_str(const string& s) {
    string r;
    for (char c : s) {
        char lo = tolower(c);
        if (lo == '0') lo = 'o';
        if ((lo >= 'a' && lo <= 'z') || (lo >= '0' && lo <= '9')) {
            r += lo;
        }
    }
    return r;
}

double sim_ratio(const string& a, const string& b) {
    if (a.empty() || b.empty()) return 0.0;
    int na = a.size(), nb = b.size();
    vector<vector<int>> dp(na + 1, vector<int>(nb + 1, 0));
    for (int i = 0; i <= na; ++i) {
        for (int j = 0; j <= nb; ++j) {
            if (i == 0) dp[i][j] = j;
            else if (j == 0) dp[i][j] = i;
            else if (a[i - 1] == b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
            else dp[i][j] = 1 + min({dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]});
        }
    }
    return 1.0 - (double)dp[na][nb] / max(na, nb);
}

string calc_sha256(const string& path) {
    ifstream f(path, ios::binary);
    if (!f) return "";
    SHA256_CTX ctx;
    SHA256_Init(&ctx);
    char buf[16384];
    while (f.read(buf, sizeof(buf)) || f.gcount() > 0) {
        SHA256_Update(&ctx, buf, f.gcount());
    }
    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256_Final(hash, &ctx);
    ostringstream oss;
    for (int i = 0; i < SHA256_DIGEST_LENGTH; ++i) {
        oss << hex << setw(2) << setfill('0') << (int)hash[i];
    }
    return oss.str();
}

string calc_dhash(Pix* pix, int size = 16) {
    // shortcut: resize to (size+1, size) 8bpp grayscale for fast gradient dHash
    Pix* gray = (pixGetDepth(pix) == 8) ? pixClone(pix) : pixConvertTo8(pix, 0);
    Pix* scaled = pixScaleToSize(gray, size + 1, size);
    pixDestroy(&gray);
    if (!scaled) return "";

    ostringstream oss;
    unsigned long long bits_hi = 0, bits_lo = 0;
    // 256 bits = 4 x 64-bit words
    vector<unsigned long long> words(4, 0);
    int bit_idx = 0;
    for (int y = 0; y < size; ++y) {
        for (int x = 0; x < size; ++x) {
            l_uint32 val1 = 0, val2 = 0;
            pixGetPixel(scaled, x, y, &val1);
            pixGetPixel(scaled, x + 1, y, &val2);
            int bit = (val1 > val2) ? 1 : 0;
            int widx = bit_idx / 64;
            int bpos = 63 - (bit_idx % 64);
            if (bit) words[widx] |= (1ULL << bpos);
            bit_idx++;
        }
    }
    pixDestroy(&scaled);
    for (int i = 0; i < 4; ++i) {
        oss << hex << setw(16) << setfill('0') << words[i];
    }
    return oss.str();
}

int hamming_dist(const string& a, const string& b) {
    if (a.size() != b.size() || a.size() != 64) return 256;
    int dist = 0;
    for (size_t i = 0; i < 64; i += 16) {
        unsigned long long v1 = stoull(a.substr(i, 16), nullptr, 16);
        unsigned long long v2 = stoull(b.substr(i, 16), nullptr, 16);
        dist += __builtin_popcountll(v1 ^ v2);
    }
    return dist;
}

// Minimal seen.json reader/writer
void load_db(const string& path, vector<pair<string, string>>& shas, vector<pair<string, string>>& phs) {
    ifstream f(path);
    if (!f) return;
    string content((istreambuf_iterator<char>(f)), istreambuf_iterator<char>());
    // Extract sha map
    auto parse_map = [&](const string& tag, vector<pair<string, string>>& out) {
        size_t pos = content.find("\"" + tag + "\"");
        if (pos == string::npos) return;
        size_t start = content.find('{', pos);
        size_t end = content.find('}', start);
        if (start == string::npos || end == string::npos) return;
        string sub = content.substr(start + 1, end - start - 1);
        stringstream ss(sub);
        string token;
        while (getline(ss, token, ',')) {
            size_t c = token.find(':');
            if (c == string::npos) continue;
            string k = token.substr(0, c);
            string v = token.substr(c + 1);
            auto clean = [](string s) {
                s.erase(remove(s.begin(), s.end(), '\"'), s.end());
                s.erase(remove(s.begin(), s.end(), ' '), s.end());
                return s;
            };
            k = clean(k);
            v = clean(v);
            if (!k.empty() && !v.empty()) out.push_back({k, v});
        }
    };
    parse_map("sha", shas);
    parse_map("ph", phs);
}

void save_db(const string& path, const vector<pair<string, string>>& shas, const vector<pair<string, string>>& phs) {
    ofstream f(path);
    if (!f) return;
    f << "{\n  \"sha\": {\n";
    for (size_t i = 0; i < shas.size(); ++i) {
        f << "    \"" << shas[i].first << "\": \"" << shas[i].second << "\"" << (i + 1 < shas.size() ? "," : "") << "\n";
    }
    f << "  },\n  \"ph\": {\n";
    for (size_t i = 0; i < phs.size(); ++i) {
        f << "    \"" << phs[i].first << "\": \"" << phs[i].second << "\"" << (i + 1 < phs.size() ? "," : "") << "\n";
    }
    f << "  }\n}\n";
}

int main(int argc, char* argv[]) {
    setenv("OMP_THREAD_LIMIT", "2", 0);
    string shot_path, user = "anonymous", code = "", target_channel = "Itz0Cat";
    bool check_dup = true;

    for (int i = 1; i < argc; ++i) {
        string arg = argv[i];
        if (arg == "--no-dup") {
            check_dup = false;
        } else if ((arg == "--channel" || arg == "-c") && i + 1 < argc) {
            target_channel = argv[++i];
        } else if (shot_path.empty()) {
            shot_path = arg;
        } else if (user == "anonymous") {
            user = arg;
        } else if (code.empty()) {
            code = arg;
        }
    }

    if (shot_path.empty()) {
        cerr << "Usage: verify <shot.jpg> [user] [code] [--channel <name>] [--no-dup]\n";
        return 1;
    }

    string db_path = "seen.json";
    // Check if db_path should be next to executable
    string exe_dir = argv[0];
    size_t last_slash = exe_dir.rfind('/');
    if (last_slash != string::npos) {
        db_path = exe_dir.substr(0, last_slash) + "/seen.json";
    }

    vector<pair<string, string>> shas, phs;
    string file_sha;

    if (check_dup) {
        auto t_sha = high_resolution_clock::now();
        file_sha = calc_sha256(shot_path);
        add_time("file sha256", t_sha);

        auto t_chk = high_resolution_clock::now();
        load_db(db_path, shas, phs);
        for (const auto& [old_sha, who] : shas) {
            if (old_sha == file_sha) {
                add_time("duplicate check", t_chk);
                cout << "⚠️ Exact same file already sent by " << who << "\n";
                report();
                return 0;
            }
        }
        add_time("duplicate check", t_chk);
    }

    // Load Image via Leptonica (SIMD accelerated)
    auto t_load = high_resolution_clock::now();
    Pix* pix = pixRead(shot_path.c_str());
    if (!pix) {
        cerr << "Failed to read image: " << shot_path << "\n";
        return 1;
    }
    int w = pixGetWidth(pix);
    int h = pixGetHeight(pix);
    Box* box = boxCreate(0, 0, w, (l_int32)(h * 0.45));
    Pix* head = pixClipRectangle(pix, box, nullptr);
    boxDestroy(&box);
    pixDestroy(&pix);
    add_time("image load & crop", t_load);

    string img_dhash;
    if (check_dup) {
        auto t_dh = high_resolution_clock::now();
        img_dhash = calc_dhash(head);
        add_time("dhash", t_dh);

        auto t_chk2 = high_resolution_clock::now();
        for (const auto& [old_ph, who] : phs) {
            if (hamming_dist(img_dhash, old_ph) <= 10) {
                pixDestroy(&head);
                add_time("duplicate check", t_chk2);
                cout << "⚠️ Reused screenshot, matches one from " << who << "\n";
                report();
                return 0;
            }
        }
        add_time("duplicate check", t_chk2);
    }

    // Grayscale + Dark Mode Invert Prep
    auto t_prep = high_resolution_clock::now();
    Pix* gray = (pixGetDepth(head) == 8) ? pixClone(head) : pixConvertTo8(head, 0);
    pixDestroy(&head);

    // Sample brightness
    Pix* thumb = pixScaleToSize(gray, 50, 50);
    l_float32 avg_val = 0.0;
    pixMeanInRectangle(thumb, nullptr, nullptr, &avg_val);
    pixDestroy(&thumb);
    if (avg_val < 110.0) {
        Pix* inv = pixInvert(nullptr, gray);
        pixDestroy(&gray);
        gray = inv;
    }
    add_time("header prep", t_prep);

    // Tesseract OCR
    auto t_tess_init = high_resolution_clock::now();
    tesseract::TessBaseAPI tess;
    if (tess.Init("/usr/share/tesseract-ocr/5/tessdata", "eng", tesseract::OEM_LSTM_ONLY)) {
        cerr << "Failed to initialize Tesseract\n";
        pixDestroy(&gray);
        return 1;
    }
    tess.SetVariable("tessedit_do_invert", "0");
    add_time("tesseract init", t_tess_init);

    auto t_ocr = high_resolution_clock::now();
    tess.SetImage(gray);
    char* text_out = tess.GetUTF8Text();
    string ocr_text = text_out ? text_out : "";
    if (text_out) delete[] text_out;
    pixDestroy(&gray);
    add_time("header OCR", t_ocr);

    // Matching logic
    string target_norm = norm_str(target_channel);
    stringstream ss(ocr_text);
    string word;
    bool channel_found = false;
    while (ss >> word) {
        string wn = norm_str(word);
        if (sim_ratio(wn, target_norm) >= 0.8) {
            channel_found = true;
            break;
        }
    }

    if (!channel_found) {
        cout << "❌ Channel '" << target_channel << "' not found\n";
        report();
        return 0;
    }

    // Subscribed check
    string text_lower = ocr_text;
    transform(text_lower.begin(), text_lower.end(), text_lower.begin(), ::tolower);
    if (text_lower.find("subscribed") == string::npos) {
        cout << "❌ Not subscribed\n";
        report();
        return 0;
    }

    // Code check
    if (!code.empty()) {
        string code_clean = norm_str(code);
        string text_clean = norm_str(ocr_text);
        if (text_clean.find(code_clean) == string::npos) {
            cout << "❌ Required code not visible in screenshot\n";
            report();
            return 0;
        }
    }

    // Save DB
    if (check_dup) {
        auto t_save = high_resolution_clock::now();
        shas.push_back({file_sha, user});
        phs.push_back({img_dhash, user});
        save_db(db_path, shas, phs);
        add_time("save db", t_save);
    }

    cout << "✅ Subscribed, unique\n";
    report();
    return 0;
}
