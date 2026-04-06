# -*- coding: utf-8 -*-
"""
Archi AI 無料診断テンプレート案 PDF生成スクリプト
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
import os

# ── フォント登録 ──────────────────────────────────────────────
FONT_NAME = None

# 1) HeiseiKakuGo-W5 CID フォント（reportlab 組み込み）
try:
    pdfmetrics.registerFont(UnicodeCIDFont('HeiseiKakuGo-W5'))
    FONT_NAME = 'HeiseiKakuGo-W5'
    print(f"Using CID font: {FONT_NAME}")
except Exception as e:
    print(f"HeiseiKakuGo-W5 unavailable: {e}")

# 2) Windows TrueType フォールバック
if FONT_NAME is None:
    for path, name in [
        (r'C:/Windows/Fonts/msgothic.ttc', 'MSGothic'),
        (r'C:/Windows/Fonts/meiryo.ttc',   'Meiryo'),
        (r'C:/Windows/Fonts/YuGothM.ttc',  'YuGothic'),
    ]:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont(name, path))
                FONT_NAME = name
                print(f"Using TrueType font: {FONT_NAME} ({path})")
                break
            except Exception as e:
                print(f"Could not register {name}: {e}")

if FONT_NAME is None:
    raise RuntimeError("日本語フォントを登録できませんでした。")

# ── カラーパレット ────────────────────────────────────────────
C_TITLE_BG   = colors.HexColor('#1B3A6B')  # 濃紺
C_TITLE_FG   = colors.white
C_H2_BG      = colors.HexColor('#2E6DA4')  # 青
C_H3_BG      = colors.HexColor('#4A9CCA')  # 中青
C_GOOD_HDR   = colors.HexColor('#1E7E34')  # 深緑
C_ISSUE_HDR  = colors.HexColor('#C0392B')  # 赤
C_SUGG_HDR   = colors.HexColor('#7D5A00')  # 茶
C_EVEN_ROW   = colors.HexColor('#F5F8FF')
C_ALT_GOOD   = colors.HexColor('#EBF5EB')
C_ALT_ISSUE  = colors.HexColor('#FDF0EE')
C_ALT_SUGG   = colors.HexColor('#FFFAEB')
C_GRID       = colors.HexColor('#CCCCCC')

# ── スタイル定義 ─────────────────────────────────────────────
def S(name, parent_name='Normal', **kw):
    base = {
        'fontName': FONT_NAME,
        'fontSize': 10,
        'leading': 16,
        'spaceAfter': 4,
    }
    base.update(kw)
    return ParagraphStyle(name, **base)

st_normal   = S('Normal_J')
st_title    = S('Title_J',    fontSize=22, leading=30, textColor=C_TITLE_FG,
                alignment=1, spaceAfter=6)
st_subtitle = S('Subtitle_J', fontSize=13, leading=20, textColor=C_TITLE_FG,
                alignment=1, spaceAfter=4)
st_date     = S('Date_J',     fontSize=11, leading=18, textColor=colors.HexColor('#DDDDFF'),
                alignment=1, spaceAfter=0)
st_h2       = S('H2_J',       fontSize=14, leading=20, textColor=colors.white,
                spaceAfter=2, spaceBefore=8)
st_h3       = S('H3_J',       fontSize=11, leading=16, textColor=colors.white,
                spaceAfter=2, spaceBefore=4)
st_cell     = S('Cell_J',     fontSize=8,  leading=12)
st_cell_hdr = S('CellHdr_J',  fontSize=8,  leading=12, textColor=colors.white)
st_band     = S('Band_J',     fontSize=8,  leading=12, alignment=1)

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

# ── ページ番号フッター ────────────────────────────────────────
def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont(FONT_NAME, 8)
    canvas.setFillColor(colors.HexColor('#888888'))
    canvas.drawCentredString(
        PAGE_W / 2,
        12 * mm,
        f"Archi AI 無料診断テンプレート案  —  {doc.page}"
    )
    canvas.restoreState()

# ── ヘルパー：色付きヘッダーブロック ─────────────────────────
def colored_header(text, style, bg_color, radius=3):
    """Paragraph を Table でラップして背景色を付ける"""
    t = Table([[Paragraph(text, style)]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg_color),
        ('ROUNDEDCORNERS', [radius, radius, radius, radius]),
        ('LEFTPADDING',  (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING',   (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING',(0, 0), (-1, -1), 5),
    ]))
    return t

# ── ヘルパー：データテーブル生成 ─────────────────────────────
def make_table(headers, rows, hdr_color, alt_color, col_widths=None):
    if col_widths is None:
        n = len(headers)
        if n == 3:
            col_widths = [CONTENT_W * 0.10, CONTENT_W * 0.12, CONTENT_W * 0.78]
        else:
            col_widths = [CONTENT_W / n] * n

    data = [[Paragraph(h, st_cell_hdr) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), st_cell) for c in row])

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style = [
        # ヘッダー行
        ('BACKGROUND',    (0, 0), (-1, 0), hdr_color),
        ('TEXTCOLOR',     (0, 0), (-1, 0), colors.white),
        ('FONTNAME',      (0, 0), (-1, -1), FONT_NAME),
        ('FONTSIZE',      (0, 0), (-1, -1), 8),
        ('LEADING',       (0, 0), (-1, -1), 11),
        ('LEFTPADDING',   (0, 0), (-1, -1), 4),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 4),
        ('TOPPADDING',    (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('VALIGN',        (0, 0), (-1, -1), 'TOP'),
        ('GRID',          (0, 0), (-1, -1), 0.4, C_GRID),
        ('ROWBACKGROUNDS',(0, 1), (-1, -1), [colors.white, alt_color]),
    ]
    t.setStyle(TableStyle(style))
    return t

# ── コンテンツ構築 ────────────────────────────────────────────
def build_story():
    story = []

    # ── タイトルページ ─────────────────────────────────────
    title_block = Table(
        [[Paragraph('Archi AI 無料診断テンプレート案', st_title)],
         [Paragraph('スコア帯細分化版（一級建築士確認用）', st_subtitle)],
         [Paragraph('2026年4月6日', st_date)]],
        colWidths=[CONTENT_W]
    )
    title_block.setStyle(TableStyle([
        ('BACKGROUND',    (0, 0), (-1, -1), C_TITLE_BG),
        ('ROUNDEDCORNERS',[6, 6, 6, 6]),
        ('TOPPADDING',    (0, 0), (-1, -1), 18),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 18),
        ('LEFTPADDING',   (0, 0), (-1, -1), 20),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 20),
    ]))
    story.append(title_block)
    story.append(Spacer(1, 10 * mm))

    # ── スコア帯定義 ──────────────────────────────────────
    story.append(colored_header('スコア帯定義（5段階）', st_h2, C_H2_BG))
    story.append(Spacer(1, 2 * mm))

    score_rows = [
        ['S',  '90〜100', '優秀'],
        ['A',  '75〜89',  '良好'],
        ['B',  '60〜74',  '標準'],
        ['C',  '45〜59',  '要注意'],
        ['D+', '30〜44',  '要改善'],
        ['D',  '0〜29',   '深刻'],
    ]
    story.append(make_table(
        ['帯', '範囲', '意味'],
        score_rows,
        C_TITLE_BG,
        C_EVEN_ROW,
        col_widths=[CONTENT_W*0.10, CONTENT_W*0.20, CONTENT_W*0.70]
    ))
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=C_GRID))
    story.append(Spacer(1, 4 * mm))

    # ── カテゴリデータ ────────────────────────────────────
    categories = [
        {
            'title': 'カテゴリ1：動線（dosen）',
            'good': {
                'headers': ['帯', 'コード', 'テンプレート文'],
                'rows': [
                    ['S', 'D-G1', '玄関〜LDK〜水回りの主動線が最短距離でまとまっており、無駄な移動が極めて少ない配置です'],
                    ['S', 'D-G2', '家事動線（キッチン〜洗面所〜物干し）が一直線に近い配置で、作業効率が高い間取りです'],
                    ['A', 'D-G3', '来客動線とプライベート動線が明確に分離されており、生活感を隠しやすい構成です'],
                    ['A', 'D-G4', 'キッチンからLDK全体を見渡しやすい配置で、子どもの様子を確認しながら家事ができます'],
                    ['B', 'D-G5', '動線の基本構成はおおむね整理されており、大きな迂回は見受けられません'],
                ],
            },
            'issues': {
                'headers': ['帯', 'コード', 'テンプレート文'],
                'rows': [
                    ['D', 'D-I1', 'キッチンから洗面所・洗濯機置き場までの距離が長く、毎日の家事で相当の移動負担が生じやすい配置です'],
                    ['C', 'D-I2', '水回り（キッチン・洗面・浴室）が離れて配置されており、家事の同時進行がしにくい傾向があります'],
                    ['D', 'D-I3', '玄関からLDKを通り抜けないと各個室へ行けない配置で、来客時にプライベートエリアが筒抜けになりやすい構造です'],
                    ['C', 'D-I4', 'トイレの位置が玄関・LDKに近く、来客時に使用をためらいやすい配置です'],
                    ['C', 'D-I5', '廊下面積の比率が高く、居室・収納に活用できる有効面積が圧迫されています'],
                    ['B', 'D-I6', '一部の動線が交差・重複しており、特定の時間帯に家族の行き来が集中しやすい可能性があります'],
                    ['C', 'D-I7', '主寝室や子ども部屋への移動にLDKを経由する必要があり、深夜・早朝の生活音が干渉しやすい配置です'],
                ],
            },
            'suggestions': {
                'headers': ['対応Issue', 'コード', 'テンプレート文'],
                'rows': [
                    ['D-I1/I2', 'D-S1', '洗面脱衣室とキッチンの位置関係について、近接配置の可能性を設計士に確認してみる価値があります'],
                    ['D-I3',    'D-S2', '玄関ホールから各エリアへの動線分岐を再検討することで、プライバシーを確保しやすくなる可能性があります'],
                    ['D-I4',    'D-S3', 'トイレ入口の向きを廊下側に変更できるか、設計段階で確認してみると良いかもしれません'],
                    ['D-I5',    'D-S4', '廊下幅・廊下長の最適化により、居室や収納に転換できるスペースが生まれる可能性があります'],
                    ['D-I7',    'D-S5', '主寝室・子ども部屋への動線を廊下経由に変更できるか、間取り上の検討余地を確認してみてください'],
                ],
            },
        },
        {
            'title': 'カテゴリ2：採光・方位（lighting）',
            'good': {
                'headers': ['帯', 'コード', 'テンプレート文'],
                'rows': [
                    ['S', 'L-G1', 'LDKが南面に大きく開かれており、冬季も含めた終日の採光が期待できる優れた配置です'],
                    ['S', 'L-G2', '主要な居室が東・南・西面にバランスよく配置されており、各室の日照条件が良好です'],
                    ['A', 'L-G3', 'リビングに吹き抜けや高窓が設けられており、奥まった空間への採光が工夫されています'],
                    ['A', 'L-G4', '南北方向に風の通り道となる開口が確保されており、通風・換気条件が良好です'],
                    ['B', 'L-G5', '主要な生活空間（LDKまたは主寝室）の採光条件はおおむね標準的な水準を満たしています'],
                ],
            },
            'issues': {
                'headers': ['帯', 'コード', 'テンプレート文'],
                'rows': [
                    ['D', 'L-I1', '子ども部屋・主寝室が北面に集中しており、冬季の日照時間が著しく短くなる傾向があります'],
                    ['C', 'L-I2', 'LDKに隣接する壁や構造物の影響で、リビングへの直射光が遮られやすい配置です'],
                    ['C', 'L-I3', '居室に対して窓面積が小さい、または開口部が少ない可能性があります'],
                    ['D', 'L-I4', '建物全体が北向き・閉鎖的な構成で、自然光が全体的に入りにくい構造です'],
                    ['B', 'L-I5', '窓の位置・大きさが間取り図から読み取りにくく、採光計画の詳細確認が必要な箇所があります'],
                    ['C', 'L-I6', '東西に細長い配置のため、中央部の居室が採光上の死角になりやすい構造です'],
                    ['B', 'L-I7', '隣家や道路との位置関係によっては、南面開口からの採光が遮られる可能性があります'],
                ],
            },
            'suggestions': {
                'headers': ['対応Issue', 'コード', 'テンプレート文'],
                'rows': [
                    ['L-I1', 'L-S1', '北側居室への天窓・高窓の設置で、採光量を大きく改善できる可能性があります'],
                    ['L-I2', 'L-S2', '隣接する居室との間に室内窓を設けることで、光を間接的に取り込む方法が考えられます'],
                    ['L-I3', 'L-S3', '開口部のサイズ・位置変更について、構造上の制約と合わせて設計士に確認してみてください'],
                    ['L-I6', 'L-S4', '中央部に光井戸（ライトコート）や吹き抜けを配置する案を設計士に相談してみる価値があります'],
                ],
            },
        },
        {
            'title': 'カテゴリ3：収納計画（storage）',
            'good': {
                'headers': ['帯', 'コード', 'テンプレート文'],
                'rows': [
                    ['S', 'S-G1', '玄関収納・パントリー・洗面収納が各動線上に適切に配置されており、「使う場所にしまえる」設計になっています'],
                    ['S', 'S-G2', 'ウォークインクローゼットや大型収納が十分に確保されており、家族人数に対して収納量が充実しています'],
                    ['A', 'S-G3', '各居室にクローゼットが設けられており、個人の荷物を各室内に完結できる構成です'],
                    ['A', 'S-G4', '玄関にシューズクローク相当の収納スペースが確保されており、外回り品の整理がしやすい配置です'],
                    ['B', 'S-G5', '収納スペースの総量は標準的な水準を満たしています'],
                ],
            },
            'issues': {
                'headers': ['帯', 'コード', 'テンプレート文'],
                'rows': [
                    ['D', 'S-I1', '収納スペースが居室面積に対して明らかに不足しており、生活物品があふれやすい懸念があります'],
                    ['C', 'S-I2', '収納が一箇所に集中しており、使用頻度の高い場所から遠い「遠い収納」になっています'],
                    ['B', 'S-I3', '玄関収納（シューズクローク・土間収納等）の確保が見受けられません'],
                    ['C', 'S-I4', 'キッチン周辺の収納（パントリー・食器棚スペース）が限られており、食品・調理器具の収まりが懸念されます'],
                    ['C', 'S-I5', '洗面脱衣室に収納スペースが確保されておらず、タオル・日用品の置き場に困る可能性があります'],
                    ['B', 'S-I6', '廊下・ホールに収納が設けられておらず、掃除用具・季節物品の収納場所が不明確です'],
                    ['D', 'S-I7', '床面積に対する収納率が目安（10〜12%）を大きく下回っている可能性があります'],
                ],
            },
            'suggestions': {
                'headers': ['対応Issue', 'コード', 'テンプレート文'],
                'rows': [
                    ['S-I1/I7', 'S-S1', '床面積に対する収納率（目安10〜12%）について設計士に確認し、必要に応じて収納計画の見直しを検討してください'],
                    ['S-I2',    'S-S2', '頻繁に使うエリア（キッチン・洗面・玄関）それぞれに分散収納を設ける「分散収納方式」が有効な場合があります'],
                    ['S-I3',    'S-S3', '玄関土間の一部を収納に転用するか、シューズクローク設置の可能性を設計士に相談してみてください'],
                    ['S-I4',    'S-S4', 'キッチン横のパントリースペース確保について、設計段階での検討が有効です'],
                    ['S-I5',    'S-S5', '洗面脱衣室に壁面棚または洗面台下収納を追加できるか確認してみると良いでしょう'],
                ],
            },
        },
        {
            'title': 'カテゴリ4：空間バランス（space）',
            'good': {
                'headers': ['帯', 'コード', 'テンプレート文'],
                'rows': [
                    ['S', 'SP-G1', 'LDKが20畳以上相当の広さを確保しており、家族全員が集まっても圧迫感が少ない設計です'],
                    ['S', 'SP-G2', '廊下を極力省いた「ホール型」の効率的な面積配分で、居室・収納への有効活用が高い間取りです'],
                    ['A', 'SP-G3', '各居室の広さのバランスが取れており、用途に応じた空間が無理なく確保されています'],
                    ['A', 'SP-G4', 'LDKと隣接する和室・多目的室が一体的に使える配置で、来客・育児時の柔軟性があります'],
                    ['B', 'SP-G5', '各居室の広さは標準的な水準（個室6畳・LDK16畳相当以上）を概ね満たしています'],
                ],
            },
            'issues': {
                'headers': ['帯', 'コード', 'テンプレート文'],
                'rows': [
                    ['D', 'SP-I1', '個室面積の合計がLDKを大きく上回っており、家族が集まる共用空間が狭くなっています'],
                    ['C', 'SP-I2', '廊下・ホール面積の比率が高く、居室・収納へ使える有効面積が圧迫されています'],
                    ['C', 'SP-I3', '一部の個室が4.5畳以下相当と狭く、家具の配置・生活動線の確保が難しい可能性があります'],
                    ['B', 'SP-I4', 'LDKの形状が細長いため、家具レイアウトによっては空間の使い勝手に制約が生じやすい形状です'],
                    ['C', 'SP-I5', '水回り（浴室・洗面・トイレ）のスペースが必要最低限で、将来のリフォームに制約が生じる可能性があります'],
                    ['D', 'SP-I6', '全体の延床面積に対して、居室として活用できる有効面積の比率が低い配分となっています'],
                    ['B', 'SP-I7', '階段・吹き抜けの占有面積が大きく、他の用途に使えるスペースが限られています'],
                ],
            },
            'suggestions': {
                'headers': ['対応Issue', 'コード', 'テンプレート文'],
                'rows': [
                    ['SP-I1', 'SP-S1', 'LDKと隣接する和室・洋室を一体化できるか、間仕切り撤去の可能性を設計士に確認してみてください'],
                    ['SP-I2', 'SP-S2', '廊下スペースを収納・書斎コーナー・ワークスペースに転用できるか検討する余地があります'],
                    ['SP-I3', 'SP-S3', '狭い個室は将来的にウォークインクローゼットや書斎に用途変更する前提で計画する方法もあります'],
                    ['SP-I4', 'SP-S4', '細長いLDKの家具レイアウトについて、設計士または家具配置のシミュレーションを事前に行うと安心です'],
                ],
            },
        },
        {
            'title': 'カテゴリ5：将来対応（future）',
            'good': {
                'headers': ['帯', 'コード', 'テンプレート文'],
                'rows': [
                    ['S', 'F-G1', '1階に寝室・水回りをまとめた配置で、将来の高齢化・バリアフリー化に対応しやすい構成です'],
                    ['S', 'F-G2', '大きな個室を将来的に分割できる間取りで、子育て期・独立後の両方に対応しやすい設計です'],
                    ['A', 'F-G3', 'テレワーク・在宅ケアに転用できる独立した個室が確保されています'],
                    ['A', 'F-G4', '廊下幅が車椅子対応（90cm以上相当）を確保できる余裕があります'],
                    ['B', 'F-G5', 'ライフスタイルの変化に対して最低限の転用余地が見込める間取りです'],
                ],
            },
            'issues': {
                'headers': ['帯', 'コード', 'テンプレート文'],
                'rows': [
                    ['D', 'F-I1', '水回りが2階以上に分散しており、高齢化時の生活を1階に集約するには大規模な工事が必要になる可能性があります'],
                    ['C', 'F-I2', '子育て期・子どもの独立後・老後のいずれのライフステージにも転用が難しい、固定的な間取りの構成です'],
                    ['C', 'F-I3', 'テレワーク・在宅勤務に対応できる静かな個室・集中スペースの余裕が少ない間取りです'],
                    ['B', 'F-I4', '廊下幅が狭く（75cm以下相当）、将来の車椅子対応リフォームにコストがかかる可能性があります'],
                    ['C', 'F-I5', '将来の間仕切り変更を想定した構造上の配慮（耐力壁の位置等）が確認しにくい配置です'],
                    ['D', 'F-I6', '全室が2階以上に配置されており、高齢化対応に根本的な設計変更が必要になる構造です'],
                    ['B', 'F-I7', '現時点の家族構成には最適化されていますが、家族人数の変化（増減）への対応余地が限られています'],
                ],
            },
            'suggestions': {
                'headers': ['対応Issue', 'コード', 'テンプレート文'],
                'rows': [
                    ['F-I1/I6', 'F-S1', '寝室・水回りの1階集約が可能か、初期設計段階での検討が将来的な改修コスト削減につながります'],
                    ['F-I2',    'F-S2', '20〜30年後のライフステージを想定したゾーニングについて、設計士と早めに共有しておくと安心です'],
                    ['F-I3',    'F-S3', '個室の一つをテレワーク・多目的利用に対応できる仕様（防音・コンセント配置等）で設計することを検討してみてください'],
                    ['F-I4',    'F-S4', '廊下幅の確保（最低80cm、理想90cm）についてバリアフリー対応の観点から設計士に確認してみてください'],
                    ['F-I5',    'F-S5', '将来の間仕切り変更を考慮した構造計画（ラーメン構造・スケルトンインフィル等）について確認してみると良いでしょう'],
                ],
            },
        },
    ]

    # サブセクション H3 タイトル・色マッピング
    section_meta = {
        'good':        ('Good Points（良い点）',    C_GOOD_HDR,  C_ALT_GOOD),
        'issues':      ('Issues（課題）',            C_ISSUE_HDR, C_ALT_ISSUE),
        'suggestions': ('Suggestions（改善提案）',   C_SUGG_HDR,  C_ALT_SUGG),
    }

    for cat in categories:
        story.append(colored_header(cat['title'], st_h2, C_H2_BG))
        story.append(Spacer(1, 2 * mm))

        for key in ('good', 'issues', 'suggestions'):
            label, hdr_color, alt_color = section_meta[key]
            story.append(colored_header(label, st_h3, hdr_color))
            story.append(Spacer(1, 1 * mm))
            d = cat[key]
            story.append(make_table(
                d['headers'], d['rows'],
                hdr_color, alt_color
            ))
            story.append(Spacer(1, 3 * mm))

        story.append(HRFlowable(width=CONTENT_W, thickness=0.5, color=C_GRID))
        story.append(Spacer(1, 4 * mm))

    # ── 総合コメント テンプレート ─────────────────────────
    story.append(colored_header('総合コメント テンプレート（6段階）', st_h2, C_H2_BG))
    story.append(Spacer(1, 2 * mm))

    overall_rows = [
        ['S',  '90〜100', '動線・採光・収納・空間バランスのいずれも高水準にまとまった優秀な間取りです。日常生活の質が高く維持できる構成で、大きな課題は見受けられません。'],
        ['A',  '75〜89',  '全体的によくまとまった間取りで、主要な生活動線と採光条件が良好です。一部に改善の余地があるものの、快適な住まいとして機能する設計水準です。'],
        ['B',  '60〜74',  '標準的な水準の間取りです。動線や採光に改善できる余地が複数見受けられ、設計段階での見直しで暮らしやすさをさらに高められる可能性があります。'],
        ['C',  '45〜59',  '複数の課題が重なっており、日常生活での不便が蓄積しやすい懸念があります。優先度の高い項目から設計士に確認することで、大きく改善できる可能性があります。'],
        ['D+', '30〜44',  '動線・採光・収納のいずれかに深刻な課題が集中しています。現在の設計のまま進めると、将来的に高いリフォームコストが発生する可能性があります。'],
        ['D',  '0〜29',   '複数の重要課題が重なった間取りです。着工前に設計全体を見直すことで、長期的な居住快適性とコストを大きく改善できる余地があります。'],
    ]
    story.append(make_table(
        ['帯', '総合スコア', 'テンプレート文'],
        overall_rows,
        C_TITLE_BG, C_EVEN_ROW,
        col_widths=[CONTENT_W*0.08, CONTENT_W*0.14, CONTENT_W*0.78]
    ))
    story.append(Spacer(1, 8 * mm))
    story.append(HRFlowable(width=CONTENT_W, thickness=1.0, color=C_TITLE_BG))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph('-- END --', S('End_J', alignment=1, fontSize=9,
                                          textColor=colors.HexColor('#888888'))))

    return story


# ── メイン ────────────────────────────────────────────────────
def main():
    out_path = r'C:\Users\saito\OneDrive\H-One_家づくりの不安をワンタップで可視化\archi_ai_template_proposal.pdf'

    doc = SimpleDocTemplate(
        out_path,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=20 * mm,
        title='Archi AI 無料診断テンプレート案',
        author='H-One',
        subject='スコア帯細分化版（一級建築士確認用）',
    )

    story = build_story()
    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(f"\nPDF generated successfully: {out_path}")
    size_kb = os.path.getsize(out_path) / 1024
    print(f"File size: {size_kb:.1f} KB")


if __name__ == '__main__':
    main()
