@echo off
chcp 65001 > nul

REM .env がなければ .env.example からコピー
if not exist "%~dp0.env" (
  echo [設定] .env ファイルが見つかりません。.env.example からコピーします...
  copy "%~dp0.env.example" "%~dp0.env" > nul
  echo.
  echo ============================================
  echo  .env ファイルを作成しました。
  echo  メモ帳で開いて ANTHROPIC_API_KEY を設定してください。
  echo  設定後、このウィンドウを閉じて「アプリを起動する.bat」を再実行してください。
  echo ============================================
  start notepad "%~dp0.env"
  pause
  exit /b
)

npm install --prefer-offline
node server.js
