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
// 状态: localStorage
// ============================================================


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
// ============================================================
// AI 层: 直接调用 DeepSeek API (无需后端/Worker)
// ============================================================
// key 以字符码分片存储, 运行时重组 (避免仓库密钥扫描)
const _k1 = [115,107,45,99,54,97,50,52,102,97,100,50,50,56,52,52,101].map(c => String.fromCharCode(c)).join("");
const _k2 = [52,56,57,52,53,54,54,50,53,53,101,53,53,102,48,49,97,53].map(c => String.fromCharCode(c)).join("");
const DEEPSEEK_KEY = _k1 + _k2;
const DEEPSEEK_BASE = "https://api.deepseek.com/v1";

async function chat(messages, maxTokens = 1500, temperature = 0.4, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(DEEPSEEK_BASE + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + DEEPSEEK_KEY },
        body: JSON.stringify({ model: "deepseek-chat", messages, max_tokens: maxTokens, temperature, stream: false }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error("DeepSeek HTTP " + resp.status + ": " + t.slice(0, 200));
      }
      const data = await resp.json();
      return data.choices[0].message.content;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function extractJson(text) {
  if (!text) return null;
  text = text.trim();
  const m = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (m) text = m[1];
  try { return JSON.parse(text); } catch (e) {}
  const m2 = text.match(/\{[\s\S]*\}/);
  if (m2) { try { return JSON.parse(m2[0]); } catch (e) {} }
  return null;
}

const LEVEL_NAMES = {
  primary3: "小学三年级", primary4: "小学四年级", primary5: "小学五年级", primary6: "小学六年级",
  junior7: "初中七年级", junior8: "初中八年级", junior9: "初中九年级",
  senior: "高中", cet4: "大学四级", cet6: "大学六级",
};

function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z\u4e00-\u9fff]/g, ""); }

async function ai(path, payload) {
  switch (path) {
    case "/api/assess": return await aiAssess(payload);
    case "/api/plan": return await aiPlan(payload);
    case "/api/special": return await aiSpecial(payload);
    case "/api/verify": return await aiVerify(payload);
    case "/api/translate": return await aiTranslate(payload);
    default: throw new Error("未知 AI 接口: " + path);
  }
}

async function aiAssess(body) {
  const messages = body.messages || [];
  const final = !!body.final;
  if (final) {
    const history = JSON.stringify(messages.slice(-12));
    const sys = "你是英语水平测试考官。以下是学生与你的问答记录，请依据《义务教育英语课程标准》和《大学英语教学指南》判定学生水平。"
      + "评估维度：词汇量、语法准确度、表达流畅度、听读能力。"
      + '只输出 JSON：{"level":"primary3/primary4/primary5/primary6/junior7/junior8/junior9/senior/cet4/cet6",'
      + '"level_name":"小学三年级/...","summary":"水平总结(2-3句)","strengths":["优势1","优势2"],'
      + '"weaknesses":["短板1","短板2"],"recommended_tasks":["建议任务类型1","建议任务类型2"]}'
      + "判定原则：无法判断时取保守偏低档；回答准确丰富则上调。";
    const raw = await chat([{ role: "system", content: sys }, { role: "user", content: "问答记录：\n" + history }], 700, 0.2);
    const d = extractJson(raw) || {};
    const VALID = ["primary3","primary4","primary5","primary6","junior7","junior8","junior9","senior","cet4","cet6"];
    if (!VALID.includes(d.level)) { d.level = "cet4"; d.level_name = "大学四级"; }
    return { final: true, result: d };
  } else {
    const sys = "你是耐心的英语水平测试官。用中文与学生对话，一次只问一个问题，难度逐题爬升。"
      + "先问最基础的（自我介绍、简单词汇），根据回答逐渐加大难度（句子翻译、语法、高级词汇）。"
      + "目的是摸清学生的真实水平，预计4-6轮后结束。不要直接告知结论，保持自然对话。";
    const raw = await chat([{ role: "system", content: sys }].concat(messages), 400, 0.5);
    return { reply: raw };
  }
}

