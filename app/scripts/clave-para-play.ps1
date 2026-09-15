<#
.SYNOPSIS
  Genera el .zip cifrado con la llave de IPTV Player para subirlo a Google Play (firma de apps).

.DESCRIPTION
  En Play Console, al configurar la firma de apps, elige "Usar una clave diferente" /
  "Exportar y subir una clave desde Java KeyStore". Esa pantalla da para descargar:
    - pepk.jar
    - la clave pública de cifrado (archivo .pem)
  Con esos dos archivos, ejecuta este script desde la carpeta app:

    .\scripts\clave-para-play.ps1 -Pepk C:\Descargas\pepk.jar -ClaveCifrado C:\Descargas\encryption_public_key.pem

  Crea app\clave-play.zip (cifrado: solo Google puede abrirlo). Súbelo en esa misma pantalla y luego bórralo.
  La llave (android\keystore\iptv-player.jks) y sus contraseñas (android\key.properties) no salen del equipo.

.PARAMETER Pepk
  Ruta de pepk.jar descargado de Play Console.

.PARAMETER ClaveCifrado
  Ruta de la clave pública de cifrado (.pem) descargada de Play Console.

.PARAMETER Salida
  Archivo a crear. Por defecto app\clave-play.zip.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Pepk,
    [Parameter(Mandatory = $true)] [string] $ClaveCifrado,
    [string] $Salida
)

# Los programas nativos escriben avisos en stderr: no deben detener el script (PowerShell 5.1).
$ErrorActionPreference = 'Continue'

function Fail([string] $msg) {
    Write-Host "ERROR: $msg" -ForegroundColor Red
    exit 1
}

# Copia un secreto al portapapeles SIN guardarlo en el historial (Win+V) ni en el portapapeles en la nube.
function Set-SecretClipboard([string] $value) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $data = New-Object System.Windows.Forms.DataObject
        $data.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $value)
        foreach ($format in 'CanIncludeInClipboardHistory', 'CanUploadToCloudClipboard', 'ExcludeClipboardContentFromMonitorProcessing') {
            $data.SetData($format, (New-Object IO.MemoryStream (, [byte[]](0, 0, 0, 0))))
        }
        [System.Windows.Forms.Clipboard]::SetDataObject($data, $true)
        return $true
    } catch {
        return $false
    }
}

$appDir = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $appDir 'android'
$propsFile = Join-Path $androidDir 'key.properties'
if (-not $Salida) { $Salida = Join-Path $appDir 'clave-play.zip' }

if (-not (Test-Path -LiteralPath $Pepk -PathType Leaf)) { Fail "No se encontró pepk.jar en: $Pepk" }
if (-not (Test-Path -LiteralPath $ClaveCifrado -PathType Leaf)) { Fail "No se encontró la clave de cifrado (.pem) en: $ClaveCifrado" }
if (-not (Test-Path -LiteralPath $propsFile -PathType Leaf)) { Fail "No existe $propsFile (contraseñas de la llave)." }

# key.properties: storeFile, storePassword, keyAlias, keyPassword
$props = @{}
foreach ($line in Get-Content -LiteralPath $propsFile) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $parts = $line -split '=', 2
    $props[$parts[0].Trim()] = $parts[1].Trim()
}
foreach ($k in 'storeFile', 'storePassword', 'keyAlias') {
    if (-not $props[$k]) { Fail "Falta '$k' en key.properties." }
}
if (-not $props['keyPassword']) { $props['keyPassword'] = $props['storePassword'] }

$keystore = $props['storeFile']
if (-not [IO.Path]::IsPathRooted($keystore)) { $keystore = Join-Path $androidDir $keystore }
if (-not (Test-Path -LiteralPath $keystore -PathType Leaf)) { Fail "No se encontró la llave: $keystore" }
$alias = $props['keyAlias']
if ($alias -ne 'iptv-player') {
    Write-Host "Aviso: el alias de la llave es '$alias' (se esperaba 'iptv-player')." -ForegroundColor Yellow
}

