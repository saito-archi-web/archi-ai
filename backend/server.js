const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
require('dotenv').config();

// ─── レートリミット ────────────────────────────────────────────────────────────
const rateLimit = require('express-rate-limit');

const diagnoseLimiterMin = rateLimit({
  windowMs: 60 * 1000,          // 1分
  max: 3,                        // 同一IPから3回まで
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
  handler: (req, res) => res.status(429).json({ error: 'しばらく時間をおいて再度お試しください。' }),
  standardHeaders: true,
  legacyHeaders: false,
});

const diagnoseLimiterHour = rateLimit({
  windowMs: 60 * 60 * 1000,     // 1時間
  max: 10,                       // 同一IPから10回まで
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0] || req.ip,
  handler: (req, res) => res.status(429).json({ error: '本日の利用上限に達しました。しばらく時間をおいて再度お試しください。' }),
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── reCAPTCHA 検証 ────────────────────────────────────────────────────────────
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY;
const MOCK_RECAPTCHA   = !RECAPTCHA_SECRET;

async function verifyRecaptcha(token) {
  if (MOCK_RECAPTCHA) { console.log('[reCAPTCHA] キー未設定 → スキップ'); return true; }
  if (!token)         { console.log('[reCAPTCHA] トークンなし → スキップ'); return true; }
  try {
    const resp = await fetch(
      `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET}&response=${token}`,
      { method: 'POST' }
    );
    const data = await resp.json();
    const ok = data.success && (data.score ?? 1) >= 0.6;
    console.log(`[reCAPTCHA] success=${data.success} score=${data.score ?? 'n/a'} → ${ok ? '✅通過' : '❌ブロック'}`);
    return ok;
  } catch (e) {
    console.log('[reCAPTCHA] 検証エラー → 通す', e.message);
    return true;
  }
}

// ─── Stripe ──────────────────────────────────────────────────────────────────
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const MOCK_STRIPE = !STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.startsWith('sk_test_placeholder');
const stripe = MOCK_STRIPE ? null : require('stripe')(STRIPE_SECRET_KEY);
if (MOCK_STRIPE) console.log('[Stripe] キー未設定 → モックモードで動作');

const app = express();

// ファイルはメモリ上に保持（ディスク不要）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('JPG・PNG・WebP・PDF形式のみ対応しています'));
    }
  },
});

// ─── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || null; // 例: https://archi-ai.onrender.com
app.use(cors(ALLOWED_ORIGIN && process.env.NODE_ENV === 'production'
  ? { origin: ALLOWED_ORIGIN, credentials: true }
  : {}
));

// ─── 支払い済みフラグ永続化 ──────────────────────────────────────────────────
const PAID_FLAGS_FILE = path.join(__dirname, 'tmp_paid_flags.json');
let paidFlags = {};
try {
  if (fs.existsSync(PAID_FLAGS_FILE)) {
    paidFlags = JSON.parse(fs.readFileSync(PAID_FLAGS_FILE, 'utf8'));
    console.log(`[PaidFlags] ${Object.keys(paidFlags).length}件の支払い済みフラグを読み込みました`);
  }
} catch (e) { console.error('[PaidFlags] 読み込みエラー:', e.message); }

// 書き込み中フラグ（同時実行時の競合を防ぐ簡易ミューテックス）
let paidFlagsWriting = false;
let paidFlagsPending = false;
async function savePaidFlags() {
  // 既に書き込み中の場合は、完了後にもう一度実行するようフラグを立てて戻る
  if (paidFlagsWriting) {
    paidFlagsPending = true;
    return;
  }
  paidFlagsWriting = true;
  try {
    const snapshot = JSON.stringify(paidFlags, null, 2);
    // 同一ディレクトリの一時ファイルに書き込んでから rename → 原子的更新
    const tmpPath = `${PAID_FLAGS_FILE}.tmp`;
    await fs.promises.writeFile(tmpPath, snapshot);
    await fs.promises.rename(tmpPath, PAID_FLAGS_FILE);
  } catch (e) {
    console.error('[PaidFlags] 保存エラー:', e.message);
  } finally {
    paidFlagsWriting = false;
    // 書き込み中に追加の保存要求があった場合は再実行
    if (paidFlagsPending) {
      paidFlagsPending = false;
      savePaidFlags();
    }
  }
}

// ─── Stripe Webhook（express.json()より前に登録必須） ─────────────────────────
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;

app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // モック時はそのまま受け取る
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.log('[Webhook] モックモード → スキップ');
    return res.json({ received: true });
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Webhook] 署名検証失敗:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const diagnosisId = session.metadata?.diagnosisId;
    const email = session.customer_email || session.metadata?.email || '';
    const planKind = session.metadata?.plan || 'ai'; // 'ai' | 'architect'

    if (diagnosisId) {
      // メモリ上のエントリに paid フラグを立てる
      const entry = tempDiagnosisStore.get(diagnosisId);
      if (entry) {
        entry.paid = true;
        console.log(`[Webhook] 決済確認・paid=true diagnosisId=${diagnosisId}`);
      }
      // ディスクに永続化（再起動後も参照可能）
      paidFlags[diagnosisId] = { email, timestamp: Date.now() };
      savePaidFlags();

      // AI診断プランの場合、サーバー側でバックグラウンド診断を即時開始
      // → ブラウザの接続状態に関係なく診断を実行し、完了したらメールで結果を送信
      if (planKind === 'ai' && entry && !MOCK_MODE) {
        runDiagnosisAndEmail(diagnosisId, email).catch(e =>
          console.error('[Webhook] バックグラウンド診断の起動エラー:', e.message)
        );
      }
    }

    // ユーザー向け決済確認メール送信
    if (email) {
      const isArchitect = planKind === 'architect';
      await sendUserConfirmation({
        to: email,
        subject: isArchitect ? '【ArchiAI】一級建築士相談のお申し込みを受け付けました' : '【ArchiAI】AI詳細診断のお申し込みを受け付けました',
        text: isArchitect
          ? `この度は ArchiAI 一級建築士相談プランをお申し込みいただきありがとうございます。\n\n3営業日以内に一級建築士よりメールにてご連絡いたします。\n\n※本メールは自動送信です。ご不明点は ArchiAI@outlook.jp までお問い合わせください。\n\n-- ArchiAI 間取り診断`
          : `この度は ArchiAI AI詳細診断をお申し込みいただきありがとうございます。\n\n診断結果はご購入完了後、画面上でご確認いただけます。ご登録のメールアドレスにも送信可能です（診断結果画面からお手続きください）。\n\n※本メールは自動送信です。ご不明点は ArchiAI@outlook.jp までお問い合わせください。\n\n-- ArchiAI 間取り診断`,
      });
    }
  } else if (event.type === 'checkout.session.expired') {
    // Stripeセッション期限切れ時の処理
    const session = event.data.object;
    const diagnosisId = session.metadata?.diagnosisId;
    if (diagnosisId) {
      console.log(`[Webhook] セッション期限切れ diagnosisId=${diagnosisId}`);
      // 支払い未完了なのでメモリから削除（paidFlagsは作らない）
      tempDiagnosisStore.delete(diagnosisId);
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// ─── メール通知 ───────────────────────────────────────────────────────────────
const NOTIFY_EMAIL = 'ArchiAI@outlook.jp';
const EMAIL_USER   = process.env.EMAIL_USER || NOTIFY_EMAIL;
const EMAIL_PASS   = process.env.EMAIL_PASS || '';
const MOCK_EMAIL   = !EMAIL_PASS;
if (MOCK_EMAIL) console.log('[Email] パスワード未設定 → メール送信をスキップします');

const mailer = nodemailer.createTransport({
  host: 'smtp-mail.outlook.com',
  port: 587,
  secure: false,
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  tls: { ciphers: 'SSLv3' },
  connectionTimeout: 10000,  // SMTP接続タイムアウト 10秒
  greetingTimeout:   10000,  // SMTPグリーティング待機 10秒
  socketTimeout:     15000,  // ソケット無通信タイムアウト 15秒
});

// タイムアウト付き sendMail ラッパー
function sendMailWithTimeout(options, timeoutMs = 20000) {
  return Promise.race([
    mailer.sendMail(options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('メール送信がタイムアウトしました（20秒）')), timeoutMs)
    ),
  ]);
}

