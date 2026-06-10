@echo off
chcp 65001 >nul
title 智慧物聯網健康輔助系統 - 一鍵啟動腳本

echo ===================================================
echo   智慧物聯網健康輔助系統 (IoT Health Companion)
echo ===================================================
echo.

:: 1. 啟動 Python 背景伺服器
echo [1/2] 正在啟動 Python WebSocket 伺服器...
start /b python server.py

:: 等待 1.5 秒讓伺服器初始化
timeout /t 2 >nul

:: 2. 啟動 Godot 桌面寵物
echo [2/2] 正在啟動桌面寵物程式...
if exist "SlimePet.exe" (
    start "" "SlimePet.exe"
    echo.
    echo 啟動成功！請保持此視窗在背景運行以維持連線。
) else if exist "桌寵/SlimePet.exe" (
    start "" "桌寵/SlimePet.exe"
    echo.
    echo 啟動成功！請保持此視窗在背景運行以維持連線。
) else (
    echo.
    echo ⚠️ 提示: 尚未找到匯出的 SlimePet.exe 執行檔。
    echo 請先在 Godot 中將專案匯出為 "SlimePet.exe" 並放在此根目錄（或「桌寵/」目錄）下。
    echo 網頁控制台仍可透過 http://localhost:8000 正常開啟。
)

echo.
echo ===================================================
echo 結束請關閉此視窗，或按 Ctrl+C 中止背景伺服器。
echo ===================================================
pause >nul
