@echo off
setlocal

REM Garante que o servidor rode a partir da pasta do projeto.
set "PROJECT_DIR=%~dp0"

start "Servidor Node" cmd /k "cd /d ""%PROJECT_DIR%"" && set INBOUND_API_KEY=SUA_CHAVE_FORTE && set ENABLE_SMTP_INBOUND=false && set DEBUG_INBOUND=true && node server.js"

start "Cloudflared Tunnel" cmd /k "cloudflared --config ""C:\Users\Administrator\.cloudflared\config.yml"" tunnel run"

echo Janelas iniciadas: Servidor Node e Cloudflared.
endlocal
