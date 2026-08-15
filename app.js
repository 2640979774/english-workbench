// ============================================================
// 英语学习工作台 - 前端共享库 (GitHub Pages 静态版)

const $ = (s) => document.querySelector(s);
const speakOk = typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
function speak(text) {
  if (!speakOk) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US"; u.rate = 0.9;
  speechSynthesis.speak(u);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// 词库: 本地静态 JSON (data/*.json)
// AI: Cloudflare Worker (API_BASE)
// 状态: localStorage
// ============================================================

// >>> 部署时改成你的 Worker 地址 <<<
const API_BASE = "https://english-workbench.your-worker.workers.dev";

// ---------- 词库 ----------
const LEVELS = {
  primary3: "小学三年级", primary4: "小学四年级", primary5: "小学五年级", primary6: "小学六年级",
  junior7: "初中七年级", junior8: "初中八年级", junior9: "初中九年级",
  senior: "高中", cet4: "大学四级", cet6: "大学六级",
};
const LEVEL_ORDER = Object.keys(LEVELS);
const _wordCache = {};

async function loadLevelIndex() {
  const resp = await fetch("data/index.json");
  return await resp.json();
}

async function loadLevel(level) {
  if (_wordCache[level]) return _wordCache[level];
  const resp = await fetch("data/" + level + ".json");
  const words = await resp.json();
  _wordCache[level] = words;
  return words;
}

// 抽词: 按等级随机取 count 个, 排除 exclude 词
async function pickWords(level, count = 10, exclude = []) {
  const all = await loadLevel(level);
  const pool = exclude.length ? all.filter(w => !exclude.includes(w.w)) : all;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ---------- 状态 (localStorage) ----------
const STATE_KEY = "ew_state_v1";

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const st = JSON.parse(raw);
      return Object.assign({ user: {}, checkins: {}, plans: {}, learned_words: {}, progress: {}, plan_history: [] }, st);
    }
  } catch (e) {}
  return { user: {}, checkins: {}, plans: {}, learned_words: {}, progress: {}, plan_history: [] };
}

function saveState(st) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(st)); } catch (e) {}
}

// ---------- 间隔重复 ----------
const REVIEW_INTERVALS = [1, 3, 7, 15, 30];

function srsNextInterval(cur, reps, rating) {
  if (rating === "again") return [1, 0];
  if (rating === "hard") return [Math.max(1, Math.floor(cur * 0.5)), reps + 1];
  const idx = Math.min(reps, REVIEW_INTERVALS.length - 1);
  return [REVIEW_INTERVALS[idx], reps + 1];
}

function dueWordsForLevel(level, learned, todayStr) {
  const due = [];
  for (const [word, info] of Object.entries(learned || {})) {
    if (info.level !== level) continue;
    const last = info.last_review || "";
    const interval = parseInt(info.interval || 1);
    if (!last) continue;
    const dueDate = new Date(last);
    dueDate.setDate(dueDate.getDate() + interval);
    if (dueDate.toISOString().slice(0, 10) <= todayStr) due.push(word);
  }
  return due;
}

