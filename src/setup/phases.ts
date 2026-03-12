import type { Platform, SetupConfig } from "../setup-core/types.js";

// ── Phase Definition ────────────────────────────────────────────────

export interface SetupPhase {
	id: string;
	name: string;
	description: string;
	/** Phases that should be skipped based on config/detection */
	shouldSkip?: (config: SetupConfig, detected: PhaseContext) => boolean;
	/** Generate the script block for this phase */
	generateScript: (config: SetupConfig, ctx: PhaseContext) => PhaseScript;
}

export interface PhaseScript {
	shell: "powershell" | "bash";
	cwd: string;
	script: string;
	env?: Record<string, string>;
}

export interface PhaseContext {
	hasGit: boolean;
	hasCompiler: boolean;
	hasFaust: boolean;
	hasIPP: boolean;
	hisePath: string;
}

// ── Shell helpers ───────────────────────────────────────────────────

function shellFor(platform: Platform): "powershell" | "bash" {
	return platform === "windows" ? "powershell" : "bash";
}

function expandPath(p: string): string {
	if (p.startsWith("~")) {
		return p.replace("~", process.env.HOME || process.env.USERPROFILE || "~");
	}
	return p;
}

// ── Phase: Install Git ──────────────────────────────────────────────

const installGit: SetupPhase = {
	id: "git-install",
	name: "Install Git",
	description: "Ensure Git is available",
	shouldSkip: (_config, ctx) => ctx.hasGit,
	generateScript: (config) => {
		if (config.platform === "windows") {
			return {
				shell: "powershell",
				cwd: expandPath(config.installPath),
				script: `
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Try winget first
$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
    Write-Host "Installing Git via winget..."
    winget install Git.Git --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
} else {
    Write-Host "Installing Git via direct download..."
    $gitInstaller = "$env:TEMP\\git-installer.exe"
    Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe" -OutFile $gitInstaller
    Start-Process -FilePath $gitInstaller -Args "/VERYSILENT /NORESTART" -Wait
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Remove-Item $gitInstaller -Force -ErrorAction SilentlyContinue
}

# Verify
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Error "Git installation failed"
    exit 1
}
Write-Host "Git installed successfully"
`,
			};
		}

		if (config.platform === "macos") {
			return {
				shell: "bash",
				cwd: expandPath(config.installPath),
				script: `#!/bin/bash
set -e
echo "Checking for Git / Xcode CLI Tools..."
if ! command -v git &> /dev/null; then
    echo "ERROR: Git is not installed."
    echo "Please run: xcode-select --install"
    echo "Then re-run this setup."
    exit 1
fi
echo "Git is available"
`,
			};
		}

		// Linux
		return {
			shell: "bash",
			cwd: expandPath(config.installPath),
			script: `#!/bin/bash
set -e
if ! command -v git &> /dev/null; then
    echo "Installing Git..."
    sudo apt-get update
    sudo apt-get install -y git
fi
echo "Git is available"
`,
		};
	},
};

// ── Phase: Clone Repository ─────────────────────────────────────────

