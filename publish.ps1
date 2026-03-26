# PAiA Build & Publish Script
# Creates a self-contained distributable Windows app
# No .NET SDK required on end-user machines

param(
    [ValidateSet("x64", "x86", "arm64")]
    [string]$Platform = "x64",

    [ValidateSet("Release", "Debug")]
    [string]$Config = "Release",

    [switch]$CreateInstaller,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path $MyInvocation.MyCommand.Path -Parent
$OutputDir = Join-Path $ProjectDir "publish\PAiA-$Platform"
$InstallerDir = Join-Path $ProjectDir "publish\installer"

Write-Host "═══ PAiA Build & Publish ═══" -ForegroundColor Cyan
Write-Host "Platform:  $Platform"
Write-Host "Config:    $Config"
Write-Host "Output:    $OutputDir"
Write-Host ""

# Step 1: Run tests
if (-not $SkipTests) {
    Write-Host "Running tests..." -ForegroundColor Yellow
    dotnet test "$ProjectDir\PAiA.Tests" --configuration $Config --verbosity minimal
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Tests FAILED — aborting build." -ForegroundColor Red
        exit 1
    }
    Write-Host "All tests passed!" -ForegroundColor Green
    Write-Host ""
}

# Step 2: Clean previous output
if (Test-Path $OutputDir) {
    Write-Host "Cleaning previous build..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $OutputDir
}

# Step 3: Publish self-contained
Write-Host "Building self-contained app..." -ForegroundColor Yellow
dotnet publish "$ProjectDir\PAiA.WinUI\PAiA.WinUI.csproj" `
    --configuration $Config `
    --runtime "win-$Platform" `
    --self-contained true `
    --output $OutputDir `
    -p:Platform=$Platform `
    -p:PublishSingleFile=false `
    -p:IncludeNativeLibrariesForSelfExtract=true

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build FAILED." -ForegroundColor Red
    exit 1
}

Write-Host "Build complete!" -ForegroundColor Green

# Step 4: Copy docs
Write-Host "Copying documentation..." -ForegroundColor Yellow
Copy-Item "$ProjectDir\README.md" "$OutputDir\"
Copy-Item "$ProjectDir\PRIVACY.md" "$OutputDir\"
Copy-Item "$ProjectDir\FAQ.md" "$OutputDir\"
Copy-Item "$ProjectDir\GETTING_STARTED.md" "$OutputDir\"

# Step 5: Create ZIP
$ZipPath = Join-Path $ProjectDir "publish\PAiA-v1.0.0-$Platform.zip"
Write-Host "Creating ZIP: $ZipPath" -ForegroundColor Yellow
if (Test-Path $ZipPath) { Remove-Item $ZipPath }
Compress-Archive -Path "$OutputDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal

# Step 6: Create installer batch file
if ($CreateInstaller) {
    Write-Host "Creating installer..." -ForegroundColor Yellow
    if (-not (Test-Path $InstallerDir)) { New-Item -ItemType Directory -Path $InstallerDir | Out-Null }

    $installerContent = @"
@echo off
title PAiA Installer
echo.
echo  ╔═══════════════════════════════════════╗
echo  ║     PAiA — Screen Assistant Setup     ║
echo  ╚═══════════════════════════════════════╝
echo.

set INSTALL_DIR=%LOCALAPPDATA%\PAiA\App
set SHORTCUT_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs

echo Installing PAiA to: %INSTALL_DIR%
echo.

:: Create install directory
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Copy files
echo Copying files...
xcopy /s /y /q "%~dp0\*" "%INSTALL_DIR%\" >nul 2>&1
echo Done.

:: Create Start Menu shortcut
echo Creating Start Menu shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut('%SHORTCUT_DIR%\PAiA.lnk'); $sc.TargetPath = '%INSTALL_DIR%\PAiA.exe'; $sc.WorkingDirectory = '%INSTALL_DIR%'; $sc.Description = 'PAiA Screen Assistant'; $sc.Save()"
echo Done.

:: Create Desktop shortcut
echo Creating Desktop shortcut...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'PAiA.lnk')); $sc.TargetPath = '%INSTALL_DIR%\PAiA.exe'; $sc.WorkingDirectory = '%INSTALL_DIR%'; $sc.Description = 'PAiA Screen Assistant'; $sc.Save()"
echo Done.

echo.
echo  ╔═══════════════════════════════════════╗
echo  ║        Installation Complete!          ║
echo  ║                                       ║
echo  ║  Next steps:                          ║
echo  ║  1. Install Ollama: ollama.com        ║
echo  ║  2. Run: ollama pull qwen3.5:9b      ║
echo  ║  3. Launch PAiA from Start Menu       ║
echo  ╚═══════════════════════════════════════╝
echo.

set /p LAUNCH="Launch PAiA now? (Y/N): "
if /i "%LAUNCH%"=="Y" start "" "%INSTALL_DIR%\PAiA.exe"

pause
"@
    Set-Content -Path "$OutputDir\install.bat" -Value $installerContent
    Write-Host "Installer created: $OutputDir\install.bat" -ForegroundColor Green
}

# Summary
$size = (Get-ChildItem $OutputDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
$zipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host ""
Write-Host "═══ Build Summary ═══" -ForegroundColor Cyan
Write-Host "App folder:  $OutputDir"
Write-Host "App size:    $([math]::Round($size, 1)) MB"
Write-Host "ZIP:         $ZipPath ($([math]::Round($zipSize, 1)) MB)"
Write-Host ""
Write-Host "To distribute: share the ZIP file." -ForegroundColor Green
Write-Host "Users extract it and run PAiA.exe or install.bat" -ForegroundColor Green
