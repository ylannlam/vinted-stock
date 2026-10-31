@echo off
setlocal
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Installe Node.js LTS depuis https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<20)process.exit(1)"
if errorlevel 1 (
  echo Mets Node.js a jour depuis https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)
if not exist "node_modules\playwright-core\package.json" (
  call npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    echo Installation interrompue. Verifie ta connexion Internet puis relance run.bat.
    pause
    exit /b 1
  )
)
node collector.mjs %*
pause