const cloneRepo: SetupPhase = {
	id: "clone-repo",
	name: "Clone HISE Repository",
	description: "Clone the HISE source code from GitHub",
	generateScript: (config) => {
		const installPath = expandPath(config.installPath);
		const shell = shellFor(config.platform);
		const commitCheckout = config.targetCommit
			? config.platform === "windows"
				? `git checkout ${config.targetCommit}\nif ($LASTEXITCODE -ne 0) { Write-Error "Failed to checkout commit"; exit 1 }`
				: `git checkout ${config.targetCommit} || { echo "Failed to checkout commit"; exit 1; }`
			: config.platform === "windows"
				? "git checkout develop\ngit pull origin develop"
				: "git checkout develop\ngit pull origin develop";

		if (config.platform === "windows") {
			return {
				shell,
				cwd: installPath,
				script: `
$ErrorActionPreference = "Stop"
$HISE_PATH = "${installPath.replace(/\\/g, "\\\\")}"

if (-not (Test-Path "$HISE_PATH\\.git")) {
    $parentPath = Split-Path $HISE_PATH -Parent
    if ($parentPath -and $parentPath.Length -gt 3) {
        New-Item -ItemType Directory -Force -Path $parentPath | Out-Null
    }
    Write-Host "Cloning HISE repository..."
    git clone https://github.com/christophhart/HISE.git "$HISE_PATH"
    if ($LASTEXITCODE -ne 0) { Write-Error "Failed to clone HISE"; exit 1 }
} else {
    Write-Host "HISE repository already exists, updating..."
    Set-Location $HISE_PATH
    git fetch origin
}

Set-Location $HISE_PATH
${commitCheckout}

Write-Host "Initializing submodules..."
git submodule update --init
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to init submodules"; exit 1 }

Set-Location JUCE
git checkout juce6
Set-Location $HISE_PATH

Write-Host "Repository setup complete"
`,
			};
		}

		// macOS / Linux
		return {
			shell,
			cwd: installPath,
			script: `#!/bin/bash
set -e
HISE_PATH="${installPath}"

if [ ! -d "$HISE_PATH/.git" ]; then
    mkdir -p "$(dirname "$HISE_PATH")"
    echo "Cloning HISE repository..."
    git clone https://github.com/christophhart/HISE.git "$HISE_PATH"
else
    echo "HISE repository already exists, updating..."
    cd "$HISE_PATH"
    git fetch origin
fi

cd "$HISE_PATH"
${commitCheckout}

echo "Initializing submodules..."
git submodule update --init

cd JUCE && git checkout juce6 && cd ..

echo "Repository setup complete"
`,
		};
	},
};

// ── Phase: Install Build Dependencies (Linux only) ──────────────────

const installBuildDeps: SetupPhase = {
	id: "build-deps",
	name: "Install Build Dependencies",
	description: "Install required system packages",
	shouldSkip: (config) => config.platform !== "linux",
	generateScript: (config) => ({
		shell: "bash",
		cwd: expandPath(config.installPath),
		script: `#!/bin/bash
set -e
echo "Installing build dependencies..."
sudo apt-get update
sudo apt-get install -y \\
    build-essential \\
    make \\
    llvm \\
    clang \\
    libfreetype6-dev \\
    libx11-dev \\
    libxinerama-dev \\
    libxrandr-dev \\
    libxcursor-dev \\
    mesa-common-dev \\
    libasound2-dev \\
    freeglut3-dev \\
    libxcomposite-dev \\
    libcurl4-gnutls-dev \\
    libgtk-3-dev \\
    libjack-jackd2-dev \\
    libwebkit2gtk-4.0-dev \\
    libpthread-stubs0-dev \\
    ladspa-sdk

echo "Build dependencies installed"
`,
	}),
};

// ── Phase: Install Faust ────────────────────────────────────────────

