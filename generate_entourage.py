#!/usr/bin/env python3
"""
DXF添景生成スクリプト（外部ライブラリ不要・標準ライブラリのみ）
-----------------------------------------------------------------
生成される添景:
  1. 腕を組んで悩んでいる人
  2. 座って足をぶらぶらしている人
  3. 話している男女
  4. 走っている子供
  5. イロハモミジの樹形

単位: cm (1unit = 1cm)
実行: python generate_entourage.py
出力: entourage_figures.dxf (同じフォルダ)
"""

import math
import os

# ============================================================
# DXF ビルダー (ezdxf 不使用)
# ============================================================
class DXFWriter:
    def __init__(self):
        self.entities = []

    def _e(self, *pairs):
        """group_code, value のペアをまとめて文字列化"""
        lines = []
        for code, val in pairs:
            lines.append(f"{code:>3}")
            if isinstance(val, float):
                lines.append(f"{val:.6f}")
            else:
                lines.append(str(val))
        return "\n".join(lines) + "\n"

    def add_line(self, layer, x1, y1, x2, y2):
        self.entities.append(self._e(
            (0, "LINE"),
            (8, layer),
            (62, 1 if layer == "HUMAN" else 3),
            (10, float(x1)), (20, float(y1)), (30, 0.0),
            (11, float(x2)), (21, float(y2)), (31, 0.0),
        ))

    def add_circle(self, layer, cx, cy, r):
        self.entities.append(self._e(
            (0, "CIRCLE"),
            (8, layer),
            (62, 1 if layer == "HUMAN" else 3),
            (10, float(cx)), (20, float(cy)), (30, 0.0),
            (40, float(r)),
        ))

    def add_arc(self, layer, cx, cy, r, a1, a2):
        self.entities.append(self._e(
            (0, "ARC"),
            (8, layer),
            (62, 1 if layer == "HUMAN" else 3),
            (10, float(cx)), (20, float(cy)), (30, 0.0),
            (40, float(r)),
            (50, float(a1 % 360)),
            (51, float(a2 % 360)),
        ))

    def add_polyline_as_lines(self, layer, pts, closed=False):
        """LWPOLYLINE の代わりに LINE の集合で描画"""
        for i in range(len(pts) - 1):
            self.add_line(layer, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1])
        if closed and len(pts) > 1:
            self.add_line(layer, pts[-1][0], pts[-1][1], pts[0][0], pts[0][1])

    def save(self, path):
        header = (
            "  0\nSECTION\n  2\nHEADER\n"
            "  9\n$ACADVER\n  1\nAC1015\n"
            "  9\n$INSUNITS\n 70\n5\n"
            "  0\nENDSEC\n"
            "  0\nSECTION\n  2\nTABLES\n"
            "  0\nTABLE\n  2\nLTYPE\n 70\n1\n"
            "  0\nLTYPE\n  2\nCONTINUOUS\n 70\n0\n"
            "  3\nSolid line\n 72\n65\n 73\n0\n 40\n0.0\n"
            "  0\nENDTAB\n"
            "  0\nTABLE\n  2\nLAYER\n 70\n2\n"
            "  0\nLAYER\n  2\nHUMAN\n 70\n0\n 62\n1\n  6\nCONTINUOUS\n"
            "  0\nLAYER\n  2\nTREE\n 70\n0\n 62\n3\n  6\nCONTINUOUS\n"
            "  0\nENDTAB\n"
            "  0\nENDSEC\n"
            "  0\nSECTION\n  2\nENTITIES\n"
        )
        footer = "  0\nENDSEC\n  0\nEOF\n"
        with open(path, "w", encoding="ascii") as fp:
            fp.write(header)
            fp.writelines(self.entities)
            fp.write(footer)
        print(f"保存しました: {os.path.abspath(path)}")


