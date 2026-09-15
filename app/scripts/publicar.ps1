<#
.SYNOPSIS
  Compila IPTV Player (APK de la versión portal, para celulares y TV box) y, opcionalmente,
  sube los APK al portal (quedan SIN publicar para revisarlos allá).

.DESCRIPTION
  Por defecto compila los APK por arquitectura (arm64-v8a, armeabi-v7a, x86_64) y el universal.
  El .aab de Google Play solo se compila con -Play (mientras la app no esté en Play no hace falta).

.EXAMPLE
  .\scripts\publicar.ps1
  Compila los APK.

.EXAMPLE
  .\scripts\publicar.ps1 -Portal http://192.168.1.46:8080 -Usuario admin
  Compila y sube los APK al portal (pide la contraseña del administrador).

.EXAMPLE
  .\scripts\publicar.ps1 -GitHub -Notas "Búsqueda del servidor en la red"
  Compila y publica los APK en GitHub (Release app-v<versión>). Cada portal la ve en
  "Actualizaciones de la app" y la puede traer con un clic.

.EXAMPLE
  .\scripts\publicar.ps1 -Play
  Compila también el .aab para Google Play Console.

.PARAMETER Portal
  URL del portal (http://host:puerto). Si se indica, se suben los APK.

.PARAMETER Usuario
  Administrador del portal (por defecto admin).

.PARAMETER Clave
  Contraseña como SecureString (si no se da, se pide en pantalla).

.PARAMETER Play
  Compila también el .aab de Google Play (tarda varios minutos más).

.PARAMETER SinUniversal
  No compila el APK universal.

.PARAMETER SinCompilar
  No compila: usa los archivos que ya están en build\ (para repetir solo la subida).

.PARAMETER GitHub
  Publica los APK en un Release de GitHub con etiqueta app-v<versión> (repositorio Sacxer/iptv-panel).
  Usa la sesión de GitHub guardada en este PC (la misma de git push) o la variable GITHUB_TOKEN.
  El Release se crea como borrador, se suben los APK y al final se publica: los portales nunca ven una versión a medias.

.PARAMETER Notas
  Novedades de la versión (se muestran en los portales y a los clientes). Si falta, se piden en pantalla.

.PARAMETER Beta
  Publica el Release como pre-release (beta): los portales lo muestran aparte.
#>
[CmdletBinding()]
param(
    [string] $Portal,
    [string] $Usuario = 'admin',
    [SecureString] $Clave,
    [switch] $Play,
    [switch] $SinUniversal,
    [switch] $SinCompilar,
    [switch] $GitHub,
    [string] $Notas,
    [switch] $Beta,
    [string] $Repo = 'Sacxer/iptv-panel',
    # Solo para pruebas con un GitHub simulado.
    [string] $GitHubApi = 'https://api.github.com',
    [string] $GitHubUploads = 'https://uploads.github.com'
)

# flutter escribe avisos en stderr: no deben detener el script (PowerShell 5.1).
$ErrorActionPreference = 'Continue'

function Fail([string] $msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

function Format-Size([long] $bytes) {
    '{0:N1} MB' -f ($bytes / 1MB)
}

function Get-ErrorMessage($err) {
    $body = $null
    if ($err.ErrorDetails -and $err.ErrorDetails.Message) { $body = $err.ErrorDetails.Message }
    if ($body) {
        try {
            $json = $body | ConvertFrom-Json
            if ($json.error) { return [string]$json.error }
        } catch { }
        return $body
    }
    return $err.Exception.Message
}

# Ejecuta flutter mostrando la salida y devuelve @{ Code; Text }.
function Invoke-Flutter([string[]] $arguments) {
    $lines = New-Object System.Collections.Generic.List[string]
    & flutter @arguments 2>&1 | ForEach-Object {
        # Las líneas de stderr llegan como ErrorRecord: se muestra el texto original.
        $line = if ($_ -is [Management.Automation.ErrorRecord]) { [string]$_.TargetObject } else { [string]$_ }
        $lines.Add($line)
        Write-Host $line
    }
    return @{ Code = $LASTEXITCODE; Text = ($lines -join "`n") }
}

# Lo mismo que comprueba flutter con apkanalyzer: que los símbolos de depuración de las
# librerías nativas se hayan sacado a BUNDLE-METADATA (no viajan a los equipos).
function Test-AabSymbolsStripped([string] $path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        $names = @($zip.Entries | ForEach-Object { $_.FullName })
    } finally {
        $zip.Dispose()
    }
    $prefix = '^BUNDLE-METADATA/com\.android\.tools\.build\.debugsymbols/[^/]+/'
    return (@($names -match ($prefix + 'libflutter\.so\.(sym|dbg)$')).Count -gt 0) -and
        (@($names -match ($prefix + 'libapp\.so\.(sym|dbg)$')).Count -gt 0)
}

$appDir = Split-Path -Parent $PSScriptRoot
$pubspec = Join-Path $appDir 'pubspec.yaml'
$versionLine = Select-String -LiteralPath $pubspec -Pattern '^version:\s*([0-9A-Za-z.\-]+)\+(\d+)\s*$' | Select-Object -First 1
if (-not $versionLine) { Fail 'No se pudo leer "version: X.Y.Z+N" de pubspec.yaml.' }
$versionName = $versionLine.Matches[0].Groups[1].Value
$buildNumber = [int]$versionLine.Matches[0].Groups[2].Value
$b3 = '{0:D3}' -f $buildNumber

Write-Host ''
Write-Host "IPTV Player $versionName (compilación $buildNumber)" -ForegroundColor Cyan
Write-Host "  versionCode: armeabi-v7a 1$b3 · arm64-v8a 2$b3 · x86_64 4$b3 · universal $buildNumber$(if ($Play) { " · Play $buildNumber" })"
Write-Host ''

if (-not (Test-Path -LiteralPath (Join-Path $appDir 'android\key.properties'))) {
    Write-Host 'AVISO: falta android\key.properties. Se firmará con la clave de depuración:' -ForegroundColor Yellow
    Write-Host '       NO sirve para actualizar equipos que tienen la versión oficial ni para Google Play.' -ForegroundColor Yellow
    Write-Host ''
}

$apkDir = Join-Path $appDir 'build\app\outputs\flutter-apk'
$aab = Join-Path $appDir 'build\app\outputs\bundle\playRelease\app-play-release.aab'
$universalApk = Join-Path $apkDir 'app-portal-release.apk'

Push-Location $appDir
try {
    if (-not $SinCompilar) {
        $steps = 1 + [int](-not $SinUniversal) + [int][bool]$Play
        $n = 1
        Write-Host "$n/$steps  APK por arquitectura (celulares y TV box)…" -ForegroundColor Cyan
        $r = Invoke-Flutter @('build', 'apk', '--release', '--split-per-abi', '--flavor', 'portal', '--dart-define=DISTRIBUTION=portal')
        if ($r.Code -ne 0) { Fail 'Falló la compilación de los APK por arquitectura.' }

        if (-not $SinUniversal) {
            $n++
            Write-Host ''
            Write-Host "$n/$steps  APK universal…" -ForegroundColor Cyan
            $r = Invoke-Flutter @('build', 'apk', '--release', '--flavor', 'portal', '--dart-define=DISTRIBUTION=portal')
            if ($r.Code -ne 0) { Fail 'Falló la compilación del APK universal.' }
        }

        if ($Play) {
            $n++
            Write-Host ''
            Write-Host "$n/$steps  Google Play (.aab)…" -ForegroundColor Cyan
            $r = Invoke-Flutter @('build', 'appbundle', '--release', '--flavor', 'play', '--dart-define=DISTRIBUTION=play')
            if ($r.Code -ne 0) {
                # Sin "Android SDK Command-line Tools" flutter no puede revisar el .aab y lo da por fallido
                # aunque Gradle terminó bien (ese mensaje solo sale después de compilar). Se revisa aquí.
                if ($r.Text -match 'failed to strip debug symbols' -and (Test-Path -LiteralPath $aab) -and (Test-AabSymbolsStripped $aab)) {
                    Write-Host ''
                    Write-Host 'AVISO: flutter no pudo revisar el .aab porque falta "Android SDK Command-line Tools".' -ForegroundColor Yellow
                    Write-Host '       Se revisó aquí: los símbolos de depuración sí se separaron; el .aab es válido.' -ForegroundColor Yellow
                    Write-Host '       Para quitar el aviso: Android Studio → SDK Manager → SDK Tools → Command-line Tools.' -ForegroundColor Yellow
                } else {
                    Fail 'Falló la compilación del .aab para Play.'
                }
            }
        }
    }
} finally {
    Pop-Location
}

# APK a entregar: por arquitectura (+ universal).
$abiApks = @{}
foreach ($abi in 'arm64-v8a', 'armeabi-v7a', 'x86_64') {
    $p = Join-Path $apkDir "app-$abi-portal-release.apk"
    if (Test-Path -LiteralPath $p) { $abiApks[$abi] = Get-Item -LiteralPath $p }
}
if ($abiApks.Count -eq 0) { Fail "No se encontraron APK por arquitectura en $apkDir" }
$apks = @('arm64-v8a', 'armeabi-v7a', 'x86_64' | Where-Object { $abiApks.ContainsKey($_) } | ForEach-Object { $abiApks[$_] })
$universal = $null
if (-not $SinUniversal -and (Test-Path -LiteralPath $universalApk)) {
    $universal = Get-Item -LiteralPath $universalApk
    $apks += $universal
}
if ($Play -and -not (Test-Path -LiteralPath $aab)) { Fail "No se encontró $aab" }

# Comprobar que los APK son de esta versión (aapt2 de Android SDK build-tools, si está).
$sdkDir = $env:ANDROID_HOME
if (-not $sdkDir) { $sdkDir = $env:ANDROID_SDK_ROOT }
$localProps = Join-Path $appDir 'android\local.properties'
if (-not $sdkDir -and (Test-Path -LiteralPath $localProps)) {
    $sdkLine = Select-String -LiteralPath $localProps -Pattern '^sdk\.dir=(.+)$' | Select-Object -First 1
    if ($sdkLine) { $sdkDir = $sdkLine.Matches[0].Groups[1].Value.Replace('\\', '\').Replace('\:', ':') }
}
$aapt2 = $null
if ($sdkDir -and (Test-Path -LiteralPath (Join-Path $sdkDir 'build-tools'))) {
    $aapt2 = Get-ChildItem -LiteralPath (Join-Path $sdkDir 'build-tools') -Directory |
        Sort-Object { try { [version]$_.Name } catch { [version]'0.0' } } -Descending |
        ForEach-Object { Join-Path $_.FullName 'aapt2.exe' } |
        Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if ($aapt2) {
    foreach ($apk in $apks) {
        $badging = @(& $aapt2 dump badging $apk.FullName 2>$null)
        $m = [regex]::Match([string]($badging | Select-Object -First 1), "versionCode='(\d+)' versionName='([^']*)'")
        if (-not $m.Success) { Fail "No se pudo leer la versión de $($apk.Name)." }
        if ($m.Groups[2].Value -ne $versionName -or ([int]$m.Groups[1].Value % 1000) -ne ($buildNumber % 1000)) {
            Fail ("{0} es la versión {1} ({2}), no la {3}+{4} de pubspec.yaml. Vuelve a compilar (sin -SinCompilar)." -f $apk.Name, $m.Groups[2].Value, $m.Groups[1].Value, $versionName, $buildNumber)
        }
    }
}

$failed = 0
if ($Portal) {
    $base = $Portal.Trim().TrimEnd('/')
    if ($base -notmatch '^https?://') { $base = "http://$base" }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    Write-Host ''
    Write-Host "Subiendo al portal $base como $Usuario…" -ForegroundColor Cyan
    if (-not $Clave) { $Clave = Read-Host -AsSecureString "Contraseña de $Usuario" }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Clave)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }

    try {
        $loginBody = @{ username = $Usuario; password = $plain } | ConvertTo-Json -Compress
        $login = Invoke-RestMethod -Method Post -Uri "$base/api/admin/auth/login" -ContentType 'application/json; charset=utf-8' `
            -Body ([Text.Encoding]::UTF8.GetBytes($loginBody)) -TimeoutSec 30 -ErrorAction Stop
    } catch {
        Fail ('No se pudo iniciar sesión en el portal: ' + (Get-ErrorMessage $_))
    } finally {
        $plain = $null
        $loginBody = $null
    }
    $headers = @{ Authorization = "Bearer $($login.token)" }

    $releaseIds = @{}
    foreach ($apk in $apks) {
        Write-Host ("  {0} ({1})…" -f $apk.Name, (Format-Size $apk.Length))
        try {
            $uri = "$base/api/admin/app-releases/upload?name=$([uri]::EscapeDataString($apk.Name))"
            $res = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType 'application/octet-stream' `
                -InFile $apk.FullName -TimeoutSec 900 -ErrorAction Stop
            $a = $res.apk
            $replaced = if ($res.replaced) { ' (reemplazó uno anterior)' } else { '' }
            Write-Host ("    OK: {0} {1} (versionCode {2}), arquitectura {3}{4}" -f $a.package, $a.versionName, $a.versionCode, $a.abi, $replaced) -ForegroundColor Green
            if ($a.versionName -ne $versionName) {
                Write-Host "    Aviso: el APK dice versión $($a.versionName) y pubspec.yaml $versionName." -ForegroundColor Yellow
            }
            foreach ($w in @($res.warnings)) { if ($w) { Write-Host "    Aviso del portal: $w" -ForegroundColor Yellow } }
            if ($res.release) { $releaseIds[[string]$res.release.id] = $res.release }
        } catch {
            $failed++
            Write-Host ('    ERROR: ' + (Get-ErrorMessage $_)) -ForegroundColor Red
        }
    }

    Write-Host ''
    foreach ($id in $releaseIds.Keys) {
        $rel = $releaseIds[$id]
        if ($rel.published) {
            Write-Host "  Versión $($rel.version_name) en el portal (id $id): YA ESTABA PUBLICADA; se reemplazaron sus archivos." -ForegroundColor Yellow
        } else {
            Write-Host "  Versión $($rel.version_name) en el portal (id $id): SIN publicar." -ForegroundColor Cyan
        }
    }
    Write-Host 'Revisa y publica en el portal: Actualizaciones de la app' -ForegroundColor Cyan
    if ($failed -gt 0) { Write-Host "$failed APK no se pudieron subir." -ForegroundColor Red }
}

function Get-GitHubToken {
    if ($env:GITHUB_TOKEN) { return $env:GITHUB_TOKEN }
    # La sesión que guardó Git Credential Manager al hacer git push (puede abrir la ventana de GitHub).
    $request = "protocol=https`nhost=github.com`n`n"
    $out = $request | & git credential fill 2>$null
    foreach ($line in @($out)) {
        if ($line -like 'password=*') { return $line.Substring(9) }
    }
    return $null
}

function Get-StatusCode($err) {
    try { return [int]$err.Exception.Response.StatusCode } catch { return 0 }
}

function Invoke-GitHub([string] $Method, [string] $Uri, $Body = $null) {
    $params = @{ Method = $Method; Uri = $Uri; Headers = $script:ghHeaders; TimeoutSec = 60; ErrorAction = 'Stop' }
    if ($null -ne $Body) {
        $params.ContentType = 'application/json; charset=utf-8'
        $params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
    }
    return Invoke-RestMethod @params
}

$githubUrl = $null
if ($GitHub) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $tag = "app-v$versionName"
    Write-Host ''
    Write-Host "Publicando en GitHub ($Repo, etiqueta $tag)…" -ForegroundColor Cyan

    $token = Get-GitHubToken
    if (-not $token) { Fail 'No hay sesión de GitHub en este PC. Haz un "git push" una vez (abre la ventana de GitHub) o define GITHUB_TOKEN.' }
    $script:ghHeaders = @{
        Authorization = "Bearer $token"
        Accept = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
        'User-Agent' = 'iptv-player-publicar'
    }
    $token = $null

    if (-not $PSBoundParameters.ContainsKey('Notas')) {
        $Notas = Read-Host 'Novedades de esta versión (Enter para dejarlas vacías)'
    }

    # Release existente con esa etiqueta (también borradores de un intento anterior).
    try {
        $all = @(Invoke-GitHub 'GET' "$GitHubApi/repos/$Repo/releases?per_page=100")
    } catch {
        $code = Get-StatusCode $_
        if ($code -eq 401 -or $code -eq 403) { Fail 'GitHub rechazó la sesión guardada. Vuelve a iniciar sesión con "git push" o usa GITHUB_TOKEN.' }
        if ($code -eq 404) { Fail "No se encontró el repositorio $Repo (o la sesión no tiene acceso)." }
        Fail ('No se pudo consultar GitHub: ' + (Get-ErrorMessage $_))
    }
    $release = $all | Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1

    try {
        if ($release) {
            if (-not $release.draft) {
                Write-Host "  Ya existe el Release $tag publicado: se reemplazan sus APK." -ForegroundColor Yellow
            } else {
                Write-Host "  Se reutiliza el borrador $tag de un intento anterior."
            }
            if ($Notas) { $release = Invoke-GitHub 'PATCH' "$GitHubApi/repos/$Repo/releases/$($release.id)" @{ body = $Notas } }
        } else {
            $release = Invoke-GitHub 'POST' "$GitHubApi/repos/$Repo/releases" @{
                tag_name = $tag
                target_commitish = 'main'
                name = "IPTV Player $versionName"
                body = [string]$Notas
                draft = $true
                prerelease = [bool]$Beta
            }
            Write-Host "  Borrador creado (id $($release.id))."
        }

        foreach ($apk in $apks) {
            $old = @($release.assets) | Where-Object { $_.name -eq $apk.Name } | Select-Object -First 1
            if ($old) { Invoke-GitHub 'DELETE' "$GitHubApi/repos/$Repo/releases/assets/$($old.id)" | Out-Null }
            Write-Host ("  Subiendo {0} ({1})…" -f $apk.Name, (Format-Size $apk.Length))
            $uri = "$GitHubUploads/repos/$Repo/releases/$($release.id)/assets?name=$([uri]::EscapeDataString($apk.Name))"
            $asset = Invoke-RestMethod -Method Post -Uri $uri -Headers $script:ghHeaders -ContentType 'application/vnd.android.package-archive' `
                -InFile $apk.FullName -TimeoutSec 1800 -ErrorAction Stop
            if ([long]$asset.size -ne $apk.Length) { Fail "GitHub recibió $($asset.size) bytes de $($apk.Name) y el archivo tiene $($apk.Length)." }
            Write-Host '    OK' -ForegroundColor Green
        }

        if ($release.draft) {
            $release = Invoke-GitHub 'PATCH' "$GitHubApi/repos/$Repo/releases/$($release.id)" @{ draft = $false; prerelease = [bool]$Beta }
        }
        $githubUrl = $release.html_url
        Write-Host "  Publicado: $githubUrl" -ForegroundColor Green
        Write-Host '  Los portales lo verán en "Actualizaciones de la app" al buscar actualizaciones (o solos en su próxima revisión).' -ForegroundColor Cyan
    } catch {
        Fail ('Falló la publicación en GitHub: ' + (Get-ErrorMessage $_) + '. Si quedó un borrador, vuelve a ejecutar con -SinCompilar -GitHub para terminarlo.')
    } finally {
        $script:ghHeaders = $null
    }
}

function Show-Apk([string] $label, $item) {
    if ($item) {
        Write-Host ("    {0,-13} {1}  ({2})" -f $label, $item.FullName, (Format-Size $item.Length))
    }
}

Write-Host ''
Write-Host 'Qué APK usar (mientras la app no esté en Google Play, este es el de celulares y TV box):' -ForegroundColor Cyan
Write-Host '  Celulares y tabletas:'
Write-Host '    - arm64-v8a: casi todos los celulares de los últimos años.'
Write-Host '    - armeabi-v7a: celulares viejos o muy económicos (32 bits).'
Write-Host '    - universal: si no sabes cuál; sirve en todos pero pesa unas tres veces más.'
Write-Host '  TV box:'
Write-Host '    - arm64-v8a: la mayoría de TV box recientes.'
Write-Host '    - armeabi-v7a: TV box económicos y Fire TV Stick viejos (muchos traen Android de 32 bits'
Write-Host '      aunque el procesador sea de 64). Si "no es compatible", usa este o el universal.'
Write-Host '  Emuladores y equipos Intel/AMD: x86_64.'
Write-Host '  Una vez instalada, cada equipo recibe desde el portal solo la actualización de su arquitectura.'
Write-Host ''
Write-Host 'Archivos:' -ForegroundColor Cyan
Show-Apk 'arm64-v8a' $abiApks['arm64-v8a']
Show-Apk 'armeabi-v7a' $abiApks['armeabi-v7a']
Show-Apk 'x86_64' $abiApks['x86_64']
Show-Apk 'universal' $universal
if ($Play) {
    $aabItem = Get-Item -LiteralPath $aab
    Write-Host ''
    Write-Host '  Google Play Console (Producción / Pruebas → Crear versión):'
    Show-Apk '.aab' $aabItem
}

if ($failed -gt 0) { exit 2 }
exit 0