# Java: el de Android Studio, JAVA_HOME o el del PATH.
$java = $null
$candidates = @(
    'C:\Program Files\Android\Android Studio\jbr\bin\java.exe',
    $(if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' })
)
foreach ($c in $candidates) { if ($c -and (Test-Path -LiteralPath $c)) { $java = $c; break } }
if (-not $java) {
    $cmd = Get-Command java -ErrorAction SilentlyContinue
    if ($cmd) { $java = $cmd.Source }
}
if (-not $java) { Fail 'No se encontró Java. Instala Android Studio o define JAVA_HOME.' }

# Comprobar las opciones con la ayuda de ESTE pepk (cambian entre versiones).
$help = (& $java -jar $Pepk --help 2>&1 | Out-String)
$required = '--keystore', '--alias', '--output', '--include-cert', '--rsa-aes-encryption', '--encryption-key-path'
$missing = @($required | Where-Object { $help -notmatch [regex]::Escape($_) })
if ($help.Trim().Length -gt 0 -and $missing.Count -gt 0) {
    Write-Host 'Opciones que muestra pepk --help:' -ForegroundColor Yellow
    Write-Host $help
    Fail ("Este pepk.jar no menciona: " + ($missing -join ', ') + ". Descarga el pepk.jar de la misma pantalla de Play Console.")
}

$pepkArgs = @(
    '-jar', $Pepk,
    "--keystore=$keystore",
    "--alias=$alias",
    "--output=$Salida",
    '--include-cert',
    '--rsa-aes-encryption',
    "--encryption-key-path=$ClaveCifrado"
)

$usedClipboard = $false
$envPassFlags = ($help -match '--keystore-pass') -and ($help -match '--key-pass') -and ($help -match 'env:')
if ($envPassFlags) {
    # pepk acepta las contraseñas desde variables de entorno (no quedan visibles en la línea de comandos).
    $env:IPTV_PEPK_STORE_PASS = $props['storePassword']
    $env:IPTV_PEPK_KEY_PASS = $props['keyPassword']
    $pepkArgs += '--keystore-pass=env:IPTV_PEPK_STORE_PASS'
    $pepkArgs += '--key-pass=env:IPTV_PEPK_KEY_PASS'
} else {
    # pepk pide las contraseñas en la consola (no acepta leerlas de otro lado): se copian al
    # portapapeles, fuera del historial, para pegarlas.
    Write-Host ''
    Write-Host 'pepk va a pedir DOS contraseñas (la del almacén y la de la clave).' -ForegroundColor Cyan
    if (Set-SecretClipboard $props['storePassword']) {
        $usedClipboard = $true
        Write-Host 'La contraseña está en el portapapeles: pégala con clic derecho (o Ctrl+V) y Enter, las dos veces.' -ForegroundColor Cyan
        if ($props['keyPassword'] -ne $props['storePassword']) {
            Write-Host 'Ojo: la segunda es distinta (keyPassword en android\key.properties).' -ForegroundColor Yellow
        }
    } else {
        Write-Host 'Cópialas de android\key.properties (storePassword y keyPassword).' -ForegroundColor Yellow
    }
    Write-Host ''
}

if (Test-Path -LiteralPath $Salida) { Remove-Item -LiteralPath $Salida -Force }
try {
    & $java @pepkArgs
    $code = $LASTEXITCODE
} finally {
    Remove-Item Env:\IPTV_PEPK_STORE_PASS -ErrorAction SilentlyContinue
    Remove-Item Env:\IPTV_PEPK_KEY_PASS -ErrorAction SilentlyContinue
    if ($usedClipboard) { [void](Set-SecretClipboard ' ') }
}

if ($code -ne 0 -or -not (Test-Path -LiteralPath $Salida)) {
    Fail "pepk terminó con código $code y no creó $Salida."
}

Write-Host ''
Write-Host "Listo: $Salida" -ForegroundColor Green
Write-Host 'Súbelo en Play Console, en la misma pantalla de donde descargaste pepk.jar.'
Write-Host 'Después bórralo. No envíes la llave ni key.properties por correo ni chat.'
