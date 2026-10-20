@echo off
echo Removing Direct Downloader Native Messaging Host from Registry...
REG DELETE "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.direct.downloader.host" /f >nul 2>&1
echo Done.
pause
