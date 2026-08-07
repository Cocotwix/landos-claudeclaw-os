# Foreground-window monitor — proves LandOS automation never takes the screen.
#
# Samples the Windows foreground window every 400ms and records the owning
# process. Used as acceptance evidence: during a full research run the operator's
# chosen application must remain foreground for every sample.
#
#   powershell -File scripts/runtime/foreground-monitor.ps1 -Seconds 300 -OutFile fg.log

param(
  [int]$Seconds = 120,
  [string]$OutFile = "foreground-monitor.log"
)

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Current() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return "0|none|(no foreground)";
    uint pid; GetWindowThreadProcessId(h, out pid);
    StringBuilder sb = new StringBuilder(256);
    GetWindowText(h, sb, 256);
    string name = "unknown";
    try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
    return pid + "|" + name + "|" + sb.ToString();
  }
}
'@

$deadline = (Get-Date).AddSeconds($Seconds)
$samples = 0
$byProcess = @{}
"timestamp,pid,process,title" | Out-File -FilePath $OutFile -Encoding utf8

while ((Get-Date) -lt $deadline) {
  $raw = [Fg]::Current()
  $parts = $raw.Split('|', 3)
  $proc = $parts[1]
  $samples++
  if ($byProcess.ContainsKey($proc)) { $byProcess[$proc]++ } else { $byProcess[$proc] = 1 }
  "$((Get-Date).ToString('HH:mm:ss.fff')),$($parts[0]),$proc,$($parts[2])" | Out-File -FilePath $OutFile -Append -Encoding utf8
  Start-Sleep -Milliseconds 400
}

"" | Out-File -FilePath $OutFile -Append -Encoding utf8
"=== SUMMARY: $samples samples ===" | Out-File -FilePath $OutFile -Append -Encoding utf8
$byProcess.GetEnumerator() | Sort-Object -Property Value -Descending | ForEach-Object {
  "$($_.Key): $($_.Value) sample(s)" | Out-File -FilePath $OutFile -Append -Encoding utf8
}
$chrome = 0
$byProcess.GetEnumerator() | Where-Object { $_.Key -eq 'chrome' } | ForEach-Object { $chrome = $_.Value }
"CHROME_FOREGROUND_SAMPLES=$chrome" | Out-File -FilePath $OutFile -Append -Encoding utf8
