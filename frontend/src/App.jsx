import { useState, useRef, useEffect } from 'react'
import './App.css'

// ─── 利用回数制限（localStorage） ─────────────────────────────────────────────
const USAGE_KEY = 'archi_usage'
const getToday  = () => new Date().toISOString().slice(0, 10)

function checkDailyLimit() {
  try {
    const s = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}')
    return !(s.date === getToday() && (s.count || 0) >= 1)
  } catch { return true }
}
function recordUsage() {
  try {
    const today = getToday()
    const s = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}')
    localStorage.setItem(USAGE_KEY, JSON.stringify({
      date: today, count: s.date === today ? (s.count || 0) + 1 : 1
    }))
  } catch {}
}

// ─── reCAPTCHA トークン取得 ───────────────────────────────────────────────────
function getRecaptchaToken(siteKey, action) {
  if (!siteKey || !window.grecaptcha) return Promise.resolve(null)
  return new Promise(resolve => {
    window.grecaptcha.ready(() => {
      window.grecaptcha.execute(siteKey, { action }).then(resolve).catch(() => resolve(null))
    })
  })
}

// ─── 定数 ─────────────────────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  '動線を確認しています...',
  '採光・方位を分析中...',
  '収納計画を評価中...',
  '空間バランスをチェック中...',
  '将来のライフスタイルを診断中...',
  'AIが総合スコアを算出中...',
]
const DETAIL_LOADING_MESSAGES = [
  '問題点を優先順位付けしています...',
  '生活ストレスを予測中...',
  '具体的な改善策を検討中...',
  '詳細レポートを生成中...',
]

const CATEGORIES = [
  { key: 'dosen',    label: '動線',        desc: '移動効率・家事動線' },
  { key: 'lighting', label: '採光・方位',   desc: '日当たり・自然光' },
  { key: 'storage',  label: '収納計画',    desc: '配置の適切さ' },
  { key: 'space',    label: '空間バランス', desc: '広さ・開放感' },
  { key: 'future',   label: '将来対応',    desc: 'ライフスタイル変化' },
]

const COST_COLORS = {
  '低コスト':     { bg: '#DCFCE7', color: '#166534' },
  '中程度の工事': { bg: '#FEF9C3', color: '#854D0E' },
  '設計変更必要': { bg: '#FEE2E2', color: '#991B1B' },
}

const STRUCTURE_OPTIONS = ['木造', '鉄骨造', 'RC造', 'わからない']
const FLOOR_OPTIONS     = ['平屋', '2階建て', '3階建て以上']
const FAMILY_OPTIONS    = ['1人', '2人', '3人', '4人', '5人以上']
const AGE_OPTIONS       = ['20代', '30代', '40代', '50代', '60代以上']
const BUDGET_OPTIONS    = ['〜2,000万円', '2,000〜3,000万円', '3,000〜4,000万円', '4,000万円以上']

const CHECK_ITEMS = [
  { key: 'direction', label: '方位（北の向き）が記載されている',         note: '採光・日当たりの判定に使用します',            required: true  },
  { key: 'rooms',     label: '部屋名・用途が確認できる',                  note: 'LDK、洗面所、寝室などの表記があるか',          required: true  },
  { key: 'scale',     label: '縮尺または部屋の帖数が記載されている',       note: '空間バランスの評価精度が向上します',            required: true  },
  { key: 'allFloors', label: '全フロアの平面図がそろっている',             note: '複数階の場合、全フロア分があると精度が上がります', required: false },
  { key: 'site',      label: '敷地・建物の向きが確認できる',               note: '配置図や外形がわかる資料',                    required: false },
]

const PLANS = [
  {
    id: 'free', name: '無料診断', price: '¥0', tag: '無料', tagBg: '#22C55E',
    features: ['5項目スコアリング（動線・採光・収納など）', '良い点・気になるポイントの指摘', '基本的な改善提案', '診断後にAI詳細診断・建築士相談に進める'],
  },
  {
    id: 'ai', name: 'AI詳細診断', price: '¥500', tag: '人気', tagBg: '#FF6B35',
    features: ['無料診断の全項目', '優先度付き問題点リスト（最大5件）', '「住んでから気づく」生活ストレス予測', 'コスト感付きの具体的改善策', '診断後に一級建築士相談に進める'],
  },
  {
    id: 'architect', name: '一級建築士相談', price: '¥3,000', tag: '最高精度', tagBg: '#3B82F6',
    features: ['一級建築士による間取りの直接チェック', '動線・方位・収納・圧迫感の指摘', 'テキストコメント付きフィードバック', '3営業日以内にメールでご連絡'],
  },
]

// ファイルスロット定義
const getFileSlots = (floors) => {
  const floorCount = floors === '平屋' ? 1 : floors === '2階建て' ? 2 : floors === '3階建て以上' ? 3 : 1
  const planSlots = Array.from({ length: floorCount }, (_, i) => ({
    key: `floor${i}`,
    label: floorCount === 1 ? '平面図' : `${i + 1}F 平面図`,
    required: i === 0,
    group: 'plan',
  }))
  const extraSlots = [
    { key: 'elevation', label: '立面図',          required: false, group: 'extra' },
    { key: 'reference', label: 'イメージ・参考写真', required: false, group: 'extra' },
    { key: 'other',     label: 'その他',           required: false, group: 'extra' },
  ]
  return [...planSlots, ...extraSlots]
}

// ─── ユーティリティ ────────────────────────────────────────────────────────────

function getScoreColor(score) {
  if (score >= 80) return '#22C55E'
  if (score >= 70) return '#F59E0B'
  if (score >= 60) return '#F97316'
  return '#C42230'
}