# ============================================================
# 図形クラス (オフセット付き描画)
# ============================================================
class Figure:
    def __init__(self, dxf: DXFWriter, ox=0.0, oy=0.0, layer="HUMAN"):
        self.dxf = dxf
        self.ox = ox
        self.oy = oy
        self.layer = layer

    def L(self, x1, y1, x2, y2):
        self.dxf.add_line(self.layer,
            self.ox+x1, self.oy+y1, self.ox+x2, self.oy+y2)

    def Arc(self, cx, cy, r, a1, a2):
        self.dxf.add_arc(self.layer,
            self.ox+cx, self.oy+cy, r, a1, a2)

    def Circ(self, cx, cy, r):
        self.dxf.add_circle(self.layer,
            self.ox+cx, self.oy+cy, r)

    def Poly(self, pts, closed=False):
        shifted = [(self.ox+x, self.oy+y) for x, y in pts]
        self.dxf.add_polyline_as_lines(self.layer, shifted, closed)


# ============================================================
# 人物1: 腕を組んで悩んでいる人
# ============================================================
def draw_crossed_arms(dxf, ox=0.0, oy=0.0):
    f = Figure(dxf, ox, oy, "HUMAN")

    # 頭
    f.Circ(0, 160, 14)
    # 髪の毛 (思い悩み)
    f.L(-4, 174, -6, 181)
    f.L(0, 174, 0, 182)
    f.L(4, 174, 6, 181)
    # 目 (ハの字)
    f.L(-7, 164, -4, 166)
    f.L(4, 166, 7, 164)
    # への字口
    f.Arc(0, 155, 5, 210, 330)
    # 汗マーク
    f.Circ(15, 170, 2)
    f.L(15, 172, 14, 178)
    f.L(16, 172, 17, 178)

    # 首
    f.L(-4, 146, -4, 140)
    f.L(4, 146, 4, 140)

    # 肩
    f.L(-4, 140, -24, 138)
    f.L(4, 140, 24, 138)

    # 胴体
    f.L(-24, 138, -20, 100)
    f.L(24, 138, 20, 100)

    # 腕を組む: 左腕 (右に流れる)
    f.L(-24, 133, -35, 118)
    f.Arc(-35, 118, 4, 90, 270)
    f.L(-35, 114, 22, 114)
    f.Circ(22, 117, 5)

    # 腕を組む: 右腕 (左に流れる・上側)
    f.L(24, 133, 35, 121)
    f.Arc(35, 121, 4, 270, 90)
    f.L(35, 125, -22, 125)
    f.Circ(-22, 122, 5)

    # 腰
    f.L(-20, 100, 20, 100)

    # 左脚
    f.L(-14, 100, -16, 58)
    f.Arc(-16, 58, 4, 95, 265)
    f.L(-16, 58, -14, 8)

    # 右脚
    f.L(14, 100, 16, 58)
    f.Arc(16, 58, 4, 275, 85)
    f.L(16, 58, 14, 8)

    # 足 (左)
    f.L(-14, 8, -26, 5)
    f.Arc(-26, 8, 4, 210, 360)
    # 足 (右)
    f.L(14, 8, 26, 5)
    f.Arc(26, 8, 4, 180, 330)

    # 考え中の「…」吹き出し
    f.Circ(22, 185, 2)
    f.Circ(28, 190, 3)
    f.Circ(36, 197, 4)


# ============================================================
# 人物2: 座って足をぶらぶらしている人
# ============================================================
def draw_sitting_dangling(dxf, ox=0.0, oy=0.0):
    f = Figure(dxf, ox, oy, "HUMAN")
    sy = 100  # 座面高さ

    # 頭
    f.Circ(0, sy+58, 13)
    # 笑い目
    f.Arc(-5, sy+61, 3, 10, 170)
    f.Arc(5, sy+61, 3, 10, 170)
    # 笑顔
    f.Arc(0, sy+53, 5, 200, 340)

    # 首
    f.L(-3, sy+45, -3, sy+39)
    f.L(3, sy+45, 3, sy+39)

    # 肩
    f.L(-3, sy+39, -20, sy+37)
    f.L(3, sy+39, 20, sy+37)

    # 胴体
    f.L(-20, sy+37, -16, sy)
    f.L(20, sy+37, 16, sy)

    # 左腕 (膝の上)
    f.L(-20, sy+33, -28, sy+20)
    f.L(-28, sy+20, -24, sy+8)
    f.Circ(-22, sy+5, 4)

    # 右腕 (上げて表現)
    f.L(20, sy+33, 30, sy+46)
    f.L(30, sy+46, 26, sy+56)
    f.Circ(24, sy+59, 4)

    # 座面プラットフォーム
    f.L(-35, sy, 35, sy)
    f.L(-35, sy, -35, sy-3)
    f.L(35, sy, 35, sy-3)
    f.L(-35, sy-3, 35, sy-3)

    # 大腿
    f.L(-16, sy, -22, sy-3)
    f.L(16, sy, 22, sy-3)

    # 左脚 (ぶらぶら・前)
    f.L(-22, sy-3, -20, sy-32)
    f.L(-20, sy-32, -24, sy-55)
    f.Arc(-24, sy-60, 5, 60, 300)
    f.L(-19, sy-57, -14, sy-61)

    # 右脚 (ぶらぶら・後ろ気味)
    f.L(22, sy-3, 24, sy-28)
    f.L(24, sy-28, 20, sy-52)
    f.Arc(20, sy-57, 5, 240, 120)
    f.L(25, sy-55, 30, sy-58)