const installFaust: SetupPhase = {
	id: "faust-install",
	name: "Install Faust",
	description: "Install the Faust DSP compiler",
	shouldSkip: (config, ctx) => !config.includeFaust || ctx.hasFaust,
	generateScript: (config) => {
		const installPath = expandPath(config.installPath);
		const faustVersion = config.faustVersion || "2.83.1";

		if (config.platform === "windows") {
			return {
				shell: "powershell",
				cwd: installPath,
				script: `
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$faustDll = "C:\\Program Files\\Faust\\lib\\faust.dll"
if (Test-Path $faustDll) {
    Write-Host "Faust already installed"
    exit 0
}

Write-Host "Downloading Faust ${faustVersion}..."
$faustInstaller = "$env:TEMP\\faust-installer.exe"
$faustUrl = "https://github.com/grame-cncm/faust/releases/download/${faustVersion}/Faust-${faustVersion}-win64.exe"
Invoke-WebRequest -Uri $faustUrl -OutFile $faustInstaller

Write-Host "Installing Faust ${faustVersion}..."
Start-Process -FilePath $faustInstaller -Args '/S /D=C:\\Program Files\\Faust' -Wait
Remove-Item $faustInstaller -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $faustDll)) {
    Write-Error "Faust installation failed - faust.dll not found"
    exit 1
}
Write-Host "Faust ${faustVersion} installed"
`,
			};
		}

		if (config.platform === "macos") {
			const archSuffix = config.architecture === "arm64" ? "arm64" : "x64";
			return {
				shell: "bash",
				cwd: installPath,
				script: `#!/bin/bash
set -e
HISE_PATH="${installPath}"
FAUST_LIB="$HISE_PATH/tools/faust/lib/libfaust.dylib"

if [ -f "$FAUST_LIB" ]; then
    echo "Faust already installed"
    exit 0
fi

echo "Downloading Faust ${faustVersion}..."
FAUST_DMG="Faust-${faustVersion}-${archSuffix}.dmg"
FAUST_URL="https://github.com/grame-cncm/faust/releases/download/${faustVersion}/$FAUST_DMG"
DOWNLOAD_PATH="/tmp/$FAUST_DMG"

curl -L -o "$DOWNLOAD_PATH" "$FAUST_URL"

echo "Mounting DMG..."
hdiutil attach "$DOWNLOAD_PATH" -readonly -nobrowse -mountpoint /tmp/faust-mount

echo "Extracting Faust..."
mkdir -p "$HISE_PATH/tools/faust"
FAUST_FOLDER=$(find /tmp/faust-mount -maxdepth 1 -type d -name "Faust*" | head -1)
if [ -n "$FAUST_FOLDER" ] && [ -d "$FAUST_FOLDER" ]; then
    cp -R "$FAUST_FOLDER"/* "$HISE_PATH/tools/faust/"
else
    cp -R /tmp/faust-mount/* "$HISE_PATH/tools/faust/"
fi

echo "Removing quarantine attributes..."
xattr -cr "$HISE_PATH/tools/faust"

hdiutil detach /tmp/faust-mount 2>/dev/null || true
rm -f "$DOWNLOAD_PATH"

if [ ! -f "$FAUST_LIB" ]; then
    echo "ERROR: Faust installation failed - libfaust.dylib not found"
    exit 1
fi
echo "Faust ${faustVersion} installed"
`,
			};
		}

		// Linux
		return {
			shell: "bash",
			cwd: installPath,
			script: `#!/bin/bash
set -e
if command -v faust &> /dev/null; then
    echo "Faust already installed"
    exit 0
fi

echo "Attempting to install Faust via apt..."
sudo apt-get install -y faust libfaust-dev 2>/dev/null || {
    echo "ERROR: Could not install Faust automatically."
    echo "Please install Faust manually:"
    echo "  git clone https://github.com/grame-cncm/faust.git"
    echo "  cd faust && make && sudo make install && sudo ldconfig"
    exit 1
}
echo "Faust installed"
`,
		};
	},
};

// ── Phase: Extract SDKs ─────────────────────────────────────────────

const extractSDKs: SetupPhase = {
	id: "extract-sdks",
	name: "Extract SDKs",
	description: "Extract ASIO and VST3 SDKs",
	generateScript: (config) => {
		const installPath = expandPath(config.installPath);
		const shell = shellFor(config.platform);

		if (config.platform === "windows") {
			return {
				shell,
				cwd: installPath,
				script: `
$ErrorActionPreference = "Stop"
$HISE_PATH = "${installPath.replace(/\\/g, "\\\\")}"

Set-Location "$HISE_PATH\\tools\\SDK"

if (-not (Test-Path "$HISE_PATH\\tools\\SDK\\ASIOSDK2.3")) {
    Write-Host "Extracting SDKs..."
    tar -xf sdk.zip
} else {
    Write-Host "SDKs already extracted"
}

if ((Test-Path "$HISE_PATH\\tools\\SDK\\ASIOSDK2.3") -and (Test-Path "$HISE_PATH\\tools\\SDK\\VST3 SDK")) {
    Write-Host "SDKs verified"
} else {
    Write-Error "SDK extraction failed"
    exit 1
}
`,
			};
		}

		return {
			shell,
			cwd: installPath,
			script: `#!/bin/bash
set -e
HISE_PATH="${installPath}"

cd "$HISE_PATH/tools/SDK"

if [ ! -d "ASIOSDK2.3" ]; then
    echo "Extracting SDKs..."
    tar -xf sdk.zip
else
    echo "SDKs already extracted"
fi

if [ -d "ASIOSDK2.3" ] && [ -d "VST3 SDK" ]; then
    echo "SDKs verified"
else
    echo "ERROR: SDK extraction failed"
    exit 1
fi
`,
		};
	},
};

