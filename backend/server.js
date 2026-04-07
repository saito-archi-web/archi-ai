const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
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
    const ok = data.success && (data.score ?? 1) >= 0.5;
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

app.use(cors());
app.use(express.json());

const MOCK_MODE = !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_anthropic_api_key_here';
const client = MOCK_MODE ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

if (MOCK_MODE) console.log('[モード] APIキー未設定 → モックデータで動作します');

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
const DIAGNOSIS_PROMPT = `あなたは経験豊富な住宅建築士です。
アップロードされた間取り図を、以下の5観点で厳密に評価してください。

【評価基準】
1. dosen（動線）: 日常生活・家事・来客の動線効率、無駄な移動の有無
2. lighting（採光・方位）: 自然光の取り込み、各居室の日当たり傾向
3. storage（収納計画）: 生活動線上での収納の配置と使い勝手
4. space（空間バランス）: 各室の広さのバランス、廊下幅、圧迫感
5. future（将来対応）: 子育て・高齢化・テレワーク等への柔軟性

【採点方針】
- 0〜100点の整数で採点（平均的な間取りは60〜70点）
- 問題がある場合は容赦なく減点する
- total は5項目の平均（小数点以下四捨五入）
- 間取り画像が不鮮明・読み取れない場合も推測でコメントする

【出力形式】
以下のJSONのみ出力してください。説明文・マークダウン記法・コードブロックは不要：

{"scores":{"dosen":整数,"lighting":整数,"storage":整数,"space":整数,"future":整数},"total":整数,"good_points":["良い点1","良い点2","良い点3"],"issues":["問題点1（具体的な観察事実として）","問題点2","問題点3"],"suggestions":["改善の視点1（観察・指摘のみ。断定や推薦は避ける）","改善の視点2","改善の視点3"],"overall_comment":"この間取りへの客観的な所見を80〜120字で。断定・推薦・強い勧誘表現は使わない。"}`;

// 注意: suggestions/issues は「〜が見受けられます」「〜の可能性があります」「〜を確認することが有効かもしれません」
// のような観察・示唆に留める。「強くお勧めします」「ぜひ」「必ず」「〜すべき」は使用しない。
// 詳細な改善提案・具体的アドバイスは有料の詳細診断（DETAIL_PROMPT）でのみ提供する。