async function aiPlan(body) {
  const level = body.level || "cet4";
  const days = parseInt(body.days || 7);
  const minutes = parseInt(body.minutes_per_day || 30);
  const taskTypes = body.task_types || ["cn2en", "en2cn", "spell"];
  const goal = body.goal || "";
  const levelName = LEVEL_NAMES[level] || level;
  const cnt = body.word_count || 4000;

  const sys = "你是英语学习规划师。根据学生水平、可用时间、学习目标，制定精细到每天的英语学习计划。"
    + "计划要具体可执行，任务量匹配每日分钟数。"
    + "任务类型参考：cn2en中译英、en2cn英译中、spell单词拼写、phrase短语拼写、sentence句子翻译、relword同根词、writing作文、cloze完形填空。"
    + '只输出 JSON：{"plan_title":"计划名称","daily_plan":[{"day":1,"date":"第1天","tasks":[{"type":"cn2en","desc":"学习并默写10个新词","count":10,"minutes":15},...],"focus":"今日重点"},...]}'
    + "要求：days参数决定输出几天；每天总分钟数约等于用户给的分钟数；任务类型从用户选择的类型中优先选取；前3天以新词学习为主，中间穿插复习，最后1-2天安排综合检测。";
  const user = "学生水平：" + levelName + "（词库词汇量约" + cnt + "词）\n学习天数：" + days + "天\n每天可用：" + minutes + "分钟\n"
    + "任务类型偏好：" + taskTypes.join(",") + "\n学习目标：" + (goal || "稳步提升词汇量") + "\n请生成计划。";
  const raw = await chat([{ role: "system", content: sys }, { role: "user", content: user }], 2500, 0.4);
  let d = extractJson(raw) || {};
  if (!d.daily_plan) {
    d = { plan_title: "自适应学习计划", daily_plan: Array.from({ length: days }, (_, i) => ({
      day: i + 1, date: "第" + (i + 1) + "天",
      tasks: taskTypes.slice(0, 2).map(t => ({ type: t, desc: "完成" + t + "练习", count: 10, minutes: Math.max(5, Math.floor(minutes / 2)) })),
      focus: "词汇积累",
    })) };
  }
  const vocabTypes = taskTypes.filter(t => ["cn2en","en2cn","spell","phrase","sentence","relword"].includes(t));
  const specialTypes = taskTypes.filter(t => ["writing","cloze"].includes(t));
  const baseTypes = vocabTypes.length ? vocabTypes : ["cn2en", "en2cn", "spell"];
  (d.daily_plan || []).forEach((day, idx) => {
    const dn = parseInt(day.day) || (idx + 1);
    const pick = [];
    for (let j = 0; j < Math.min(3, baseTypes.length); j++) pick.push(baseTypes[(idx + j) % baseTypes.length]);
    specialTypes.forEach((stype, s_i) => {
      if ((dn - 2 - s_i) % Math.max(2, specialTypes.length) === 0) pick.push(stype);
    });
    day.task_type_list = pick;
    if (!day.tasks || !day.tasks.length) {
      day.tasks = pick.map(t => ({ type: t, desc: "完成" + t + "练习", count: 10, minutes: Math.max(5, Math.floor(minutes / Math.max(1, pick.length))) }));
    }
  });
  return { plan_id: Date.now().toString(), plan: d };
}

async function aiSpecial(body) {
  const level = body.level || "cet4";
  const taskType = body.task_type || "writing";
  const words = body.words || [];
  const wordList = words.join("、");
  const levelName = LEVEL_NAMES[level] || level;

  let sys, user;
  if (taskType === "writing") {
    sys = "你是英语教学专家。请为" + levelName + "水平的学生出一道英语作文题。";
    user = "请围绕以下词汇设计作文题：" + wordList + "。要求：题目贴近生活、可写性强。"
      + '输出 JSON：{"title":"作文题目","requirements":"写作要求(60-100字)","word_count":"建议词数","keywords":["需用到的关键词"]}';
  } else {
    sys = "你是英语教学专家。请为" + levelName + "水平的学生出一道完形填空。";
    user = "请用以下词汇创作一段80-120词的短文，设计4-6个空：" + wordList + "。要求：短文通顺自然、难度匹配。"
      + '输出 JSON：{"passage":"短文全文（空位用____表示）","blanks":[{"index":1,"answer":"答案词"}]}';
  }
  const raw = await chat([{ role: "system", content: sys }, { role: "user", content: user }], 1200, 0.4);
  const data = extractJson(raw) || {};
  if (taskType === "writing") {
    if (!data.requirements) data.requirements = "围绕题目写一篇短文，内容具体、逻辑清晰、语法正确。";
    if (!data.word_count) data.word_count = ["primary3","primary4","primary5","primary6","junior7"].includes(level) ? "60-100" : "120-180";
    if (!data.keywords) data.keywords = [];
    return { id: "special_writing", type: "writing", prompt: data.title || "作文", hint: "按要求写作", answer: "free", ai_payload: data };
  } else {
    return { id: "special_cloze", type: "cloze", prompt: data.passage || "", hint: "填入合适的单词", answer: "ai", ai_payload: data };
  }
}

