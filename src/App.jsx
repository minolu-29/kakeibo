
import { useState, useRef, useCallback } from "react";

// ── カテゴリ定義（ここを変えるだけで全体に反映）─────────────
const CATS = [
  { key: "食費",   color: "#E05D44", bg: "#FEF3F0", emoji: "🍱" },
  { key: "雑貨",   color: "#7AB55C", bg: "#F1F8EC", emoji: "🛒" },
  { key: "病院代", color: "#9B6DCC", bg: "#F5F0FF", emoji: "🏥" },
  { key: "レジャー", color: "#E8A020", bg: "#FFF8EC", emoji: "🎡" },
];
const catMap = Object.fromEntries(CATS.map(c => [c.key, c]));

// ── カラートークン ──────────────────────────────────────────
const C = {
  bg: "#F8F7F4", surface: "#FFFFFF", border: "#E2DDD6",
  ink: "#1C1C1A", sub: "#6B6560", accent: "#3A7BDB",
};

// ── ユーティリティ ─────────────────────────────────────────
const fmt = (n) => Number(n).toLocaleString("ja-JP");
const today = () => new Date().toISOString().slice(0, 10);
const weekKey = (dateStr) => {
  const d = new Date(dateStr);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
};
const monthKey = (dateStr) => dateStr.slice(0, 7);
const catSum = (items, key) =>
  items.filter(i => i.category === key).reduce((s, i) => s + i.price, 0);

// ── Claude Vision API ─────────────────────────────────────
async function analyzeReceipt(base64Image) {
  const catList = CATS.map(c => `「${c.key}」`).join("、");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Image } },
          {
            type: "text",
            text: `このレシートを解析してください。
以下のJSON形式のみで返答してください（マークダウン・コードブロック不要）:
{
  "store": "店名",
  "date": "YYYY-MM-DD形式の日付（不明な場合は今日）",
  "items": [
    { "name": "商品名", "price": 数値（税込円）, "category": "カテゴリ名" }
  ],
  "total": 合計金額数値
}
カテゴリは ${catList} の4種類から選んでください。
- 食品・飲料・お菓子・調味料 → 食費
- 日用品・文具・衣類・家電など → 雑貨
- 診察・薬・医療費 → 病院代
- 遊園地・旅行・映画・スポーツ・外食（レジャー目的）→ レジャー`
          }
        ]
      }]
    })
  });
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text || "{}";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

// ── CSV 生成 ───────────────────────────────────────────────
function generateCSV(records) {
  const byWeek = {}, byMonth = {};
  records.forEach(r => {
    const wk = weekKey(r.date), mo = monthKey(r.date);
    if (!byWeek[wk]) byWeek[wk] = [];
    if (!byMonth[mo]) byMonth[mo] = [];
    byWeek[wk].push(r); byMonth[mo].push(r);
  });

  const catCols = CATS.map(c => `${c.key}合計`).join(",");
  let csv = "\uFEFF";

  csv += "【月別サマリー】\n";
  csv += `年月,${catCols},合計\n`;
  Object.entries(byMonth).sort().forEach(([mo, recs]) => {
    const sums = CATS.map(c => recs.reduce((s, r) => s + catSum(r.items, c.key), 0));
    csv += `${mo},${sums.join(",")},${sums.reduce((a, b) => a + b, 0)}\n`;
  });

  csv += "\n【週別サマリー】\n";
  csv += `週,${catCols},合計\n`;
  Object.entries(byWeek).sort().forEach(([wk, recs]) => {
    const sums = CATS.map(c => recs.reduce((s, r) => s + catSum(r.items, c.key), 0));
    csv += `${wk},${sums.join(",")},${sums.reduce((a, b) => a + b, 0)}\n`;
  });

  csv += "\n【明細】\n日付,店名,商品名,カテゴリ,金額\n";
  [...records].sort((a, b) => a.date.localeCompare(b.date)).forEach(r =>
    r.items.forEach(i => { csv += `${r.date},${r.store},"${i.name}",${i.category},${i.price}\n`; })
  );
  return csv;
}