function getGrade(score) {
  if (score >= 90) return { rank: 'S', text: '優秀な間取りです！',               color: '#22C55E' }
  if (score >= 80) return { rank: 'A', text: '良好。少しの改善で完璧に。',        color: '#4CAF50' }
  if (score >= 70) return { rank: 'B', text: '標準的ですが、要注意ポイントあり。', color: '#F59E0B' }
  if (score >= 60) return { rank: 'C', text: '複数の問題点が潜んでいます。',       color: '#F97316' }
  return             { rank: 'D', text: '危険信号！大きな問題が潜んでいます。',     color: '#C42230' }
}

function isPDF(file) { return file?.type === 'application/pdf' }

// ─── 共通UIパーツ ──────────────────────────────────────────────────────────────

function ScoreCircle({ score }) {
  const [display, setDisplay] = useState(0)
  const R = 80, circ = 2 * Math.PI * R
  const color = getScoreColor(display)
  useEffect(() => {
    let raf
    const start = performance.now()
    const animate = (now) => {
      const t = Math.min((now - start) / 1400, 1)
      setDisplay(Math.round(score * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(animate)
    }
    raf = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(raf)
  }, [score])
  const offset = circ - (display / 100) * circ
  return (
    <svg width="200" height="200" viewBox="0 0 200 200">
      <circle cx="100" cy="100" r={R} fill="none" stroke="#E5E7EB" strokeWidth="10" />
      <circle cx="100" cy="100" r={R} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="butt" transform="rotate(-90 100 100)"
        style={{ transition: 'stroke-dashoffset 0.05s linear, stroke 0.3s' }} />
      <text x="100" y="92" textAnchor="middle" fill={color} fontSize="48" fontWeight="800" fontFamily="inherit">{display}</text>
      <text x="100" y="118" textAnchor="middle" fill="#6B7280" fontSize="16" fontFamily="inherit">点</text>
    </svg>
  )
}

function ScoreBar({ score, label, desc, delay }) {
  const [width, setWidth] = useState(0)
  const color = getScoreColor(score)
  useEffect(() => { const t = setTimeout(() => setWidth(score), delay); return () => clearTimeout(t) }, [score, delay])
  return (
    <div className="score-bar-item">
      <div className="score-bar-header">
        <div><span className="score-bar-label">{label}</span><span className="score-bar-desc">{desc}</span></div>
        <span className="score-bar-value" style={{ color }}>{score}<span className="score-bar-unit">点</span></span>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${width}%`, backgroundColor: color, transition: 'width 0.9s cubic-bezier(0.4,0,0.2,1)' }} />
      </div>
    </div>
  )
}

function PillSelect({ options, value, onChange }) {
  return (
    <div className="pill-group">
      {options.map(opt => (
        <button key={opt} type="button"
          className={`pill${value === opt ? ' pill-active' : ''}`}
          onClick={() => onChange(opt)}>
          {opt}
        </button>
      ))}
    </div>
  )
}

function LogoMark({ size = 55 }) {
  return (
    <img
      src="/logo.jpg"
      alt="Archi AI logo"
      width={size}
      height={size}
      style={{ display: 'block', objectFit: 'cover', borderRadius: 0 }}
    />
  )
}

// ─── ファイルスロット ──────────────────────────────────────────────────────────

// iOSではf.typeが空の場合があるため拡張子でもチェック
function resolveFileType(f) {
  if (f.type) return f.type
  const ext = f.name.split('.').pop().toLowerCase()
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[ext] || ''
}

function FileSlot({ label, required, file, onChange }) {
  const inputRef = useRef(null)
  const hasFile = !!file

  const handleRemove = (e) => {
    e.stopPropagation()
    e.preventDefault()
    onChange(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleChange = (e) => {
    const f = e.target.files[0]
    if (!f) return
    const type = resolveFileType(f)
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowed.includes(type)) { alert('JPG・PNG・WebP・PDF形式のみ対応しています'); return }
    if (f.size > 20 * 1024 * 1024) { alert('ファイルサイズは20MB以下にしてください'); return }
    onChange(f)
  }

  const handleTap = () => { if (!hasFile) inputRef.current?.click() }

  return (
    <div className="file-slot">
      <div className="file-slot-label">
        {label}
        {required && <span className="slot-required">必須</span>}
        {!required && <span className="slot-optional">任意</span>}
      </div>
      <div className={`file-slot-drop${hasFile ? ' has-file' : ''}`} onClick={handleTap}>
        {hasFile ? (
          <div className="file-slot-filled">
            {isPDF(file)
              ? <span className="file-icon pdf">PDF</span>
              : <span className="file-icon img">IMG</span>
            }
            <span className="file-name">{file.name}</span>
            <button className="file-remove" onClick={handleRemove} title="削除">×</button>
          </div>
        ) : (
          <div className="file-slot-empty">
            <span className="file-slot-plus">＋</span>
            <span className="file-slot-hint">JPG · PNG · PDF</span>
          </div>
        )}
        {/* iOSのためdisplay:noneを避けopacity/sizeで隠す */}
        <input ref={inputRef} type="file"
          accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
          onChange={handleChange}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }} />
      </div>
    </div>
  )
}

// ─── メインApp ─────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen]               = useState('landing')
  const [basicInfo, setBasicInfo]         = useState({ structure: '', floors: '', familySize: '', ageGroup: '', budget: '' })
  const [selectedPlan, setSelectedPlan]   = useState(null)
  const [files, setFiles]                 = useState({})   // { floor0: File, floor1: File, elevation: File, ... }
  const [diagnosis, setDiagnosis]         = useState(null)
  const [detailDiagnosis, setDetailDiagnosis] = useState(null)
  const [consultResult, setConsultResult] = useState(null)
  const [error, setError]                 = useState(null)
  const [checklist, setChecklist]         = useState({})
  const [loadingMsg, setLoadingMsg]       = useState(LOADING_MESSAGES[0])
  const [loadingPct, setLoadingPct]       = useState(0)
  const [recaptchaSiteKey, setRecaptchaSiteKey] = useState(null)
  const [splash, setSplash]               = useState('in') // 'in' | 'out' | 'done'
  const [consentModal, setConsentModal]   = useState(null) // { plan, action } | null

  // スプラッシュ：フェードイン→表示→フェードアウト
  useEffect(() => {
    const t1 = setTimeout(() => setSplash('out'),  2500) // 2.5秒後にフェードアウト開始
    const t2 = setTimeout(() => setSplash('done'), 4000) // 4秒後に完全非表示
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

  // reCAPTCHA 初期化（キーが設定されている場合のみ）
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => {
      if (d.recaptchaSiteKey) {
        setRecaptchaSiteKey(d.recaptchaSiteKey)
        const s = document.createElement('script')
        s.src = `https://www.google.com/recaptcha/api.js?render=${d.recaptchaSiteKey}`
        document.head.appendChild(s)
      }
    }).catch(() => {})
  }, [])

  // 決済完了後のリダイレクト検出
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('payment') === 'success') {
      setScreen('payment-success')
      window.history.replaceState({}, '', '/')
    } else if (params.get('payment') === 'cancel') {
      setScreen('consult')
      window.history.replaceState({}, '', '/')
    }
  }, [])

  // ローディングメッセージ
  useEffect(() => {
    const msgs = screen === 'detail-loading' ? DETAIL_LOADING_MESSAGES : LOADING_MESSAGES
    if (screen !== 'loading' && screen !== 'detail-loading') return
    let i = 0
    const iv = setInterval(() => {
      i = (i + 1) % msgs.length
      setLoadingMsg(msgs[i])
      setLoadingPct(Math.round(((i + 1) / msgs.length) * 90))
    }, 1400)
    return () => clearInterval(iv)
  }, [screen])

  const handleFileChange = (key, file) => setFiles(prev => ({ ...prev, [key]: file }))

  const buildFormData = () => {
    const fd = new FormData()
    Object.values(files).forEach(f => { if (f) fd.append('files', f) })
    fd.append('basicInfo', JSON.stringify(basicInfo))
    return fd
  }

  // 最初の画像ファイル（プレビュー表示用）
  const primaryFile = Object.values(files).find(f => f && !isPDF(f)) || null

  // 必須ファイルが1枚以上あるか
  const hasRequiredFile = !!files['floor0']

  const handleDiagnose = async () => {
    if (selectedPlan === 'architect') { setError(null); setScreen('consult'); return }

    // ① 無料診断：1日1回制限チェック
    if (selectedPlan === 'free' && !checkDailyLimit()) {
      setError('本日の無料診断は上限に達しました。明日またお試しください。')
      return
    }

    const isDetail = selectedPlan === 'ai'
    setScreen(isDetail ? 'detail-loading' : 'loading')
    setLoadingMsg(isDetail ? DETAIL_LOADING_MESSAGES[0] : LOADING_MESSAGES[0])
    setLoadingPct(5)
    try {
      // ② reCAPTCHA トークン取得
      const token = await getRecaptchaToken(recaptchaSiteKey, 'diagnose')
      const fd = buildFormData()
      if (token) fd.append('recaptchaToken', token)

      const res = await fetch(isDetail ? '/api/diagnose/detail' : '/api/diagnose', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `エラー (${res.status})`)

      // ③ 成功時：無料診断の利用を記録
      if (selectedPlan === 'free') recordUsage()

      setLoadingPct(100)
      setTimeout(() => {
        if (isDetail) { setDetailDiagnosis(data); setScreen('detail') }
        else { setDiagnosis(data); setScreen('results') }
      }, 400)
    } catch (err) { setError(err.message); setScreen('preview') }
  }

  const handleDetailDiagnose = async () => {
    setScreen('detail-loading')
    setLoadingMsg(DETAIL_LOADING_MESSAGES[0]); setLoadingPct(5)
    try {
      const res = await fetch('/api/diagnose/detail', { method: 'POST', body: buildFormData() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `エラー (${res.status})`)
      setLoadingPct(100)
      setTimeout(() => { setDetailDiagnosis(data); setScreen('detail') }, 400)
    } catch (err) { setError(err.message); setScreen('results') }
  }

  const handleConsultSubmit = async (form) => {
    const fd = new FormData()
    fd.append('name', form.name)
    fd.append('email', form.email)
    fd.append('message', form.message || '')
    fd.append('structure',   basicInfo.structure   || '')
    fd.append('floors',      basicInfo.floors      || '')
    fd.append('familySize',  basicInfo.familySize  || '')
    fd.append('ageGroup',    basicInfo.ageGroup    || '')
    const res = await fetch('/api/create-checkout-session', { method: 'POST', body: fd })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    // Stripeの決済ページへリダイレクト
    window.location.href = data.url
  }

  const handleReset = () => {
    setScreen('landing')
    setBasicInfo({ structure: '', floors: '', familySize: '', ageGroup: '', budget: '' })
    setSelectedPlan(null); setFiles({}); setChecklist({})
    setDiagnosis(null); setDetailDiagnosis(null); setConsultResult(null); setError(null)
  }

  // 有料プランへの遷移前に同意モーダルを挟む
  const withConsent = (plan, action) => setConsentModal({ plan, action })

  const backFromConsult = () => {
    if (selectedPlan === 'architect') setScreen('preview')
    else if (detailDiagnosis) setScreen('detail')
    else if (diagnosis) setScreen('results')
    else setScreen('upload')
  }

  return (
    <div className="app">
      {splash !== 'done' && (
        <div className={`splash-overlay splash-${splash}`}>
          <div className="splash-logo">
            <LogoMark size={120} />
          </div>
        </div>
      )}
      <div className={`app-content${splash !== 'in' ? ' app-content--visible' : ''}`}>
        {consentModal && (
          <ConsentModal
            plan={consentModal.plan}
            onAgree={() => { consentModal.action(); setConsentModal(null) }}
            onCancel={() => setConsentModal(null)}
          />
        )}
        <header className="app-header">
          <div className="logo">
            <LogoMark />
            <div className="logo-info">
              <span className="logo-title">Archi AI</span>
              <span className="logo-sub">家づくりの不安をワンタップで可視化</span>
            </div>
          </div>
        </header>

        <main className="app-main">
          {screen === 'landing'        && <LandingScreen onStart={() => setScreen('basicInfo')} />}
          {screen === 'basicInfo'      && <BasicInfoScreen basicInfo={basicInfo} onChange={setBasicInfo} onNext={() => setScreen('planSelect')} onBack={() => setScreen('landing')} />}
          {screen === 'planSelect'     && <PlanSelectScreen selectedPlan={selectedPlan} onChange={setSelectedPlan} onNext={() => { setError(null); setScreen('upload') }} onBack={() => setScreen('basicInfo')} />}
          {screen === 'upload'         && <UploadScreen files={files} onFileChange={handleFileChange} floors={basicInfo.floors} error={error} onNext={() => { setError(null); setScreen('check') }} onBack={() => setScreen('planSelect')} selectedPlan={selectedPlan} hasRequired={hasRequiredFile} />}
          {screen === 'check'          && <CheckScreen checklist={checklist} onChange={setChecklist} onNext={() => { setError(null); setScreen('preview') }} onBack={() => setScreen('upload')} />}
          {screen === 'preview'        && <PreviewScreen files={files} primaryFile={primaryFile} selectedPlan={selectedPlan} onDiagnose={handleDiagnose} onBack={() => setScreen('upload')} error={error} />}
          {screen === 'loading'        && <LoadingScreen message={loadingMsg} pct={loadingPct} title="AIが診断中..." />}
          {screen === 'results'        && diagnosis && <ResultsScreen diagnosis={diagnosis} basicInfo={basicInfo} onReset={handleReset} onDetailDiagnose={() => withConsent('ai', handleDetailDiagnose)} onConsult={() => withConsent('architect', () => setScreen('consult'))} error={error} />}
          {screen === 'detail-loading' && <LoadingScreen message={loadingMsg} pct={loadingPct} title="詳細分析中..." />}
          {screen === 'detail'         && detailDiagnosis && <DetailScreen detail={detailDiagnosis} freeDiagnosis={diagnosis} onBack={() => setScreen(diagnosis ? 'results' : 'upload')} onReset={handleReset} onConsult={() => withConsent('architect', () => setScreen('consult'))} />}
          {screen === 'consult'        && <ConsultScreen onSubmit={handleConsultSubmit} onBack={backFromConsult} selectedPlan={selectedPlan} basicInfo={basicInfo} primaryFile={primaryFile} />}
          {screen === 'consult-done'   && consultResult && <ConsultDoneScreen result={consultResult} onReset={handleReset} />}
          {screen === 'payment-success' && <PaymentSuccessScreen onReset={handleReset} />}
        </main>
      </div>
    </div>
  )
}