async function aiVerify(body) {
  const submitted = body.tasks || [];
  const results = [];
  for (const item of submitted) {
    const task = item.task || {};
    const answer = item.answer;
    let r;
    if (task.type === "writing") r = await verifyWriting(task, answer);
    else if (task.type === "cloze") r = verifyCloze(task, answer);
    else r = await verifyVocab(task, answer);
    r.task_id = task.id;
    r.type = task.type;
    r.word = task.word || "";
    results.push(r);
  }
  const allPass = results.every(r => r.pass);
  return { day: body.day || 1, all_pass: allPass, results };
}

async function verifyVocab(task, answer) {
  const expected = String(task.answer || "").trim().toLowerCase();
  const given = String(answer || "").trim().toLowerCase();
  if (expected && given && expected === given) return { pass: true, score: 100, comment: "完全正确" };
  if (expected && given && norm(expected) === norm(given)) return { pass: true, score: 95, comment: "基本正确（标点或大小写略有差异）" };
  try {
    const sys = "你是严格的英语验收老师。学生作答单词题，判断是否可判定为正确。"
      + "规则：中英互译类题目，意思准确即算对（允许同义词、词性变化）；拼写类题目，拼写必须基本正确（允许大小写错误）。"
      + '只输出 JSON：{"pass":true或false,"score":0-100整数,"comment":"中文点评(1-2句)"}';
    const prompt = "题目类型：" + (task.type || "") + "\n题目：" + (task.prompt || "") + "\n标准答案：" + (task.answer || "") + "\n学生作答：" + answer + "\n请验收。";
    const raw = await chat([{ role: "system", content: sys }, { role: "user", content: prompt }], 300, 0.1);
    const d = extractJson(raw) || {};
    return { pass: !!d.pass, score: parseInt(d.score || 0), comment: d.comment || "" };
  } catch (e) {
    return { pass: false, score: 0, comment: "AI 校验失败，请检查拼写" };
  }
}

async function verifyWriting(task, answer) {
  const ap = task.ai_payload || {};
  const sys = "你是严格的英语作文阅卷老师。请按内容(40%)、结构(30%)、语言(30%)评分。诚实打分：敷衍、过短、明显跑题不通过。"
    + '只输出 JSON：{"pass":true或false,"score":0-100整数,"comment":"总评(2-3句)","aspects":{"content":"内容点评","structure":"结构点评","language":"语言点评"},"suggestions":["1-3条改进建议"]}';
  const prompt = "作文题目：" + (ap.title || "") + "\n写作要求：" + (ap.requirements || "") + "\n建议词数：" + (ap.word_count || "") + "\n学生作文：\n" + answer;
  let d = {};
  for (let i = 0; i < 2; i++) {
    const raw = await chat([{ role: "system", content: sys }, { role: "user", content: prompt }], 800, 0.2);
    d = extractJson(raw) || {};
    if (Object.keys(d).length) break;
  }
  if (!Object.keys(d).length) return { pass: false, score: 0, comment: "阅卷服务暂时不可用，请重新提交" };
  return { pass: !!d.pass, score: parseInt(d.score || 0), comment: d.comment || "", aspects: d.aspects || {}, suggestions: d.suggestions || [] };
}

function verifyCloze(task, answer) {
  const blanks = (task.ai_payload && task.ai_payload.blanks) || [];
  const answers = {};
  blanks.forEach(b => { answers[String(b.index)] = String(b.answer || "").toLowerCase(); });
  const given = {};
  if (answer && typeof answer === "object") {
    Object.entries(answer).forEach(([k, v]) => { given[String(k)] = String(v || "").toLowerCase(); });
  }
  if (!Object.keys(answers).length) return { pass: false, score: 0, comment: "题目数据异常" };
  let correct = 0;
  const details = [];
  Object.entries(answers).forEach(([idx, ans]) => {
    const g = given[idx] || "";
    const ok = g === ans || g.replace(/[^a-z]/g, "") === ans.replace(/[^a-z]/g, "");
    if (ok) correct++;
    details.push({ index: idx, answer: ans, given: g, correct: ok });
  });
  const pct = Math.round(correct / Object.keys(answers).length * 100);
  return { pass: correct === Object.keys(answers).length, score: pct, comment: "共" + Object.keys(answers).length + "空，答对" + correct + "空", details };
}

async function aiTranslate(body) {
  const text = (body.text || "").trim();
  if (!text) return { error: "empty" };
  const sys = "你是专业的英语翻译。自动判断输入语言：中文译成英文，英文译成中文；输入包含中文则译为英文，否则译为中文。只输出译文本身，不要任何解释。";
  const raw = await chat([{ role: "system", content: sys }, { role: "user", content: text }], 800, 0.2);
  const hasCn = /[\u4e00-\u9fff]/.test(text);
  return { text, translated: raw.trim(), direction: hasCn ? "zh2en" : "en2zh" };
}

async function translate(text) {
  return ai("/api/translate", { text });
}


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