// ── Phase: Compile HISE ─────────────────────────────────────────────

const compileHISE: SetupPhase = {
	id: "compile",
	name: "Compile HISE",
	description: "Build HISE from source (5-15 minutes)",
	generateScript: (config) => {
		const installPath = expandPath(config.installPath);
		const shell = shellFor(config.platform);

		if (config.platform === "windows") {
			const buildConfig = config.includeFaust
				? "Release with Faust"
				: "Release";
			return {
				shell,
				cwd: installPath,
				script: `
$ErrorActionPreference = "Stop"
$HISE_PATH = "${installPath.replace(/\\/g, "\\\\")}"

Set-Location "$HISE_PATH\\projects\\standalone"

Write-Host "Running Projucer..."
$projucer = "$HISE_PATH\\JUCE\\Projucer\\Projucer.exe"
if (-not (Test-Path $projucer)) {
    Write-Error "Projucer not found at $projucer"
    exit 1
}

& $projucer --resave "$HISE_PATH\\projects\\standalone\\HISE Standalone.jucer"
$projucerExitCode = $LASTEXITCODE

$sln2026 = "$HISE_PATH\\projects\\standalone\\Builds\\VisualStudio2026\\HISE Standalone.sln"
$sln2022 = "$HISE_PATH\\projects\\standalone\\Builds\\VisualStudio2022\\HISE Standalone.sln"
$maxWait = 30
$waited = 0
while (-not (Test-Path $sln2026) -and -not (Test-Path $sln2022) -and $waited -lt $maxWait) {
    Start-Sleep -Seconds 1
    $waited++
}

$slnPath = $null
if (Test-Path $sln2026) {
    $slnPath = $sln2026
} elseif (Test-Path $sln2022) {
    $slnPath = $sln2022
}

if (-not $slnPath) {
    if ($projucerExitCode -ne 0) {
        Write-Error "Projucer failed (exit code: $projucerExitCode) and no Visual Studio solution was generated"
    } else {
        Write-Error "Solution file not found after Projucer"
    }
    exit 1
}

if ($projucerExitCode -ne 0) {
    Write-Warning "Projucer exited with code $projucerExitCode, but generated solution '$slnPath'. Continuing..."
}

Write-Host "Using solution: $slnPath"

Write-Host "Compiling HISE (this will take 5-15 minutes)..."
$env:PreferredToolArchitecture = "x64"

$msbuild2026 = "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe"
$msbuild2022 = "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe"
$prefer2026 = $slnPath -like "*VisualStudio2026*"

$msbuildCandidates = if ($prefer2026) {
    @($msbuild2026, $msbuild2022)
} else {
    @($msbuild2022, $msbuild2026)
}

$msbuild = $null
foreach ($candidate in $msbuildCandidates) {
    if (Test-Path $candidate) {
        $msbuild = $candidate
        break
    }
}

if (-not (Test-Path $msbuild)) {
    Write-Error "MSBuild not found"
    exit 1
}

Write-Host "Using MSBuild: $msbuild"

$buildConfig = "${buildConfig}"
& $msbuild "$slnPath" /p:Configuration="$buildConfig" /p:Platform=x64 /verbosity:minimal
if ($LASTEXITCODE -ne 0) {
    if ($prefer2026) {
        Write-Host "Hint: this solution expects the v145 toolset (VS2026). Install the VS2026 C++ build tools."
    }
    Write-Error "Compilation failed"
    exit 1
}

Write-Host "HISE compiled successfully"
`,
			};
		}

		if (config.platform === "macos") {
			const buildConfig = config.includeFaust
				? "Release with Faust"
				: "Release";
			return {
				shell,
				cwd: installPath,
				script: `#!/bin/bash
set -e
HISE_PATH="${installPath}"

cd "$HISE_PATH/projects/standalone"

echo "Running Projucer..."
PROJUCER="$HISE_PATH/JUCE/Projucer/Projucer.app/Contents/MacOS/Projucer"
if [ ! -f "$PROJUCER" ]; then
    echo "ERROR: Projucer not found at $PROJUCER"
    exit 1
fi
chmod +x "$PROJUCER"
"$PROJUCER" --resave "HISE Standalone.jucer"

echo "Compiling HISE (this will take 5-15 minutes)..."
CORES=$(sysctl -n hw.ncpu)
BUILD_CONFIG="${buildConfig}"

XCBEAUTIFY="$HISE_PATH/tools/Projucer/xcbeautify"
if [ -x "$XCBEAUTIFY" ]; then
    set -o pipefail && xcodebuild -project "Builds/MacOSX/HISE Standalone.xcodeproj" -configuration "$BUILD_CONFIG" -jobs $CORES | "$XCBEAUTIFY"
else
    xcodebuild -project "Builds/MacOSX/HISE Standalone.xcodeproj" -configuration "$BUILD_CONFIG" -jobs $CORES
fi

echo "HISE compiled successfully"
`,
			};
		}

		// Linux
		const buildConfig = config.includeFaust
			? "ReleaseWithFaust"
			: "Release";
		return {
			shell,
			cwd: installPath,
			script: `#!/bin/bash
set -e
HISE_PATH="${installPath}"

cd "$HISE_PATH/projects/standalone"

echo "Running Projucer..."
PROJUCER="$HISE_PATH/JUCE/Projucer/Projucer"
if [ ! -f "$PROJUCER" ]; then
    echo "ERROR: Projucer not found at $PROJUCER"
    exit 1
fi
chmod +x "$PROJUCER"
"$PROJUCER" --resave "HISE Standalone.jucer"

echo "Compiling HISE (this will take 5-15 minutes)..."
cd Builds/LinuxMakefile
BUILD_CONFIG="${buildConfig}"

make CONFIG=$BUILD_CONFIG AR=gcc-ar -j$(nproc --ignore=2)

cd build
ln -sf "HISE Standalone" HISE
cd ..

echo "HISE compiled successfully"
`,
		};
	},
};

