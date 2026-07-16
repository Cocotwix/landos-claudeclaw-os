param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$EntryPoint,
  [Parameter(Mandatory = $true)][string]$RuntimeId,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$StdoutPath,
  [Parameter(Mandatory = $true)][string]$StderrPath
)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class LandOSDetachedLauncher
{
    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint OPEN_ALWAYS = 4;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
    private const uint DETACHED_PROCESS = 0x00000008;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST = new IntPtr(0x00020002);
    private const uint FILE_END = 2;
    private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint dwLowDateTime;
        public uint dwHighDateTime;
    }

    public sealed class LaunchResult
    {
        public uint Pid { get; set; }
        public string ProcessStartTime { get; set; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFileW(string name, uint access, uint share, ref SECURITY_ATTRIBUTES attributes, uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetFilePointerEx(IntPtr file, long distance, out long newPosition, uint moveMethod);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref STARTUPINFOEX startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr attributeList, int attributeCount, int flags, ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(IntPtr attributeList, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previousValue, IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);

    private static string Quote(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
        var result = new StringBuilder("\"");
        var slashes = 0;
        foreach (var ch in value)
        {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"')
            {
                result.Append('\\', slashes * 2 + 1).Append('"');
                slashes = 0;
                continue;
            }
            result.Append('\\', slashes).Append(ch);
            slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }

    private static IntPtr OpenInherited(string name, ref SECURITY_ATTRIBUTES attributes)
    {
        var handle = CreateFileW(name, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, ref attributes, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (handle == INVALID_HANDLE_VALUE) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open " + name);
        long position;
        if (!SetFilePointerEx(handle, 0, out position, FILE_END)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not seek " + name);
        return handle;
    }

    private static IntPtr OpenNullInput(ref SECURITY_ATTRIBUTES attributes)
    {
        var handle = CreateFileW("NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, ref attributes, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (handle == INVALID_HANDLE_VALUE) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open NUL for stdin");
        return handle;
    }

    public static LaunchResult Launch(string executable, string[] arguments, string cwd, string stdoutPath, string stderrPath)
    {
        var attributes = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), bInheritHandle = true };
        IntPtr stdoutHandle = INVALID_HANDLE_VALUE, stderrHandle = INVALID_HANDLE_VALUE, stdinHandle = INVALID_HANDLE_VALUE;
        IntPtr attributeList = IntPtr.Zero, handleList = IntPtr.Zero;
        PROCESS_INFORMATION processInfo = new PROCESS_INFORMATION();
        try
        {
            stdoutHandle = OpenInherited(stdoutPath, ref attributes);
            stderrHandle = OpenInherited(stderrPath, ref attributes);
            stdinHandle = OpenNullInput(ref attributes);
            var startup = new STARTUPINFOEX {
                StartupInfo = new STARTUPINFO {
                    cb = Marshal.SizeOf(typeof(STARTUPINFOEX)),
                    dwFlags = STARTF_USESTDHANDLES,
                    hStdInput = stdinHandle,
                    hStdOutput = stdoutHandle,
                    hStdError = stderrHandle
                }
            };
            var attributeBytes = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeBytes);
            attributeList = Marshal.AllocHGlobal(attributeBytes);
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeBytes))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not initialize the inherited-handle list");
            handleList = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(handleList, 0, stdinHandle);
            Marshal.WriteIntPtr(handleList, IntPtr.Size, stdoutHandle);
            Marshal.WriteIntPtr(handleList, IntPtr.Size * 2, stderrHandle);
            if (!UpdateProcThreadAttribute(attributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handleList, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not restrict inherited handles");
            startup.lpAttributeList = attributeList;
            var command = new StringBuilder(Quote(executable));
            foreach (var argument in arguments) command.Append(' ').Append(Quote(argument));
            var flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT | CREATE_BREAKAWAY_FROM_JOB | EXTENDED_STARTUPINFO_PRESENT;
            if (!CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, cwd, ref startup, out processInfo))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessW failed");
            FILETIME creation, exit, kernel, user;
            var processStartTime = DateTime.UtcNow;
            if (GetProcessTimes(processInfo.hProcess, out creation, out exit, out kernel, out user))
            {
                var fileTime = ((long)creation.dwHighDateTime << 32) | creation.dwLowDateTime;
                processStartTime = DateTime.FromFileTimeUtc(fileTime);
            }
            return new LaunchResult { Pid = processInfo.dwProcessId, ProcessStartTime = processStartTime.ToString("o") };
        }
        finally
        {
            if (attributeList != IntPtr.Zero) DeleteProcThreadAttributeList(attributeList);
            if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
            if (attributeList != IntPtr.Zero) Marshal.FreeHGlobal(attributeList);
            if (processInfo.hThread != IntPtr.Zero) CloseHandle(processInfo.hThread);
            if (processInfo.hProcess != IntPtr.Zero) CloseHandle(processInfo.hProcess);
            if (stdinHandle != INVALID_HANDLE_VALUE) CloseHandle(stdinHandle);
            if (stdoutHandle != INVALID_HANDLE_VALUE) CloseHandle(stdoutHandle);
            if (stderrHandle != INVALID_HANDLE_VALUE) CloseHandle(stderrHandle);
        }
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp
$arguments = [string[]]@(
  $EntryPoint,
  "--landos-runtime-id=$RuntimeId",
  "--landos-runtime-root=$RepoRoot"
)
$launch = [LandOSDetachedLauncher]::Launch($NodePath, $arguments, $RepoRoot, $StdoutPath, $StderrPath)
[pscustomobject]@{ pid = $launch.Pid; processStartTime = $launch.ProcessStartTime } | ConvertTo-Json -Compress