# ============================================================
# 人物3: 話している男女
# ============================================================
def draw_talking_couple(dxf, ox=0.0, oy=0.0):
    f = Figure(dxf, ox, oy, "HUMAN")

    # === 男性 (左) ===
    mx = -28.0

    f.Circ(mx, 163, 14)
    f.L(mx-5, 166, mx-3, 166)
    f.L(mx+3, 166, mx+5, 166)
    f.Arc(mx, 158, 5, 200, 340)

    f.L(mx, 149, mx, 143)
    f.L(mx, 143, mx-20, 141)
    f.L(mx, 143, mx+22, 141)
    f.L(mx-20, 141, mx-17, 98)
    f.L(mx+22, 141, mx+18, 98)

    # 左腕
    f.L(mx-20, 137, mx-26, 115)
    f.L(mx-26, 115, mx-24, 98)
    f.Circ(mx-22, 95, 4)
    # 右腕 (ジェスチャー)
    f.L(mx+22, 137, mx+34, 125)
    f.L(mx+34, 125, mx+42, 112)
    f.Circ(mx+44, 109, 4)

    f.L(mx-17, 98, mx+18, 98)
    # 左脚
    f.L(mx-10, 98, mx-12, 55)
    f.L(mx-12, 55, mx-10, 5)
    f.L(mx-10, 5, mx-22, 2)
    f.Arc(mx-22, 5, 4, 220, 360)
    # 右脚
    f.L(mx+10, 98, mx+14, 55)
    f.L(mx+14, 55, mx+12, 5)
    f.L(mx+12, 5, mx+24, 2)
    f.Arc(mx+24, 5, 4, 180, 320)

    # === 女性 (右) ===
    wx = 24.0

    f.Circ(wx, 154, 13)
    # 髪 (ロング)
    f.Arc(wx, 154, 17, 40, 140)
    f.L(wx-17, 154, wx-19, 136)
    f.L(wx+17, 154, wx+19, 136)
    # 目
    f.Arc(wx-4, 157, 2.5, 5, 175)
    f.Arc(wx+4, 157, 2.5, 5, 175)
    f.Arc(wx, 149, 4, 200, 340)

    f.L(wx, 141, wx, 135)
    f.L(wx, 135, wx-18, 133)
    f.L(wx, 135, wx+18, 133)
    f.L(wx-18, 133, wx-16, 92)
    f.L(wx+18, 133, wx+16, 92)

    # 左腕 (ジェスチャー)
    f.L(wx-18, 129, wx-30, 118)
    f.L(wx-30, 118, wx-32, 106)
    f.Circ(wx-30, 103, 4)
    # 右腕
    f.L(wx+18, 129, wx+22, 110)
    f.L(wx+22, 110, wx+20, 95)
    f.Circ(wx+18, 92, 4)

    # スカート
    f.Arc(wx, 92, 18, 180, 360)
    f.L(wx-18, 92, wx-20, 42)
    f.L(wx+18, 92, wx+20, 42)
    f.Arc(wx, 42, 20, 180, 360)

    # 脚
    f.L(wx-8, 42, wx-10, 8)
    f.L(wx-10, 8, wx-20, 4)
    f.Arc(wx-20, 7, 4, 220, 360)
    f.L(wx+8, 42, wx+10, 8)
    f.L(wx+10, 8, wx+20, 4)
    f.Arc(wx+20, 7, 4, 180, 320)

    # 会話の気泡
    f.Circ(mx+35, 185, 3)
    f.L(mx+32, 183, mx+25, 175)