async function sendNotification({ subject, text, attachments = [] }) {
  if (MOCK_EMAIL) { console.log(`[Email mock] subject="${subject}" attachments=${attachments.length}`); return; }
  try {
    await sendMailWithTimeout({ from: EMAIL_USER, to: NOTIFY_EMAIL, subject, text, attachments });
    console.log(`[Email] 送信完了: ${subject}`);
  } catch (e) {
    console.error('[Email] 送信エラー:', e.message);
  }
}

// ─── AI詳細診断結果をメールで送信 ────────────────────────────────────────────
async function sendDetailResultEmail(email, result) {
  const { priority_issues = [], life_stress = [], detailed_suggestions = [], verdict, good_points = [], user_question, user_question_answer } = result;
  let body = `【ArchiAI】AI詳細診断レポート\n${'─'.repeat(40)}\n\n`;
  if (priority_issues.length) {
    body += `■ 優先度の高い問題点\n`;
    priority_issues.forEach(p => { body += `\n[優先度${p.rank}] ${p.title}\n${p.detail}\n→ 生活への影響: ${p.impact}\n`; });
  }
  if (life_stress.length) {
    body += `\n■ 住んでから感じるストレス\n`;
    life_stress.forEach(s => { body += `・${s}\n`; });
  }
  if (detailed_suggestions.length) {
    body += `\n■ 具体的な改善提案\n`;
    detailed_suggestions.forEach(s => { body += `\n[${s.area}] ${s.cost_hint}\n${s.action}\n理由: ${s.reason}\n`; });
  }
  if (verdict) body += `\n■ AI総評\n${verdict}\n`;
  if (good_points.length) {
    body += `\n■ この間取りの良い点\n`;
    good_points.forEach(p => { body += `✓ ${p}\n`; });
  }
  if (user_question && user_question_answer) {
    body += `\n■ ご質問への回答\nQ: ${user_question}\nA: ${user_question_answer}\n`;
  }
  body += `\n${'─'.repeat(40)}\n※ 本診断結果は参考情報です。実際の建築計画には専門家にご相談ください。\n※ 診断基準は一級建築士が監修しています。\n\nArchiAI 間取り診断\nhttps://archi-ai.onrender.com\n`;
  const ok = await sendUserConfirmation({ to: email, subject: '【ArchiAI】AI詳細診断レポートをお届けします', text: body });
  if (ok) console.log(`[BG] 結果メール送信完了 → ${email}`);
  return ok;
}

// ─── AI詳細診断バックグラウンド実行（支払い確認後にサーバー側で自動実行） ──────
async function runDiagnosisAndEmail(diagnosisId, email) {
  const entry = tempDiagnosisStore.get(diagnosisId);
  if (!entry) { console.log(`[BG] エントリなし diagnosisId=${diagnosisId}`); return; }
  if (entry.result) { console.log(`[BG] 既にキャッシュ済み`); return; }
  if (entry.running) { console.log(`[BG] 既に実行中`); return; }

  entry.running = true;
  console.log(`[BG] 診断開始 diagnosisId=${diagnosisId}`);

  try {
    const fileBlocks = buildFileContentBlocks(entry.files);
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{ role: 'user', content: [...fileBlocks, { type: 'text', text: buildDetailPrompt(entry.question || '', { floors: entry.floors || '', familySize: entry.familySize || '', ageGroup: entry.ageGroup || '', childrenCount: entry.childrenCount || '' }) }] }],
    }, { timeout: 120 * 1000 }); // バックグラウンドは2分まで許容
    const responseText = message.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AIの応答形式が不正でした');
    entry.result = filterDiagnosisResult(JSON.parse(jsonMatch[0]), entry.floors || '', entry.familySize || '', entry.childrenCount || '');
    entry.running = false;
    console.log(`[BG] 診断完了 diagnosisId=${diagnosisId}`);
    if (email) {
      const sent = await sendDetailResultEmail(email, entry.result);
      if (!sent) {
        // 結果はキャッシュ済み（リトライ可能）だが、メール未達のため管理者に手動対応を促す
        console.error(`[BG] ⚠️ 結果メール送信失敗 diagnosisId=${diagnosisId} email=${email}`);
        await sendNotification({
          subject: '【ArchiAI】⚠️ 結果メール送信失敗（要手動対応）',
          text: `AI詳細診断は完了しましたが、結果メールの送信に失敗しました。\n\n診断ID: ${diagnosisId}\nメール: ${email}\n\nお客様へ手動で結果をお送りするか、状況をご連絡ください。`,
        });
      }
    }
  } catch (err) {
    entry.running = false;
    entry.bgError = err.message;
    console.error(`[BG] 診断エラー diagnosisId=${diagnosisId}:`, err.message);
    if (email) {
      await sendUserConfirmation({
        to: email,
        subject: '【ArchiAI】AI詳細診断の処理について',
        text: `診断処理中にエラーが発生しました。大変お手数ですが ArchiAI@outlook.jp までご連絡ください。\nお名前と決済日時をお知らせいただければ対応いたします。\n\n-- ArchiAI 間取り診断`,
      });
    }
  }
}

// ユーザー向け決済確認メール
async function sendUserConfirmation({ to, subject, text }) {
  if (!to) { console.log('[Email] ユーザー宛先なし → スキップ'); return false; }
  if (MOCK_EMAIL) { console.log(`[Email mock user] to=${to} subject="${subject}"`); return true; }
  try {
    await sendMailWithTimeout({ from: EMAIL_USER, to, subject, text });
    console.log(`[Email] ユーザー向け送信完了: ${to}`);
    return true;
  } catch (e) {
    console.error('[Email] ユーザー向け送信エラー:', e.message);
    return false;
  }
}