// ── Phase: Add to PATH ──────────────────────────────────────────────

const addToPath: SetupPhase = {
	id: "add-path",
	name: "Add HISE to PATH",
	description: "Make HISE available from any terminal",
	generateScript: (config) => {
		const installPath = expandPath(config.installPath);
		const shell = shellFor(config.platform);

		if (config.platform === "windows") {
			const buildConfig = config.includeFaust
				? "Release with Faust"
				: "Release";
			return {
				shell,
				cwd: installPath,
				script: `
$ErrorActionPreference = "Stop"
$HISE_PATH = "${installPath.replace(/\\/g, "\\\\")}"
$buildConfig = "${buildConfig}"

# Determine VS version folder
$hiseBinPath = "$HISE_PATH\\projects\\standalone\\Builds\\VisualStudio2022\\x64\\$buildConfig\\App"
if (-not (Test-Path $hiseBinPath)) {
    $hiseBinPath = "$HISE_PATH\\projects\\standalone\\Builds\\VisualStudio2026\\x64\\$buildConfig\\App"
}

$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$hiseBinPath*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$hiseBinPath", "User")
    $env:Path = "$env:Path;$hiseBinPath"
    Write-Host "HISE added to PATH"
} else {
    Write-Host "HISE already in PATH"
}
`,
			};
		}

		if (config.platform === "macos") {
			const buildConfig = config.includeFaust
				? "Release with Faust"
				: "Release";
			return {
				shell,
				cwd: installPath,
				script: `#!/bin/bash
set -e
HISE_PATH="${installPath}"
HISE_BIN="$HISE_PATH/projects/standalone/Builds/MacOSX/build/${buildConfig}/HISE.app/Contents/MacOS"

if [ "$(basename "$SHELL")" = "zsh" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
else
    SHELL_CONFIG="$HOME/.bash_profile"
fi

if ! grep -q "$HISE_BIN" "$SHELL_CONFIG" 2>/dev/null; then
    echo "export PATH=\\"\\$PATH:$HISE_BIN\\"" >> "$SHELL_CONFIG"
    echo "HISE added to PATH"
else
    echo "HISE already in PATH"
fi
`,
			};
		}

		// Linux
		const buildConfig = config.includeFaust
			? "ReleaseWithFaust"
			: "Release";
		return {
			shell,
			cwd: installPath,
			script: `#!/bin/bash
set -e
HISE_PATH="${installPath}"
HISE_BIN="$HISE_PATH/projects/standalone/Builds/LinuxMakefile/build"

if [ "$(basename "$SHELL")" = "zsh" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
else
    SHELL_CONFIG="$HOME/.bashrc"
fi

if ! grep -q "$HISE_BIN" "$SHELL_CONFIG" 2>/dev/null; then
    echo "export PATH=\\"\\$PATH:$HISE_BIN\\"" >> "$SHELL_CONFIG"
    echo "HISE added to PATH"
else
    echo "HISE already in PATH"
fi
`,
		};
	},
};

