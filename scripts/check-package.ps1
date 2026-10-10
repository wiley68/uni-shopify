Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/package.ps1"

function Assert-Fails([scriptblock]$Action, [string]$Message) {
    try { & $Action | Out-Null }
    catch {
        if ($_.Exception.Message -notlike "*$Message*") {
            throw "Wrong failure (expected '$Message'): $($_.Exception.Message)"
        }
        return
    }
    throw "Expected failure: $Message"
}

function Edit-Archive([string]$ArchivePath, [string]$Name, [bool]$Delete, [string]$Content = '') {
    $zip = [IO.Compression.ZipFile]::Open($ArchivePath, [IO.Compression.ZipArchiveMode]::Update)
    try {
        if ($Delete) { $zip.GetEntry($Name).Delete() }
        else {
            $entry = $zip.CreateEntry($Name)
            $stream = $entry.Open()
            try {
                $bytes = [Text.Encoding]::UTF8.GetBytes($Content)
                $stream.Write($bytes, 0, $bytes.Length)
            } finally { $stream.Dispose() }
        }
    } finally { $zip.Dispose() }
}

$root = Split-Path -Parent $PSScriptRoot
$inputs = Get-PackageInputs $root
$source = [Text.Encoding]::UTF8.GetString($inputs['assets/uni-transport.js'])
$version = Get-ModuleVersion $source
Assert-Fails { Get-ModuleVersion '' } 'exactly one'
Assert-Fails { Get-ModuleVersion ($source + "`nvar UNI_VERSION = `"1.2.3`";") } 'exactly one'
foreach ($invalid in @('1.2', '1.2.3-beta', '01.2.3', 'x.y.z', '')) {
    Assert-Fails { Get-ModuleVersion ("var UNI_VERSION = `"$invalid`";") } 'Malformed'
}
if ((Get-ModuleVersion "var OTHER_VERSION = `"9.9.9`";`nvar UNI_VERSION = `"1.2.3`";") -cne '1.2.3') {
    throw 'Parser matched an unrelated version.'
}

# Disposable fixtures stay inside ignored dist/; never mutate real runtime sources.
$dist = Join-Path $root 'dist'
$fixture = Join-Path $dist ('package-check-' + [Guid]::NewGuid().ToString())
[IO.Directory]::CreateDirectory($fixture) | Out-Null
try {
    $archive = Join-Path $fixture "spf_uni_$version.zip"
    New-Installer $archive $inputs
    Assert-Installer $archive $inputs $version
    $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
    New-Installer $archive $inputs
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $hash) {
        throw 'Repeat build was not byte-identical.'
    }
    Assert-Installer $archive $inputs $version

    $wrongName = Join-Path $fixture 'wrong.zip'
    Copy-Item -LiteralPath $archive -Destination $wrongName
    Assert-Fails { Assert-Installer $wrongName $inputs $version } 'filename must be'
    foreach ($unexpected in @('extra.txt', 'dist/recursive.zip', 'wrapper/assets/uni-transport.js')) {
        New-Installer $archive $inputs
        Edit-Archive $archive $unexpected $false 'unexpected'
        Assert-Fails { Assert-Installer $archive $inputs $version } 'Unexpected archive file/path'
    }
    New-Installer $archive $inputs
    Edit-Archive $archive '.shopifyignore' $true
    Assert-Fails { Assert-Installer $archive $inputs $version } 'Missing archive file: .shopifyignore'
    New-Installer $archive $inputs
    Edit-Archive $archive '.shopifyignore' $false 'duplicate'
    Assert-Fails { Assert-Installer $archive $inputs $version } 'Duplicate archive file'
    New-Installer $archive $inputs
    Edit-Archive $archive '.shopifyignore' $true
    Edit-Archive $archive '.shopifyignore' $false 'changed bytes'
    Assert-Fails { Assert-Installer $archive $inputs $version } 'Archive/source bytes differ'
    [IO.File]::WriteAllText($archive, 'not a ZIP')
    Assert-Fails { Assert-Installer $archive $inputs $version } 'central directory'

    $fixtureRoot = Join-Path $fixture 'source'
    foreach ($name in $PackageManifest) {
        $file = Join-Path $fixtureRoot $name
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
        [IO.File]::WriteAllBytes($file, $inputs[$name])
    }
    [IO.File]::WriteAllText((Join-Path $fixtureRoot '.gitignore'), "/dist/`n")
    Get-PackageInputs $fixtureRoot | Out-Null
    $extra = Join-Path $fixtureRoot 'assets/unreviewed.tmp'
    [IO.File]::WriteAllText($extra, 'unexpected')
    Assert-Fails { Get-PackageInputs $fixtureRoot } 'Unexpected distributable input'
    [IO.File]::Delete($extra)
    [IO.File]::WriteAllText((Join-Path $fixtureRoot '.shopifyignore'), 'scripts/')
    Assert-Fails { Get-PackageInputs $fixtureRoot } '.shopifyignore must contain'
    [IO.File]::WriteAllBytes((Join-Path $fixtureRoot '.shopifyignore'), $inputs['.shopifyignore'])
    [IO.File]::WriteAllText((Join-Path $fixtureRoot '.gitignore'), '')
    Assert-Fails { Get-PackageInputs $fixtureRoot } '.gitignore must contain'
    [IO.File]::Delete((Join-Path $fixtureRoot 'assets/uni-transport.js'))
    Assert-Fails { Get-PackageInputs $fixtureRoot } 'Missing required source file'
    Write-Output "Packaging checks passed: version parser, manifest, exclusions, archive failures, source parity, byte-identical rebuild (SHA256 $hash)."
} finally {
    # Validate the absolute cleanup target before recursively deleting our fixture.
    $resolved = [IO.Path]::GetFullPath($fixture)
    $distPrefix = [IO.Path]::GetFullPath($dist).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($distPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing cleanup outside dist: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