# ============================================================
# 人物4: 走っている子供 (~110cm)
# ============================================================
def draw_running_child(dxf, ox=0.0, oy=0.0):
    f = Figure(dxf, ox, oy, "HUMAN")

    # 頭 (前傾)
    f.Circ(8, 98, 11)
    f.L(2, 109, -2, 115)
    f.L(6, 109, 4, 116)
    f.L(10, 108, 11, 115)
    # 目
    f.Arc(2, 101, 2.5, 0, 180)
    f.Arc(10, 101, 2.5, 0, 180)
    # 口
    f.Arc(6, 96, 4, 190, 350)
    f.L(2, 96, 10, 96)

    # 首
    f.L(4, 87, 2, 82)

    # 肩
    f.L(2, 82, -12, 80)
    f.L(2, 82, 16, 80)
    f.L(-12, 80, -8, 55)
    f.L(16, 80, 12, 55)
    f.L(-8, 55, 12, 55)

    # 左腕 (後ろに振る)
    f.L(-12, 77, -22, 65)
    f.L(-22, 65, -28, 52)
    f.Circ(-26, 49, 4)

    # 右腕 (前に振る)
    f.L(16, 77, 24, 87)
    f.L(24, 87, 22, 98)
    f.Circ(20, 101, 4)

    # 左脚 (後ろ蹴り出し)
    f.L(-8, 55, -16, 32)
    f.L(-16, 32, -24, 8)
    f.L(-24, 8, -32, 0)
    f.Arc(-30, -2, 4, 120, 350)

    # 右脚 (前踏み出し・膝曲がり)
    f.L(12, 55, 20, 38)
    f.L(20, 38, 12, 20)
    f.L(12, 20, 18, 10)
    f.Arc(20, 8, 4, 0, 210)

    # スピード線
    f.L(-38, 72, -52, 72)
    f.L(-38, 67, -50, 67)
    f.L(-38, 62, -48, 62)
    f.L(-38, 57, -50, 57)


# ============================================================
# イロハモミジの葉
# ============================================================
def draw_maple_leaf(dxf, cx, cy, size, rotation_deg=0.0, layer="TREE"):
    lobes = 5
    pts = []
    for i in range(lobes * 2):
        angle_deg = rotation_deg + i * (360.0 / (lobes * 2)) - 90.0
        angle_rad = math.radians(angle_deg)
        r = size if i % 2 == 0 else size * 0.32
        pts.append((cx + r * math.cos(angle_rad),
                    cy + r * math.sin(angle_rad)))
    pts.append(pts[0])
    dxf.add_polyline_as_lines(layer, pts, closed=False)

    # 葉脈
    for i in range(lobes):
        angle_rad = math.radians(rotation_deg + i * (360.0/lobes) - 90.0)
        x_tip = cx + size * math.cos(angle_rad)
        y_tip = cy + size * math.sin(angle_rad)
        dxf.add_line(layer, cx, cy, x_tip, y_tip)

    # 葉柄
    stem_rad = math.radians(rotation_deg + 90.0)
    dxf.add_line(layer, cx, cy,
                 cx + size * 0.5 * math.cos(stem_rad),
                 cy + size * 0.5 * math.sin(stem_rad))