// ─── ファイルをClaudeコンテンツブロックに変換 ────────────────────────────────
function buildFileContentBlocks(files) {
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
app.post('/api/diagnose', diagnoseLimiterMin, diagnoseLimiterHour, upload.array('files', 10), async (req, res) => {
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

    const message = await client.messages.create({
      model: 'claude-haiku-3-5-20241022',  // 無料診断：低コスト
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: [
            ...fileBlocks,
            {
              type: 'text',
              text: DIAGNOSIS_PROMPT,
            },
          ],
        },
      ],
    });

    const responseText = message.content[0].text.trim();

    // JSON部分を抽出（前後に余計なテキストが混入した場合に対応）
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('AI response:', responseText);
      return res.status(500).json({ error: 'AIの応答形式が不正でした。再度お試しください。' });
    }

    const result = JSON.parse(jsonMatch[0]);

    // 必須フィールドの検証
    const required = ['scores', 'total', 'good_points', 'issues', 'suggestions', 'overall_comment'];
    for (const field of required) {
      if (!(field in result)) {
        return res.status(500).json({ error: '診断結果の形式が不完全でした。再度お試しください。' });
      }
    }

    res.json(result);
  } catch (err) {
    console.error('診断エラー:', err);

    if (err.message?.includes('JPG') || err.message?.includes('形式')) {
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
const DETAIL_PROMPT = `あなたは経験豊富な住宅建築士です。
この間取り図に対して、無料診断より踏み込んだ「有料レベルの詳細診断」を行ってください。

【出力内容】
1. priority_issues: 優先度の高い問題点を最大5つ。rank（1が最重要）、title（問題の名前）、detail（詳細な説明）、impact（実生活への具体的影響）を含める
2. life_stress: この間取りで実際に生活したときに感じるストレスを4〜6個。「〇〇するたびに〜」「毎日〜が不便」など具体的な表現で
3. detailed_suggestions: 改善提案を3〜5個。area（対象エリア）、action（具体的な改善策）、reason（理由）、cost_hint（"低コスト" / "中程度の工事" / "設計変更必要" のいずれか）
4. verdict: このリスクの総合評価。「このまま建てると〜」という形式で120字以内

【出力形式】
以下のJSONのみ出力してください。説明文・マークダウン・コードブロックは不要：

{"priority_issues":[{"rank":1,"title":"問題名","detail":"詳細説明","impact":"生活への影響"}],"life_stress":["ストレス1","ストレス2"],"detailed_suggestions":[{"area":"エリア名","action":"改善策","reason":"理由","cost_hint":"低コスト"}],"verdict":"総合評価"}`;

// ─── AI詳細診断エンドポイント ──────────────────────────────────────────────────
app.post('/api/diagnose/detail', diagnoseLimiterMin, diagnoseLimiterHour, upload.array('files', 10), async (req, res) => {
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

    const message = await client.messages.create({
      model: 'claude-opus-4-5',  // AI詳細診断：最高品質
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            ...fileBlocks,
            { type: 'text', text: DETAIL_PROMPT },
          ],
        },
      ],
    });

    const responseText = message.content[0].text.trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AIの応答形式が不正でした。再度お試しください。' });
    }

    const result = JSON.parse(jsonMatch[0]);
    res.json(result);
  } catch (err) {
    console.error('詳細診断エラー:', err);
    if (err.status === 429) return res.status(429).json({ error: 'しばらく時間をおいて再度お試しください。' });
    res.status(500).json({ error: '詳細診断中にエラーが発生しました。再度お試しください。' });
  }
});

// ─── Stripe 決済セッション作成 ────────────────────────────────────────────────
app.post('/api/create-checkout-session', upload.none(), async (req, res) => {
  try {
    const { name, email, message, structure, floors, familySize, ageGroup } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'お名前とメールアドレスを入力してください' });
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
            description: '間取りの妥当性チェック・テキストフィードバック（3営業日以内）',
          },
          unit_amount: 3000,
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email,
      metadata: {
        name,
        email,
        message: (message || '').substring(0, 500),
        structure: structure || '',
        floors: floors || '',
        familySize: familySize || '',
        ageGroup: ageGroup || '',
      },
      success_url: `${origin}/?payment=success`,
      cancel_url:  `${origin}/?payment=cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    res.status(500).json({ error: '決済の準備中にエラーが発生しました。再度お試しください。' });
  }
});

// ─── AI詳細診断 決済セッション作成（¥500） ──────────────────────────────────────
app.post('/api/create-ai-checkout-session', upload.none(), async (req, res) => {
  try {
    const { name, email, structure, floors } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'お名前とメールアドレスを入力してください' });
    }

    const origin = process.env.NODE_ENV === 'production'
      ? `https://${req.get('host')}`
      : `http://${req.get('host')}`;

    if (MOCK_STRIPE) {
      return res.json({ url: `${origin}/?payment=ai-success` });
    }

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
      metadata: { name, email, structure: structure || '', floors: floors || '' },
      success_url: `${origin}/?payment=ai-success`,
      cancel_url:  `${origin}/?payment=cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('AI Stripe checkout error:', err);
    res.status(500).json({ error: '決済の準備中にエラーが発生しました。再度お試しください。' });
  }
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

    // 本番では外部メール/DB保存に置き換える
    console.log('【建築士相談受付】', { refNo, name, email, message: message || '（なし）', fileCount: files.length, received });

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

// ─── ヘルスチェック ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── フロント向け公開設定 ─────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({ recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || null });
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