const MOCK_MODE = !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here';
const client = MOCK_MODE ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── ファクトチェックフィルター（0追加トークン・ルールベース） ───────────────────
// 入力された前提条件と矛盾する診断項目をサーバー側で除去する

// 階数ごとに「出てはいけないワード」を定義
// 注意：'上の階'は2階建てでは2階を指す正当な表現のため、平屋（上階が存在しない）にのみ含める
const FLOOR_FORBIDDEN_WORDS = {
  '平屋':    ['2階', '二階', '2F', '上階', '上の階', '上層', '2つ目の階', '階段'],
  '2階建て': ['3階', '三階', '3F', '4階'],
  '3階建て': ['4階', '四階', '4F', '5階'],
};

// 子どもなし判定で使う禁止ワード
const NO_CHILDREN_FORBIDDEN_WORDS = ['子ども', '子供', '子育て', '育児', 'お子', 'キッズ', '子ども部屋', '子供部屋', '保育', '通学'];

// 総評文（overall_comment / verdict）から、禁止ワードを含む文だけを除去する。
// 配列項目と違い丸ごと消せないため、句点単位で矛盾文のみ落とし、全消失時はフォールバック文を返す。
function scrubForbiddenSentences(text, forbidden, fallback) {
  if (!text || typeof text !== 'string') return text;
  if (!forbidden.some(w => text.includes(w))) return text;
  const kept = text.split(/(?<=。)/).filter(s => !forbidden.some(w => s.includes(w)));
  const joined = kept.join('').trim();
  return joined.length > 0 ? joined : fallback;
}

function filterDiagnosisResult(result, floors, familySize, childrenCount = '') {
  if (!result) return result;

  const hasNoChildren = familySize === '1人' || childrenCount === '0人';
  const forbidden = [
    ...(FLOOR_FORBIDDEN_WORDS[floors] || []),
    ...(hasNoChildren ? NO_CHILDREN_FORBIDDEN_WORDS : []),
  ];
  if (forbidden.length === 0) return result;

  const hasForbidden = (text) =>
    text && forbidden.some(w => text.includes(w));

  const filterArr = (arr) =>
    Array.isArray(arr) ? arr.filter(s => !hasForbidden(typeof s === 'string' ? s : null)) : arr;

  const filterObjArr = (arr, keys) =>
    Array.isArray(arr) ? arr.filter(obj => !keys.some(k => hasForbidden(obj?.[k]))) : arr;

  const before = {
    issues:       result.issues?.length || 0,
    suggestions:  result.suggestions?.length || 0,
    good_points:  result.good_points?.length || 0,
    priority:     result.priority_issues?.length || 0,
    life_stress:  result.life_stress?.length || 0,
    suggestions2: result.detailed_suggestions?.length || 0,
  };

  const filtered = {
    ...result,
    issues:               filterArr(result.issues),
    suggestions:          filterArr(result.suggestions),
    good_points:          filterArr(result.good_points),
    priority_issues:      filterObjArr(result.priority_issues,      ['title', 'detail', 'impact']),
    life_stress:          filterArr(result.life_stress),
    detailed_suggestions: filterObjArr(result.detailed_suggestions, ['area', 'action', 'reason']),
  };

  // 総評文の矛盾文を除去（唯一フィルタが効いていなかった欄。クレーム文面になりやすいため）
  filtered.overall_comment = scrubForbiddenSentences(result.overall_comment, forbidden,
    '間取り図をもとに各観点から総合的に評価しました。詳細は各項目をご確認ください。');
  filtered.verdict = scrubForbiddenSentences(result.verdict, forbidden,
    '総合的に見て改善の余地がある間取りです。詳細は各項目をご確認ください。');

  // 除去件数をログ（デバッグ用）
  const removed =
    (before.issues       - (filtered.issues?.length || 0)) +
    (before.suggestions  - (filtered.suggestions?.length || 0)) +
    (before.priority     - (filtered.priority_issues?.length || 0)) +
    (before.life_stress  - (filtered.life_stress?.length || 0)) +
    (before.suggestions2 - (filtered.detailed_suggestions?.length || 0));

  if (removed > 0) {
    console.log(`[FactFilter] floors="${floors}" family="${familySize}" children="${childrenCount}" → ${removed}件の矛盾項目を除去`);
  }

  // 過剰除去ガード：主要な出力がすべて空になった場合はフィルタ前を返す（空レポート防止）
  // 課金ユーザーが空のレポートを受け取る事故を防ぐ。矛盾が残るリスクより空レポートのほうが致命的なため。
  const detailEmptied =
    (before.priority > 0 || before.life_stress > 0 || before.suggestions2 > 0) &&
    (filtered.priority_issues?.length      || 0) === 0 &&
    (filtered.life_stress?.length          || 0) === 0 &&
    (filtered.detailed_suggestions?.length || 0) === 0;
  const freeEmptied =
    (before.issues > 0 || before.suggestions > 0) &&
    (filtered.issues?.length      || 0) === 0 &&
    (filtered.suggestions?.length || 0) === 0;
  if (detailEmptied || freeEmptied) {
    console.warn(`[FactFilter] 過剰除去を検出（主要項目が全消失）→ フィルタを無効化し元の結果を返します floors="${floors}" family="${familySize}" children="${childrenCount}"`);
    return result;
  }

  return filtered;
}