# ============================================================
# イロハモミジの樹形 (幅~160cm, 高さ~220cm)
# ============================================================
def draw_maple_tree(dxf, ox=0.0, oy=0.0):
    f = Figure(dxf, ox, oy, "TREE")

    # 根元の張り出し
    f.L(-10, 0, -22, -6)
    f.L(-22, -6, -28, -10)
    f.L(10, 0, 22, -6)
    f.L(22, -6, 28, -10)
    f.L(-4, 0, -8, -8)
    f.L(4, 0, 8, -8)

    # 主幹
    f.L(-10, 0, -6, 65)
    f.L(10, 0, 6, 65)
    f.L(-6, 65, -4, 120)
    f.L(6, 65, 4, 120)

    # 樹皮テクスチャ
    for yy in range(10, 110, 14):
        f.L(-9 + yy * 0.03, yy, 9 - yy * 0.03, yy + 3)

    # --- 左主枝 ---
    f.L(-4, 95, -32, 128)
    f.L(-32, 128, -55, 158)
    f.L(-55, 158, -68, 180)

    f.L(-42, 144, -58, 162)
    f.L(-58, 162, -72, 175)
    f.L(-42, 144, -40, 168)
    f.L(-55, 158, -52, 183)
    f.L(-68, 180, -78, 196)
    f.L(-68, 180, -62, 198)

    # 左中枝
    f.L(-4, 78, -28, 105)
    f.L(-28, 105, -44, 125)
    f.L(-44, 125, -56, 140)
    f.L(-44, 125, -42, 148)
    f.L(-56, 140, -64, 155)
    f.L(-56, 140, -52, 160)

    # --- 右主枝 ---
    f.L(4, 95, 32, 128)
    f.L(32, 128, 55, 158)
    f.L(55, 158, 68, 180)

    f.L(42, 144, 58, 162)
    f.L(58, 162, 72, 175)
    f.L(42, 144, 40, 168)
    f.L(55, 158, 52, 183)
    f.L(68, 180, 78, 196)
    f.L(68, 180, 62, 198)

    # 右中枝
    f.L(4, 78, 28, 105)
    f.L(28, 105, 44, 125)
    f.L(44, 125, 56, 140)
    f.L(44, 125, 42, 148)
    f.L(56, 140, 64, 155)
    f.L(56, 140, 52, 160)

    # --- 中央上枝 ---
    f.L(-4, 120, 0, 152)
    f.L(0, 152, -12, 178)
    f.L(0, 152, 12, 178)
    f.L(-12, 178, -18, 198)
    f.L(-12, 178, -6, 202)
    f.L(12, 178, 18, 198)
    f.L(12, 178, 6, 202)
    f.L(0, 152, 2, 182)

    # --- 葉 (枝先) ---
    leaf_data = [
        (-78, 200, 8, 10),
        (-72, 178, 7, -15),
        (-62, 202, 7, 30),
        (-52, 186, 7, -5),
        (-64, 158, 7, 20),
        (-52, 163, 6, -25),
        (78, 200, 8, -10),
        (72, 178, 7, 15),
        (62, 202, 7, -30),
        (52, 186, 7, 5),
        (64, 158, 7, -20),
        (52, 163, 6, 25),
        (-18, 202, 8, 5),
        (-6, 206, 7, -10),
        (6, 206, 7, 20),
        (18, 202, 8, -5),
        (2, 185, 6, 0),
        (-42, 152, 7, 15),
        (42, 152, 7, -15),
        (-40, 170, 7, -10),
        (40, 170, 7, 10),
        (-56, 143, 6, 30),
        (56, 143, 6, -30),
        (-65, 158, 6, -5),
        (65, 158, 6, 5),
    ]
    for (lx, ly, lsize, lrot) in leaf_data:
        draw_maple_leaf(dxf, ox + lx, oy + ly, lsize, lrot, layer="TREE")


# ============================================================
# メイン
# ============================================================
def main():
    dxf = DXFWriter()

    # 各添景を横に並べて配置 (間隔 100cm)
    draw_crossed_arms(dxf,     ox=0,   oy=0)   # 腕を組んで悩む人
    draw_sitting_dangling(dxf, ox=105, oy=0)   # 座って足ぶらぶら
    draw_talking_couple(dxf,   ox=230, oy=0)   # 話している男女
    draw_running_child(dxf,    ox=370, oy=0)   # 走っている子供
    draw_maple_tree(dxf,       ox=490, oy=0)   # イロハモミジ

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "entourage_figures.dxf")
    dxf.save(out_path)


if __name__ == "__main__":
    main()
