import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A Windows job created with KILL_ON_JOB_CLOSE kills every process in it once its last handle
// closes. The wrapper joins the job, then starts the program, which inherits the job; whatever the
// program leaves behind, orphans included, dies when the wrapper exits or is killed on a timeout.
const JOB_SOURCE = `
using System;
using System.Runtime.InteropServices;
namespace SpecGate {
  public static class Job {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
      public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
      public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
      public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
      public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemoryLimit;
      public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, int length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    static IntPtr held;
    public static bool KillOnClose() {
      IntPtr job = CreateJobObject(IntPtr.Zero, null);
      if (job == IntPtr.Zero) return false;
      ExtendedLimits info = new ExtendedLimits();
      info.Basic.LimitFlags = 0x2000;
      if (!SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(ExtendedLimits)))) return false;
      if (!AssignProcessToJobObject(job, GetCurrentProcess())) return false;
      held = job;
      return true;
    }
  }
}
`

const WRAPPER = `
$ErrorActionPreference = 'Stop'
try {
  $dll = $env:SPEC_GATE_JOB_DLL
  if (-not (Test-Path -LiteralPath $dll)) {
    $tmp = "$dll.$PID.tmp"
    Add-Type -TypeDefinition $env:SPEC_GATE_JOB_SOURCE -OutputAssembly $tmp -OutputType Library | Out-Null
    try { Move-Item -LiteralPath $tmp -Destination $dll } catch { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
  }
  if (-not ('SpecGate.Job' -as [type])) { Add-Type -Path $dll }
  [SpecGate.Job]::KillOnClose() | Out-Null
} catch {}
$psi = New-Object System.Diagnostics.ProcessStartInfo $env:SPEC_GATE_JOB_FILE, $env:SPEC_GATE_JOB_ARGS
$psi.UseShellExecute = $false
foreach ($name in 'SPEC_GATE_JOB_DLL', 'SPEC_GATE_JOB_SOURCE', 'SPEC_GATE_JOB_FILE', 'SPEC_GATE_JOB_ARGS') { $psi.EnvironmentVariables.Remove($name) }
$child = [System.Diagnostics.Process]::Start($psi)
$child.WaitForExit()
exit $child.ExitCode
`

const ENCODED = Buffer.from(WRAPPER, 'utf16le').toString('base64')
const DLL = join(tmpdir(), `spec-gate-job-${createHash('sha256').update(JOB_SOURCE).digest('hex').slice(0, 12)}.dll`)

// `args` is one Windows command-line string, parsed by the program itself.
export function spawnInJob(file, args, options) {
  const env = { ...(options.env ?? process.env), SPEC_GATE_JOB_DLL: DLL, SPEC_GATE_JOB_SOURCE: JOB_SOURCE, SPEC_GATE_JOB_FILE: file, SPEC_GATE_JOB_ARGS: args }
  return spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED], { windowsHide: true, ...options, env })
}
