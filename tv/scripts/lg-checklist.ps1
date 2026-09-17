# Llena la lista de verificación oficial de LG (self_evaluation_checklist_5.0.xlsx) con las respuestas de
# assets/store/lg/checklist.json, usando Microsoft Excel del equipo (solo Windows).
#
#   powershell -ExecutionPolicy Bypass -File scripts/lg-checklist.ps1            (borrador: las pruebas de TV quedan vacías)
#   powershell -ExecutionPolicy Bypass -File scripts/lg-checklist.ps1 -Probado   (después de probar en un LG real: pone Pass)
#
# La plantilla es la de LG (webostv.developer.lge.com → App Self Checklist → documents_for_app_qa.zip); se espera en
# dist/lg/ y el resultado queda en dist/lg/ (no se suben a GitHub).
param(
  [switch]$Probado,
  [string]$Plantilla = "",
  [string]$Salida = ""
)
$ErrorActionPreference = 'Stop'
$tv = Split-Path -Parent $PSScriptRoot
if (-not $Plantilla) { $Plantilla = Join-Path $tv 'dist\lg\self_evaluation_checklist_5.0.xlsx' }
if (-not $Salida) { $Salida = Join-Path $tv 'dist\lg\self_evaluation_checklist_PTOVS.xlsx' }
if (-not (Test-Path $Plantilla)) { throw "No está la plantilla de LG: $Plantilla" }
$datos = Get-Content -Raw -Encoding UTF8 (Join-Path $tv 'assets\store\lg\checklist.json') | ConvertFrom-Json

function Llenar($hoja, $respuestas, $colNo, $colResultado, $colComentario, $probado) {
  $pendientes = 0
  # Se leen los números de una vez (la hoja tiene formato hasta muy abajo y celda a celda sería muy lento)
  $filas = 200
  $numeros = $hoja.Range($hoja.Cells.Item(1, $colNo), $hoja.Cells.Item($filas, $colNo)).Value2
  for ($f = 1; $f -le $filas; $f++) {
    $valor = $numeros[$f, 1]
    if ($null -eq $valor) { continue }
    $no = ([string]$valor).Trim() -replace '\.0$', ''
    if ($no -notmatch '^\d+$') { continue }
    $r = $respuestas.PSObject.Properties[$no]
    if (-not $r) { continue }
    $resultado = $r.Value[0]
    if ($resultado -eq 'TV') {
      if ($probado) { $resultado = 'Pass' } else { $resultado = ''; $pendientes++ }
    }
    $hoja.Cells.Item($f, $colResultado).Value2 = $resultado
    $hoja.Cells.Item($f, $colComentario).Value2 = $r.Value[1]
  }
  return $pendientes
}

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $libro = $excel.Workbooks.Open((Resolve-Path $Plantilla).Path)
  # Hoja 1: No en B, resultado en N, comentario en O. Hoja 2: No en B, resultado en G, comentario en H.
  $p1 = Llenar $libro.Worksheets.Item(1) $datos.selfChecklist 2 14 15 $Probado
  $p2 = Llenar $libro.Worksheets.Item(2) $datos.otherCheckPoints 2 7 8 $Probado
  $libro.SaveAs($Salida, 51)
  $libro.Close($false)
  Write-Output "Lista de verificación: $Salida"
  if ($p1 + $p2 -gt 0) {
    Write-Output "Quedan $($p1 + $p2) pruebas por confirmar en un televisor LG real (luego ejecute con -Probado)."
  }
} finally {
  $excel.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