// ─── 同意モーダル（有料プラン遷移時） ────────────────────────────────────────

const CONSENT_NOTICES = {
  ai: [
    'AIが画像を読み取り分析します。文字・寸法・記号が不鮮明な場合、正確に認識できず結果に影響することがあります。',
    'AIによる診断のため、必ずしも正確とは限りません。重要な判断は必ず専門家にご確認ください。',
  ],
  architect: [
    'AIによる診断のため、必ずしも正確とは限りません。重要な判断は必ず専門家にご確認ください。',
    '本相談は設計業務ではありません。診断・アドバイスの内容に設計上の責任は負いかねます。',
  ],
}

function ConsentModal({ plan, onAgree, onCancel }) {
  const [agreed, setAgreed] = useState(false)
  return (
    <div className="consent-modal-overlay">
      <div className="consent-modal">
        <p className="consent-title">ご利用にあたって</p>
        <ul className="consent-list">
          {CONSENT_NOTICES[plan].map((n, i) => <li key={i}>{n}</li>)}
        </ul>
        <label className="consent-check">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
          <span>上記の内容を確認し、同意します</span>
        </label>
        <button className="btn-primary" style={{ marginTop: 16 }} onClick={onAgree} disabled={!agreed}>同意して進む</button>
        <button className="btn-ghost" onClick={onCancel}>キャンセル</button>
      </div>
    </div>
  )
}