// ── メインアプリ ──────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("camera");
  const [records, setRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem("kakeibo") || "[]"); } catch { return []; }
  });
  const [preview, setPreview] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editDate, setEditDate] = useState(today());
  const fileRef = useRef();

  const save = (recs) => { setRecords(recs); localStorage.setItem("kakeibo", JSON.stringify(recs)); };

  const handleFile = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(""); setParsed(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const b64 = ev.target.result.split(",")[1];
      setPreview(ev.target.result);
      setLoading(true);
      try {
        const result = await analyzeReceipt(b64);
        result.date = result.date || today();
        setEditDate(result.date);
        setParsed(result);
      } catch { setError("レシートの読み取りに失敗しました。再度お試しください。"); }
      setLoading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const updateItem = (idx, field, val) =>
    setParsed(p => {
      const items = [...p.items];
      items[idx] = { ...items[idx], [field]: field === "price" ? Number(val) : val };
      return { ...p, items, total: items.reduce((s, i) => s + i.price, 0) };
    });

  const addRecord = () => {
    save([{ ...parsed, date: editDate, id: Date.now() }, ...records]);
    setParsed(null); setPreview(null); setTab("list");
  };

  const deleteRecord = (id) => save(records.filter(r => r.id !== id));

  const downloadCSV = () => {
    const blob = new Blob([generateCSV(records)], { type: "text/csv;charset=utf-8;" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `家計簿_${today()}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  // 集計
  const totalByCat = Object.fromEntries(CATS.map(c => [c.key,
    records.reduce((s, r) => s + catSum(r.items, c.key), 0)
  ]));
  const grandTotal = Object.values(totalByCat).reduce((a, b) => a + b, 0);

  const periodStats = (groupFn) => {
    const m = {};
    records.forEach(r => {
      const k = groupFn(r.date);
      if (!m[k]) m[k] = Object.fromEntries(CATS.map(c => [c.key, 0]));
      CATS.forEach(c => { m[k][c.key] += catSum(r.items, c.key); });
    });
    return m;
  };
  const byMonth = periodStats(monthKey);
  const byWeek  = periodStats(weekKey);

  // カテゴリ選択肢のスタイル（select内で動的カラーを当てる）
  const catStyle = (cat) => ({
    border: `1.5px solid ${catMap[cat]?.color || C.border}`,
    borderRadius: 6, padding: "4px 6px", fontSize: 11,
    color: catMap[cat]?.color || C.ink,
    background: catMap[cat]?.bg || C.surface,
    fontWeight: 700, cursor: "pointer",
  });

  return (
    <div style={{ fontFamily: "'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif", background: C.bg, minHeight: "100vh", maxWidth: 480, margin: "0 auto", paddingBottom: 80 }}>

      {/* ヘッダー */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "16px 20px 12px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ fontSize: 10, color: C.sub, letterSpacing: "0.12em", marginBottom: 2 }}>KAKEIBO</div>
        <div style={{ fontSize: 21, fontWeight: 700, color: C.ink }}>レシート家計簿</div>
      </div>

      {/* タブ */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.surface, position: "sticky", top: 60, zIndex: 10 }}>
        {[["camera","📷 撮影"],["list","📋 一覧"],["stats","📊 集計"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ flex: 1, padding: "12px 0", fontSize: 13, fontWeight: tab === key ? 700 : 400,
              color: tab === key ? C.accent : C.sub, background: "none", border: "none",
              borderBottom: `2px solid ${tab === key ? C.accent : "transparent"}`, cursor: "pointer" }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: "20px 16px" }}>

        {/* ── 撮影タブ ── */}
        {tab === "camera" && (
          <div>
            {!parsed && (
              <>
                <div onClick={() => fileRef.current.click()}
                  style={{ border: `2px dashed ${C.border}`, borderRadius: 16, padding: "40px 20px",
                    textAlign: "center", cursor: "pointer", background: C.surface, marginBottom: 16, minHeight: 180,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  {preview
                    ? <img src={preview} alt="レシート" style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 8, objectFit: "contain" }} />
                    : <>
                        <div style={{ fontSize: 48, marginBottom: 12 }}>📷</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: C.ink, marginBottom: 6 }}>レシートを撮影・選択</div>
                        <div style={{ fontSize: 13, color: C.sub }}>タップしてカメラを起動</div>
                      </>}
                </div>
                <input ref={fileRef} type="file" accept="image/*" capture="environment"
                  style={{ display: "none" }} onChange={handleFile} />

                {loading && (
                  <div style={{ textAlign: "center", padding: 24 }}>
                    <div style={{ fontSize: 32, animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</div>
                    <div style={{ marginTop: 12, color: C.sub, fontSize: 14 }}>AIがレシートを解析中...</div>
                  </div>
                )}
                {error && <div style={{ background: "#FEF2F2", color: "#DC2626", padding: "12px 16px", borderRadius: 10, fontSize: 14 }}>{error}</div>}
              </>
            )}

            {parsed && (
              <div>
                {/* 店名・日付 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, flex: 1 }}>{parsed.store || "店名不明"}</div>
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                    style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", fontSize: 13, color: C.ink, background: C.surface }} />
                </div>

                {/* カテゴリ別サマリー (2×2グリッド) */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                  {CATS.map(c => {
                    const sum = catSum(parsed.items, c.key);
                    return (
                      <div key={c.key} style={{ background: c.bg, borderRadius: 12, padding: "10px 12px" }}>
                        <div style={{ fontSize: 10, color: c.color, fontWeight: 700, marginBottom: 2 }}>{c.emoji} {c.key}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: sum > 0 ? C.ink : C.sub }}>
                          {sum > 0 ? `¥${fmt(sum)}` : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 商品リスト */}
                <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 14 }}>
                  {parsed.items.map((item, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
                      borderBottom: idx < parsed.items.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div style={{ flex: 1, fontSize: 13, color: C.ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                      <input type="number" value={item.price}
                        onChange={e => updateItem(idx, "price", e.target.value)}
                        style={{ width: 68, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 6px", fontSize: 13, textAlign: "right", color: C.ink }} />
                      <select value={item.category} onChange={e => updateItem(idx, "category", e.target.value)}
                        style={catStyle(item.category)}>
                        {CATS.map(c => <option key={c.key} value={c.key}>{c.key}</option>)}
                      </select>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#F8F7F4", fontWeight: 700, color: C.ink }}>
                    <span>合計</span>
                    <span>¥{fmt(parsed.items.reduce((s, i) => s + i.price, 0))}</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => { setParsed(null); setPreview(null); }}
                    style={{ flex: 1, padding: "14px", borderRadius: 12, border: `1px solid ${C.border}`, background: C.surface, color: C.sub, fontSize: 14, cursor: "pointer" }}>
                    やり直す
                  </button>
                  <button onClick={addRecord}
                    style={{ flex: 2, padding: "14px", borderRadius: 12, border: "none", background: C.accent, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                    💾 保存する
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 一覧タブ ── */}
        {tab === "list" && (
          <div>
            {records.length === 0
              ? <div style={{ textAlign: "center", padding: "48px 0", color: C.sub }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                  <div>まだレシートがありません</div>
                </div>
              : records.map(r => {
                  const total = r.items.reduce((s, i) => s + i.price, 0);
                  const nonZero = CATS.filter(c => catSum(r.items, c.key) > 0);
                  return (
                    <div key={r.id} style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, marginBottom: 10, overflow: "hidden" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px 10px" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>{r.store}</div>
                          <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{r.date}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>¥{fmt(total)}</div>
                          <button onClick={() => deleteRecord(r.id)}
                            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: C.sub, padding: 0 }}>🗑</button>
                        </div>
                      </div>
                      {/* カテゴリバー */}
                      <div style={{ display: "flex", borderTop: `1px solid ${C.border}` }}>
                        {nonZero.map(c => {
                          const s = catSum(r.items, c.key);
                          return (
                            <div key={c.key} style={{ flex: s, background: c.bg, padding: "7px 10px", textAlign: "center" }}>
                              <div style={{ fontSize: 10, color: c.color, fontWeight: 600 }}>{c.emoji}{c.key}</div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>¥{fmt(s)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
          </div>
        )}

        {/* ── 集計タブ ── */}
        {tab === "stats" && (
          <div>
            {records.length === 0
              ? <div style={{ textAlign: "center", padding: "48px 0", color: C.sub }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
                  <div>まだデータがありません</div>
                </div>
              : <>
                  {/* 全期間合計 */}
                  <div style={{ background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: 16, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, marginBottom: 10 }}>全期間合計</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                      {CATS.map(c => (
                        <div key={c.key} style={{ background: c.bg, borderRadius: 10, padding: "10px 12px" }}>
                          <div style={{ fontSize: 10, color: c.color, fontWeight: 700 }}>{c.emoji} {c.key}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginTop: 3 }}>¥{fmt(totalByCat[c.key])}</div>
                        </div>
                      ))}
                    </div>
                    {/* 割合バー */}
                    <div style={{ display: "flex", gap: 3, height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
                      {CATS.map(c => <div key={c.key} style={{ flex: totalByCat[c.key] || 0.01, background: c.color }} />)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                      <span style={{ color: C.sub, fontSize: 14 }}>総計</span>
                      <span style={{ fontWeight: 700, fontSize: 18, color: C.ink }}>¥{fmt(grandTotal)}</span>
                    </div>
                  </div>

                  {/* 月別 */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 8 }}>📅 月別</div>
                  {Object.entries(byMonth).sort().reverse().map(([mo, s]) => {
                    const tot = Object.values(s).reduce((a, b) => a + b, 0);
                    return (
                      <div key={mo} style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "12px 14px", marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                          <span style={{ fontWeight: 600, color: C.ink }}>{mo.replace("-", "年")}月</span>
                          <span style={{ fontWeight: 700, color: C.ink }}>¥{fmt(tot)}</span>
                        </div>
                        <div style={{ display: "flex", gap: 3, height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
                          {CATS.map(c => <div key={c.key} style={{ flex: s[c.key] || 0.01, background: c.color }} />)}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11 }}>
                          {CATS.filter(c => s[c.key] > 0).map(c => (
                            <span key={c.key} style={{ color: c.color, fontWeight: 600 }}>{c.emoji}{c.key} ¥{fmt(s[c.key])}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {/* 週別 */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, margin: "18px 0 8px" }}>📆 週別</div>
                  {Object.entries(byWeek).sort().reverse().map(([wk, s]) => {
                    const tot = Object.values(s).reduce((a, b) => a + b, 0);
                    return (
                      <div key={wk} style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: "12px 14px", marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                          <span style={{ fontWeight: 600, color: C.ink }}>{wk}</span>
                          <span style={{ fontWeight: 700, color: C.ink }}>¥{fmt(tot)}</span>
                        </div>
                        <div style={{ display: "flex", gap: 3, height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 8 }}>
                          {CATS.map(c => <div key={c.key} style={{ flex: s[c.key] || 0.01, background: c.color }} />)}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11 }}>
                          {CATS.filter(c => s[c.key] > 0).map(c => (
                            <span key={c.key} style={{ color: c.color, fontWeight: 600 }}>{c.emoji}{c.key} ¥{fmt(s[c.key])}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  <button onClick={downloadCSV}
                    style={{ width: "100%", marginTop: 12, padding: "16px", borderRadius: 14, border: "none", background: C.accent, color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer" }}>
                    📥 スプレッドシートをダウンロード
                  </button>
                </>}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
