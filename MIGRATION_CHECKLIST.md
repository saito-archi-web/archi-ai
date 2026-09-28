# 別PCへの移行チェックリスト（ArchiAI）

> 上から順にチェックを付けながら進めてください。GitHub / VS Code で開くとチェックボックスを操作できます。
> 最終更新: 2026-09-28

---

## 事前の全体像

**自動で揃うもの（コピー不要）**
- プラグイン（カスタム導入は0個）
- スキル（docs / pdf / docx / xlsx / pptx / skill-creator / morning / import-memory）
- コネクタ（visualize / Google Drive / Claude Docs / scheduled-tasks）
- → いずれも **Claudeアカウント紐づけ**。新PCで同じアカウントにログインすれば自動で揃う
- コード一式 → OneDrive同期 or `git clone`

**手動が必要なもの**
- 基本ソフトの新規インストール（Node / Git / Python / Claude Code）
- 会話履歴・メモリのフォルダコピー（下記フェーズ5）

> 💡 **最重要の前提**：新PCの Windows ユーザー名を **今と同じ `saito`** にすると、`.claude` のフォルダ名（パス由来）が一致して会話履歴の引き継ぎが楽になります。違う名前だとフェーズ5で改名が必要です。

---

## フェーズ0：旧PCでの事前準備
- [ ] `git status` で未コミットがないか確認
- [ ] `git push` 済み（GitHubが最新）
- [ ] このチェックリストがコミットされている（新PCでも読める）

## フェーズ1：新PCに基本ソフトを入れる
- [ ] Node.js **v24系** をインストール → `node -v` で確認
- [ ] Git をインストール → `git --version` で確認
- [ ] Python **3.14系** をインストール → `python --version` で確認
- [ ] Claude Code をインストール：
  ```bash
  npm i -g @anthropic-ai/claude-code
  ```
- [ ] Claude にサインイン（**今と同じアカウント：saito-archi@outlook.jp**）
  - これでプラグイン・スキル・コネクタが自動で揃う

## フェーズ2：Git の初期設定（新PCで実行）
- [ ] ユーザー名を設定
  ```bash
  git config --global user.name "Saito"
  ```
- [ ] メールを設定
  ```bash
  git config --global user.email "saito-archi@outlook.jp"
  ```

## フェーズ3：プロジェクトを新PCに取得
- [ ] OneDrive に同じアカウントでサインイン
- [ ] `H-One_家づくりの不安をワンタップで可視化` フォルダを右クリック →「このデバイス上で常に保持する」で完全ダウンロード
  - （代替）GitHub から取得：`git clone <リポジトリURL>`
- [ ] フォルダの中身（backend / frontend 等）が実体としてある事を確認

## フェーズ4：依存関係のインストール（新PCで実行）
- [ ] バックエンド依存
  ```bash
  cd "C:\Users\saito\OneDrive\H-One_家づくりの不安をワンタップで可視化\backend"
  npm install
  ```
- [ ] Python パッケージ
  ```bash
  python -m pip install reportlab ezdxf
  ```
- [ ] （フロントをローカルビルドする場合のみ）
  ```bash
  cd "C:\Users\saito\OneDrive\H-One_家づくりの不安をワンタップで可視化\frontend"
  npm install
  ```

## フェーズ5：会話履歴・メモリの引き継ぎ（手動コピー）
- [ ] **旧PC**の次のフォルダを丸ごとコピー
  ```
  C:\Users\saito\.claude\projects\C--Users-saito-OneDrive-H-One------------------
  ```
- [ ] **新PC**の次の場所に貼り付け（`<ユーザー名>` は新PCのもの）
  ```
  C:\Users\<ユーザー名>\.claude\projects\
  ```
- [ ] ⚠️ 新PCのユーザー名が `saito` 以外の場合、上のフォルダ名は**新PCのパスに合わせて改名**しないと認識されない（不明なら要相談）
- [ ] `.credentials.json` は**コピーしない**（フェーズ1の再ログインで足りる）
  ```
  （コピー禁止）C:\Users\saito\.claude\.credentials.json
  ```
- [ ] （任意・他プロジェクトの履歴も欲しい場合）`.claude` フォルダごとコピーし、`.credentials.json` だけ削除

## フェーズ6：動作確認（新PCで実行）
- [ ] Claude で `H-One_家づくりの不安をワンタップで可視化` フォルダを開く
- [ ] 会話履歴・メモリが引き継がれているか確認
- [ ] バックエンド構文チェック
  ```bash
  node --check backend/server.js
  ```
- [ ] フロントのビルドが通る
  ```bash
  cd frontend
  npm run build
  ```

## フェーズ7：本番デプロイ時の環境変数（Render）※稼働させる時
- [ ] `SITE_PASSWORD`（必須）
- [ ] `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`（必須。未設定だと課金されず「完了」表示になる）
- [ ] `AUTH_SECRET`（推奨・独立した強ランダム値）
- [ ] `ALLOWED_ORIGIN`（推奨：`https://archi-ai.onrender.com`）
- [ ] `ANTHROPIC_API_KEY` / `EMAIL_USER` / `EMAIL_PASS` / `RECAPTCHA_*`

## フェーズ8：旧PCの後始末
- [ ] 新PCで全て動くことを確認
- [ ] 旧PCの使用を停止（データは残せばバックアップになる）

---

## 補足：秘密情報（.env）について
- ローカル用の秘密情報はここにある（OneDrive同期で新PCにも来る）：
  ```
  C:\Users\saito\OneDrive\H-One_家づくりの不安をワンタップで可視化\backend\.env
  ```
- OneDrive は `.gitignore` を無視して全ファイルを同期するため、`.env` や `node_modules` も付いてくる。ただし `node_modules` は信用せずフェーズ4で入れ直すこと。