// ─── 決済完了画面 ─────────────────────────────────────────────────────────────

function PaymentSuccessScreen({ onReset }) {
  return (
    <div className="screen screen-center">
      <div className="done-wrap">
        <div className="done-icon">✓</div>
        <h2 className="done-title">お支払い完了</h2>
        <p className="done-sub">ご相談を受け付けました。</p>
        <div className="done-card">
          <p className="done-message">3営業日以内にご登録のメールアドレスへご連絡いたします。</p>
          <p className="done-message" style={{marginTop:'8px',fontSize:'13px',color:'#787878'}}>
            間取り図ファイルの送付方法はご連絡メールにてご案内します。
          </p>
        </div>
        <div className="done-notice">
          <p>設計責任は負いません。参考意見としてご活用ください</p>
        </div>
        <button className="btn-primary" onClick={onReset}>トップに戻る</button>
      </div>
    </div>
  )
}

// ─── ランディング画面 ──────────────────────────────────────────────────────────

function LandingScreen({ onStart }) {
  return (
    <div className="screen">
      <div className="landing-hero">
        <div className="supervisor-banner">
          一級建築士が監修した診断システム
        </div>
        <h1 className="landing-title">あなたの間取り、<br /><span className="landing-accent">本当に大丈夫？</span></h1>
        <p className="landing-sub">住んでから気づく後悔を、建てる前に発見。<br />間取り画像をアップロードするだけで、<br />プロの視点でスコアリングします。</p>
      </div>

      <div className="landing-features">
        {[
          { icon: '診', cls: 'lfi-blue',   title: '一級建築士監修の診断基準', desc: '評価項目・採点基準はすべて一級建築士が設計・監修' },
          { icon: 'AI', cls: 'lfi-orange', title: 'AIが5項目を瞬時に評価',   desc: '動線・採光・収納・空間・将来性をスコアリング' },
          { icon: '相', cls: 'lfi-green',  title: '必要なら直接相談も可能',   desc: '一級建築士への個別相談プランもご用意' },
        ].map(f => (
          <div key={f.title} className="landing-feature-item">
            <div className={`landing-feature-icon ${f.cls}`}>{f.icon}</div>
            <div>
              <p className="landing-feature-title">{f.title}</p>
              <p className="landing-feature-desc">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <button className="btn-primary btn-start" onClick={onStart}>診断を始める</button>
      <p className="landing-free-note">まずは無料で試せます</p>
    </div>
  )
}

// ─── 基本情報入力画面 ──────────────────────────────────────────────────────────

function BasicInfoScreen({ basicInfo, onChange, onNext, onBack }) {
  const isComplete = basicInfo.structure && basicInfo.floors && basicInfo.familySize && basicInfo.ageGroup
  return (
    <div className="screen">
      <StepBar step={1} />
      <h2 className="page-title">建物の情報を教えてください</h2>
      <p className="page-sub">診断の精度を高めるために使用します</p>

      <div className="info-fields">
        {[
          { label: '構造方式',     options: STRUCTURE_OPTIONS, key: 'structure' },
          { label: '階数',         options: FLOOR_OPTIONS,     key: 'floors' },
          { label: '家族人数',     options: FAMILY_OPTIONS,    key: 'familySize' },
          { label: '世帯主の年齢', options: AGE_OPTIONS,       key: 'ageGroup' },
        ].map(({ label, options, key }) => (
          <div key={key} className="info-field">
            <label className="info-label">{label}</label>
            <PillSelect options={options} value={basicInfo[key]} onChange={v => onChange(prev => ({ ...prev, [key]: v }))} />
          </div>
        ))}
        <div className="info-field">
          <label className="info-label">建設予算　<span className="slot-optional">任意</span></label>
          <PillSelect options={BUDGET_OPTIONS} value={basicInfo.budget} onChange={v => onChange(prev => ({ ...prev, budget: v }))} />
        </div>
      </div>

      <button className="btn-primary" onClick={onNext} disabled={!isComplete} style={{ opacity: isComplete ? 1 : 0.35 }}>
        次へ（診断コースを選ぶ）
      </button>
      <button className="btn-ghost" onClick={onBack}>戻る</button>
    </div>
  )
}

// ─── 診断コース選択画面 ────────────────────────────────────────────────────────

function PlanSelectScreen({ selectedPlan, onChange, onNext, onBack }) {
  return (
    <div className="screen">
      <StepBar step={2} />
      <h2 className="page-title">どのコースで診断しますか？</h2>

      <div className="plan-cards">
        {PLANS.map(plan => (
          <div key={plan.id} className={`plan-card${selectedPlan === plan.id ? ' plan-card-active' : ''}`} onClick={() => onChange(plan.id)}>
            <div className="plan-card-top">
              <div>
                <span className="plan-tag" style={{ background: plan.tagBg }}>{plan.tag}</span>
                <p className="plan-name">{plan.name}</p>
              </div>
              <p className="plan-price">{plan.price}</p>
            </div>
            <ul className="plan-features">
              {plan.features.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
            {selectedPlan === plan.id && <div className="plan-selected-mark">選択中</div>}
          </div>
        ))}
      </div>

      <div className="plan-disclaimer">
        ※ AI診断と一級建築士による診断では、観点や指摘内容が異なる場合があります。建築士相談はAI診断とは独立した専門家の見解です。
      </div>

      <button className="btn-primary" onClick={onNext} disabled={!selectedPlan} style={{ opacity: selectedPlan ? 1 : 0.35 }}>
        {selectedPlan === 'architect' ? '間取りをアップロードして相談する' : 'この診断を始める'}
      </button>
      <button className="btn-ghost" onClick={onBack}>戻る</button>
    </div>
  )
}

// ─── ファイルアップロード画面 ──────────────────────────────────────────────────

function UploadScreen({ files, onFileChange, floors, error, onNext, onBack, selectedPlan, hasRequired }) {
  const slots = getFileSlots(floors)
  const planSlots = slots.filter(s => s.group === 'plan')
  const extraSlots = slots.filter(s => s.group === 'extra')

  return (
    <div className="screen">
      <StepBar step={3} />

      <div className="upload-section-title">
        <span className="upload-section-label">間取り図</span>
        <span className="upload-section-note">階数に応じてアップロード</span>
      </div>
      {planSlots.map(slot => (
        <FileSlot key={slot.key} label={slot.label} required={slot.required}
          file={files[slot.key] || null} onChange={f => onFileChange(slot.key, f)} />
      ))}

      <div className="upload-section-title" style={{ marginTop: 20 }}>
        <span className="upload-section-label">追加資料</span>
        <span className="upload-section-note">任意</span>
      </div>
      {extraSlots.map(slot => (
        <FileSlot key={slot.key} label={slot.label} required={slot.required}
          file={files[slot.key] || null} onChange={f => onFileChange(slot.key, f)} />
      ))}

      <p className="upload-format-note">JPG · PNG · WebP · PDF ／ 1ファイル最大20MB</p>
      {error && <div className="error-box">{error}</div>}

      <button className="btn-primary" onClick={onNext} disabled={!hasRequired} style={{ opacity: hasRequired ? 1 : 0.35, marginTop: 20 }}>
        確認して次へ
      </button>
      <button className="btn-ghost" onClick={onBack}>戻る</button>
    </div>
  )
}

// ─── プレビュー画面 ────────────────────────────────────────────────────────────

function PreviewScreen({ files, primaryFile, selectedPlan, onDiagnose, onBack, error }) {
  const isArchitect = selectedPlan === 'architect'
  const isFree      = selectedPlan === 'free'
  const isAI        = selectedPlan === 'ai'
  const allFiles    = Object.entries(files).filter(([, f]) => f)
  const [agreed, setAgreed] = useState(false)

  const notices = [
    ...(isFree ? ['本診断は一般的な観点に基づく参考情報です。個別の条件や詳細な図面情報を反映した精度には限りがあります。'] : []),
    ...(isAI   ? ['AI が画像を読み取り分析します。文字・寸法・記号が不鮮明な場合、正確に認識できず結果に影響することがあります。'] : []),
    'AI による診断のため、必ずしも正確とは限りません。重要な判断は必ず専門家にご確認ください。',
    ...(isArchitect ? ['本相談は設計業務ではありません。診断・アドバイスの内容に設計上の責任は負いかねます。'] : []),
  ]

  return (
    <div className="screen">
      <h2 className="page-title">アップロード内容を確認</h2>

      <div className="preview-file-list">
        {allFiles.map(([key, file]) => (
          <div key={key} className="preview-file-row">
            {!isPDF(file) ? (
              <img src={URL.createObjectURL(file)} alt={file.name} className="preview-thumb" />
            ) : (
              <div className="preview-thumb preview-thumb-pdf">PDF</div>
            )}
            <span className="preview-file-name">{file.name}</span>
          </div>
        ))}
      </div>

      <p className="preview-note">
        {isArchitect ? 'この内容で一級建築士に相談します' : 'この内容をAIが診断します'}
      </p>

      <div className="consent-box">
        <p className="consent-title">ご利用にあたって</p>
        <ul className="consent-list">
          {notices.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
        <label className="consent-check">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
          <span>上記の内容を確認し、同意します</span>
        </label>
      </div>

      {error && <div className="error-box">{error}</div>}
      <button className="btn-primary" onClick={onDiagnose} disabled={!agreed}>
        {isArchitect ? '相談を申し込む画面へ進む' : '診断を開始する'}
      </button>
      <button className="btn-ghost" onClick={onBack}>ファイルを変更する</button>
    </div>
  )
}

// ─── ローディング画面 ──────────────────────────────────────────────────────────

function LoadingScreen({ message, pct, title }) {
  return (
    <div className="screen screen-center">
      <div className="loading-wrap">
        <svg className="spin" width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="#E5E7EB" strokeWidth="5" />
          <circle cx="32" cy="32" r="26" fill="none" stroke="#C42230" strokeWidth="5"
            strokeDasharray="40 122" strokeLinecap="butt" />
        </svg>
        <h2 className="loading-title">{title}</h2>
        <p className="loading-msg">{message}</p>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%`, transition: 'width 1.2s ease' }} /></div>
        <p className="loading-hint">一級建築士監修の診断基準で分析しています</p>
      </div>
    </div>
  )
}

// ─── 無料診断 結果画面 ─────────────────────────────────────────────────────────

function ResultsScreen({ diagnosis, basicInfo, onReset, onDetailDiagnose, onConsult, error }) {
  const { total, scores, good_points, issues, suggestions, overall_comment } = diagnosis
  const grade = getGrade(total)

  return (
    <div className="screen">
      <div className="score-hero" style={{ borderTopColor: grade.color }}>
        <p className="score-hero-label">総合スコア（無料診断）</p>
        <ScoreCircle score={total} />
        <div className="grade-chip" style={{ background: grade.color }}>{grade.rank}ランク</div>
        <p className="grade-text" style={{ color: grade.color }}>{grade.text}</p>
        {basicInfo.structure && (
          <p className="result-basic-info">{basicInfo.structure} · {basicInfo.floors} · {basicInfo.familySize}家族 · {basicInfo.ageGroup}</p>
        )}
      </div>

      <div className="section">
        <h3 className="section-title">カテゴリ別スコア</h3>
        <div className="score-bars-card">
          {CATEGORIES.map((c, i) => <ScoreBar key={c.key} score={scores[c.key]} label={c.label} desc={c.desc} delay={i * 120} />)}
        </div>
      </div>

      {good_points?.length > 0 && (
        <div className="section">
          <h3 className="section-title title-good">良い点</h3>
          <div className="result-card card-good">
            {good_points.map((p, i) => <div key={i} className="result-row"><span className="result-icon icon-good">✓</span><span>{p}</span></div>)}
          </div>
        </div>
      )}
      {issues?.length > 0 && (
        <div className="section">
          <h3 className="section-title title-warn">気になるポイント</h3>
          <div className="result-card card-warn">
            {issues.map((p, i) => <div key={i} className="result-row"><span className="result-icon icon-warn">!</span><span>{p}</span></div>)}
          </div>
        </div>
      )}
      {suggestions?.length > 0 && (
        <div className="section">
          <h3 className="section-title title-info">改善提案</h3>
          <div className="result-card card-info">
            {suggestions.map((p, i) => <div key={i} className="result-row"><span className="result-icon icon-info">→</span><span>{p}</span></div>)}
          </div>
        </div>
      )}
      {overall_comment && (
        <div className="section">
          <h3 className="section-title">AIからの総評</h3>
          <div className="comment-card"><p className="comment-text">「{overall_comment}」</p></div>
          <p className="supervisor-caption">※ 診断基準は一級建築士が監修しています</p>
        </div>
      )}

      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="premium-section">
        <p className="premium-label">さらに詳しく知りたい方へ</p>
        <div className="premium-card">
          <div className="premium-card-top">
            <div><span className="premium-card-name">② AI詳細診断</span><p className="premium-card-sub">問題点の深掘り＋生活ストレス予測</p></div>
            <span className="premium-card-price">¥500</span>
          </div>
          <ul className="premium-list">
            <li>優先順位付きの問題点リスト（最大5件）</li>
            <li>「住んでから気づく」生活ストレスの予測</li>
            <li>コスト感付きの具体的改善提案</li>
          </ul>
          <button className="btn-premium-orange" onClick={onDetailDiagnose}>AI詳細診断を見る（¥500）</button>
        </div>
        <div className="premium-card" style={{ marginTop: 10 }}>
          <div className="premium-card-top">
            <div><span className="premium-card-name">③ 一級建築士相談</span><p className="premium-card-sub">専門家が直接チェック</p></div>
            <span className="premium-card-price">¥3,000</span>
          </div>
          <ul className="premium-list">
            <li>一級建築士による間取りの妥当性チェック</li>
            <li>動線・方位・収納・圧迫感の指摘</li>
            <li>テキストコメント付きフィードバック</li>
          </ul>
          <button className="btn-premium-white" onClick={onConsult}>一級建築士に相談する（¥3,000）</button>
        </div>
        <div className="plan-disclaimer" style={{ marginTop: 10 }}>
          ※ AI診断と一級建築士による診断では、観点や指摘内容が異なる場合があります。
        </div>
        <p className="premium-note">※ 設計責任は負いません。あくまで参考意見としてご活用ください。</p>
      </div>
      <button className="btn-ghost" onClick={onReset}>最初からやり直す</button>
    </div>
  )
}

// ─── AI詳細診断 結果画面 ───────────────────────────────────────────────────────

function DetailScreen({ detail, freeDiagnosis, onBack, onReset, onConsult }) {
  const { priority_issues = [], life_stress = [], detailed_suggestions = [], verdict } = detail
  return (
    <div className="screen">
      <div className="detail-hero">
        <div className="detail-badge">AI詳細診断レポート</div>
        <h2 className="detail-title">あなたの間取りの<br />本当のリスク</h2>
        {freeDiagnosis && <p className="detail-score-note">無料診断スコア：<strong>{freeDiagnosis.total}点</strong></p>}
      </div>

      {priority_issues.length > 0 && (
        <div className="section">
          <h3 className="section-title title-warn">優先度の高い問題点</h3>
          <div className="priority-list">
            {priority_issues.map((issue, i) => (
              <div key={i} className="priority-item">
                <div className="priority-header">
                  <span className="priority-rank" style={{ background: i === 0 ? '#C42230' : i === 1 ? '#F97316' : '#F59E0B' }}>優先度{issue.rank}</span>
                  <span className="priority-title">{issue.title}</span>
                </div>
                <p className="priority-detail">{issue.detail}</p>
                <div className="priority-impact">
                  <span className="impact-label">生活への影響</span>
                  <span className="impact-text">{issue.impact}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {life_stress.length > 0 && (
        <div className="section">
          <h3 className="section-title title-stress">住んでから感じるストレス</h3>
          <div className="stress-card">
            {life_stress.map((s, i) => <div key={i} className="stress-row"><span className="stress-icon">😓</span><span>{s}</span></div>)}
          </div>
        </div>
      )}

      {detailed_suggestions.length > 0 && (
        <div className="section">
          <h3 className="section-title title-info">具体的な改善提案</h3>
          <div className="suggestion-list">
            {detailed_suggestions.map((s, i) => {
              const costStyle = COST_COLORS[s.cost_hint] || COST_COLORS['中程度の工事']
              return (
                <div key={i} className="suggestion-item">
                  <div className="suggestion-header">
                    <span className="suggestion-area">{s.area}</span>
                    <span className="suggestion-cost" style={costStyle}>{s.cost_hint}</span>
                  </div>
                  <p className="suggestion-action">{s.action}</p>
                  <p className="suggestion-reason">{s.reason}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {verdict && (
        <div className="section">
          <h3 className="section-title">AIからの verdict</h3>
          <div className="verdict-card"><p className="verdict-text">{verdict}</p></div>
          <p className="supervisor-caption">※ 診断基準は一級建築士が監修しています</p>
        </div>
      )}

      <div className="premium-section">
        <p className="premium-label">より確かな判断のために</p>
        <div className="premium-card">
          <div className="premium-card-top">
            <div><span className="premium-card-name">③ 一級建築士相談</span><p className="premium-card-sub">専門家が直接チェック</p></div>
            <span className="premium-card-price">¥3,000</span>
          </div>
          <ul className="premium-list">
            <li>一級建築士による間取りの妥当性チェック</li>
            <li>動線・方位・収納・圧迫感の指摘</li>
            <li>テキストコメント付きフィードバック</li>
          </ul>
          <button className="btn-premium-orange" onClick={onConsult}>一級建築士に相談する</button>
        </div>
        <div className="plan-disclaimer" style={{ marginTop: 10 }}>
          ※ AI診断と一級建築士による診断では、観点や指摘内容が異なる場合があります。
        </div>
        <p className="premium-note">※ 設計責任は負いません。あくまで参考意見としてご活用ください。</p>
      </div>

      <button className="btn-ghost" onClick={onBack}>無料診断結果に戻る</button>
      <button className="btn-ghost" onClick={onReset}>最初からやり直す</button>
    </div>
  )
}

// ─── 建築士相談 フォーム ───────────────────────────────────────────────────────

function ConsultScreen({ onSubmit, onBack, selectedPlan, basicInfo, primaryFile }) {
  const [form, setForm]       = useState({ name: '', email: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) { setError('お名前とメールアドレスを入力してください'); return }
    setLoading(true); setError(null)
    try { await onSubmit(form) } catch (err) { setError(err.message); setLoading(false) }
  }

  return (
    <div className="screen">
      <div className="consult-hero">
        <div className="detail-badge">一級建築士による第三者相談</div>
        <h2 className="detail-title">専門家に<br />直接聞いてみる</h2>
        <p className="consult-sub">建築士が間取りの妥当性をチェックし、テキストでフィードバックします。</p>
      </div>

      <div className="consult-info-card">
        <p className="consult-info-title">サービス内容</p>
        {['間取りの妥当性チェック（法規確認は除く）','動線・方位・収納・圧迫感の指摘','テキストコメントでのフィードバック','3営業日以内にメールでご連絡'].map((t,i)=>(
          <div key={i} className="consult-info-row"><span className="consult-info-icon">✓</span><span>{t}</span></div>
        ))}
        <div className="consult-price-row"><span>相談料</span><span className="consult-price">¥3,000（税込）</span></div>
        {basicInfo.structure && (
          <div className="consult-basic-info"><span>建物情報：</span><span>{basicInfo.structure} · {basicInfo.floors} · {basicInfo.familySize}家族 · {basicInfo.ageGroup}</span></div>
        )}
        <p className="consult-disclaimer">※ 設計責任は負いません。参考意見としてご活用ください。</p>
        <p className="consult-disclaimer">※ AI診断と一級建築士による診断では、観点や指摘内容が異なる場合があります。</p>
      </div>

      <form className="consult-form" onSubmit={handleSubmit} noValidate>
        <h3 className="form-title">お申し込み情報</h3>
        <div className="form-field">
          <label className="form-label" htmlFor="name">お名前 <span className="form-required">必須</span></label>
          <input id="name" name="name" type="text" className="form-input" placeholder="山田 太郎" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="email">メールアドレス <span className="form-required">必須</span></label>
          <input id="email" name="email" type="email" className="form-input" placeholder="example@email.com" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="message">気になる点・ご要望 <span className="slot-optional">任意</span></label>
          <textarea id="message" name="message" className="form-textarea" rows="4"
            placeholder="例：キッチンから洗面所への動線が気になります..."
            value={form.message} onChange={e=>setForm({...form,message:e.target.value})} />
        </div>
        <div className="form-note-box"><p>アップロード済みのファイルが自動的に添付されます。</p></div>
        {error && <div className="error-box">{error}</div>}
        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? '決済ページへ移動中...' : 'カードで支払う（¥3,000）'}
        </button>
      </form>
      <button className="btn-ghost" onClick={onBack}>戻る</button>
    </div>
  )
}

// ─── 完了画面 ─────────────────────────────────────────────────────────────────

function ConsultDoneScreen({ result, onReset }) {
  return (
    <div className="screen screen-center">
      <div className="done-wrap">
        <div className="done-icon">✓</div>
        <h2 className="done-title">お申し込み完了</h2>
        <p className="done-sub">ご相談を受け付けました。</p>
        <div className="done-card">
          <div className="done-row"><span className="done-label">受付番号</span><span className="done-value ref">{result.ref_no}</span></div>
          <div className="done-row"><span className="done-label">受付日時</span><span className="done-value">{result.received}</span></div>
          <p className="done-message">{result.message}</p>
        </div>
        <div className="done-notice">
          <p>3営業日以内にご登録のメールアドレスへご連絡します</p>
          <p>設計責任は負いません。参考意見としてご活用ください</p>
        </div>
        <button className="btn-primary" onClick={onReset}>トップに戻る</button>
      </div>
    </div>
  )
}

// ─── 図面確認チェックリスト画面 ──────────────────────────────────────────────

function CheckScreen({ checklist, onChange, onNext, onBack }) {
  const toggle = (key) => onChange(prev => ({ ...prev, [key]: !prev[key] }))
  const requiredDone = CHECK_ITEMS.filter(i => i.required).every(i => checklist[i.key])

  return (
    <div className="screen">
      <h2 className="page-title">図面の内容を確認</h2>

      <div className="check-intro">
        <p>AIが正確に診断するために、アップロードした図面に以下の情報が含まれているか確認してください。不足している場合は戻って追加のファイルを添付できます。</p>
      </div>

      <div className="check-items-list">
        {CHECK_ITEMS.map(item => (
          <div key={item.key}
            className={`check-item-row${checklist[item.key] ? ' checked' : ''}`}
            onClick={() => toggle(item.key)}>
            <div className={`check-checkbox${checklist[item.key] ? ' checked' : ''}`}>
              {checklist[item.key] && '✓'}
            </div>
            <div className="check-item-body">
              <p className="check-item-label">
                {item.label}
                {item.required && <span className="slot-required">必須</span>}
              </p>
              <p className="check-item-note">{item.note}</p>
            </div>
          </div>
        ))}
      </div>

      {!requiredDone && (
        <div className="check-warn-box">
          必須項目（方位・部屋名）が確認できない場合、診断精度が下がることがあります。このまま進むこともできます。
        </div>
      )}

      <button className="btn-primary" onClick={onNext} style={{ marginTop: 8 }}>
        {requiredDone ? '診断へ進む' : 'このまま診断へ進む'}
      </button>
      <button className="btn-ghost" onClick={onBack}>ファイルを確認・追加する</button>
    </div>
  )
}

// ─── ステップバー ──────────────────────────────────────────────────────────────

function StepBar({ step }) {
  return (
    <div className="step-header">
      <div className="step-indicators">
        {[1,2,3].map((s, i) => (<>
          {i > 0 && <span key={`l${s}`} className={`step-line${step > s-1 ? ' step-line-done' : ''}`} />}
          <span key={s} className={`step-dot${step === s ? ' step-active' : step > s ? ' step-done' : ''}`} />
        </>))}
      </div>
      <p className="step-label">STEP {step} / 3　{['基本情報の入力','診断コースを選ぶ','ファイルをアップロード'][step-1]}</p>
    </div>
  )
}
