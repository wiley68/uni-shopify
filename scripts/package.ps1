param([switch]$VerifyOnly)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Explicit distributable manifest. Never enumerate the repository into the ZIP.
$PackageManifest = @(
    '.shopifyignore'
    'assets/uni-cart-button.css'
    'assets/uni-cart-button.js'
    'assets/uni-product-button.css'
    'assets/uni-product-button.js'
    'assets/uni-transport.js'
    'assets/uni_logo.svg'
    'shopify-theme-procedure.txt'
    'snippets/uni-cart-button.liquid'
    'snippets/uni-product-button.liquid'
)

function Get-ModuleVersion([string]$Source) {
    # Match only the complete canonical declaration, never payload/SVG versions.
    $declarations = [regex]::Matches($Source, '(?m)^\s*var\s+UNI_VERSION\b[^\r\n]*')
    if ($declarations.Count -ne 1) {
        throw 'Expected exactly one var UNI_VERSION declaration in assets/uni-transport.js.'
    }
    $match = [regex]::Match($declarations[0].Value,
        '^\s*var UNI_VERSION = "((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))";\s*$')
    if (-not $match.Success) {
        throw 'Malformed UNI_VERSION: expected var UNI_VERSION = "MAJOR.MINOR.PATCH"; (no leading zeros).'
    }
    return $match.Groups[1].Value
}

function Get-PackageInputs([string]$Root) {
    $inputs = @{}
    foreach ($relative in $PackageManifest) {
        $file = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Missing required source file: $relative"
        }
        if ((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Symlinks/reparse points are not distributable inputs: $relative"
        }
        $inputs[$relative] = [IO.File]::ReadAllBytes($file)
    }
    # Reject unreviewed additions, temporary files and nested directories too.
    foreach ($directory in @('assets', 'snippets')) {
        $folder = Get-Item -LiteralPath (Join-Path $Root $directory)
        if ($folder.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Symlink/reparse directory is not allowed: $directory"
        }
        foreach ($item in Get-ChildItem -LiteralPath $folder.FullName -Force) {
            $relative = "$directory/$($item.Name)"
            if ($item.PSIsContainer -or -not $inputs.ContainsKey($relative)) {
                throw "Unexpected distributable input: $relative (review the explicit manifest)"
            }
        }
    }
    $shopifyIgnore = [Text.Encoding]::UTF8.GetString($inputs['.shopifyignore'])
    if ($shopifyIgnore -notmatch '(?m)^dist/\r?$') {
        throw '.shopifyignore must contain the dist/ exclusion.'
    }
    $gitIgnore = Join-Path $Root '.gitignore'
    if (-not (Test-Path -LiteralPath $gitIgnore) -or
        [IO.File]::ReadAllText($gitIgnore) -notmatch '(?m)^/dist/\r?$') {
        throw '.gitignore must contain /dist/.'
    }
    return $inputs
}

function Get-PackageNames {
    $names = [string[]]$PackageManifest.Clone()
    [Array]::Sort($names, [StringComparer]::Ordinal)
    return $names
}

function New-Installer([string]$ArchivePath, [hashtable]$Inputs) {
    $stream = [IO.File]::Open($ArchivePath, [IO.FileMode]::Create)
    try {
        $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($name in Get-PackageNames) {
                $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = [DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
                $entry.ExternalAttributes = 0
                $output = $entry.Open()
                try { $output.Write($Inputs[$name], 0, $Inputs[$name].Length) }
                finally { $output.Dispose() }
            }
        } finally { $zip.Dispose() }
    } finally { $stream.Dispose() }
}

function Assert-Installer([string]$ArchivePath, [hashtable]$Inputs, [string]$Version) {
    if ([IO.Path]::GetFileName($ArchivePath) -cne "spf_uni_$Version.zip") {
        throw "Installer filename must be spf_uni_$Version.zip."
    }
    $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName
            if (-not ($PackageManifest -ccontains $name)) {
                throw "Unexpected archive file/path: $name"
            }
            if (-not $seen.Add($name)) { throw "Duplicate archive file: $name" }
            $input = $entry.Open()
            $buffer = [IO.MemoryStream]::new()
            try {
                $input.CopyTo($buffer)
                $actual = $buffer.ToArray()
            } finally { $input.Dispose(); $buffer.Dispose() }
            if ([Convert]::ToBase64String($actual) -cne [Convert]::ToBase64String($Inputs[$name])) {
                throw "Archive/source bytes differ: $name"
            }
        }
        foreach ($name in $PackageManifest) {
            if (-not $seen.Contains($name)) { throw "Missing archive file: $name" }
        }
        # Reading and comparing every decompressed byte verifies readability/parity.
        # Parity also proves the archived .shopifyignore contains the dist/ exclusion.
    } finally { $zip.Dispose() }
}

# Dot sourcing exposes the same build/verification functions to the fixture checks.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        $root = Split-Path -Parent $PSScriptRoot
        $inputs = Get-PackageInputs $root
        $version = Get-ModuleVersion ([Text.Encoding]::UTF8.GetString($inputs['assets/uni-transport.js']))
        $dist = Join-Path $root 'dist'
        $archivePath = Join-Path $dist "spf_uni_$version.zip"
        if (-not $VerifyOnly) {
            [IO.Directory]::CreateDirectory($dist) | Out-Null
            # Build and verify before replacing any previous installer.
            $candidate = Join-Path $dist ([Guid]::NewGuid().ToString())
            [IO.Directory]::CreateDirectory($candidate) | Out-Null
            $candidatePath = Join-Path $candidate "spf_uni_$version.zip"
            try {
                New-Installer $candidatePath $inputs
                Assert-Installer $candidatePath $inputs $version
                Copy-Item -LiteralPath $candidatePath -Destination $archivePath -Force
            } finally {
                if (Test-Path -LiteralPath $candidatePath) { [IO.File]::Delete($candidatePath) }
                [IO.Directory]::Delete($candidate)
            }
        }
        Assert-Installer $archivePath $inputs $version
        Write-Output "Verified dist/spf_uni_$version.zip ($($inputs.Count) files, $((Get-Item -LiteralPath $archivePath).Length) bytes)."
    } catch {
        [Console]::Error.WriteLine("Packaging failed: $($_.Exception.Message)")
        exit 1
    }
}
