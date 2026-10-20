@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo  Direct Downloader - Native Messaging Host Installer
echo ===================================================
echo.

set "SCRIPT_DIR=%~dp0"
set "JSON_PATH=%SCRIPT_DIR%downloader_host.json"

:: Register Host in Windows Current User Registry
echo [1/2] Registering host manifest in Windows Registry...
REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.direct.downloader.host" /ve /t REG_SZ /d "%JSON_PATH%" /f >nul 2>&1

if %ERRORLEVEL% EQU 0 (
    echo [OK] Registry key successfully created.
) else (
    echo [ERROR] Failed to write to Windows Registry.
    pause
    exit /b 1
)

:: Test Python and yt-dlp
echo [2/3] Checking Python and yt-dlp environment...
python -m yt_dlp --version >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] yt-dlp is installed and functional.
) else (
    echo [INFO] Installing yt-dlp via pip...
    python -m pip install yt-dlp
)

:: Test FFmpeg
echo [3/3] Checking FFmpeg audio/video merger...
if exist "%SCRIPT_DIR%bin\ffmpeg.exe" (
    echo [OK] FFmpeg binary verified in native_host\bin.
) else (
    echo [INFO] Provisioning FFmpeg binary via imageio-ffmpeg...
    python -m pip install imageio-ffmpeg >nul 2>&1
    python -c "import imageio_ffmpeg, shutil, os; os.makedirs(r'%SCRIPT_DIR%bin', exist_ok=True); shutil.copy(imageio_ffmpeg.get_ffmpeg_exe(), r'%SCRIPT_DIR%bin\ffmpeg.exe')" >nul 2>&1
    if exist "%SCRIPT_DIR%bin\ffmpeg.exe" (
        echo [OK] FFmpeg successfully configured in native_host\bin.
    ) else (
        echo [INFO] FFmpeg will fallback to system PATH.
    )
)

echo.
echo ===================================================
echo  Installation Complete!
echo  Restart Google Chrome or reload extension (F5).
echo ===================================================
echo.
pause