// ── Phase: Verify Build ─────────────────────────────────────────────

const verifyBuild: SetupPhase = {
	id: "verify",
	name: "Verify Build",
	description: "Check that HISE was built correctly",
	generateScript: (config) => {
		const installPath = expandPath(config.installPath);
		const shell = shellFor(config.platform);

		if (config.platform === "windows") {
			const buildConfig = config.includeFaust
				? "Release with Faust"
				: "Release";
			return {
				shell,
				cwd: installPath,
				script: `
$ErrorActionPreference = "Stop"
$HISE_PATH = "${installPath.replace(/\\/g, "\\\\")}"
$buildConfig = "${buildConfig}"

$hiseBinPath = "$HISE_PATH\\projects\\standalone\\Builds\\VisualStudio2022\\x64\\$buildConfig\\App"
if (-not (Test-Path $hiseBinPath)) {
    $hiseBinPath = "$HISE_PATH\\projects\\standalone\\Builds\\VisualStudio2026\\x64\\$buildConfig\\App"
}

$hiseExe = "$hiseBinPath\\HISE.exe"
if (-not (Test-Path $hiseExe)) {
    Write-Error "HISE.exe not found at $hiseExe"
    exit 1
}

$fileSize = (Get-Item $hiseExe).Length
if ($fileSize -lt 10MB) {
    Write-Error "HISE.exe appears corrupted (size: $fileSize bytes)"
    exit 1
}

Write-Host "Checking build flags..."
& $hiseExe get_build_flags
Write-Host "Build verified"
`,
			};
		}

		if (config.platform === "macos") {
			const buildConfig = config.includeFaust
				? "Release with Faust"
				: "Release";
			return {
				shell,
				cwd: installPath,
				script: `#!/bin/bash
set -e
HISE_PATH="${installPath}"
HISE_BIN="$HISE_PATH/projects/standalone/Builds/MacOSX/build/${buildConfig}/HISE.app/Contents/MacOS/HISE"

if [ ! -f "$HISE_BIN" ]; then
    echo "ERROR: HISE binary not found at $HISE_BIN"
    exit 1
fi

echo "Checking build flags..."
"$HISE_BIN" get_build_flags || echo "Warning: Could not verify build flags"
echo "Build verified"
`,
			};
		}

		// Linux
		return {
			shell,
			cwd: installPath,
			script: `#!/bin/bash
set -e
HISE_PATH="${installPath}"
HISE_BIN="$HISE_PATH/projects/standalone/Builds/LinuxMakefile/build/HISE"

if [ ! -f "$HISE_BIN" ]; then
    echo "ERROR: HISE binary not found"
    exit 1
fi

echo "Checking build flags..."
"$HISE_BIN" get_build_flags || echo "Warning: Could not verify build flags"
echo "Build verified"
`,
		};
	},
};

// ── Phase: Configure & Test ─────────────────────────────────────────

