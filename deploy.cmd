@echo off
setlocal
set MSG=%*
if "%MSG%"=="" set MSG=K&D Supabase V5
git add -A
git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo Nothing new to commit, or commit failed.
)
git push origin main
echo.
echo K&D V5 pushed to GitHub main.
endlocal