// ─── 診断の日次制限（サーバー側・IP単位） ────────────────────────────────────
// localStorage制限はincognitoで回避できるため、IP単位でサーバー側でも制限する。
// 2種類の上限を持つ：
//   - success: 提供する「成功した診断」数（商品としての無料枠）。我々起因の失敗で枠を消費させない。
//   - attempts: AI APIを呼んだ回数（失敗含む）。コスト上限。失敗を繰り返してAPIを浪費する濫用を遮断する。
// ※IPは万能ではない（VPN・モバイル回線のIP変動・同一NAT共有は合算）が、カジュアルな濫用は防げる。
const DAILY_LIMITS = {
  free:   { attempts: parseInt(process.env.FREE_DAILY_ATTEMPTS   || '6',  10), success: parseInt(process.env.FREE_DAILY_SUCCESS || '2', 10) },
  // detailは本番の有料フローでは未使用（決済フローは detail-by-id を使う）。未認証でSonnetを呼べるため濫用抑制が目的。
  detail: { attempts: parseInt(process.env.DETAIL_DAILY_ATTEMPTS || '10', 10), success: parseInt(process.env.DETAIL_DAILY_ATTEMPTS || '10', 10) },
};
const dailyUsage = new Map(); // `${bucket}:${ip}` -> { date, success, attempts }
const dailyIpOf = (req) => (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').trim();

function getDailyRec(bucket, req) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${bucket}:${dailyIpOf(req)}`;
  let rec = dailyUsage.get(key);
  if (!rec || rec.date !== today) { rec = { date: today, success: 0, attempts: 0 }; dailyUsage.set(key, rec); }
  return rec;
}
function dailyLimiter(bucket) {
  return (req, res, next) => {
    if (MOCK_MODE) return next(); // 開発時は制限しない
    const lim = DAILY_LIMITS[bucket];
    const rec = getDailyRec(bucket, req);
    if (rec.attempts >= lim.attempts) {
      return res.status(429).json({ error: '本日のご利用回数の上限に達しました。日付が変わってから再度お試しください。' });
    }
    if (rec.success >= lim.success) {
      return res.status(429).json({
        error: bucket === 'free'
          ? `無料診断は1日${lim.success}件までご利用いただけます。日付が変わってから再度お試しください。より詳しい診断をご希望の場合はAI詳細診断もご利用いただけます。`
          : '本日のご利用上限に達しました。日付が変わってから再度お試しください。',
      });
    }
    next();
  };
}
// AI APIを呼ぶ直前に呼び出す（失敗してもコストは発生するためカウントする）
function recordDailyAttempt(bucket, req) { getDailyRec(bucket, req).attempts++; }
// 診断が成功して結果を返す直前に呼び出す
function recordDailySuccess(bucket, req) { getDailyRec(bucket, req).success++; }

if (MOCK_MODE) console.log('[モード] APIキー未設定 → モックデータで動作します');

// ─── AI詳細診断ファイル一時保管（Stripe決済後に即時結果を返すため） ──────────
const tempDiagnosisStore = new Map(); // id -> { files, result?, timestamp }
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2時間でTTL
  for (const [id, entry] of tempDiagnosisStore) {
    if (entry.timestamp < cutoff) tempDiagnosisStore.delete(id);
  }
  // 診断の日次カウンタも、前日以前のエントリを掃除（メモリ肥大防止）
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, rec] of dailyUsage) {
    if (rec.date !== today) dailyUsage.delete(key);
  }
}, 30 * 60 * 1000);

const MOCK_DIAGNOSIS = {
  scores: { dosen: 72, lighting: 58, storage: 65, space: 80, future: 60 },
  total: 67,
  good_points: [
    'リビング・ダイニングが南向きで採光条件が良好です',
    '主寝室が静かな北側に配置されており、睡眠環境として優れています',
    '玄関からLDKへの動線がシンプルで来客対応しやすい間取りです',
  ],
  issues: [
    'キッチンから洗面所・洗濯機置き場への家事動線が長く、毎日の家事負担が蓄積します',
    '子ども部屋が北西角に位置しており、日照時間が極端に短くなる可能性があります',
    'トイレが玄関直近に配置されており、来客時に使いにくい・気まずいレイアウトです',
  ],
  suggestions: [
    '洗面脱衣室をキッチン横に移動することで家事動線を大幅に短縮できます',
    '子ども部屋に天窓または高窓を設けることで採光不足を補えます',
    'トイレ位置を廊下奥に変更するか、扉の向きを変えてプライバシーを確保しましょう',
  ],
  overall_comment: 'LDKの配置は優秀ですが、家事動線と水回りの配置に課題があります。毎日の生活で蓄積するストレスを軽減するため、洗面・トイレ周りの再検討を強くお勧めします。',
};

const MOCK_DETAIL = {
  priority_issues: [
    { rank: 1, title: '家事動線の深刻な非効率', detail: 'キッチン〜洗面所間の移動距離が約8mあり、1日平均20往復すると仮定すると年間で約58kmを無駄に歩くことになります。', impact: '料理中の洗濯対応が困難になり、特に小さなお子さんがいる時期に強いストレスを感じます' },
    { rank: 2, title: '北西角の子ども部屋の日照不足', detail: '冬至の日照時間が1日1時間未満になる可能性があります。成長期の子どもへの影響が懸念されます。', impact: '部屋が暗く寒いため子どもが部屋に籠もりにくく、リビングへの滞在が増えてプライバシーが確保できません' },
    { rank: 3, title: 'トイレの位置によるプライバシー問題', detail: '玄関から直視できる位置にトイレドアがあるため、来客時に使用をためらう状況が生まれます。', impact: '来客中はトイレを我慢するか、使用時に気まずさを感じる日常が続きます' },
  ],
  life_stress: [
    '料理中に洗濯機の終了に気づいても、すぐに取りに行けずシワになった衣類が増えます',
    '子どもが冬の朝に部屋が寒すぎてリビングで着替えるようになり、プライバシーがなくなります',
    '来客があるたびにトイレのドアが気になり、リラックスして接客できません',
    '将来テレワークが必要になっても、集中できる個室を確保しにくい間取りです',
    '収納が分散しているため、どこに何があるか把握しにくく探し物が増えます',
  ],
  detailed_suggestions: [
    { area: 'キッチン・洗面', action: '洗面脱衣室をキッチン横（現在のパントリー位置）に移動する', reason: '家事動線が約2mに短縮され、料理・洗濯の同時進行がストレスなく行えます', cost_hint: '設計変更必要' },
    { area: '子ども部屋', action: '南面の壁に室内窓を設けてLDKからの光を取り込む', reason: '構造変更なしで採光量を増やせます。視線は格子で遮りつつ光だけ通す設計が有効です', cost_hint: '低コスト' },
    { area: 'トイレ', action: 'トイレ入口を廊下側（90度回転）に変更する', reason: '玄関からの直視を遮断でき、来客時のストレスが解消されます', cost_hint: '中程度の工事' },
  ],
  verdict: 'このまま建てると、家事と採光の問題が10年後も解決されないまま蓄積します。LDKの設計は優秀なだけに、水回りの動線だけ修正すれば大幅に暮らしやすくなる間取りです。設計士への修正依頼を強くお勧めします。',
};

// ─── 診断プロンプト ────────────────────────────────────────────────────────────

// ユーザー入力の前提条件をプロンプトの禁止事項として組み立てる
function buildContextNote({ floors = '', familySize = '', ageGroup = '', childrenCount = '' } = {}) {
  const notes = [];

  // 階数条件
  if (floors === '平屋') {
    notes.push('この建物は【平屋（1階建て）】です。2階・上階・上層・階段に関する指摘は一切行わないこと。平屋として評価すること。');
  } else if (floors === '2階建て') {
    notes.push('この建物は【2階建て】です。3階以上の階への指摘は行わないこと。');
  } else if (floors === '3階建て') {
    notes.push('この建物は【3階建て】です。4階以上の階への指摘は行わないこと。');
  }

  // 子どもの人数条件（familySize=1人 または childrenCount=0人 → 子どもなし）
  const hasNoChildren = familySize === '1人' || childrenCount === '0人';
  if (hasNoChildren) {
    notes.push('子どもはいません。子育て・育児・子ども部屋・子供部屋・キッズ・保育・通学に関する指摘は行わないこと。家族増加を前提とした将来対応の指摘も行わないこと。');
  } else if (childrenCount && childrenCount !== '0人') {
    notes.push(`子どもは【${childrenCount}】います。子ども部屋の配置・採光・音環境・安全性（階段・バルコニー等）を重視して評価すること。`);
  }

  // 年齢条件
  if (ageGroup === '60代以上') {
    notes.push('世帯主は【60代以上】です。バリアフリー・段差・手すり・介護動線・将来の身体機能低下への対応を重視して評価すること。');
  } else if (ageGroup === '20代') {
    notes.push('世帯主は【20代】です。老後の介護・身体機能低下を前提とした指摘の優先度は下げること。');
  }

  if (notes.length === 0) return '';
  return '\n【前提条件（厳守）】\n' + notes.map(n => `- ${n}`).join('\n');
}

function buildFreePrompt(basicInfo = {}) {
  const contextNote = buildContextNote(basicInfo);

  return `あなたは経験豊富な住宅建築士です。
アップロードされた間取り図を、以下の5観点で厳密に評価してください。

【評価基準】
1. dosen（動線）: 日常生活・家事・来客の動線効率、無駄な移動の有無
2. lighting（採光・方位）: 自然光の取り込み、各居室の日当たり傾向
3. storage（収納計画）: 生活動線上での収納の配置と使い勝手
4. space（空間バランス）: 各室の広さのバランス、廊下幅、圧迫感
5. future（将来対応）: 子育て・高齢化・家族構成の変化への柔軟性

【採点方針】
- 0〜100点の整数で採点（平均的な間取りは60〜70点）
- 問題がある場合は容赦なく減点する
- total は5項目の平均（小数点以下四捨五入）
- 間取り画像が不鮮明・読み取れない場合も推測でコメントする

【評価から除外する観点】
- 1階キッチンから2階への食事配膳（階段経由の配膳負担）は問題点・改善提案に含めない
- トイレの位置は、建物全体の平面における中心部から大きく外れ、かつ反対側の端部に居室が集中しているなど明らかな配置上の問題がある場合にのみ指摘すること。トイレが建物の中央寄りや水回りゾーンにまとまっている場合は問題としない${contextNote}

【重要：出力ルール】
- 画像の内容にかかわらず、必ず以下のJSON形式のみを出力すること
- 説明文・マークダウン・コードブロック・謝罪文は一切不要
- 間取り図でない画像（写真・イラスト等）の場合は not_floor_plan を true にして overall_comment に理由を記載すること

【出力形式】
{"scores":{"dosen":整数,"lighting":整数,"storage":整数,"space":整数,"future":整数},"total":整数,"not_floor_plan":false,"good_points":["良い点1","良い点2","良い点3"],"issues":["問題点1","問題点2","問題点3"],"suggestions":["改善の視点1","改善の視点2","改善の視点3"],"overall_comment":"所見を80〜120字で。"}`;
}

// 注意: suggestions/issues は「〜が見受けられます」「〜の可能性があります」「〜を確認することが有効かもしれません」
// のような観察・示唆に留める。「強くお勧めします」「ぜひ」「必ず」「〜すべき」は使用しない。
// 詳細な改善提案・具体的アドバイスは有料の詳細診断（buildDetailPrompt）でのみ提供する。

// ─── ファイルをClaudeコンテンツブロックに変換 ────────────────────────────────
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function buildFileContentBlocks(files) {
  for (const file of files) {
    if (file.mimetype === 'image/heic' || file.mimetype === 'image/heif') {
      const err = new Error('HEIC形式の画像はご利用いただけません。iPhoneの設定→カメラ→フォーマット→「互換性優先」に変更してJPG形式で撮影してください。');
      err.code = 'UNSUPPORTED_FORMAT';
      throw err;
    }
    if (file.mimetype !== 'application/pdf' && !SUPPORTED_IMAGE_TYPES.includes(file.mimetype)) {
      const err = new Error(`未対応のファイル形式です（${file.mimetype}）。JPG・PNG・WebP・PDF形式をご利用ください。`);
      err.code = 'UNSUPPORTED_FORMAT';
      throw err;
    }
  }
  return files.map(file => {
    if (file.mimetype === 'application/pdf') {
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: file.buffer.toString('base64'),
        },
      };
    }
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: file.mimetype,
        data: file.buffer.toString('base64'),
      },
    };
  });
}

// ─── 診断エンドポイント ────────────────────────────────────────────────────────
app.post('/api/diagnose', diagnoseLimiterMin, diagnoseLimiterHour, dailyLimiter('free'), upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: '画像ファイルが必要です' });
    }

    // reCAPTCHA 検証
    const captchaOk = await verifyRecaptcha(req.body?.recaptchaToken);
    if (!captchaOk) {
      return res.status(403).json({ error: '自動アクセスと判断されました。再度お試しください。' });
    }

    if (MOCK_MODE) {
      await new Promise(r => setTimeout(r, 2000)); // 診断っぽい待機
      return res.json(MOCK_DIAGNOSIS);
    }

    const fileBlocks = buildFileContentBlocks(files);
    let basicInfoParsed = {};
    try { basicInfoParsed = JSON.parse(req.body.basicInfo || '{}'); } catch {}
    const floors = basicInfoParsed.floors || '';

    recordDailyAttempt('free', req); // AI呼び出し直前にカウント（失敗してもコスト発生のため）
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',  // 無料診断：低コスト
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            ...fileBlocks,
            {
              type: 'text',
              text: buildFreePrompt(basicInfoParsed),
            },
          ],
        },
      ],
    }, { timeout: 40 * 1000 });

    const responseText = message.content[0].text.trim();

    // JSON部分を抽出（前後に余計なテキストが混入した場合に対応）
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('AI response:', responseText);
      return res.status(500).json({ error: 'AIの応答形式が不正でした。再度お試しください。' });
    }

    const rawResult = JSON.parse(jsonMatch[0]);

    // 間取り図以外の画像チェック
    if (rawResult.not_floor_plan) {
      return res.status(400).json({ error: '間取り図が読み取れませんでした。間取りの平面図をアップロードしてください。' });
    }

    // 必須フィールドの検証
    const required = ['scores', 'total', 'good_points', 'issues', 'suggestions', 'overall_comment'];
    for (const field of required) {
      if (!(field in rawResult)) {
        return res.status(500).json({ error: '診断結果の形式が不完全でした。再度お試しください。' });
      }
    }

    // ファクトチェックフィルター（前提条件と矛盾する項目を除去）
    const result = filterDiagnosisResult(rawResult, floors, basicInfoParsed.familySize || '', basicInfoParsed.childrenCount || '');

    recordDailySuccess('free', req); // 成功した診断のみ成功枠を消費
    res.json(result);
  } catch (err) {
    console.error('診断エラー:', err);

    if (err.code === 'UNSUPPORTED_FORMAT' || err.message?.includes('JPG') || err.message?.includes('形式') || err.message?.includes('HEIC')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.status === 401) {
      return res.status(500).json({ error: 'APIキーが正しくありません。設定を確認してください。' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'しばらく時間をおいて再度お試しください。' });
    }

    res.status(500).json({ error: '診断中にエラーが発生しました。再度お試しください。' });
  }
});

// ─── AI詳細診断プロンプト ──────────────────────────────────────────────────────
function buildDetailPrompt(question, basicInfo = {}) {
  const hasQ = question && question.trim();
  const questionSection = hasQ
    ? `\n【ユーザーからの質問】\n「${question.trim()}」\nこの質問に対して、間取り図を踏まえた上で具体的に回答してください。回答はuser_question_answerフィールドに150字以内で記載してください。\n`
    : '';
  const questionOutput = hasQ
    ? '\n6. user_question: ユーザーの質問をそのまま転記\n7. user_question_answer: 質問への回答（150字以内）'
    : '';
  const questionJson = hasQ
    ? ',"user_question":"質問テキスト","user_question_answer":"回答テキスト"'
    : '';

  const contextNote = buildContextNote(basicInfo);

  return `あなたは経験豊富な住宅建築士です。
この間取り図に対して、無料診断より踏み込んだ「有料レベルの詳細診断」を行ってください。
${questionSection}
【評価の注意事項】
- 問題点の深刻度は実際の配置関係を正確に読み取って判断すること
- 部屋が「はす向かい（斜め対面）」の場合や「廊下を挟んでいる」場合は、直接隣接より影響が軽減されるため、優先度を下げるか問題点から外すこと
- 直接壁を共有している場合のみ「近接問題」として高優先度に挙げること
- 実際に観察できる問題のみ指摘し、見えていない部分は推測で大げさに評価しないこと
- 1階キッチンから2階への食事配膳（階段経由の配膳負担）は問題点・ストレス・改善提案に含めない
- トイレの位置は、建物全体の平面における中心部から大きく外れ、かつ反対側の端部に居室が集中しているなど明らかな配置上の問題がある場合にのみ指摘すること。トイレが建物中央寄りや水回りゾーンにまとまっている場合は問題としない
- 「監視性」という言葉は使用しない。子ども室の見守りに関する指摘は「見守りやすさ」「声が届きやすいか」などの表現を使うこと
- 書斎・ワークスペースが独立した個室であることは問題点としない（プライバシーや集中環境として適切なため）
- 間取り図に明確に記載・描画されていない室（サンルーム・ウッドデッキ等）は存在しないものとして扱い、問題点・ストレス・改善提案に含めない
- 子供室とLDKの生活音干渉については、廊下・収納・ホール等が間に挟まっている場合は影響が軽減されるため問題点としない。直接隣接している場合のみ指摘すること
- パントリーとWICの動線の分断は問題点としない（両室の間に直接的な機能的関係はないため）
- ランドリールームから屋外への動線については、間取り図にデッキ・テラス・庭への出入り口が明確に描かれている場合のみ動線の可否を判断して指摘すること。屋外への出入り口が確認できない場合、または乾燥機使用の可能性がある場合は指摘しない
- 玄関からリビングへのプライバシー不足は、玄関ドアを開けた正面に居室の出入り口が直接見える配置の場合のみ指摘すること。玄関とリビングの間に収納・壁・ホール等の遮蔽物がある場合は問題としない${contextNote}

【出力内容】
1. priority_issues: 優先度の高い問題点を最大5つ。rank（1が最重要）、title（問題の名前）、detail（詳細な説明）、impact（実生活への具体的影響）を含める
2. life_stress: この間取りで実際に生活したときに感じるストレスを4〜6個。「〇〇するたびに〜」「毎日〜が不便」など具体的な表現で
3. detailed_suggestions: 改善提案を3〜5個。area（対象エリア）、action（具体的な改善策）、reason（理由）、cost_hint（"低コスト" / "中程度の工事" / "設計変更必要" のいずれか）
4. verdict: このリスクの総合評価。「このまま建てると〜」という形式で120字以内
5. good_points: この間取りの優れている点を2つ。簡潔に1〜2文で述べる${questionOutput}

【出力形式】
以下のJSONのみ出力してください。説明文・マークダウン・コードブロックは不要：

{"priority_issues":[{"rank":1,"title":"問題名","detail":"詳細説明","impact":"生活への影響"}],"life_stress":["ストレス1","ストレス2"],"detailed_suggestions":[{"area":"エリア名","action":"改善策","reason":"理由","cost_hint":"低コスト"}],"verdict":"総合評価","good_points":["良い点1","良い点2"]${questionJson}}`;
}

// ─── AI詳細診断エンドポイント ──────────────────────────────────────────────────
app.post('/api/diagnose/detail', diagnoseLimiterMin, diagnoseLimiterHour, dailyLimiter('detail'), upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: '画像ファイルが必要です' });
    }

    // reCAPTCHA 検証
    const captchaOk = await verifyRecaptcha(req.body?.recaptchaToken);
    if (!captchaOk) {
      return res.status(403).json({ error: '自動アクセスと判断されました。再度お試しください。' });
    }

    if (MOCK_MODE) {
      await new Promise(r => setTimeout(r, 2500));
      return res.json(MOCK_DETAIL);
    }

    const fileBlocks = buildFileContentBlocks(files);
    const question = req.body?.question || '';
    let detailInfo = {};
    try { detailInfo = JSON.parse(req.body?.basicInfo || '{}'); } catch {}
    if (req.body?.floors)         detailInfo.floors         = req.body.floors;
    if (req.body?.familySize)     detailInfo.familySize     = req.body.familySize;
    if (req.body?.ageGroup)       detailInfo.ageGroup       = req.body.ageGroup;
    if (req.body?.childrenCount)  detailInfo.childrenCount  = req.body.childrenCount;
    const floors = detailInfo.floors || '';
    const prompt = buildDetailPrompt(question, detailInfo);

    recordDailyAttempt('detail', req); // Sonnet呼び出し直前にカウント（失敗してもコスト発生のため）
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',  // AI詳細診断：高品質
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            ...fileBlocks,
            { type: 'text', text: prompt },
          ],
        },
      ],
    }, { timeout: 55 * 1000 });

    const responseText = message.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AIの応答形式が不正でした。再度お試しください。' });
    }

    let result;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message);
      console.error('Response length:', responseText.length);
      return res.status(500).json({ error: 'AIの応答の解析に失敗しました。再度お試しください。' });
    }

    // ファクトチェックフィルター（前提条件と矛盾する項目を除去）
    result = filterDiagnosisResult(result, floors, detailInfo.familySize || '', detailInfo.childrenCount || '');

    recordDailySuccess('detail', req);
    res.json(result);
  } catch (err) {
    console.error('詳細診断エラー:', err);
    if (err.status === 429) return res.status(429).json({ error: 'しばらく時間をおいて再度お試しください。' });
    res.status(500).json({ error: '詳細診断中にエラーが発生しました。再度お試しください。' });
  }
});

// ─── クーポン定義（環境変数 COUPONS_JSON で上書き可能） ───────────────────────
// 例: COUPONS_JSON='{"ARCHI500":{"discount":500,"label":"¥500割引"}}'
const DEFAULT_COUPONS = {
  // ここにコードを追加: 'コード': { discount: 割引額(円), label: '表示名' }
};
let COUPONS = DEFAULT_COUPONS;
try {
  if (process.env.COUPONS_JSON) COUPONS = JSON.parse(process.env.COUPONS_JSON);
} catch { console.warn('COUPONS_JSON parse error'); }

app.post('/api/validate-coupon', express.json(), (req, res) => {
  const code = (req.body?.code || '').toUpperCase().trim();
  const coupon = COUPONS[code];
  if (!coupon) return res.json({ valid: false });
  res.json({ valid: true, discount: coupon.discount, label: coupon.label });
});

// ─── Stripe 決済セッション作成 ────────────────────────────────────────────────
app.post('/api/create-checkout-session', upload.array('files', 10), async (req, res) => {
  try {
    const { name, email, message, structure, floors, familySize, childrenCount, ageGroup, price, couponCode } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'お名前とメールアドレスを入力してください' });
    }

    // クーポン適用
    let chargeAmount = 3000;
    if (couponCode) {
      const c = COUPONS[(couponCode).toUpperCase().trim()];
      if (c) chargeAmount = Math.max(3000 - c.discount, 0);
    } else if (price) {
      chargeAmount = parseInt(price, 10) || 3000;
    }

    // Stripeの最低決済額（JPYは¥50）を下回る場合はエラー（クーポン全額割引などの破綻を防ぐ）
    if (chargeAmount < 50) {
      return res.status(400).json({ error: 'このクーポンは現在ご利用いただけません。お手数ですが運営までお問い合わせください。' });
    }

    const origin = process.env.NODE_ENV === 'production'
      ? `https://${req.get('host')}`
      : `http://${req.get('host')}`;

    if (MOCK_STRIPE) {
      // テスト用：そのまま成功ページへ
      return res.json({ url: `${origin}/?payment=success` });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'jpy',
          product_data: {
            name: '一級建築士相談',
            description: couponCode
              ? `間取りに関する参考意見の提示・テキストフィードバック（3営業日以内）※クーポン適用`
              : '間取りに関する参考意見の提示・テキストフィードバック（3営業日以内）',
          },
          unit_amount: chargeAmount,
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email,
      payment_intent_data: { receipt_email: email },
      metadata: {
        plan: 'architect',
        name,
        email,
        message: (message || '').substring(0, 500),
        structure: structure || '',
        floors: floors || '',
        familySize: familySize || '',
        childrenCount: childrenCount || '',
        ageGroup: ageGroup || '',
      },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30分で期限切れ
      success_url: `${origin}/?payment=success`,
      cancel_url:  `${origin}/?payment=cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: '決済の準備中にエラーが発生しました。再度お試しください。' });
  }
});

// ─── AI詳細診断 決済セッション作成（¥300） ──────────────────────────────────────
// ファイルも受け取り、一時保存してIDを発行。決済後に即時診断できるようにする。
app.post('/api/create-ai-checkout-session', upload.array('files', 10), async (req, res) => {
  try {
    const { name, email, structure, floors, familySize, ageGroup, childrenCount } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'お名前とメールアドレスを入力してください' });
    }

    const origin = process.env.NODE_ENV === 'production'
      ? `https://${req.get('host')}`
      : `http://${req.get('host')}`;

    // ファイルを一時保存（決済後の即時診断用）
    const diagnosisId = crypto.randomUUID();
    const files = req.files || [];
    const question = req.body?.question || '';
    if (files.length > 0) {
      tempDiagnosisStore.set(diagnosisId, { files, question, floors: floors || '', familySize: familySize || '', ageGroup: ageGroup || '', childrenCount: childrenCount || '', result: null, timestamp: Date.now() });
    }
    const didParam = files.length > 0 ? `&did=${diagnosisId}` : '';

    if (MOCK_STRIPE) {
      // 管理者通知（モック時）
      await sendNotification({
        subject: `【ArchiAI】AI詳細診断 申込（テスト）`,
        text: `AI詳細診断の申し込みがありました。\n\nお名前: ${name}\nメール: ${email}\n診断ID: ${diagnosisId}\nファイル数: ${files.length}\n質問: ${req.body?.question || '（なし）'}`,
      });
      return res.json({ url: `${origin}/?payment=ai-success${didParam}` });
    }

    // 管理者通知
    await sendNotification({
      subject: `【ArchiAI】AI詳細診断 申込`,
      text: `AI詳細診断の申し込みがありました。\n\nお名前: ${name}\nメール: ${email}\n診断ID: ${diagnosisId}\nファイル数: ${files.length}\n質問: ${req.body?.question || '（なし）'}`,
    });

    const session = await stripe.checkout.sessions.create({
      line_items: [{
        price_data: {
          currency: 'jpy',
          product_data: {
            name: 'AI詳細診断',
            description: '優先度付き問題点リスト・生活ストレス予測・具体的改善策',
          },
          unit_amount: 500,
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email,
      payment_intent_data: { receipt_email: email },
      metadata: { plan: 'ai', name, email, structure: structure || '', floors: floors || '', familySize: familySize || '', childrenCount: childrenCount || '', ageGroup: ageGroup || '', diagnosisId },
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30分で期限切れ
      success_url: `${origin}/?payment=ai-success${didParam}`,
      cancel_url:  `${origin}/?payment=cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('AI Stripe checkout error:', err);
    res.status(500).json({ error: '決済の準備中にエラーが発生しました。再度お試しください。' });
  }
});

// ─── AI詳細診断 IDから実行（決済後即時結果用） ────────────────────────────────
app.get('/api/diagnose/detail-by-id/:id', async (req, res) => {
  const id = req.params.id;
  const entry = tempDiagnosisStore.get(id);

  if (!entry) {
    // 支払い済みフラグが存在する場合はサーバー再起動によるデータ消失
    if (paidFlags[id]) {
      return res.status(410).json({
        error: 'paid_data_lost',
        message: '決済は確認されていますが、サーバーの再起動によりデータが消失しました。大変申し訳ございません。ArchiAI@outlook.jp までご連絡ください（お名前・決済日時をお知らせください）。',
      });
    }
    return res.status(404).json({ error: '診断データが見つかりません。お手数ですが最初からやり直してください。' });
  }

  // 本番環境では支払い確認必須
  if (!MOCK_MODE && !MOCK_STRIPE && !entry.paid) {
    return res.status(403).json({ error: '決済が確認できません。Stripeの決済画面からお手続きください。' });
  }

  // キャッシュ済みの結果があれば即返す
  if (entry.result) return res.json(entry.result);

  if (MOCK_MODE) {
    await new Promise(r => setTimeout(r, 2500));
    entry.result = MOCK_DETAIL;
    return res.json(MOCK_DETAIL);
  }

  // バックグラウンドジョブがまだ開始されていない場合のフォールバック
  // （Webhook到着前に detail-by-id が呼ばれた場合 / Webhook未設定環境）
  if (!entry.running && !entry.result && !entry.bgError) {
    const fallbackEmail = paidFlags[req.params.id]?.email || '';
    runDiagnosisAndEmail(req.params.id, fallbackEmail).catch(e =>
      console.error('[detail-by-id] フォールバック診断エラー:', e.message)
    );
  }

  // バックグラウンドジョブ完了までポーリング
  // Renderフリープランは30秒HTTP制限があるため25秒上限（有料プランなら60秒に変更可）
  const POLL_TIMEOUT_MS = parseInt(process.env.DETAIL_POLL_TIMEOUT_MS || '25000', 10);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000));
    if (entry.result) return res.json(entry.result);
    if (entry.bgError) {
      return res.status(500).json({
        error: '診断処理中にエラーが発生しました。ご入力のメールアドレスにご案内をお送りしました。お手数ですが ArchiAI@outlook.jp まで（お名前・決済日時を添えて）ご連絡ください。返金または再診断で確実に対応いたします。',
        code: 'bg_error',
      });
    }
  }

  // 50秒経過しても完了しない場合（バックグラウンドジョブは継続中）
  return res.status(504).json({
    error: '診断の処理にお時間がかかっています。完了次第、ご登録のメールアドレスに結果をお送りします。',
    code: 'still_processing',
  });
});

// ─── 建築士相談エンドポイント ──────────────────────────────────────────────────
app.post('/api/consult', upload.array('files', 10), async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'お名前とメールアドレスは必須です' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '正しいメールアドレスを入力してください' });
    }

    const refNo = `HC-${Date.now().toString(36).toUpperCase()}`;
    const received = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const files = req.files || [];

    console.log('【建築士相談受付】', { refNo, name, email, message: message || '（なし）', fileCount: files.length, received });

    // 管理者通知メール（ファイル添付）
    const attachments = files.map(f => ({
      filename: f.originalname || `file_${Date.now()}`,
      content:  f.buffer,
    }));
    await sendNotification({
      subject: `【ArchiAI】新規建築士相談 ${refNo}`,
      text: `建築士相談が届きました。\n\n受付番号: ${refNo}\nお名前: ${name}\nメール: ${email}\n受付日時: ${received}\nファイル数: ${files.length}\n\n---\nご要望:\n${message || '（なし）'}`,
      attachments,
    });

    res.json({
      ref_no: refNo,
      received,
      message: `${name} 様からのご相談を受け付けました。3営業日以内に ${email} へご連絡いたします。`,
    });
  } catch (err) {
    console.error('相談受付エラー:', err);
    res.status(500).json({ error: '受付中にエラーが発生しました。再度お試しください。' });
  }
});

// ─── 診断結果メール送信 ────────────────────────────────────────────────────────
app.post('/api/send-result', express.json(), async (req, res) => {
  try {
    const { email, type, result } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: '正しいメールアドレスを入力してください' });
    }
    if (!result) return res.status(400).json({ error: '送信内容がありません' });

    const isDetail = type === 'detail';
    const subject = isDetail
      ? '【ArchiAI】AI詳細診断レポート'
      : '【ArchiAI】間取り無料診断結果';

    // テキスト形式に変換
    let body = `${subject}\n${'─'.repeat(40)}\n\n`;

    if (isDetail) {
      const { priority_issues = [], life_stress = [], detailed_suggestions = [], verdict, good_points = [], user_question, user_question_answer } = result;
      if (priority_issues.length) {
        body += `■ 優先度の高い問題点\n`;
        priority_issues.forEach((p, i) => { body += `\n[優先度${p.rank}] ${p.title}\n${p.detail}\n→ 生活への影響: ${p.impact}\n`; });
      }
      if (life_stress.length) {
        body += `\n■ 住んでから感じるストレス\n`;
        life_stress.forEach(s => { body += `・${s}\n`; });
      }
      if (detailed_suggestions.length) {
        body += `\n■ 具体的な改善提案\n`;
        detailed_suggestions.forEach(s => { body += `\n[${s.area}] ${s.cost_hint}\n${s.action}\n理由: ${s.reason}\n`; });
      }
      if (verdict) body += `\n■ AI総評\n${verdict}\n`;
      if (good_points.length) {
        body += `\n■ この間取りの良い点\n`;
        good_points.forEach(p => { body += `✓ ${p}\n`; });
      }
      if (user_question && user_question_answer) {
        body += `\n■ ご質問への回答\nQ: ${user_question}\nA: ${user_question_answer}\n`;
      }
    } else {
      const { total, grade, categories = [], good_points = [], concerns = [], suggestions = [] } = result;
      body += `総合スコア: ${total}点 (${grade?.rank || ''})\n${grade?.text || ''}\n\n`;
      if (categories.length) {
        body += `■ カテゴリ別スコア\n`;
        categories.forEach(c => { body += `${c.label}: ${c.score}点\n`; });
      }
      if (good_points.length) { body += `\n■ 良い点\n`; good_points.forEach(p => { body += `✓ ${p}\n`; }); }
      if (concerns.length)    { body += `\n■ 気になる点\n`; concerns.forEach(p => { body += `！${p}\n`; }); }
      if (suggestions.length) { body += `\n■ 改善提案\n`; suggestions.forEach(p => { body += `→ ${p}\n`; }); }
    }

    body += `\n${'─'.repeat(40)}\n※ 本診断結果は参考情報です。実際の建築計画には専門家にご相談ください。\n※ 診断基準は一級建築士が監修しています。\n\nArchiAI 間取り診断\nhttps://archi-ai.onrender.com\n`;

    // ユーザーへ送信（タイムアウト付き・エラーは呼び出し元に伝播）
    if (!MOCK_EMAIL) {
      await sendMailWithTimeout({ from: EMAIL_USER, to: email, subject, text: body });
    } else {
      console.log(`[Email mock] 結果送信 → ${email} subject="${subject}"`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('結果メール送信エラー:', err);
    res.status(500).json({ error: '送信中にエラーが発生しました' });
  }
});

// ─── ヘルスチェック ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── フロント向け公開設定 ─────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({ recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || null, mockMode: MOCK_MODE });
});

// ─── フロントエンド静的ファイル配信（本番ビルド用） ──────────────────────────
const distPath = path.join(__dirname, '../frontend/dist');
console.log('[静的ファイル] distPath:', distPath, '| 存在:', fs.existsSync(distPath));
app.use(express.static(distPath));
// SPAのルーティング：/api 以外は index.html を返す
app.get(/^(?!\/api).*/, (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(503).send('ビルド中または設定エラーです。しばらくお待ちください。');
  }
});

// ─── multerエラーハンドリング ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'ファイルサイズは20MB以下にしてください' });
  }
  if (err.message) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('');
  console.log('  ================================');
  console.log(`  間取り診断AI 起動中`);
  console.log(`  http://localhost:${PORT}`);
  console.log('  ================================');
  console.log('');
});
