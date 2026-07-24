Add-Type -AssemblyName System.Drawing
$path = 'C:\Users\Yaroslav\.cursor\projects\e-PetsAndTests-GalaxyAndromedaTabletop\assets\c__Users_Yaroslav_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_image-70a9918e-a9c4-4336-9aed-b82f58e9bc12.png'
$bmp = [System.Drawing.Bitmap]::FromFile($path)
$size = 32.0

function Get-HexFill([int]$x, [int]$y) {
  $c = $bmp.GetPixel($x, $y)
  if ($c.R -gt 155 -and $c.G -gt 145 -and $c.B -gt 125 -and ($c.R - $c.G) -lt 22) { return 'n' }
  if ($c.B -gt 150 -and $c.R -lt 95 -and $c.G -lt 135) { return 'b' }
  if ($c.R -gt 145 -and $c.G -lt 85 -and $c.B -lt 85) { return 'r' }
  if ($c.G -gt 125 -and $c.G -gt ($c.R + 25) -and $c.R -lt 115) { return 'g' }
  return '.'
}

function Dist($a, $b) { [math]::Sqrt(($a[0]-$b[0])*($a[0]-$b[0]) + ($a[1]-$b[1])*($a[1]-$b[1])) }
function To-Axial([double]$x, [double]$y) {
  $qf = $x / (1.5 * $size)
  $rf = $y / ([math]::Sqrt(3) * $size) - $qf / 2.0
  return @([int][math]::Round($qf), [int][math]::Round($rf))
}

$points = @()
for ($y = 60; $y -lt $bmp.Height - 70; $y += 12) {
  for ($x = 60; $x -lt $bmp.Width - 60; $x += 12) {
    $t = Get-HexFill $x $y
    if ($t -ne '.') { $points += ,@($x, $y, $t) }
  }
}

$clusters = @()
foreach ($p in $points) {
  $found = $false
  foreach ($c in $clusters) {
    if ((Dist $p $c.center) -lt 54) {
      $c.xsum += $p[0]; $c.ysum += $p[1]; $c.count++
      if ($p[2] -ne 'n') { $c.kind = $p[2] }
      $c.center = @([math]::Round($c.xsum / $c.count), [math]::Round($c.ysum / $c.count))
      $found = $true
      break
    }
  }
  if (-not $found) {
    $clusters += [pscustomobject]@{ xsum = $p[0]; ysum = $p[1]; count = 1; kind = $p[2]; center = @($p[0], $p[1]) }
  }
}

$clusters = $clusters | Where-Object { $_.count -ge 8 }
$raw = @{}
foreach ($c in $clusters) {
  $ax = To-Axial $c.center[0] $c.center[1]
  $key = "$($ax[0]),$($ax[1])"
  if (-not $raw.ContainsKey($key)) {
    $raw[$key] = @{ q = $ax[0]; r = $ax[1]; kind = $c.kind; x = $c.center[0]; y = $c.center[1] }
  } elseif ($c.kind -ne 'n') { $raw[$key].kind = $c.kind }
}

# keep largest connected component
$keys = @($raw.Keys)
$start = ($raw.Values | Sort-Object x | Select-Object -First 1)
$q0 = ($start.q); $r0 = ($start.r)
$dirs = @(@(1,0),@(1,-1),@(0,-1),@(-1,0),@(-1,1),@(0,1))
$visited = @{}
$queue = @("$q0,$r0")
$component = @{}
while ($queue.Count -gt 0) {
  $k = $queue[0]; $queue = $queue[1..($queue.Count-1)]
  if ($visited.ContainsKey($k)) { continue }
  $visited[$k] = $true
  if (-not $raw.ContainsKey($k)) { continue }
  $component[$k] = $raw[$k]
  $parts = $k.Split(',')
  $q = [int]$parts[0]; $r = [int]$parts[1]
  foreach ($d in $dirs) {
    $nk = "$(($q+$d[0])),$(($r+$d[1]))"
    if (-not $visited.ContainsKey($nk) -and $raw.ContainsKey($nk)) { $queue += $nk }
  }
}

$minQ = ($component.Values | ForEach-Object { $_.q } | Measure-Object -Minimum).Minimum
$minR = ($component.Values | ForEach-Object { $_.r } | Measure-Object -Minimum).Minimum
Write-Output "component=$($component.Count)"
$component.Values | Sort-Object { $_.r - $minR }, { $_.q - $minQ } | ForEach-Object {
  $q = $_.q - $minQ; $r = $_.r - $minR
  "{0,3},{1,3} {2}" -f $q, $r, $_.kind
}
$bmp.Dispose()