const configureAndTest: SetupPhase = {
	id: "test",
	name: "Configure & Test",
	description: "Set HISE settings and export demo project",
	generateScript: (config) => {
		const installPath = expandPath(config.installPath);
		const shell = shellFor(config.platform);

		if (config.platform === "windows") {
			const buildConfig = config.includeFaust
				? "Release with Faust"
				: "Release";
			return {
				shell,
				cwd: installPath,
				script: `
$ErrorActionPreference = "Continue"
$HISE_PATH = "${installPath.replace(/\\/g, "\\\\")}"
$buildConfig = "${buildConfig}"

$hiseBinPath = "$HISE_PATH\\projects\\standalone\\Builds\\VisualStudio2022\\x64\\$buildConfig\\App"
if (-not (Test-Path $hiseBinPath)) {
    $hiseBinPath = "$HISE_PATH\\projects\\standalone\\Builds\\VisualStudio2026\\x64\\$buildConfig\\App"
}

$ippFlag = if (Test-Path "C:\\Program Files (x86)\\Intel\\oneAPI\\ipp\\latest") { "-ipp:1" } else { "-ipp:0" }
$faustFlag = if (Test-Path "C:\\Program Files\\Faust\\lib\\faust.dll") { '-faustpath:"C:\\Program Files\\Faust"' } else { "" }

Write-Host "Configuring HISE settings..."
& "$hiseBinPath\\HISE.exe" set_hise_settings -hisepath:"$HISE_PATH" $ippFlag $faustFlag

Write-Host "Setting project folder..."
& "$hiseBinPath\\HISE.exe" set_project_folder -p:"$HISE_PATH\\extras\\demo_project"

Write-Host "Exporting demo project..."
Push-Location "$HISE_PATH\\extras\\demo_project"

& "$hiseBinPath\\HISE.exe" export_ci "XmlPresetBackups\\Demo.xml" -t:instrument -p:VST3 -a:x64 -nolto
if ($LASTEXITCODE -ne 0) {
    Write-Host "Demo project export had issues, but HISE is installed"
    Pop-Location
    exit 0
}

$batchCompile = "$HISE_PATH\\extras\\demo_project\\Binaries\\batchCompile.bat"
if (Test-Path $batchCompile) {
    Write-Host "Running batchCompile.bat..."
    & $batchCompile
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Demo project compile had issues, but HISE is installed"
    } else {
        Write-Host "Demo project exported successfully"
    }
} else {
    Write-Host "batchCompile.bat not found, skipping demo compile"
}

Pop-Location
`,
			};
		}

		if (config.platform === "macos") {
			const buildConfig = config.includeFaust
				? "Release with Faust"
				: "Release";
			return {
				shell,
				cwd: installPath,
				script: `#!/bin/bash
HISE_PATH="${installPath}"
HISE_BIN="$HISE_PATH/projects/standalone/Builds/MacOSX/build/${buildConfig}/HISE.app/Contents/MacOS/HISE"

echo "Configuring HISE settings..."
SETTINGS_CMD="$HISE_BIN set_hise_settings -hisepath:$HISE_PATH"
if [ -f "$HISE_PATH/tools/faust/lib/libfaust.dylib" ]; then
    SETTINGS_CMD="$SETTINGS_CMD -faustpath:$HISE_PATH/tools/faust/"
fi
$SETTINGS_CMD || echo "Warning: Failed to configure settings"

echo "Setting project folder..."
"$HISE_BIN" set_project_folder -p:"$HISE_PATH/extras/demo_project" || echo "Warning: Failed to set project folder"

echo "Exporting demo project..."
"$HISE_BIN" export "$HISE_PATH/extras/demo_project/XmlPresetBackups/Demo.xml" -t:instrument -p:VST3 -nolto || echo "Demo project export had issues, but HISE is installed"

echo "Configuration complete"
`,
			};
		}

		// Linux
		return {
			shell,
			cwd: installPath,
			script: `#!/bin/bash
HISE_PATH="${installPath}"
HISE_BIN="$HISE_PATH/projects/standalone/Builds/LinuxMakefile/build/HISE"

echo "Configuring HISE settings..."
"$HISE_BIN" set_hise_settings -hisepath:"$HISE_PATH" || echo "Warning: Failed to configure settings"

echo "Setting project folder..."
"$HISE_BIN" set_project_folder -p:"$HISE_PATH/extras/demo_project" || echo "Warning: Failed to set project folder"

echo "Exporting demo project..."
"$HISE_BIN" export "$HISE_PATH/extras/demo_project/XmlPresetBackups/Demo.xml" -t:instrument -p:VST3 -nolto || echo "Demo project export had issues, but HISE is installed"

echo "Configuration complete"
`,
		};
	},
};

// ── Export all setup phases in order ─────────────────────────────────

export const SETUP_PHASES: SetupPhase[] = [
	installGit,
	cloneRepo,
	installBuildDeps,
	installFaust,
	extractSDKs,
	compileHISE,
	addToPath,
	verifyBuild,
	configureAndTest,
];
