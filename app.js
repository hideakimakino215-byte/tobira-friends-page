// The friend-experiment page. Plain JavaScript, no build step. All text from the server is put in with
// textContent (never as markup), so nothing a user types can become markup.
import { CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);
const show = (...ids) => { for (const s of ["start", "quiz", "result", "link", "friend", "consult"]) $(s).hidden = !ids.includes(s); };
const status = (t) => { $("status").textContent = t; };
const params = new URLSearchParams(location.search);
let session = null, idToken = null, info = null;

async function api(method, path, body) {
  const res = await fetch(CONFIG.API_BASE + path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (res.status === 401 && window.liff) { window.liff.logout?.(); window.liff.login({ redirectUri: location.href }); }
  if (res.status === 503 && json?.reason === "busy") { await new Promise((r) => setTimeout(r, 2000)); return api(method, path, body); }
  return { status: res.status, json };
}

function line(parent, text, cls) { const d = document.createElement("div"); d.className = cls; d.textContent = text; parent.appendChild(d); return d; }

async function boot() {
  const cfg = await api("GET", "/config");
  if (cfg.status !== 200) { status("ただいま準備中です。しばらくしてからもう一度お試しください。"); return; }
  info = cfg.json;
  $("title").textContent = info.checkName;
  status("");
  await window.liff.init({ liffId: CONFIG.LIFF_ID });
  if (!window.liff.isLoggedIn()) { window.liff.login({ redirectUri: location.href }); return; }
  idToken = window.liff.getIDToken();
  if (params.get("mode") === "consult") { await openConsult(); return; }
  const s = await api("POST", "/session", { entry: params.get("e") || "web", qrToken: params.get("qr") || undefined });
  if (s.status !== 200) { status("開始できませんでした。"); return; }
  session = s.json.sessionId;
  const q = await api("GET", `/questions?session=${encodeURIComponent(session)}`);
  renderQuiz(q.json.questions);
  show("quiz");
}

function renderQuiz(questions) {
  const f = $("quizForm");
  f.textContent = "";
  for (const q of questions) {
    const box = document.createElement("div"); box.className = "q";
    const p = document.createElement("p"); p.textContent = q.title; box.appendChild(p);
    for (const o of q.options) {
      const l = document.createElement("label");
      const r = document.createElement("input"); r.type = "radio"; r.name = q.id; r.value = o.id;
      l.appendChild(r); l.appendChild(document.createTextNode(" " + o.text)); box.appendChild(l);
    }
    f.appendChild(box);
  }
}

$("submitQuiz").addEventListener("click", async () => {
  const answers = {};
  for (const el of $("quizForm").querySelectorAll("input:checked")) answers[el.name] = el.value;
  if (Object.keys(answers).length < $("quizForm").querySelectorAll(".q").length) { status("すべての質問にお答えください。"); return; }
  status("");
  const r = await api("POST", "/answers", { session, answers });
  if (r.status !== 200 || !r.json.page?.ok) { status("結果を表示できませんでした。"); return; }
  const p = r.json.page, b = $("resultBody");
  b.textContent = "";
  line(b, p.intro, "");
  line(b, `おすすめ: ${p.menu.displayName}`, "note");
  if (p.typeName) line(b, `${p.typeName}: ${p.typeDescription ?? ""}`, "");
  if (p.patternLine) line(b, p.patternLine, "");
  line(b, p.disclaimer, "muted");
  show("result");
});

$("goLink").addEventListener("click", () => {
  const n = $("notice"); n.textContent = "";
  const fn = info.friendNotice;
  if (fn) for (const k of ["experiment", "ai", "not_medical", "data", "stop"]) if (fn[k]) line(n, fn[k], "");
  $("tStorage").textContent = info.consent.storage; $("tMemory").textContent = info.consent.conversation_memory;
  $("tDelivery").textContent = info.consent.memory_for_delivery; $("tFollow").textContent = info.consent.followup_send;
  $("tExperiment").textContent = info.experimentNotice;
  show("link");
});

$("doLink").addEventListener("click", async () => {
  if (!$("cStorage").checked) { status("保存への同意が必要です。"); return; }
  const r = await api("POST", "/link", { session, idToken, consents: { storage: true, conversation_memory: $("cMemory").checked, memory_for_delivery: $("cDelivery").checked, followup_send: $("cFollow").checked } });
  if (r.status !== 200) { status("結び付けられませんでした。もう一度お試しください。"); return; }
  status("");
  if (r.json.showFriendAddButton) await showFriend(); else await openConsult();
});

async function showFriend() {
  $("addFriendPrompt").textContent = info.addFriendPrompt;
  $("addFriendLink").href = CONFIG.ADD_FRIEND_URL;
  show("friend");
}
$("recheck").addEventListener("click", async () => {
  const r = await api("POST", "/friendship", { idToken });
  if (r.json?.showFriendAddButton) status("まだ友だちになっていないようです。"); else { status(""); await openConsult(); }
});

async function openConsult() {
  $("banner").textContent = info.aiBanner;
  show("consult");
}

$("send").addEventListener("click", async () => {
  const text = $("msg").value.trim();
  if (!text) return;
  $("msg").value = "";
  line($("log"), text, "bubble me");
  const r = await api("POST", "/consult", { idToken, message: text });
  line($("log"), r.json?.reply ?? "うまく送れませんでした。", "bubble");
  if (r.json?.actions?.length) status("下のボタンで、記憶や履歴を消せます。");
});
$("forgetMemory").addEventListener("click", async () => { const r = await api("POST", "/forget", { idToken, mode: "memory" }); line($("log"), r.json?.message ?? "消しました。", "bubble"); });
$("deleteHistory").addEventListener("click", async () => { const r = await api("POST", "/forget", { idToken, mode: "history" }); $("log").textContent = ""; line($("log"), r.json?.message ?? "消しました。", "bubble"); });
$("withdraw").addEventListener("click", async () => {
  if (!window.confirm("保存したデータをすべて消します。よろしいですか？")) return;
  const r = await api("POST", "/withdraw", { idToken });
  status(r.json?.deleted ? "データを消しました。ご利用ありがとうございました。" : "消せませんでした。担当者にお伝えください。");
  show();
});

boot().catch(() => status("読み込めませんでした。"));