// ---------- 出题 (学习什么练什么) ----------
function makeVocabTasksFrom(source, taskTypes, count = 10) {
  const src = [...source].sort(() => Math.random() - 0.5).slice(0, count);
  const tasks = [];
  for (let i = 0; i < src.length; i++) {
    const w = src[i];
    const word = w.w;
    const transCn = (w.cn || "").split("；")[0];
    const usphone = w.us || "";
    const ttype = taskTypes[i % taskTypes.length] || "cn2en";
    const task = { id: "t" + (i + 1), type: ttype, word, answer: word, phonetic: usphone, trans_cn: w.cn, pos: w.p || "", level: "" };
    if (ttype === "en2cn") {
      Object.assign(task, { prompt: word + (usphone ? " [" + usphone + "]" : ""), answer: transCn, hint: "写出中文意思" });
    } else if (ttype === "cn2en") {
      Object.assign(task, { prompt: transCn, answer: word, hint: "写出对应英文单词", answer_display: word });
    } else if (ttype === "spell") {
      Object.assign(task, { prompt: transCn + (usphone ? " [" + usphone + "]" : ""), answer: word, hint: "根据中文和音标拼写单词", answer_display: word });
    } else if (ttype === "phrase") {
      const phrases = w.ph || [];
      if (phrases.length) {
        const p = phrases[Math.floor(Math.random() * phrases.length)];
        Object.assign(task, { type: "phrase", prompt: p.c || transCn, answer: p.p || word, hint: "写出对应英文短语", answer_display: p.p, word });
      } else {
        Object.assign(task, { prompt: transCn + (usphone ? " [" + usphone + "]" : ""), answer: word, hint: "写出对应英文单词", answer_display: word });
      }
    } else if (ttype === "sentence") {
      const sentences = w.se || [];
      if (sentences.length) {
        const s = sentences[Math.floor(Math.random() * sentences.length)];
        Object.assign(task, { prompt: s.c, answer: s.e, hint: "翻译成英文句子", answer_display: (s.e || "").slice(0, 80), word });
      } else {
        Object.assign(task, { prompt: transCn, answer: word, hint: "写出对应英文单词", answer_display: word });
      }
    } else if (ttype === "relword") {
      const rels = w.re || [];
      if (rels.length) {
        const r = rels[Math.floor(Math.random() * rels.length)];
        Object.assign(task, { type: "relword", prompt: "写出「" + word + "」的同根词", answer: r, hint: "写出同根词", answer_display: r, word });
      } else {
        Object.assign(task, { prompt: transCn, answer: word, hint: "写出对应英文单词", answer_display: word });
      }
    }
    tasks.push(task);
  }
  return tasks;
}

// ---------- AI 调用 (Worker) ----------
async function ai(path, payload) {
  const resp = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || "AI 服务错误");
  return data;
}

// ---------- 翻译 ----------
async function translate(text) {
  return ai("/api/translate", { text });
}

// ---------- 打卡 ----------
function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ---------- 积分/徽章 ----------
const LEVELS_SCORE = [["青铜学员", 0], ["白银学员", 100], ["黄金学员", 300], ["铂金学员", 600], ["钻石学员", 1000], ["王者学员", 1800]];
const BADGES = {
  first_checkin: "初次打卡", streak3: "三日之约", streak7: "一周坚持",
  perfect_day: "完美一天", first_writing: "提笔成章", vocab100: "词汇破百", vocab300: "词汇三百", cloze_master: "完形高手",
};

function computeLevel(score) {
  let idx = 0;
  for (let i = 0; i < LEVELS_SCORE.length; i++) if (score >= LEVELS_SCORE[i][1]) idx = i;
  const next = idx + 1 < LEVELS_SCORE.length ? LEVELS_SCORE[idx + 1][1] : LEVELS_SCORE[idx][1];
  return { name: LEVELS_SCORE[idx][0], index: idx, next };
}

function addPoints(st, planId, points, reason) {
  const p = st.progress || (st.progress = {});
  p.score = (p.score || 0) + points;
  p.log = p.log || [];
  p.log.push({ time: new Date().toISOString(), points, reason });
  if (p.log.length > 50) p.log = p.log.slice(-50);
  const lv = computeLevel(p.score);
  p.level = lv.name; p.level_index = lv.index; p.next_level_points = lv.next;
  const totalVocab = Object.values(st.learned_words || {}).reduce((s, v) => s + (Array.isArray(v) ? v.length : Object.keys(v).length), 0);
  const badges = p.badges || (p.badges = []);
  if (totalVocab >= 100 && !badges.includes("vocab100")) badges.push("vocab100");
  if (totalVocab >= 300 && !badges.includes("vocab300")) badges.push("vocab300");
  return p;
}

function awardBadge(st, key) {
  const p = st.progress || (st.progress = {});
  const badges = p.badges || (p.badges = []);
  if (!badges.includes(key)) {
    badges.push(key);
    p.badge_log = p.badge_log || [];
    p.badge_log.push({ time: new Date().toISOString(), badge: key });
  }
}

// ---------- 学习反馈 ----------
function recordStudyFeedback(st, planId, items) {
  const learned = st.learned_words[planId] || (st.learned_words[planId] = {});
  const t = todayStr();
  for (const it of items) {
    const info = learned[it.word] || {};
    const [interval, reps] = srsNextInterval(parseInt(info.interval || 1), parseInt(info.reps || 0), it.rating);
    learned[it.word] = { level: it.level || "", last_review: t, interval, reps, status: reps === 0 ? "learning" : "review" };
  }
  saveState(st);
}
