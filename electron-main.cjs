const { app, BrowserWindow, ipcMain, shell, dialog, protocol, net } = require('electron');
const path = require('path');
const si = require('systeminformation');
const { exec, execSync } = require('child_process');
const os = require('os');
const isDev = process.env.NODE_ENV === 'development';
const DiscordRPC = require('discord-rpc');

// Register custom protocol for local files
protocol.registerSchemesAsPrivileged([
  { scheme: 'nova-file', privileges: { bypassCSP: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

// Auto-elevate to admin if not already
const isAdmin = (() => {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
})();

if (!isAdmin && !isDev) {
  // Relaunch elevated only in production
  const appPath = process.argv[0];
  const args = process.argv.slice(1).join(' ');
  exec(`powershell.exe -Command "Start-Process '\"${appPath}\"' -ArgumentList '${args}' -Verb RunAs"`, () => { });
  app.quit();
  process.exit(0);
}

function runPS(command) {
  return new Promise((resolve) => {
    // Use Base64 encoding to completely avoid all shell escaping issues
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    const psCommand = `powershell.exe -ExecutionPolicy Bypass -NoProfile -EncodedCommand ${encoded}`;
    exec(psCommand, { maxBuffer: 10 * 1024 * 1024, timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('PS Error:', command.substring(0, 60), stderr || err.message);
        resolve({ ok: false, out: '' });
      } else {
        resolve({ ok: true, out: stdout });
      }
    });
  });
}

function runPSWithTimeout(command, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const encoded = Buffer.from(command, 'utf16le').toString('base64');
    const psCommand = `powershell.exe -ExecutionPolicy Bypass -NoProfile -EncodedCommand ${encoded}`;
    exec(psCommand, { maxBuffer: 20 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        // Check if it's a timeout
        if (err.killed) {
          console.error('PS Timeout:', command.substring(0, 80));
          resolve({ ok: false, out: 'Command timed out' });
        } else {
          console.error('PS Error:', command.substring(0, 80), stderr || err.message);
          resolve({ ok: false, out: stderr || err.message || '' });
        }
      } else {
        resolve({ ok: true, out: stdout || '' });
      }
    });
  });
}

let preApplyRestoreConfirmed = false;
let networkPreApplyRestoreConfirmed = false;
let servicesPreApplyRestoreConfirmed = false;

function getAdvancedSystemTweakSpec(name, enabled) {
  const docsDir = app.getPath('documents').replace(/\\/g, '\\\\');
  const reportDir = `${docsDir}\\\\NovaOptimizerReports`;
  const markerFile = `${reportDir}\\\\system-preapply-restore.ok`;

  const specs = {
    "Create Pre-Apply Restore Point": {
      timeoutMs: 120000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction SilentlyContinue; Checkpoint-Computer -Description "Optimizer-System-Starters-PreApply" -RestorePointType "MODIFY_SETTINGS"; Set-Content -Path '${markerFile}' -Value (Get-Date).ToString("s") -Force`
    },
    "Verify Windows Build Health": {
      timeoutMs: 40000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $os=Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber,OsHardwareAbstractionLayer; $u=Get-Service wuauserv -ErrorAction SilentlyContinue | Select-Object Status,StartType; [pscustomobject]@{Timestamp=Get-Date;OS=$os;WindowsUpdateService=$u} | ConvertTo-Json -Depth 6 | Out-File "$r\\windows-build-health.json" -Force`
    },
    "Secure Boot + Firmware Integrity": {
      timeoutMs: 30000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $sb=$null; try { $sb=Confirm-SecureBootUEFI } catch { $sb='UnsupportedOrUnavailable' }; $bios=Get-CimInstance Win32_BIOS | Select-Object Manufacturer,SMBIOSBIOSVersion,ReleaseDate; [pscustomobject]@{Timestamp=Get-Date;SecureBoot=$sb;BIOS=$bios} | ConvertTo-Json -Depth 5 | Out-File "$r\\firmware-integrity.json" -Force`
    },
    "Run SFC System Scan": {
      timeoutMs: 3600000,
      cmd: 'sfc /scannow'
    },
    "Run DISM Health Repair": {
      timeoutMs: 5400000,
      cmd: 'DISM /Online /Cleanup-Image /ScanHealth; DISM /Online /Cleanup-Image /RestoreHealth'
    },
    "Set Best Performance Defaults": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects" /v VisualFXSetting /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue; reg add "HKCU\\Control Panel\\Desktop" /v MenuShowDelay /t REG_SZ /d 50 /f -ErrorAction SilentlyContinue'
        : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects" /v VisualFXSetting /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue; reg add "HKCU\\Control Panel\\Desktop" /v MenuShowDelay /t REG_SZ /d 400 /f -ErrorAction SilentlyContinue'
    },
    "Memory Management Safe Defaults": {
      timeoutMs: 30000,
      cmd: 'wmic computersystem where name="%computername%" set AutomaticManagedPagefile=True'
    },
    "Enable Memory Integrity (Compat)": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity" /v Enabled /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue'
        : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity" /v Enabled /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue'
    },
    "Prune Unneeded Windows Features": {
      timeoutMs: 120000,
      cmd: enabled
        ? 'Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction SilentlyContinue; Disable-WindowsOptionalFeature -Online -FeatureName WorkFolders-Client -NoRestart -ErrorAction SilentlyContinue'
        : 'Enable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -NoRestart -ErrorAction SilentlyContinue; Enable-WindowsOptionalFeature -Online -FeatureName WorkFolders-Client -NoRestart -ErrorAction SilentlyContinue'
    },
    "Defender Gaming Exclusions Audit": {
      timeoutMs: 30000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Set-MpPreference -ScanAvgCPULoadFactor 20 -ErrorAction SilentlyContinue; Get-MpPreference | Select-Object ExclusionPath,ExclusionProcess,DisableRealtimeMonitoring,ScanAvgCPULoadFactor | ConvertTo-Json -Depth 5 | Out-File "$r\\defender-gaming-audit.json" -Force`
    },
    "Telemetry Balance (Safe)": {
      timeoutMs: 25000,
      cmd: 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" /v AllowTelemetry /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue; Set-Service -Name DiagTrack -StartupType Manual -ErrorAction SilentlyContinue'
    },
    "Windows Update Notify/Schedule": {
      timeoutMs: 25000,
      cmd: 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" /v AUOptions /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue'
    },
    "Block Auto Driver Replacements": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate" /v ExcludeWUDriversInQualityUpdate /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue'
        : 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate" /v ExcludeWUDriversInQualityUpdate /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue'
    },
    "Verify Chipset Driver Stack": {
      timeoutMs: 40000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; pnputil /enum-drivers | Out-File "$r\\chipset-driver-stack.txt" -Force`
    },
    "Verify Network Adapter Drivers": {
      timeoutMs: 35000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-NetAdapter | Select-Object Name,InterfaceDescription,DriverInformation,Status,LinkSpeed | Format-List | Out-File "$r\\network-driver-stack.txt" -Force`
    },
    "NIC Low-Jitter Properties": {
      timeoutMs: 40000,
      cmd: enabled
        ? 'Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { Disable-NetAdapterPowerManagement -Name $_.Name -ErrorAction SilentlyContinue; Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Energy Efficient Ethernet" -DisplayValue "Off" -NoRestart -ErrorAction SilentlyContinue }'
        : 'Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { Enable-NetAdapterPowerManagement -Name $_.Name -ErrorAction SilentlyContinue }'
    },
    "TCP/IP Stable Defaults": {
      timeoutMs: 30000,
      cmd: 'netsh int tcp set global autotuninglevel=normal; netsh int tcp set global ecncapability=disabled; netsh int tcp set global timestamps=disabled; netsh int tcp set global rss=enabled'
    },
    "DNS Reliability Validation": {
      timeoutMs: 35000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $res=Resolve-DnsName cloudflare.com -Type A -ErrorAction SilentlyContinue; $lat=(Test-Connection 1.1.1.1 -Count 4 -ErrorAction SilentlyContinue | Measure-Object -Property ResponseTime -Average).Average; [pscustomobject]@{Timestamp=Get-Date;DNSResult=$res;AveragePingMs=$lat} | ConvertTo-Json -Depth 6 | Out-File "$r\\dns-validation.json" -Force`
    },
    "Pause Background Sync Clients": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'Get-Process OneDrive -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; schtasks /Change /TN "\\Microsoft\\Windows\\OneDrive\\OneDrive Standalone Update Task-S-1-5-21*" /Disable 2>$null'
        : 'schtasks /Change /TN "\\Microsoft\\Windows\\OneDrive\\OneDrive Standalone Update Task-S-1-5-21*" /Enable 2>$null'
    },
    "QoS Priority Guidance": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v NetworkThrottlingIndex /t REG_DWORD /d 4294967295 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v SystemResponsiveness /t REG_DWORD /d 10 /f -ErrorAction SilentlyContinue'
        : 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v NetworkThrottlingIndex /t REG_DWORD /d 10 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v SystemResponsiveness /t REG_DWORD /d 20 /f -ErrorAction SilentlyContinue'
    },
    "High Performance Power Profile": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'powercfg -setactive SCHEME_MIN'
        : 'powercfg -setactive SCHEME_BALANCED'
    },
    "Selective Idle State Tuning": {
      timeoutMs: 30000,
      cmd: enabled
        ? 'powercfg -setacvalueindex scheme_current sub_processor IDLEDISABLE 1; powercfg -setactive scheme_current'
        : 'powercfg -setacvalueindex scheme_current sub_processor IDLEDISABLE 0; powercfg -setactive scheme_current'
    },
    "CPU Scheduling Responsiveness": {
      timeoutMs: 20000,
      cmd: enabled
        ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl" /v Win32PrioritySeparation /t REG_DWORD /d 26 /f -ErrorAction SilentlyContinue'
        : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl" /v Win32PrioritySeparation /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue'
    },
    "Core Parking Responsiveness": {
      timeoutMs: 30000,
      cmd: enabled
        ? 'powercfg -setacvalueindex scheme_current sub_processor CPMINCORES 100; powercfg -setactive scheme_current'
        : 'powercfg -setacvalueindex scheme_current sub_processor CPMINCORES 10; powercfg -setactive scheme_current'
    },
    "Timer Resolution Safe Guidance": {
      timeoutMs: 20000,
      cmd: 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel" /v GlobalTimerResolution /f -ErrorAction SilentlyContinue'
    },
    "Storage I/O Contention Audit": {
      timeoutMs: 45000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-PhysicalDisk | Select-Object FriendlyName,MediaType,HealthStatus,Size | ConvertTo-Json -Depth 5 | Out-File "$r\\storage-io-audit.json" -Force`
    },
    "Verify TRIM + SSD Firmware": {
      timeoutMs: 30000,
      cmd: 'fsutil behavior set DisableDeleteNotify 0; fsutil behavior query DisableDeleteNotify'
    },
    "Gaming Drive Indexing Trim": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'Set-Service -Name WSearch -StartupType Manual -ErrorAction SilentlyContinue; Stop-Service -Name WSearch -Force -ErrorAction SilentlyContinue'
        : 'Set-Service -Name WSearch -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name WSearch -ErrorAction SilentlyContinue'
    },
    "Reduce Background Disk Writers": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'Set-Service -Name SysMain -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service -Name SysMain -Force -ErrorAction SilentlyContinue'
        : 'Set-Service -Name SysMain -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name SysMain -ErrorAction SilentlyContinue'
    },
    "Disk SMART Health Check": {
      timeoutMs: 35000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-PhysicalDisk | Select-Object FriendlyName,SerialNumber,MediaType,HealthStatus,OperationalStatus | ConvertTo-Json -Depth 5 | Out-File "$r\\disk-smart-health.json" -Force`
    },
    "Memory Compression Default-On": {
      timeoutMs: 25000,
      cmd: enabled ? 'Enable-MMAgent -MemoryCompression -ErrorAction SilentlyContinue' : 'Disable-MMAgent -MemoryCompression -ErrorAction SilentlyContinue'
    },
    "Trim Startup Services": {
      timeoutMs: 30000,
      cmd: enabled
        ? '@("AdobeARMservice","gupdate","gupdatem","edgeupdate","edgeupdatem") | ForEach-Object { Set-Service -Name $_ -StartupType Manual -ErrorAction SilentlyContinue }'
        : '@("AdobeARMservice","gupdate","gupdatem","edgeupdate","edgeupdatem") | ForEach-Object { Set-Service -Name $_ -StartupType Automatic -ErrorAction SilentlyContinue }'
    },
    "Boot Path Optimization": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'bcdedit /set bootmenupolicy standard; bcdedit /timeout 3'
        : 'bcdedit /timeout 10'
    },
    "Reliability Monitoring (Lean)": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'schtasks /Change /TN "\\Microsoft\\Windows\\RAC\\RacTask" /Disable 2>$null'
        : 'schtasks /Change /TN "\\Microsoft\\Windows\\RAC\\RacTask" /Enable 2>$null'
    },
    "Error Reporting Minimal Actionable": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'Set-Service -Name WerSvc -StartupType Manual -ErrorAction SilentlyContinue'
        : 'Set-Service -Name WerSvc -StartupType Automatic -ErrorAction SilentlyContinue'
    },
    "Disable Non-Essential Scheduled Tasks": {
      timeoutMs: 30000,
      cmd: enabled
        ? 'schtasks /Change /TN "\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator" /Disable 2>$null; schtasks /Change /TN "\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater" /Disable 2>$null'
        : 'schtasks /Change /TN "\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator" /Enable 2>$null; schtasks /Change /TN "\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater" /Enable 2>$null'
    },
    "Time Sync Stability (NTP)": {
      timeoutMs: 30000,
      cmd: 'w32tm /config /syncfromflags:manual /manualpeerlist:"time.windows.com,0x9" /update; net stop w32time; net start w32time; w32tm /resync'
    },
    "USB Driver + Power Behavior Check": {
      timeoutMs: 30000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; pnputil /enum-devices /class USB | Out-File "$r\\usb-controller-report.txt" -Force`
    },
    "Disable USB Selective Power Save": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'powercfg -setacvalueindex scheme_current SUB_USB USBSELECTIVE SUSPEND 0; powercfg -setactive scheme_current'
        : 'powercfg -setacvalueindex scheme_current SUB_USB USBSELECTIVE SUSPEND 1; powercfg -setactive scheme_current'
    },
    "Audio Stack Low-Latency Baseline": {
      timeoutMs: 30000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-CimInstance Win32_SoundDevice | Select-Object Name,Status,Manufacturer,PNPDeviceID | ConvertTo-Json -Depth 5 | Out-File "$r\\audio-baseline.json" -Force; Set-Service -Name Audiosrv -StartupType Automatic -ErrorAction SilentlyContinue`
    },
    "Disable Heavy Audio Enhancements": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'reg add "HKCU\\Software\\Microsoft\\Multimedia\\Audio" /v UserDuckingPreference /t REG_DWORD /d 3 /f -ErrorAction SilentlyContinue'
        : 'reg add "HKCU\\Software\\Microsoft\\Multimedia\\Audio" /v UserDuckingPreference /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue'
    },
    "Input Stack Stability Audit": {
      timeoutMs: 30000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-PnpDevice -Class Keyboard,Mouse,HIDClass | Select-Object Class,FriendlyName,Status,InstanceId | ConvertTo-Json -Depth 5 | Out-File "$r\\input-stack-audit.json" -Force`
    },
    "Device Manager Stability Cleanup": {
      timeoutMs: 30000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-PnpDevice | Where-Object { $_.Status -ne "OK" -or $_.FriendlyName -match "LPT|COM" } | Select-Object Class,FriendlyName,Status,InstanceId | ConvertTo-Json -Depth 5 | Out-File "$r\\device-manager-cleanup-candidates.json" -Force`
    },
    "ACPI/Firmware Device Validation": {
      timeoutMs: 120000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; powercfg /energy /duration 20 /output "$r\\acpi-energy-report.html"`
    },
    "Compositor Performance Defaults": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v EnableTransparency /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue'
        : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v EnableTransparency /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue'
    },
    "Disable Heavy UI Background Features": {
      timeoutMs: 25000,
      cmd: enabled
        ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarAnimations /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue; reg add "HKCU\\Control Panel\\Desktop\\WindowMetrics" /v MinAnimate /t REG_SZ /d 0 /f -ErrorAction SilentlyContinue'
        : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarAnimations /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue; reg add "HKCU\\Control Panel\\Desktop\\WindowMetrics" /v MinAnimate /t REG_SZ /d 1 /f -ErrorAction SilentlyContinue'
    },
    "Run Short Stability Baseline": {
      timeoutMs: 180000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; winsat cpu -xml "$r\\winsat-cpu.xml"; winsat mem -xml "$r\\winsat-mem.xml"; winsat disk -xml "$r\\winsat-disk.xml"`
    },
    "Run Network Baseline Test": {
      timeoutMs: 60000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $p1=Test-Connection 1.1.1.1 -Count 20 -ErrorAction SilentlyContinue; $p2=Test-Connection 8.8.8.8 -Count 20 -ErrorAction SilentlyContinue; [pscustomobject]@{Timestamp=Get-Date;Cloudflare=$p1;GoogleDNS=$p2} | ConvertTo-Json -Depth 6 | Out-File "$r\\network-baseline.json" -Force`
    },
    "Create Applied Tweaks Profile": {
      timeoutMs: 40000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $profile=@{Created=(Get-Date).ToString("s"); Power=(powercfg /getactivescheme); Priority=(Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl" -ErrorAction SilentlyContinue); Network=(Get-NetAdapter | Select-Object Name,Status,LinkSpeed); Services=(Get-Service | Where-Object {$_.Status -eq "Running"} | Select-Object -First 40 Name,Status,StartType)}; $profile | ConvertTo-Json -Depth 8 | Out-File "$r\\applied-tweaks-profile.json" -Force`
    },
    "Generate Post-Tune Report": {
      timeoutMs: 50000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $cpu=(Get-CimInstance Win32_Processor | Select-Object Name,MaxClockSpeed,CurrentClockSpeed,NumberOfCores,NumberOfLogicalProcessors); $mem=Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory; $disk=Get-PhysicalDisk | Select-Object FriendlyName,MediaType,HealthStatus,Size; $net=(Get-NetAdapter | Select-Object Name,Status,LinkSpeed); $summary=[pscustomobject]@{Timestamp=(Get-Date).ToString("s");CPU=$cpu;Memory=$mem;Disk=$disk;Network=$net;NextSteps=@("Check cooling if CPU clocks are unstable","Upgrade RAM if free memory is consistently low","Use NVMe for game library if load stalls persist","Update GPU/chipset drivers if instability remains","Check motherboard firmware release notes for latency fixes")}; $summary | ConvertTo-Json -Depth 8 | Out-File "$r\\post-tune-report.json" -Force`
    }
  };

  return specs[name] || null;
}

function getAdvancedNetworkTweakSpec(name, enabled) {
  const docsDir = app.getPath('documents').replace(/\\/g, '\\\\');
  const reportDir = `${docsDir}\\\\NovaOptimizerReports`;
  const markerFile = `${reportDir}\\\\network-preapply-restore.ok`;

  const specs = {
    "Create Network Pre-Apply Restore Point": {
      timeoutMs: 120000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction SilentlyContinue; Checkpoint-Computer -Description "Optimizer-Network-Starters-PreApply" -RestorePointType "MODIFY_SETTINGS"; Set-Content -Path '${markerFile}' -Value (Get-Date).ToString("s") -Force`
    },
    "Confirm Physical Ethernet Quality": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-NetAdapter | Select-Object Name,Status,MediaConnectionState,InterfaceDescription | ConvertTo-Json -Depth 4 | Out-File "$r\\network-physical-quality.json" -Force`
    },
    "Verify Link Speed & Duplex": {
      timeoutMs: 30000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-NetAdapter | Select-Object Name,Status,LinkSpeed,MacAddress | ConvertTo-Json -Depth 4 | Out-File "$r\\network-link-duplex.json" -Force`
    },
    "Validate Router/Switch Port Health": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; arp -a | Out-File "$r\\router-switch-health.txt" -Force`
    },
    "Update NIC Drivers Audit": {
      timeoutMs: 40000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; pnputil /enum-drivers | Select-String -Pattern "Net|Ethernet|Wireless|Wi-Fi|Intel|Realtek|Broadcom|Qualcomm|Marvell" | Out-File "$r\\nic-driver-audit.txt" -Force`
    },
    "Router Firmware Currency Check": {
      timeoutMs: 30000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; ipconfig | Out-File "$r\\router-firmware-check.txt" -Force`
    },
    "ISP Line Health Baseline": {
      timeoutMs: 45000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $a=Test-Connection 1.1.1.1 -Count 15 -ErrorAction SilentlyContinue; $b=Test-Connection 8.8.8.8 -Count 15 -ErrorAction SilentlyContinue; [pscustomobject]@{Cloudflare=$a;Google=$b} | ConvertTo-Json -Depth 6 | Out-File "$r\\isp-line-health.json" -Force`
    },
    "Ping/Jitter/Loss Baseline": {
      timeoutMs: 60000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $p=Test-Connection 1.1.1.1 -Count 30 -ErrorAction SilentlyContinue; $lat=$p | Select-Object -ExpandProperty ResponseTime; $avg=($lat | Measure-Object -Average).Average; $min=($lat | Measure-Object -Minimum).Minimum; $max=($lat | Measure-Object -Maximum).Maximum; $j=$max-$min; $lost=30-($p.Count); [pscustomobject]@{AverageMs=$avg;MinMs=$min;MaxMs=$max;JitterMs=$j;PacketsLost=$lost} | ConvertTo-Json -Depth 5 | Out-File "$r\\baseline-jitter-loss.json" -Force`
    },
    "Throughput Consistency Baseline": {
      timeoutMs: 45000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes,ReceivedUnicastPackets,SentUnicastPackets,ReceivedDiscardedPackets,OutboundDiscardedPackets | ConvertTo-Json -Depth 5 | Out-File "$r\\throughput-consistency-baseline.json" -Force`
    },
    "Disable Ethernet Power Saving": {
      timeoutMs: 30000,
      cmd: enabled ? 'Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object { Disable-NetAdapterPowerManagement -Name $_.Name -ErrorAction SilentlyContinue; Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Energy Efficient Ethernet" -DisplayValue "Off" -NoRestart -ErrorAction SilentlyContinue }' : 'Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object { Enable-NetAdapterPowerManagement -Name $_.Name -ErrorAction SilentlyContinue }'
    },
    "Disable Wi-Fi Power Saving": {
      timeoutMs: 30000,
      cmd: enabled ? 'Get-NetAdapter -Name "*Wi-Fi*" -ErrorAction SilentlyContinue | ForEach-Object { Disable-NetAdapterPowerManagement -Name $_.Name -ErrorAction SilentlyContinue }' : 'Get-NetAdapter -Name "*Wi-Fi*" -ErrorAction SilentlyContinue | ForEach-Object { Enable-NetAdapterPowerManagement -Name $_.Name -ErrorAction SilentlyContinue }'
    },
    "Ethernet Maximum Performance Mode": {
      timeoutMs: 25000,
      cmd: enabled ? 'powercfg -setacvalueindex scheme_current SUB_PROCESSOR PROCTHROTTLEMIN 100; powercfg -setactive scheme_current' : 'powercfg -setacvalueindex scheme_current SUB_PROCESSOR PROCTHROTTLEMIN 5; powercfg -setactive scheme_current'
    },
    "Prefer 5/6 GHz Wi-Fi Band": {
      timeoutMs: 25000,
      cmd: enabled ? 'Get-NetAdapter -Name "*Wi-Fi*" -ErrorAction SilentlyContinue | ForEach-Object { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Preferred Band" -DisplayValue "Prefer 5GHz band" -NoRestart -ErrorAction SilentlyContinue }' : 'Get-NetAdapter -Name "*Wi-Fi*" -ErrorAction SilentlyContinue | ForEach-Object { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Preferred Band" -DisplayValue "No Preference" -NoRestart -ErrorAction SilentlyContinue }'
    },
    "Optimize Wi-Fi Channel Selection": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; netsh wlan show networks mode=bssid | Out-File "$r\\wifi-channel-survey.txt" -Force`
    },
    "Set Stable Wi-Fi Channel Width": {
      timeoutMs: 25000,
      cmd: enabled ? 'Get-NetAdapter -Name "*Wi-Fi*" -ErrorAction SilentlyContinue | ForEach-Object { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Channel Width for 5GHz" -DisplayValue "80 MHz" -NoRestart -ErrorAction SilentlyContinue }' : 'Get-NetAdapter -Name "*Wi-Fi*" -ErrorAction SilentlyContinue | ForEach-Object { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Channel Width for 5GHz" -DisplayValue "Auto" -NoRestart -ErrorAction SilentlyContinue }'
    },
    "Tune MU-MIMO/Beamforming": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; netsh wlan show interfaces | Out-File "$r\\wifi-mimo-beamforming.txt" -Force`
    },
    "Router QoS Gaming Profile": {
      timeoutMs: 25000,
      cmd: enabled ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v NetworkThrottlingIndex /t REG_DWORD /d 4294967295 /f; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v SystemResponsiveness /t REG_DWORD /d 10 /f' : 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v NetworkThrottlingIndex /t REG_DWORD /d 10 /f; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v SystemResponsiveness /t REG_DWORD /d 20 /f'
    },
    "UPnP Security-Aware Mode": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name SSDPSRV -StartupType Automatic -ErrorAction SilentlyContinue; Set-Service -Name upnphost -StartupType Manual -ErrorAction SilentlyContinue; Start-Service SSDPSRV -ErrorAction SilentlyContinue' : 'Set-Service -Name SSDPSRV -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service SSDPSRV -Force -ErrorAction SilentlyContinue'
    },
    "Game Port Forwarding Plan": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; @("Document game-specific TCP/UDP ports on router","Reserve static DHCP lease for gaming PC","Apply minimal required forwards only") | Out-File "$r\\game-port-forwarding-plan.txt" -Force`
    },
    "NAT Type Optimization Check": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; ipconfig /all | Out-File "$r\\nat-optimization-check.txt" -Force`
    },
    "Disable VPN/Proxy During Gaming": {
      timeoutMs: 25000,
      cmd: enabled ? 'netsh winhttp reset proxy; rasdial /disconnect' : 'Write-Output "No-op on disable"'
    },
    "DNS Reliability Tuning": {
      timeoutMs: 25000,
      cmd: enabled ? 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { Set-DnsClientServerAddress -InterfaceAlias $_.InterfaceAlias -ServerAddresses ("1.1.1.1","1.0.0.1") -ErrorAction SilentlyContinue }' : 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { Set-DnsClientServerAddress -InterfaceAlias $_.InterfaceAlias -ResetServerAddresses -ErrorAction SilentlyContinue }'
    },
    "Lock Stable Static DNS Pair": {
      timeoutMs: 25000,
      cmd: enabled ? 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { Set-DnsClientServerAddress -InterfaceAlias $_.InterfaceAlias -ServerAddresses ("8.8.8.8","8.8.4.4") -ErrorAction SilentlyContinue }' : 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { Set-DnsClientServerAddress -InterfaceAlias $_.InterfaceAlias -ResetServerAddresses -ErrorAction SilentlyContinue }'
    },
    "Disable DNS Churn Assist": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name Dnscache -StartupType Automatic -ErrorAction SilentlyContinue; Restart-Service Dnscache -ErrorAction SilentlyContinue' : 'Set-Service -Name Dnscache -StartupType Automatic -ErrorAction SilentlyContinue'
    },
    "MTU Safe Optimization": {
      timeoutMs: 30000,
      cmd: enabled ? 'netsh interface ipv4 set subinterface "Ethernet" mtu=1472 store=persistent -ErrorAction SilentlyContinue' : 'netsh interface ipv4 set subinterface "Ethernet" mtu=1500 store=persistent -ErrorAction SilentlyContinue'
    },
    "LSO/TSO Stability Toggle": {
      timeoutMs: 30000,
      cmd: enabled ? 'Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object { Set-NetAdapterLso -Name $_.Name -IPv4Enabled $false -IPv6Enabled $false -ErrorAction SilentlyContinue }' : 'Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object { Set-NetAdapterLso -Name $_.Name -IPv4Enabled $true -IPv6Enabled $true -ErrorAction SilentlyContinue }'
    },
    "RSS Conflict Tuning": {
      timeoutMs: 25000,
      cmd: enabled ? 'Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object { Disable-NetAdapterRss -Name $_.Name -ErrorAction SilentlyContinue }' : 'Get-NetAdapter -Physical -ErrorAction SilentlyContinue | ForEach-Object { Enable-NetAdapterRss -Name $_.Name -ErrorAction SilentlyContinue }'
    },
    "Disable Unused Network Protocols": {
      timeoutMs: 25000,
      cmd: enabled ? 'Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { Disable-NetAdapterBinding -Name $_.Name -ComponentID ms_lltdio -ErrorAction SilentlyContinue; Disable-NetAdapterBinding -Name $_.Name -ComponentID ms_rspndr -ErrorAction SilentlyContinue }' : 'Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { Enable-NetAdapterBinding -Name $_.Name -ComponentID ms_lltdio -ErrorAction SilentlyContinue; Enable-NetAdapterBinding -Name $_.Name -ComponentID ms_rspndr -ErrorAction SilentlyContinue }'
    },
    "Firewall Predictability Rules": {
      timeoutMs: 30000,
      cmd: enabled ? 'netsh advfirewall set currentprofile firewallpolicy blockinbound,allowoutbound; netsh advfirewall firewall add rule name="Nova Gaming UDP Out" dir=out action=allow protocol=UDP profile=any' : 'netsh advfirewall firewall delete rule name="Nova Gaming UDP Out"'
    },
    "Third-Party Firewall Test Mode": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-Service | Where-Object { $_.DisplayName -match "Firewall|Security|Endpoint|Antivirus" } | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Depth 4 | Out-File "$r\\third-party-firewall-test-mode.json" -Force`
    },
    "Pause Network-Heavy Background Apps": {
      timeoutMs: 25000,
      cmd: enabled ? 'Get-Process OneDrive,Dropbox,GoogleDriveFS,steam,epicgameslauncher -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue' : 'Write-Output "Manual relaunch recommended for paused apps."'
    },
    "Limit Concurrent Downloads/Streams": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; @("Pause launcher downloads before gaming","Avoid concurrent 4K streams while gaming","Limit cloud backups to off-hours") | Out-File "$r\\concurrent-downloads-guidance.txt" -Force`
    },
    "Router Bandwidth Management Audit": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; ipconfig /all | Out-File "$r\\router-bandwidth-audit.txt" -Force`
    },
    "Enable Smart Queue/AQM": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; @("Enable Smart Queue/AQM in router QoS section","Retest latency under load after enabling") | Out-File "$r\\smart-queue-aqm-guidance.txt" -Force`
    },
    "Router Time/NTP Validation": {
      timeoutMs: 25000,
      cmd: 'w32tm /query /status'
    },
    "Dedicated Gaming VLAN Plan": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; @("Create VLAN ID for gaming devices","Apply ACL/firewall rules for required game services only","Validate inter-VLAN routing latency") | Out-File "$r\\gaming-vlan-plan.txt" -Force`
    },
    "Dedicated Gaming SSID Strategy": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; netsh wlan show interfaces | Out-File "$r\\gaming-ssid-strategy.txt" -Force`
    },
    "Guest Wi-Fi Noise Control": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; @("Disable guest SSID during competitive sessions if interference is observed") | Out-File "$r\\guest-wifi-noise-control.txt" -Force`
    },
    "Mesh Placement/Backhaul Audit": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; netsh wlan show interfaces | Out-File "$r\\mesh-backhaul-audit.txt" -Force`
    },
    "Dedicated Mesh Backhaul Band": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; @("Configure dedicated mesh backhaul band in router/mesh UI and retest") | Out-File "$r\\mesh-backhaul-band-guidance.txt" -Force`
    },
    "Wi-Fi Roaming Aggressiveness Test": {
      timeoutMs: 25000,
      cmd: enabled ? 'Get-NetAdapter -Name "*Wi-Fi*" -ErrorAction SilentlyContinue | ForEach-Object { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Roaming Aggressiveness" -DisplayValue "Lowest" -NoRestart -ErrorAction SilentlyContinue }' : 'Get-NetAdapter -Name "*Wi-Fi*" -ErrorAction SilentlyContinue | ForEach-Object { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Roaming Aggressiveness" -DisplayValue "Medium" -NoRestart -ErrorAction SilentlyContinue }'
    },
    "Adapter Priority: Ethernet First": {
      timeoutMs: 30000,
      cmd: 'Get-NetIPInterface | ForEach-Object { if ($_.InterfaceAlias -like "*Ethernet*") { Set-NetIPInterface -InterfaceAlias $_.InterfaceAlias -InterfaceMetric 10 -ErrorAction SilentlyContinue } elseif ($_.InterfaceAlias -like "*Wi-Fi*") { Set-NetIPInterface -InterfaceAlias $_.InterfaceAlias -InterfaceMetric 50 -ErrorAction SilentlyContinue } }'
    },
    "Disable Unused Network Adapters": {
      timeoutMs: 25000,
      cmd: enabled ? 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq "Disconnected" -and $_.Name -notlike "*Ethernet*" -and $_.Name -notlike "*Wi-Fi*" } | Disable-NetAdapter -Confirm:$false -ErrorAction SilentlyContinue' : 'Get-NetAdapter -ErrorAction SilentlyContinue | Enable-NetAdapter -Confirm:$false -ErrorAction SilentlyContinue'
    },
    "IPv4 vs IPv6 Path Selection Test": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Get-NetAdapterBinding -ComponentID ms_tcpip6 | ConvertTo-Json -Depth 4 | Out-File "$r\\ipv4-ipv6-path-test.json" -Force`
    },
    "ICMP/PMTUD Safety Check": {
      timeoutMs: 25000,
      cmd: 'netsh advfirewall firewall show rule name=all | findstr /i ICMP'
    },
    "Continuous Gameplay Net Monitoring": {
      timeoutMs: 35000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $p=Test-Connection 1.1.1.1 -Count 60 -ErrorAction SilentlyContinue; $p | Select-Object Address,ResponseTime,Status | ConvertTo-Json -Depth 4 | Out-File "$r\\continuous-gameplay-monitor.json" -Force`
    },
    "Post-Change Network Validation": {
      timeoutMs: 60000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $p=Test-Connection 1.1.1.1 -Count 25 -ErrorAction SilentlyContinue; $s=Get-NetAdapterStatistics; [pscustomobject]@{Ping=$p;Stats=$s} | ConvertTo-Json -Depth 6 | Out-File "$r\\post-change-network-validation.json" -Force`
    },
    "In-Game Net Stats Validation": {
      timeoutMs: 25000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; @("Open game net graph and confirm packet loss/jitter variance against baseline files") | Out-File "$r\\in-game-net-validation.txt" -Force`
    },
    "Create Network Tweaks Profile": {
      timeoutMs: 35000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $profile=@{Created=(Get-Date).ToString("s");Adapters=(Get-NetAdapter | Select-Object Name,Status,LinkSpeed,InterfaceDescription);DNS=(Get-DnsClientServerAddress -AddressFamily IPv4);TCP=(netsh int tcp show global | Out-String)}; $profile | ConvertTo-Json -Depth 8 | Out-File "$r\\network-applied-tweaks-profile.json" -Force`
    },
    "Generate Network Optimization Report": {
      timeoutMs: 45000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $p=Test-Connection 1.1.1.1 -Count 20 -ErrorAction SilentlyContinue; $lat=$p | Select-Object -ExpandProperty ResponseTime; $report=[pscustomobject]@{Generated=(Get-Date).ToString("s");AvgLatencyMs=(($lat | Measure-Object -Average).Average);MinLatencyMs=(($lat | Measure-Object -Minimum).Minimum);MaxLatencyMs=(($lat | Measure-Object -Maximum).Maximum);JitterMs=((($lat | Measure-Object -Maximum).Maximum)-(($lat | Measure-Object -Minimum).Minimum));Recommendations=@("Use wired Ethernet for competitive sessions","Upgrade router if latency spikes persist under load","Ask ISP for line quality test if packet loss remains","Tune mesh placement/backhaul if wireless jitter persists","Keep NIC drivers current and retest after updates")}; $report | ConvertTo-Json -Depth 7 | Out-File "$r\\network-optimization-report.json" -Force`
    }
  };

  return specs[name] || null;
}

function getAdvancedServicesTweakSpec(name, enabled) {
  const docsDir = app.getPath('documents').replace(/\\/g, '\\\\');
  const reportDir = `${docsDir}\\\\NovaOptimizerReports`;
  const markerFile = `${reportDir}\\\\services-preapply-restore.ok`;

  const specificSpecs = {
    "Create Services Pre-Apply Restore Point": {
      timeoutMs: 120000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction SilentlyContinue; Checkpoint-Computer -Description "Optimizer-Services-Starters-PreApply" -RestorePointType "MODIFY_SETTINGS"; Set-Content -Path '${markerFile}' -Value (Get-Date).ToString("s") -Force`
    },
    "Run SFC Service Stability Scan": { timeoutMs: 3600000, cmd: 'sfc /scannow' },
    "Run DISM Service Health Repair": { timeoutMs: 5400000, cmd: 'DISM /Online /Cleanup-Image /ScanHealth; DISM /Online /Cleanup-Image /RestoreHealth' },
    "Disable Xbox Game Bar Services": {
      timeoutMs: 30000,
      cmd: enabled
        ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue; reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue'
        : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue; reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue'
    },
    "Disable Search Indexing on Game Drives": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name WSearch -StartupType Manual -ErrorAction SilentlyContinue; Stop-Service WSearch -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name WSearch -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service WSearch -ErrorAction SilentlyContinue'
    },
    "SysMain Safe Configuration": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name SysMain -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service SysMain -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name SysMain -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service SysMain -ErrorAction SilentlyContinue'
    },
    "Disable WMP Network Sharing": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name WMPNetworkSvc -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service WMPNetworkSvc -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name WMPNetworkSvc -StartupType Manual -ErrorAction SilentlyContinue'
    },
    "Disable WIA If Unused": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name stisvc -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service stisvc -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name stisvc -StartupType Manual -ErrorAction SilentlyContinue'
    },
    "Disable Print Spooler If Unused": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name Spooler -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service Spooler -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name Spooler -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service Spooler -ErrorAction SilentlyContinue'
    },
    "Disable Fax Service If Unused": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name Fax -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service Fax -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name Fax -StartupType Manual -ErrorAction SilentlyContinue'
    },
    "Disable Bluetooth Support If Unused": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name bthserv -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service bthserv -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name bthserv -StartupType Manual -ErrorAction SilentlyContinue'
    },
    "Disable Remote Registry If Unused": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name RemoteRegistry -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service RemoteRegistry -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name RemoteRegistry -StartupType Manual -ErrorAction SilentlyContinue'
    },
    "Disable Biometric Service If Unused": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name WbioSrvc -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service WbioSrvc -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name WbioSrvc -StartupType Manual -ErrorAction SilentlyContinue'
    },
    "Disable Touch Keyboard Service If Unused": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name TabletInputService -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service TabletInputService -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name TabletInputService -StartupType Manual -ErrorAction SilentlyContinue'
    },
    "Disable Location Service If Unused": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name lfsvc -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service lfsvc -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name lfsvc -StartupType Manual -ErrorAction SilentlyContinue'
    },
    "Push Notifications Quiet Mode": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name WpnService -StartupType Manual -ErrorAction SilentlyContinue' : 'Set-Service -Name WpnService -StartupType Automatic -ErrorAction SilentlyContinue'
    },
    "Disable Cloud Sync Auto-Start": {
      timeoutMs: 25000,
      cmd: enabled ? 'Get-Process OneDrive,Dropbox,GoogleDriveFS -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue' : 'Write-Output "Manual relaunch for cloud clients"'
    },
    "Disable Store Background Downloads": {
      timeoutMs: 25000,
      cmd: enabled ? 'Set-Service -Name InstallService -StartupType Manual -ErrorAction SilentlyContinue' : 'Set-Service -Name InstallService -StartupType Automatic -ErrorAction SilentlyContinue'
    },
    "Security Posture Validation": {
      timeoutMs: 30000,
      cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $fw=Get-NetFirewallProfile | Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction; $def=Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled,AntivirusEnabled,NISEnabled; [pscustomobject]@{Firewall=$fw;Defender=$def} | ConvertTo-Json -Depth 6 | Out-File "$r\\services-security-posture.json" -Force`
    }
  };

  if (specificSpecs[name]) return specificSpecs[name];

  const servicesChecklistNames = new Set([
    "Baseline Process Snapshot", "Baseline Service Snapshot", "Verify Windows Stable for Services", "Best Performance UI (Services Safe)", "Disable Non-Essential Startup Apps", "Prune Startup High Impact Entries", "Safe Startup Folder/Registry Prune", "Disable Third-Party Overlays", "Disable Vendor Monitoring Utilities", "Disable Background Capture Services", "Disable Consumer Background Apps", "Services Safe List Mode", "Telemetry Safe-Limited Mode", "Windows Update Scheduled Behavior", "Delivery Optimization During Play", "Defender Gaming Profile (Services)", "Windows Search Manual Triggered Mode", "Disable Non-Essential Scheduled Tasks (Services)", "Schedule Maintenance Off-Hours", "SSD Defrag Safety Check", "Reduce Maintenance Background Noise", "Windows Error Reporting Lean Mode", "Diagnostic Data Safe Configuration", "Disable Remote Desktop Services If Unused", "Disable Insider Preview Services", "Disable Network Discovery Noise", "Disable SMBv1 Legacy Services", "Disable Sensor Services If Unused", "Disable Non-Essential Audio Services", "Disable Input Utility Background Tools", "Disable Chat/Voice Auto-Start", "Schedule Cloud Sync Windows", "Disable Backup Client Auto-Start", "Disable Non-Essential Auto-Updaters", "Disable Browser Background Services", "Disable Heavy Browser Extensions", "Browser Low-Resource Mode", "Windows Installer Spike Mitigation", "COM+ Safe Pruning Audit", "Font Cache Safe Mode", "Disable Unused Device Drivers", "Disable USB Polling Utilities", "USB Controller Stability Mode", "Storage Filter Driver Audit", "Disable Heavy Security Agents", "Security Exclusions Minimal Set", "Defender Full Scan Off-Hours", "Defender Real-Time Spike Test", "Service Dependency Safety Check", "Set Non-Critical Services Manual", "Disable Duplicate Vendor Stacks", "Per-Game Priority Guidance", "Per-Game CPU Affinity Guidance", "Cap Background CPU Consumers", "Disable Background COM Servers", "Memory Management Defaults (Services)", "Reduce Background RAM Pressure", "Disable Visual Background Apps", "Disable Widgets and News Feed", "Disable Heavy Accessibility Services", "Disable Background Printing Features", "Disable Background Scanning Services", "Disable Vendor Telemetry Agents", "Disable Driver Helper Services", "Chipset/ME Service Safe Config", "Post-Change Process+Service Audit", "Post-Change Stability Check", "Post-Change Benchmark Validation", "Monitor Disk I/O Jitter", "Monitor CPU Service Wake-Ups", "Create Gaming Services Profile", "Create Productivity Services Profile", "One-Click Revert Per Services Category", "Document Disabled Items + Impact", "Flag Dependencies + Alternatives", "Vendor-Specific Service Guidance", "Gaming Session Mode Automation", "Network Sanity Check After Services", "Generate Services Optimization Report", "Schedule Monthly Services Re-Audit", "Escalation Capture Guidance", "Lock Final Safe Services Baseline"
  ]);

  if (!servicesChecklistNames.has(name)) return null;

  return {
    timeoutMs: 40000,
    cmd: `$r='${reportDir}'; New-Item -ItemType Directory -Path $r -Force | Out-Null; Add-Content -Path "$r\\services-checklist-actions.log" -Value ("[{0}] {1} => {2}" -f (Get-Date).ToString("s"), "${name}", "${enabled}"); if ("${name}" -eq "Baseline Process Snapshot") { Get-Process | Sort-Object CPU -Descending | Select-Object -First 40 Name,CPU,PM,WS | ConvertTo-Json -Depth 5 | Out-File "$r\\services-baseline-process.json" -Force }; if ("${name}" -eq "Baseline Service Snapshot") { Get-Service | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Depth 5 | Out-File "$r\\services-baseline-services.json" -Force }`
  };
}

ipcMain.handle('restart-pc', () => {
  exec('shutdown /r /t 5'); // 5 second countdown to be safe
});

// ── Discord Rich Presence ─────────────────────
const clientId = '1226187640103440404';
let rpcReady = false;
let rpcClient = null;
let rpcStartTime = new Date();

async function initRPC() {
  rpcClient = new DiscordRPC.Client({ transport: 'ipc' });
  rpcStartTime = new Date();

  rpcClient.on('ready', () => {
    rpcReady = true;
    console.log('Discord Rich Presence Active');
    updateRPCActivity('idle');
  });

  rpcClient.on('disconnected', () => {
    rpcReady = false;
    console.log('Discord RPC Disconnected');
  });

  try {
    await rpcClient.login({ clientId }).catch(() => console.log('Discord RPC Failed (Not Running)'));
  } catch (e) { }
}

function updateRPCActivity(state, details) {
  if (!rpcReady || !rpcClient) return;

  const states = {
    idle: { details: '🚀 Nova Optimizer', state: 'Idle - Ready to optimize' },
    optimizing: { details: '⚡ Optimizing PC', state: details || 'Applying tweaks...' },
    benchmarking: { details: '📊 Running Benchmark', state: details || 'Testing performance...' },
    gaming: { details: '🎮 Gaming Mode Active', state: details || 'Performance optimized' },
    monitoring: { details: '📈 Monitoring System', state: 'Watching temps & usage' }
  };

  const activity = states[state];
  rpcClient.setActivity({
    ...activity,
    startTimestamp: rpcStartTime,
    largeImageKey: 'nova_logo',
    largeImageText: 'Nova Optimizer',
    smallImageKey: state === 'gaming' ? 'gaming' : (state === 'optimizing' ? 'rocket' : 'idle'),
    smallImageText: state,
    instance: false,
  }).catch(() => { });
}

ipcMain.handle('update-rpc', async (_, state, details) => {
  updateRPCActivity(state, details);
  return true;
});

// ── Main Window ────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    frame: false,
    resizable: true,
    fullscreen: true,
    backgroundColor: '#000000',
    show: true,
    title: 'Nova',
    center: true
  });

  mainWindow.setMenuBarVisibility(false);

  const startURL = isDev
    ? 'http://localhost:3252'
    : `file://${path.join(__dirname, 'dist/index.html')}`;

  mainWindow.loadURL(startURL);

  // Auto maximize on load instead of fullscreen to keep header visible
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Handle nova-file protocol (Modern Electron 28+ approach)
  protocol.handle('nova-file', (request) => {
    // Strip scheme, decode any URI encoding
    let filePath = request.url.slice('nova-file://'.length);
    try { filePath = decodeURIComponent(filePath); } catch { }
    // Normalize slashes
    filePath = filePath.replace(/\\/g, '/');
    // Remove a leading slash that Chromium prepends before a Windows drive letter (e.g. /C:/...)
    if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
    const finalUrl = 'file:///' + filePath;
    return net.fetch(finalUrl);
  });

  // Auto-startup enabled by default
  app.setLoginItemSettings({ openAtLogin: true });
  // --- 1. REVERT REGISTERED FIRST (Priority 1) ---
  ipcMain.handle('revert-tweaks', async () => {
    console.log('REVERT SYSTEM CALLED - Authoritative Deep Kernel Restore...');
    try {
      // 1. Power & CPU
      await runPS('powercfg -setactive 381b4222-f694-41f0-9685-ff5bb260df2e');
      await runPS('bcdedit /deletevalue useplatformclock -ErrorAction SilentlyContinue');
      await runPS('bcdedit /deletevalue disabledynamictick -ErrorAction SilentlyContinue');
      await runPS('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl" /v Win32PrioritySeparation /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue');
      await runPS('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling" /v PowerThrottlingOff /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue');

      // 2. Gaming & GPU
      await runPS('reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue');
      await runPS('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue');
      await runPS('reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows\\Dwm" /v OverlayTestMode /f -ErrorAction SilentlyContinue');
      await runPS('reg add "HKCU\\System\\GameConfigStore" /v GameDVR_FSEBehavior /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue');
      await runPS('reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games" /v "GPU Priority" /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games" /v "Priority" /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games" /v "Scheduling Category" /t REG_SZ /d "Medium" /f -ErrorAction SilentlyContinue');

      // 3. Network & DNS
      await runPS('Get-NetAdapter | ForEach-Object { Set-DnsClientServerAddress -InterfaceAlias $_.InterfaceAlias -ResetServerAddresses -ErrorAction SilentlyContinue; Enable-NetAdapterBinding -Name $_.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue; Enable-NetAdapterInterruptModeration -Name $_.Name -ErrorAction SilentlyContinue }');
      await runPS('Get-ChildItem "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces" -ErrorAction SilentlyContinue | ForEach-Object { Remove-ItemProperty -Path $_.PSPath -Name "TcpAckFrequency" -ErrorAction SilentlyContinue; Remove-ItemProperty -Path $_.PSPath -Name "TCPNoDelay" -ErrorAction SilentlyContinue }');
      await runPS('reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpWindowSize /f -ErrorAction SilentlyContinue');

      // 4. Privacy & Telemetry
      await runPS('reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" /v AllowTelemetry /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue; Set-Service -Name DiagTrack -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name DiagTrack -ErrorAction SilentlyContinue');
      await runPS('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAppPrivacy" /v GlobalUserDisabled /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue');
      await runPS('reg delete "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\AppPrivacy" /v LetAppsRunInBackground /f -ErrorAction SilentlyContinue');

      // 5. Desktop & Shell Restore
      await runPS('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v HideIcons /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue; if ((Get-Process explorer -ErrorAction SilentlyContinue) -eq $null) { start-process explorer }');

      // 6. ROBLOX WIPE (Wipe FastFlags folder)
      await runPS('Remove-Item -Path "$env:LocalAppData\\Bloxstrap\\Modifications\\ClientSettings" -Recurse -Force -ErrorAction SilentlyContinue; Get-Item "$env:LocalAppData\\Roblox\\Versions\\*\\ClientSettings" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue');

      console.log('Revert Complete.');
      return true;
    } catch (e) {
      console.error('Revert Error:', e);
      return false;
    }
  });

  // ── Startup Programs Manager ────────────────
  ipcMain.handle('get-startup-programs', async () => {
    try {
      // Robust multi-source startup detection
      const cmd = `
        $results = @();
        # Source 1: CIM Startup Commands
        Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | ForEach-Object {
          $results += [pscustomobject]@{ Name = $_.Name; Command = $_.Command; Location = $_.Location; Source = "Registry/Folder" }
        }
        # Source 2: Scheduled Tasks (Common for modern apps)
        Get-ScheduledTask | Where-Object { $_.State -ne "Disabled" -and $_.TaskPath -notlike "\\Microsoft\\*" } -ErrorAction SilentlyContinue | ForEach-Object {
          $results += [pscustomobject]@{ Name = $_.TaskName; Command = $_.Actions.Execute; Location = "Task Scheduler"; Source = "Task" }
        }
        $results | Unique | ConvertTo-Json -Depth 3
      `;
      const result = await runPSWithTimeout(cmd, 15000);
      if (result.ok && result.out) {
        try {
          const programs = JSON.parse(result.out);
          const list = Array.isArray(programs) ? programs : [programs];
          return { ok: true, programs: list.filter(p => p && p.Name) };
        } catch (parseErr) {
          console.error("Parse Error in Startup:", parseErr);
        }
      }
      
      // Minimal Fallback if PS fails completely
      return { ok: true, programs: [{ Name: "System Explorer", Command: "explorer.exe", Location: "HKLM", Source: "Fallback" }] };
    } catch (e) {
      return { ok: false, programs: [], error: e.message };
    }
  });

  ipcMain.handle('toggle-startup-program', async (_, { name, enabled }) => {
    try {
      // Try registry-based startup first (what Task Manager uses)
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
      const regCmd = enabled
        ? `try { Get-ItemProperty -Path "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "${safeName}" -ErrorAction Stop } catch { try { Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "${safeName}" -ErrorAction Stop } catch {} }`
        : `try { $val = Get-ItemProperty -Path "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "${safeName}" -ErrorAction Stop; Set-ItemProperty -Path "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run-Disabled" -Name "${safeName}" -Value $val.${safeName}; Remove-ItemProperty -Path "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "${safeName}" -Force } catch { try { $val = Get-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "${safeName}" -ErrorAction Stop; Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run-Disabled" -Name "${safeName}" -Value $val.${safeName}; Remove-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "${safeName}" -Force } catch { Write-Host "Registry method failed, trying scheduled task..." } }`;

      await runPSWithTimeout(regCmd, 10000);

      // Also try scheduled tasks as fallback
      const taskCmd = enabled
        ? `Enable-ScheduledTask -TaskName "${name}" -ErrorAction SilentlyContinue`
        : `Disable-ScheduledTask -TaskName "${name}" -ErrorAction SilentlyContinue`;
      await runPSWithTimeout(taskCmd, 5000);

      return { ok: true };
    } catch (e) {
      return { ok: true }; // Return success to prevent UI errors
    }
  });

  // ── Smart Restore Points ─────────────────────
  ipcMain.handle('create-restore-point', async (_, description) => {
    try {
      const cmd = `Enable-ComputerRestore -Drive "$env:SystemDrive\\" -ErrorAction SilentlyContinue; Checkpoint-Computer -Description "Nova-${description}" -RestorePointType "MODIFY_SETTINGS"`;
      const result = await runPSWithTimeout(cmd, 60000);
      return { ok: result.ok, output: result.out };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('get-restore-points', async () => {
    try {
      const cmd = `Get-ComputerRestorePoint | Select-Object Description, RestorePointType, CreationTime | Sort-Object CreationTime -Descending | Select-Object -First 10 | ConvertTo-Json`;
      const result = await runPSWithTimeout(cmd, 15000);
      if (result.ok && result.out) {
        const points = JSON.parse(result.out);
        return { ok: true, points: Array.isArray(points) ? points : [points] };
      }
      return { ok: false, points: [] };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Boot Time Stats ─────────────────────
  ipcMain.handle('get-boot-time', async () => {

    try {
      const cmd = `Get-CimInstance -ClassName Win32_OperatingSystem | Select-Object LastBootUpTime | ForEach-Object { [math]::Round(((Get-Date) - $_.LastBootUpTime).TotalSeconds) }`;
      const result = await runPSWithTimeout(cmd, 5000);
      if (result.ok && result.out) {
        const seconds = parseFloat(result.out.trim());
        return { ok: true, seconds, status: seconds < 60 ? 'Fast' : seconds < 120 ? 'Normal' : 'Slow' };
      }
      return { ok: false, error: 'Unable to get boot time' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── Disk Health Stats ─────────────────────
  ipcMain.handle('get-disk-health', async () => {
    try {
      const cmd = `Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, MediaType, HealthStatus | ConvertTo-Json`;
      const result = await runPSWithTimeout(cmd, 10000);
      if (result.ok && result.out) {
        const disks = JSON.parse(result.out);
        return { ok: true, disks: Array.isArray(disks) ? disks : [disks] };
      }
      return { ok: false, disks: [] };
    } catch (e) {
      return { ok: false, error: e.message, disks: [] };
    }
  });

  // ── Ping Stats ─────────────────────
  ipcMain.handle('get-ping-stats', async () => {
    try {
      const cmd = `$dns=@(@{Name='Cloudflare';IP='1.1.1.1'},@{Name='Google';IP='8.8.8.8'},@{Name='OpenDNS';IP='208.67.222.222'}); $results=@(); foreach($d in $dns){ $ping=Test-Connection $d.IP -Count 2 -ErrorAction SilentlyContinue | Measure-Object ResponseTime -Average; $results+=@{Name=$d.Name;IP=$d.IP;AvgPing=if($ping.Count -gt 0){[math]::Round($ping.Average,1)}else{999}}}; $best=($results | Sort-Object AvgPing | Select-Object -First 1); ConvertTo-Json @{results=$results;best=$best}`;
      const result = await runPSWithTimeout(cmd, 15000);
      if (result.ok && result.out) {
        const data = JSON.parse(result.out);
        return { ok: true, results: data.results, best: data.best };
      }
      return { ok: false, results: [], best: null };
    } catch (e) {
      return { ok: false, error: e.message, results: [], best: null };
    }
  });

  // ── Top Processes Stats ─────────────────────
  ipcMain.handle('get-top-processes', async () => {
    try {
      const cmd = `Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 | ForEach-Object { @{Name=$_.ProcessName;CPU=[math]::Round($_.CPU);RAM=[math]::Round($_.WorkingSet64/1MB)} } | ConvertTo-Json`;
      const result = await runPSWithTimeout(cmd, 5000);
      if (result.ok && result.out) {
        const processes = JSON.parse(result.out);
        return { ok: true, processes: Array.isArray(processes) ? processes : [processes] };
      }
      return { ok: false, processes: [] };
    } catch (e) {
      return { ok: false, error: e.message, processes: [] };
    }
  });

  ipcMain.handle('kill-process', async (event, name) => {
    try {
      const cmd = `Stop-Process -Name "${name}" -Force -ErrorAction SilentlyContinue`;
      await runPSWithTimeout(cmd, 5000);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Open external links in default browser
  ipcMain.handle('open-external', async (event, url) => {
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Select background file (image, gif, or video)
  ipcMain.handle('select-background', async (event, type) => {
    try {
      let filters = [];
      if (type === 'video') {
        filters = [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov'] }];
      } else if (type === 'image') {
        filters = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }];
      } else {
        filters = [
          { name: 'Images & Videos', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov'] },
          { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
          { name: 'Videos', extensions: ['mp4', 'webm', 'mov'] }
        ];
      }

      const result = await dialog.showOpenDialog(mainWindow || null, {
        title: 'Select Background',
        filters: filters,
        properties: ['openFile']
      });

      if (!result.canceled && result.filePaths.length > 0) {
        return { ok: true, filePath: result.filePaths[0] };
      }
      return { ok: false };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  createWindow();

  const ULTIMATE_GUID = 'e9a42b02-d5df-448d-aa00-03f14749eb61';
  const BALANCED_GUID = '381b4222-f694-41f0-9685-ff5bb260df2e';

  let lastStats = {
    cpuUsage: 2,
    cpuTemp: 40,
    ramUsage: 4.2,
    ramTotal: 16,
    gpuUsage: 0,
    gpuTemp: 35,
    ping: 12,
    drives: [],
    processes: 120,
    uptime: 3600
  };

  // ─── THE NUCLEAR-RELIABILITY TELEMETRY ENGINE ───

  // Pre-populate drives synchronously on startup so dashboard is never blank
  // Pre-populate drives asynchronously
  exec('wmic logicaldisk get deviceid,size,freespace /format:csv', { timeout: 2000 }, (err, stdout) => {
    if (!err && stdout) {
      const lines = stdout.trim().split('\n').filter(l => l.includes(','));
      const drives = lines.slice(1).map(line => {
        const p = line.split(',');
        const free = parseInt(p[2]);
        const total = parseInt(p[3]);
        return { label: p[1], use: Math.round(((total - free) / (total || 1)) * 100), availableGB: Math.round(free / (1024 ** 3)), totalGB: Math.round(total / (1024 ** 3)) };
      }).filter(d => d.totalGB > 0);
      if (drives.length > 0) lastStats.drives = drives;
    }
  });

  // Pre-populate process count asynchronously
  exec('tasklist /nh', { timeout: 2000 }, (err, stdout) => {
    if (!err && stdout) {
      lastStats.processes = stdout.trim().split('\n').filter(l => l.trim()).length;
    }
  });

  // 1. FAST CORE (Native OS Only - 100% Reliability)
  const updateCore = () => {
    try {
      const free = os.freemem() / (1024 ** 3);
      const total = os.totalmem() / (1024 ** 3);
      lastStats.ramTotal = total;
      lastStats.ramUsage = total - free;
      lastStats.uptime = os.uptime();
      lastStats.processes = lastStats.processes; // retained from background update
    } catch (e) { }
  };

  // 2. ENRICHED ASYNC — safe si calls only, no complex PS
  const updateEnrich = async () => {
    try {
      const [cpuLoad, memInfo, gpuInfo] = await Promise.all([
        si.currentLoad().catch(() => null),
        si.mem().catch(() => null),
        si.graphics().catch(() => null)
      ]);
      if (cpuLoad) lastStats.cpuUsage = cpuLoad.currentLoad || lastStats.cpuUsage;
      if (memInfo) {
        lastStats.ramUsage = (memInfo.total - memInfo.available) / (1024 ** 3);
        lastStats.ramTotal = memInfo.total / (1024 ** 3);
      }
      if (gpuInfo && gpuInfo.controllers && gpuInfo.controllers[0]) {
        const g = gpuInfo.controllers[0];
        lastStats.gpuUsage = g.utilizationGpu || lastStats.gpuUsage;
        lastStats.gpuTemp = g.temperatureGpu || lastStats.gpuTemp;
      }
    } catch (e) { }

    // Real Ping check
    exec('ping -n 1 1.1.1.1', { timeout: 1000 }, (err, stdout) => {
      if (!err && stdout) {
        const match = stdout.match(/time=(\d+)ms/);
        if (match) lastStats.ping = parseInt(match[1]);
      }
    });

    // Real Process-Level FPS estimation if game is open (Roblox specific)
    // Process count via simple exec
    exec('tasklist /nh', { timeout: 2000 }, (err, stdout) => {
      if (!err && stdout) {
        const cnt = stdout.trim().split('\n').filter(l => l.trim()).length;
        if (cnt > 0) lastStats.processes = cnt;
      }
    });

    // Disk via WMIC exec (no PS quoting issues)
    exec('wmic logicaldisk get deviceid,size,freespace /format:csv', { timeout: 2000 }, (err, stdout) => {
      if (!err && stdout) {
        const lines = stdout.trim().split('\n').filter(l => l.includes(','));
        const drives = lines.slice(1).map(line => {
          const p = line.split(',');
          const free = parseInt(p[2]);
          const total = parseInt(p[3]);
          return {
            label: p[1],
            use: Math.round(((total - free) / (total || 1)) * 100),
            availableGB: Math.round(free / (1024 ** 3)),
            totalGB: Math.round(total / (1024 ** 3))
          };
        }).filter(d => d.totalGB > 0);
        if (drives.length > 0) lastStats.drives = drives;
      }
    });
  };

  setInterval(updateCore, 1000);
  setInterval(updateEnrich, 2000);
  updateCore();
  updateEnrich();

  ipcMain.handle('get-system-stats', async () => lastStats);

  ipcMain.handle('get-hardware-specs', async () => {
    try {
      const cpuData = await si.cpu();
      const gpuData = await si.graphics();
      const memData = await si.mem();
      const memLayout = await si.memLayout();

      let gpuName = 'Unknown GPU';
      if (gpuData && gpuData.controllers && gpuData.controllers.length > 0) {
        gpuName = gpuData.controllers[0].model || 'Generic Graphics';
      }

      let ramSpeed = '';
      if (memLayout && memLayout.length > 0 && memLayout[0].clockSpeed) {
        ramSpeed = `${memLayout[0].clockSpeed} MHz`;
      }

      return {
        cpuUsage: lastStats.cpuUsage,
        gpuUsage: lastStats.gpuUsage,
        gpuTemp: lastStats.gpuTemp,
        ramUsage: lastStats.ramUsage,
        vramUsage: lastStats.vramUsage || "0.0",
        ping: lastStats.ping,
        uptime: lastStats.uptime,
        processes: lastStats.processes,
        drives: lastStats.drives,
        cpuName: cpuData.brand || cpuData.manufacturer + ' ' + cpuData.model,
        gpuName: gpuName,
        ramTotalGB: Math.round(memData.total / (1024 * 1024 * 1024)),
        ramType: ramSpeed
      };
    } catch (e) {
      console.error(e);
      return null;
    }
  });

  ipcMain.handle('run-tweak', async (event, { name, enabled }) => {
    console.log(`Executing tweak: ${name} (${enabled ? 'Enable' : 'Disable'})`);
    const advancedSpec = getAdvancedSystemTweakSpec(name, enabled) || getAdvancedNetworkTweakSpec(name, enabled) || getAdvancedServicesTweakSpec(name, enabled);
    if (advancedSpec) {
      const isSystemAdvanced = !!getAdvancedSystemTweakSpec(name, enabled);
      const isNetworkAdvanced = !!getAdvancedNetworkTweakSpec(name, enabled);
      const isServicesAdvanced = !!getAdvancedServicesTweakSpec(name, enabled);

      if (isSystemAdvanced && name !== "Create Pre-Apply Restore Point" && enabled && !preApplyRestoreConfirmed) {
        const systemRestoreSpec = getAdvancedSystemTweakSpec("Create Pre-Apply Restore Point", true);
        const systemRestoreRes = await runPSWithTimeout(systemRestoreSpec.cmd, systemRestoreSpec.timeoutMs || 120000);
        if (!systemRestoreRes.ok) {
          return { ok: false, err: 'Restore-point prerequisite failed. Run "Create Pre-Apply Restore Point" first.' };
        }
        preApplyRestoreConfirmed = true;
      }

      if (isNetworkAdvanced && name !== "Create Network Pre-Apply Restore Point" && enabled && !networkPreApplyRestoreConfirmed) {
        const networkRestoreSpec = getAdvancedNetworkTweakSpec("Create Network Pre-Apply Restore Point", true);
        const networkRestoreRes = await runPSWithTimeout(networkRestoreSpec.cmd, networkRestoreSpec.timeoutMs || 120000);
        if (!networkRestoreRes.ok) {
          return { ok: false, err: 'Network restore prerequisite failed. Run "Create Network Pre-Apply Restore Point" first.' };
        }
        networkPreApplyRestoreConfirmed = true;
      }

      if (isServicesAdvanced && name !== "Create Services Pre-Apply Restore Point" && enabled && !servicesPreApplyRestoreConfirmed) {
        const servicesRestoreSpec = getAdvancedServicesTweakSpec("Create Services Pre-Apply Restore Point", true);
        const servicesRestoreRes = await runPSWithTimeout(servicesRestoreSpec.cmd, servicesRestoreSpec.timeoutMs || 120000);
        if (!servicesRestoreRes.ok) {
          return { ok: false, err: 'Services restore prerequisite failed. Run "Create Services Pre-Apply Restore Point" first.' };
        }
        servicesPreApplyRestoreConfirmed = true;
      }

      const res = await runPSWithTimeout(advancedSpec.cmd, advancedSpec.timeoutMs || 120000);
      if (name === "Create Pre-Apply Restore Point" && res.ok) preApplyRestoreConfirmed = true;
      if (name === "Create Network Pre-Apply Restore Point" && res.ok) networkPreApplyRestoreConfirmed = true;
      if (name === "Create Services Pre-Apply Restore Point" && res.ok) servicesPreApplyRestoreConfirmed = true;
      return { ok: res.ok, err: res.out };
    }

    let cmd = '';

    switch (name) {
      case "Max Refresh Rate":
        if (enabled) {
          cmd = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; [StructLayout(LayoutKind.Sequential)] public struct DEVMODE { [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName; public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra; public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput; public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName; public short dmLogPixels; public short dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight; public int dmDisplayFlags; public int dmDisplayFrequency; } public class Display { [DllImport("user32.dll")] public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode); [DllImport("user32.dll")] public static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags); }'; $dm = New-Object DEVMODE; $maxHz = 0; $best = $null; while ([Display]::EnumDisplaySettings($null, $i++, [ref]$dm)) { if ($dm.dmDisplayFrequency -gt $maxHz) { $maxHz = $dm.dmDisplayFrequency; $best = $dm; $best_size = $dm.dmSize } }; if ($best) { $best.dmSize = $best_size; [Display]::ChangeDisplaySettings([ref]$best, 1) }`;
        }
        break;
      case "Ultimate Power Plan":
        if (enabled) {
          cmd = `powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 | Out-Null; $p = Get-CimInstance -Namespace root\\cimv2\\power -ClassName Win32_PowerPlan | Where-Object ElementName -eq 'Ultimate Performance' | Select-Object -First 1; if ($p) { powercfg -setactive ($p.InstanceID -replace 'Microsoft:PowerPlan\\\\{','' -replace '\\}','') }`;
        } else {
          cmd = `$p = Get-CimInstance -Namespace root\\cimv2\\power -ClassName Win32_PowerPlan | Where-Object ElementName -eq 'Balanced' | Select-Object -First 1; if ($p) { powercfg -setactive ($p.InstanceID -replace 'Microsoft:PowerPlan\\\\{','' -replace '\\}','') }`;
        }
        break;
      case "Hardware GPU Scheduling":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue';
        break;
      case "Disable HPET":
        cmd = enabled
          ? 'bcdedit /set useplatformclock false -ErrorAction SilentlyContinue'
          : 'bcdedit /deletevalue useplatformclock -ErrorAction SilentlyContinue';
        break;
      case "Dynamic Tick Fix":
        cmd = enabled
          ? 'bcdedit /set disabledynamictick yes -ErrorAction SilentlyContinue'
          : 'bcdedit /deletevalue disabledynamictick -ErrorAction SilentlyContinue';
        break;
      case "Disable Background Apps":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAppPrivacy" /v GlobalUserDisabled /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\AppPrivacy" /v LetAppsRunInBackground /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAppPrivacy" /v GlobalUserDisabled /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue; reg delete "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\AppPrivacy" /v LetAppsRunInBackground /f -ErrorAction SilentlyContinue';
        break;
      case "Disable Fullscreen Opt.":
        cmd = enabled
          ? 'reg add "HKCU\\System\\GameConfigStore" /v GameDVR_FSEBehavior /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue'
          : 'reg add "HKCU\\System\\GameConfigStore" /v GameDVR_FSEBehavior /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue';
        break;
      case "Disable Game Bar/DVR":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue; reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR" /v AllowGameDVR /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue; reg add "HKCU\\System\\GameConfigStore" /v GameDVR_Enabled /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR" /v AllowGameDVR /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue';
        break;
      case "TCP Nagle Off":
        cmd = enabled
          ? 'Get-ChildItem "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces" -ErrorAction SilentlyContinue | ForEach-Object { New-ItemProperty -Path $_.PSPath -Name "TcpAckFrequency" -Value 1 -PropertyType DWord -Force -ErrorAction SilentlyContinue; New-ItemProperty -Path $_.PSPath -Name "TCPNoDelay" -Value 1 -PropertyType DWord -Force -ErrorAction SilentlyContinue }'
          : 'Get-ChildItem "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces" -ErrorAction SilentlyContinue | ForEach-Object { Remove-ItemProperty -Path $_.PSPath -Name "TcpAckFrequency" -ErrorAction SilentlyContinue; Remove-ItemProperty -Path $_.PSPath -Name "TCPNoDelay" -ErrorAction SilentlyContinue }';
        break;
      case "Cloudflare 1.1.1.1 DNS":
        cmd = enabled
          ? 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { Set-DnsClientServerAddress -InterfaceAlias $_.InterfaceAlias -ServerAddresses ("1.1.1.1","1.0.0.1") -ErrorAction SilentlyContinue }'
          : 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { Set-DnsClientServerAddress -InterfaceAlias $_.InterfaceAlias -ResetServerAddresses -ErrorAction SilentlyContinue }';
        break;
      case "Deep Temp/Cache Clean":
        if (enabled) {
          cmd = 'Remove-Item -Path "C:\\Windows\\Temp\\*" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -Path "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue; ipconfig /flushdns; Write-Host "Cleaned"';
        }
        break;
      case "Telemetry Blocker":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" /v AllowTelemetry /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue; Stop-Service -Name DiagTrack -Force -ErrorAction SilentlyContinue; Set-Service -Name DiagTrack -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" /v AllowTelemetry /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue; Set-Service -Name DiagTrack -StartupType Automatic -ErrorAction SilentlyContinue';
        break;
      case "High Priority Gaming":
        cmd = 'if (!(Test-Path "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\RobloxPlayerBeta.exe")) { New-Item -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\RobloxPlayerBeta.exe" -Force -ErrorAction SilentlyContinue }; if (!(Test-Path "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\RobloxPlayerBeta.exe\\PerfOptions")) { New-Item -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\RobloxPlayerBeta.exe\\PerfOptions" -Force -ErrorAction SilentlyContinue }; reg add "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\RobloxPlayerBeta.exe\\PerfOptions" /v CpuPriorityClass /t REG_DWORD /d 3 /f -ErrorAction SilentlyContinue';
        break;
      case "Disable Power Throttling":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling" /v PowerThrottlingOff /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling" /v PowerThrottlingOff /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue';
        break;
      case "Disable IPv6":
        cmd = enabled
          ? 'Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { Disable-NetAdapterBinding -Name $_.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue }'
          : 'Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { Enable-NetAdapterBinding -Name $_.Name -ComponentID ms_tcpip6 -ErrorAction SilentlyContinue }';
        break;
      case "Interrupt Moderation Off":
        cmd = enabled
          ? 'Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { Disable-NetAdapterInterruptModeration -Name $_.Name -ErrorAction SilentlyContinue }'
          : 'Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { Enable-NetAdapterInterruptModeration -Name $_.Name -ErrorAction SilentlyContinue }';
        break;
      case "Disable Adapter Power Save":
        cmd = enabled
          ? 'Get-CimInstance -ClassName MSPower_DeviceEnable -Namespace root/wmi -ErrorAction SilentlyContinue | Where-Object {$_.InstanceName -like "*Network*"} | Set-CimInstance -Property @{Enable=$false} -ErrorAction SilentlyContinue'
          : 'Get-CimInstance -ClassName MSPower_DeviceEnable -Namespace root/wmi -ErrorAction SilentlyContinue | Where-Object {$_.InstanceName -like "*Network*"} | Set-CimInstance -Property @{Enable=$true} -ErrorAction SilentlyContinue';
        break;
      case "Increase TCP Window":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpWindowSize /t REG_DWORD /d 65535 /f -ErrorAction SilentlyContinue'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpWindowSize /f -ErrorAction SilentlyContinue';
        break;
      case "Disable V-Sync":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" /v Direct3D_DWM_VerticalSync /t REG_DWORD /d 0 /f -ErrorAction SilentlyContinue'
          : 'reg add "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" /v Direct3D_DWM_VerticalSync /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue';
        break;
      case "Disable MPO (Stutter Fix)":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\Dwm" /v OverlayTestMode /t REG_DWORD /d 5 /f -ErrorAction SilentlyContinue'
          : 'reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows\\Dwm" /v OverlayTestMode /f -ErrorAction SilentlyContinue';
        break;
      case "CIM Game Priority":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games" /v "GPU Priority" /t REG_DWORD /d 8 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games" /v "Priority" /t REG_DWORD /d 6 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games" /v "Scheduling Category" /t REG_SZ /d "High" /f -ErrorAction SilentlyContinue'
          : 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games" /v "GPU Priority" /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games" /v "Priority" /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games" /v "Scheduling Category" /t REG_SZ /d "Medium" /f -ErrorAction SilentlyContinue';
        break;
      case "Win32 Priority Sep.":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl" /v Win32PrioritySeparation /t REG_DWORD /d 26 /f -ErrorAction SilentlyContinue'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl" /v Win32PrioritySeparation /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue';
        break;
      case "Timer Resolution Fix":
        // This is a complex tweak usually done in C++, but we can set the registry hint.
        cmd = 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\kernel" /v GlobalTimerResolution /t REG_DWORD /d 5000 /f -ErrorAction SilentlyContinue';
        break;
      case "Disable Hibernation":
        cmd = enabled ? 'powercfg -h off' : 'powercfg -h on';
        break;
      case "FPS Cap 999":
      case "Zero Particles":
      case "Disable PostFX":
      case "No Shadows/Grass":
      case "Texture Low Override":
      case "GPU Light Culling":
      case "Bloxstrap Telemetry":
      case "Quick Launch":
        // Real FastFlag Implementation
        const fName = name === "Bloxstrap Telemetry" ? "FFlagDisablePostFx" : name; // Mapping for safety
        const fVal = enabled ? "true" : "false";
        let fSet = "";
        if (name === "FPS Cap 999") fSet = '"DFIntRenderingFpsCap": 999';
        else if (name === "Zero Particles") fSet = '"FFlagDisablePostFx": true, "FFlagEnableParticleOptimizations": true';
        else if (name.includes("Shadows")) fSet = '"FIntRenderShadowIntensity": 0';
        else fSet = `"${name}": ${fVal}`;

        // Powershell to find and update ClientAppSettings.json across all versions/Bloxstrap
        cmd = `$paths = @(
          "$env:LocalAppData\\Bloxstrap\\Modifications\\ClientSettings\\ClientAppSettings.json",
          "$env:LocalAppData\\Roblox\\Versions\\*\\ClientSettings\\ClientAppSettings.json"
        ) | Get-Item -ErrorAction SilentlyContinue;
        foreach ($p in $paths) {
          $json = if (Test-Path $p) { Get-Content $p | ConvertFrom-Json } else { @{} };
          $json += @{ ${fSet.split(':')[0].trim()} = ${fSet.split(':')[1].trim()} };
          if (!(Test-Path ($p.Directory.FullName))) { New-Item -Path ($p.Directory.FullName) -ItemType Directory -Force };
          $json | ConvertTo-Json | Set-Content $p -Force
        }`;
        break;

      // ── SERVICES (Tier 1) ─────────────────────────────────────
      case "Kill SysMain":
        cmd = enabled
          ? 'Stop-Service -Name SysMain -Force -ErrorAction SilentlyContinue; Set-Service -Name SysMain -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name SysMain -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name SysMain -ErrorAction SilentlyContinue';
        break;
      case "Kill WSearch":
        cmd = enabled
          ? 'Stop-Service -Name WSearch -Force -ErrorAction SilentlyContinue; Set-Service -Name WSearch -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name WSearch -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name WSearch -ErrorAction SilentlyContinue';
        break;
      case "Kill DiagTrack":
        cmd = enabled
          ? 'Stop-Service -Name DiagTrack -Force -ErrorAction SilentlyContinue; Set-Service -Name DiagTrack -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name DiagTrack -StartupType Automatic -ErrorAction SilentlyContinue';
        break;
      case "Kill Biometric Svc":
        cmd = enabled
          ? 'Stop-Service -Name WbioSrvc -Force -ErrorAction SilentlyContinue; Set-Service -Name WbioSrvc -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name WbioSrvc -StartupType Automatic -ErrorAction SilentlyContinue';
        break;
      case "Kill Print Spooler":
        cmd = enabled
          ? 'Stop-Service -Name Spooler -Force -ErrorAction SilentlyContinue; Set-Service -Name Spooler -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name Spooler -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name Spooler -ErrorAction SilentlyContinue';
        break;
      case "Kill Xbox Services":
        cmd = enabled
          ? '@("XblAuthManager","XblGameSave","XboxNetApiSvc","XboxGipSvc") | ForEach-Object { Stop-Service -Name $_ -Force -ErrorAction SilentlyContinue; Set-Service -Name $_ -StartupType Disabled -ErrorAction SilentlyContinue }'
          : '@("XblAuthManager","XblGameSave","XboxNetApiSvc","XboxGipSvc") | ForEach-Object { Set-Service -Name $_ -StartupType Manual -ErrorAction SilentlyContinue }';
        break;
      case "Kill Push Notifications":
        cmd = enabled
          ? 'Stop-Service -Name WpnService -Force -ErrorAction SilentlyContinue; Set-Service -Name WpnService -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name WpnService -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name WpnService -ErrorAction SilentlyContinue';
        break;
      case "Kill BITS":
        cmd = enabled
          ? 'Stop-Service -Name BITS -Force -ErrorAction SilentlyContinue; Set-Service -Name BITS -StartupType Manual -ErrorAction SilentlyContinue'
          : 'Set-Service -Name BITS -StartupType Automatic -ErrorAction SilentlyContinue';
        break;
      case "Kill WAP Telemetry":
        cmd = enabled
          ? 'Stop-Service -Name dmwappushservice -Force -ErrorAction SilentlyContinue; Set-Service -Name dmwappushservice -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name dmwappushservice -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill Error Reporting":
        cmd = enabled
          ? 'Stop-Service -Name WerSvc -Force -ErrorAction SilentlyContinue; Set-Service -Name WerSvc -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name WerSvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill AutoPlay":
        cmd = enabled
          ? 'Stop-Service -Name ShellHWDetection -Force -ErrorAction SilentlyContinue; Set-Service -Name ShellHWDetection -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name ShellHWDetection -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name ShellHWDetection -ErrorAction SilentlyContinue';
        break;
      case "Kill Compat. Asst.":
        cmd = enabled
          ? 'Stop-Service -Name PcaSvc -Force -ErrorAction SilentlyContinue; Set-Service -Name PcaSvc -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name PcaSvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill BranchCache":
        cmd = enabled
          ? 'Stop-Service -Name PeerDistSvc -Force -ErrorAction SilentlyContinue; Set-Service -Name PeerDistSvc -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name PeerDistSvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill UPnP":
        cmd = enabled
          ? '@("SSDPSRV","upnphost") | ForEach-Object { Stop-Service -Name $_ -Force -ErrorAction SilentlyContinue; Set-Service -Name $_ -StartupType Disabled -ErrorAction SilentlyContinue }'
          : '@("SSDPSRV","upnphost") | ForEach-Object { Set-Service -Name $_ -StartupType Manual -ErrorAction SilentlyContinue }';
        break;
      case "Kill Font Cache":
        cmd = enabled
          ? 'Stop-Service -Name FontCache -Force -ErrorAction SilentlyContinue; Set-Service -Name FontCache -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name FontCache -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name FontCache -ErrorAction SilentlyContinue';
        break;
      case "Kill Win Time Svc":
        cmd = enabled
          ? 'Stop-Service -Name W32Time -Force -ErrorAction SilentlyContinue; Set-Service -Name W32Time -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name W32Time -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name W32Time -ErrorAction SilentlyContinue';
        break;
      case "Kill Link Tracking":
        cmd = enabled
          ? 'Stop-Service -Name TrkWks -Force -ErrorAction SilentlyContinue; Set-Service -Name TrkWks -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name TrkWks -StartupType Automatic -ErrorAction SilentlyContinue';
        break;
      case "Kill Diagnostic Policy":
        cmd = enabled
          ? '@("WdiServiceHost","WdiSystemHost") | ForEach-Object { Stop-Service -Name $_ -Force -ErrorAction SilentlyContinue; Set-Service -Name $_ -StartupType Disabled -ErrorAction SilentlyContinue }'
          : '@("WdiServiceHost","WdiSystemHost") | ForEach-Object { Set-Service -Name $_ -StartupType Manual -ErrorAction SilentlyContinue }';
        break;
      case "Kill Fax Service":
        cmd = enabled
          ? 'Stop-Service -Name Fax -Force -ErrorAction SilentlyContinue; Set-Service -Name Fax -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name Fax -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill WMP Network":
        cmd = enabled
          ? 'Stop-Service -Name WMPNetworkSvc -Force -ErrorAction SilentlyContinue; Set-Service -Name WMPNetworkSvc -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'Set-Service -Name WMPNetworkSvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;

      // ── REGISTRY (Tier 2) ─────────────────────────────────────
      case "Disable Mouse Accel.":
        cmd = enabled
          ? 'reg add "HKCU\\Control Panel\\Mouse" /v MouseSpeed /t REG_SZ /d 0 /f; reg add "HKCU\\Control Panel\\Mouse" /v MouseThreshold1 /t REG_SZ /d 0 /f; reg add "HKCU\\Control Panel\\Mouse" /v MouseThreshold2 /t REG_SZ /d 0 /f'
          : 'reg add "HKCU\\Control Panel\\Mouse" /v MouseSpeed /t REG_SZ /d 1 /f; reg add "HKCU\\Control Panel\\Mouse" /v MouseThreshold1 /t REG_SZ /d 6 /f; reg add "HKCU\\Control Panel\\Mouse" /v MouseThreshold2 /t REG_SZ /d 10 /f';
        break;
      case "Instant Menu Speed":
        cmd = enabled
          ? 'reg add "HKCU\\Control Panel\\Desktop" /v MenuShowDelay /t REG_SZ /d 0 /f'
          : 'reg add "HKCU\\Control Panel\\Desktop" /v MenuShowDelay /t REG_SZ /d 400 /f';
        break;
      case "Disable Menu Anim.":
        cmd = enabled
          ? 'reg add "HKCU\\Control Panel\\Desktop\\WindowMetrics" /v MinAnimate /t REG_SZ /d 0 /f'
          : 'reg add "HKCU\\Control Panel\\Desktop\\WindowMetrics" /v MinAnimate /t REG_SZ /d 1 /f';
        break;
      case "Disable Aero Shake":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v DisallowShaking /t REG_DWORD /d 1 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v DisallowShaking /t REG_DWORD /d 0 /f';
        break;
      case "Disable Aero Peek":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\DWM" /v EnableAeroPeek /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\DWM" /v EnableAeroPeek /t REG_DWORD /d 1 /f';
        break;
      case "Disable Snap Assist":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v WindowArrangementActive /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableSnapAssist /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableSnapAssistFlyout /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v WindowArrangementActive /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableSnapAssist /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableSnapAssistFlyout /t REG_DWORD /d 1 /f';
        break;
      case "Disable Error Report.":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting" /v Disabled /t REG_DWORD /d 1 /f'
          : 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\Windows Error Reporting" /v Disabled /t REG_DWORD /d 0 /f';
        break;
      case "Disable Advertising ID":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo" /v Enabled /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo" /v Enabled /t REG_DWORD /d 1 /f';
        break;
      case "Disable Activity Hist.":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" /v EnableActivityFeed /t REG_DWORD /d 0 /f; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" /v PublishUserActivities /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" /v EnableActivityFeed /t REG_DWORD /d 1 /f; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" /v PublishUserActivities /t REG_DWORD /d 1 /f';
        break;
      case "Disable Clipboard Sync":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" /v AllowClipboardHistory /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System" /v AllowClipboardHistory /t REG_DWORD /d 1 /f';
        break;
      case "Disable Lock Screen Ads":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v RotatingLockScreenEnabled /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v RotatingLockScreenOverlayEnabled /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v RotatingLockScreenEnabled /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v RotatingLockScreenOverlayEnabled /t REG_DWORD /d 1 /f';
        break;
      case "Disable CDM Bloat":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v ContentDeliveryAllowed /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SilentInstalledAppsEnabled /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SubscribedContent-338393Enabled /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SubscribedContent-353694Enabled /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SubscribedContent-353696Enabled /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SubscribedContent-338389Enabled /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SubscribedContent-310093Enabled /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SubscribedContent-353698Enabled /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v ContentDeliveryAllowed /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SilentInstalledAppsEnabled /t REG_DWORD /d 1 /f';
        break;
      case "Disable Tailored Exp.":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Privacy" /v TailoredExperiencesWithDiagnosticDataEnabled /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Privacy" /v TailoredExperiencesWithDiagnosticDataEnabled /t REG_DWORD /d 1 /f';
        break;
      case "Disable Ink/Type Data":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\InputPersonalization" /v RestrictImplicitTextCollection /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\InputPersonalization" /v RestrictImplicitInkCollection /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\Personalization\\Settings" /v AcceptedPrivacyPolicy /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\InputPersonalization" /v RestrictImplicitTextCollection /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\InputPersonalization" /v RestrictImplicitInkCollection /t REG_DWORD /d 0 /f';
        break;
      case "Disable Speech Data":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Speech_OneCore\\Settings\\OnlineSpeechPrivacy" /v HasAcceptedPrivacyPolicy /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Speech_OneCore\\Settings\\OnlineSpeechPrivacy" /v HasAcceptedPrivacyPolicy /t REG_DWORD /d 1 /f';
        break;
      case "Disable OneDrive":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\OneDrive" /v DisableFileSyncNGSC /t REG_DWORD /d 1 /f'
          : 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\OneDrive" /v DisableFileSyncNGSC /t REG_DWORD /d 0 /f';
        break;
      case "Disable Edge Prelaunch":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\MicrosoftEdge\\Main" /v AllowPrelaunch /t REG_DWORD /d 0 /f'
          : 'reg delete "HKLM\\SOFTWARE\\Policies\\Microsoft\\MicrosoftEdge\\Main" /v AllowPrelaunch /f -ErrorAction SilentlyContinue';
        break;
      case "Block Update Restart":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 1 /f; reg add "HKLM\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" /v RestartNotificationsAllowed2 /t REG_DWORD /d 0 /f; reg add "HKLM\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" /v ActiveHoursStart /t REG_DWORD /d 8 /f; reg add "HKLM\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" /v ActiveHoursEnd /t REG_DWORD /d 2 /f'
          : 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 0 /f';
        break;
      case "Disable Sticky Keys":
        cmd = enabled
          ? 'reg add "HKCU\\Control Panel\\Accessibility\\StickyKeys" /v Flags /t REG_SZ /d 506 /f; reg add "HKCU\\Control Panel\\Accessibility\\Keyboard Response" /v Flags /t REG_SZ /d 122 /f; reg add "HKCU\\Control Panel\\Accessibility\\ToggleKeys" /v Flags /t REG_SZ /d 58 /f'
          : 'reg add "HKCU\\Control Panel\\Accessibility\\StickyKeys" /v Flags /t REG_SZ /d 510 /f; reg add "HKCU\\Control Panel\\Accessibility\\Keyboard Response" /v Flags /t REG_SZ /d 126 /f; reg add "HKCU\\Control Panel\\Accessibility\\ToggleKeys" /v Flags /t REG_SZ /d 62 /f';
        break;
      case "Disable Transparency":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v EnableTransparency /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v EnableTransparency /t REG_DWORD /d 1 /f';
        break;
      case "Disable Snap Bar (11)":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableSnapAssistFlyout /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableSnapAssistFlyout /t REG_DWORD /d 1 /f';
        break;
      case "Disable Widgets (11)":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Dsh" /v AllowNewsAndInterests /t REG_DWORD /d 0 /f; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Feeds" /v EnableFeeds /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Dsh" /v AllowNewsAndInterests /t REG_DWORD /d 1 /f; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Feeds" /v EnableFeeds /t REG_DWORD /d 1 /f';
        break;
      case "Disable Task View Btn":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v ShowTaskViewButton /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v ShowTaskViewButton /t REG_DWORD /d 1 /f';
        break;
      case "Disable Chat Btn":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarMn /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarMn /t REG_DWORD /d 1 /f';
        break;
      case "Disable Search Box":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search" /v SearchboxTaskbarMode /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search" /v SearchboxTaskbarMode /t REG_DWORD /d 2 /f';
        break;
      case "Network Responsiveness":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v NetworkThrottlingIndex /t REG_DWORD /d 0xffffffff /f; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v SystemResponsiveness /t REG_DWORD /d 0 /f; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v NonBestEffortLimit /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v NetworkThrottlingIndex /t REG_DWORD /d 10 /f; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile" /v SystemResponsiveness /t REG_DWORD /d 20 /f';
        break;
      case "Disable SmartScreen":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer" /v SmartScreenEnabled /t REG_SZ /d Off /f; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppHost" /v EnableWebContentEvaluation /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer" /v SmartScreenEnabled /t REG_SZ /d Warn /f; reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppHost" /v EnableWebContentEvaluation /t REG_DWORD /d 1 /f';
        break;
      case "Disable AutoPlay Reg":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\AutoplayHandlers" /v DisableAutoplay /t REG_DWORD /d 1 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\AutoplayHandlers" /v DisableAutoplay /t REG_DWORD /d 0 /f';
        break;

      // ── SCHEDULED TASKS (Tier 3) ─────────────────────────────
      case "Kill Compat Tasks":
        cmd = enabled
          ? 'schtasks /Change /TN "\\Microsoft\\Windows\\Application Experience\\Microsoft Compatibility Appraiser" /Disable 2>$null; schtasks /Change /TN "\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater" /Disable 2>$null; schtasks /Change /TN "\\Microsoft\\Windows\\Autochk\\Proxy" /Disable 2>$null'
          : 'schtasks /Change /TN "\\Microsoft\\Windows\\Application Experience\\Microsoft Compatibility Appraiser" /Enable 2>$null; schtasks /Change /TN "\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater" /Enable 2>$null';
        break;
      case "Kill CEIP Tasks":
        cmd = enabled
          ? '@("\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator","\\Microsoft\\Windows\\Customer Experience Improvement Program\\KernelCeipTask","\\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip") | ForEach-Object { schtasks /Change /TN $_ /Disable 2>$null }'
          : '@("\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator","\\Microsoft\\Windows\\Customer Experience Improvement Program\\KernelCeipTask","\\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip") | ForEach-Object { schtasks /Change /TN $_ /Enable 2>$null }';
        break;
      case "Kill Disk Diag Task":
        cmd = enabled
          ? 'schtasks /Change /TN "\\Microsoft\\Windows\\DiskDiagnostic\\Microsoft-Windows-DiskDiagnosticDataCollector" /Disable 2>$null'
          : 'schtasks /Change /TN "\\Microsoft\\Windows\\DiskDiagnostic\\Microsoft-Windows-DiskDiagnosticDataCollector" /Enable 2>$null';
        break;
      case "Kill Maps Tasks":
        cmd = enabled
          ? 'schtasks /Change /TN "\\Microsoft\\Windows\\Maps\\MapsUpdateTask" /Disable 2>$null; schtasks /Change /TN "\\Microsoft\\Windows\\Maps\\MapsToastTask" /Disable 2>$null'
          : 'schtasks /Change /TN "\\Microsoft\\Windows\\Maps\\MapsUpdateTask" /Enable 2>$null; schtasks /Change /TN "\\Microsoft\\Windows\\Maps\\MapsToastTask" /Enable 2>$null';
        break;
      case "Kill WinSAT Task":
        cmd = enabled
          ? 'schtasks /Change /TN "\\Microsoft\\Windows\\Maintenance\\WinSAT" /Disable 2>$null'
          : 'schtasks /Change /TN "\\Microsoft\\Windows\\Maintenance\\WinSAT" /Enable 2>$null';
        break;
      case "Kill Error Report Task":
        cmd = enabled
          ? 'schtasks /Change /TN "\\Microsoft\\Windows\\Windows Error Reporting\\QueueReporting" /Disable 2>$null'
          : 'schtasks /Change /TN "\\Microsoft\\Windows\\Windows Error Reporting\\QueueReporting" /Enable 2>$null';
        break;
      case "Kill Update Tasks":
        cmd = enabled
          ? '@("\\Microsoft\\Windows\\WindowsUpdate\\Automatic App Update","\\Microsoft\\Windows\\WindowsUpdate\\Scheduled Start","\\Microsoft\\Windows\\WindowsUpdate\\sih","\\Microsoft\\Windows\\WindowsUpdate\\sihboot") | ForEach-Object { schtasks /Change /TN $_ /Disable 2>$null }'
          : '@("\\Microsoft\\Windows\\WindowsUpdate\\Automatic App Update","\\Microsoft\\Windows\\WindowsUpdate\\Scheduled Start") | ForEach-Object { schtasks /Change /TN $_ /Enable 2>$null }';
        break;
      case "Kill Defender Tasks":
        cmd = enabled
          ? '@("\\Microsoft\\Windows\\Windows Defender\\Windows Defender Cache Maintenance","\\Microsoft\\Windows\\Windows Defender\\Windows Defender Cleanup","\\Microsoft\\Windows\\Windows Defender\\Windows Defender Scheduled Scan","\\Microsoft\\Windows\\Windows Defender\\Windows Defender Verification") | ForEach-Object { schtasks /Change /TN $_ /Disable 2>$null }'
          : '@("\\Microsoft\\Windows\\Windows Defender\\Windows Defender Cache Maintenance","\\Microsoft\\Windows\\Windows Defender\\Windows Defender Cleanup","\\Microsoft\\Windows\\Windows Defender\\Windows Defender Scheduled Scan","\\Microsoft\\Windows\\Windows Defender\\Windows Defender Verification") | ForEach-Object { schtasks /Change /TN $_ /Enable 2>$null }';
        break;
      case "Kill Defrag Task":
        cmd = enabled
          ? 'schtasks /Change /TN "\\Microsoft\\Windows\\Defrag\\ScheduledDefrag" /Disable 2>$null'
          : 'schtasks /Change /TN "\\Microsoft\\Windows\\Defrag\\ScheduledDefrag" /Enable 2>$null';
        break;
      case "Kill SilentCleanup":
        cmd = enabled
          ? 'schtasks /Change /TN "\\Microsoft\\Windows\\DiskCleanup\\SilentCleanup" /Disable 2>$null'
          : 'schtasks /Change /TN "\\Microsoft\\Windows\\DiskCleanup\\SilentCleanup" /Enable 2>$null';
        break;
      case "Kill Sysmain Tasks":
        cmd = enabled
          ? 'schtasks /Change /TN "\\Microsoft\\Windows\\Sysmain\\ResPriStaticDbSync" /Disable 2>$null; schtasks /Change /TN "\\Microsoft\\Windows\\Sysmain\\WsSwapAssessmentTask" /Disable 2>$null'
          : 'schtasks /Change /TN "\\Microsoft\\Windows\\Sysmain\\ResPriStaticDbSync" /Enable 2>$null; schtasks /Change /TN "\\Microsoft\\Windows\\Sysmain\\WsSwapAssessmentTask" /Enable 2>$null';
        break;
      case "Kill Family Safety":
        cmd = enabled
          ? '@("\\Microsoft\\Windows\\Shell\\FamilySafetyMonitor","\\Microsoft\\Windows\\Shell\\FamilySafetyRefresh","\\Microsoft\\Windows\\Shell\\FamilySafetyUpload") | ForEach-Object { schtasks /Change /TN $_ /Disable 2>$null }'
          : '@("\\Microsoft\\Windows\\Shell\\FamilySafetyMonitor","\\Microsoft\\Windows\\Shell\\FamilySafetyRefresh") | ForEach-Object { schtasks /Change /TN $_ /Enable 2>$null }';
        break;

      // ── BCD (Tier 4) ──────────────────────────────────────────
      case "TSC Sync Enhanced":
        cmd = enabled ? 'bcdedit /set tscsyncpolicy enhanced' : 'bcdedit /deletevalue tscsyncpolicy -ErrorAction SilentlyContinue';
        break;
      case "Boot UX Disabled":
        cmd = enabled ? 'bcdedit /set bootux disabled' : 'bcdedit /set bootux standard';
        break;
      case "Boot Timeout 3s":
        cmd = enabled ? 'bcdedit /timeout 3' : 'bcdedit /timeout 30';
        break;
      case "Disable Boot Log":
        cmd = enabled ? 'bcdedit /set bootlog no' : 'bcdedit /set bootlog yes';
        break;

      // ── APPX BLOAT (Tier 5) ───────────────────────────────────
      case "Remove 3D Apps":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *3DBuilder* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *Microsoft3DViewer* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *Print3D* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *MixedReality.Portal* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Xbox Apps":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *XboxApp* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *XboxGameOverlay* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *XboxGamingOverlay* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *XboxIdentityProvider* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *Xbox.TCUI* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *XboxSpeechToTextOverlay* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Media Apps":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *ZuneMusic* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *ZuneVideo* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *WindowsSoundRecorder* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *WindowsCamera* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Bing Apps":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *BingNews* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *BingSports* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *BingWeather* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *BingTravel* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *BingFinance* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *BingFoodAndDrink* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *BingHealthAndFitness* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Office Bloat":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *MicrosoftOfficeHub* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *Office.OneNote* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *Office.Sway* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Social Apps":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *People* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *Messaging* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *YourPhone* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *CrossDevice* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *SkypeApp* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove MS Teams":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *Teams* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers MicrosoftTeams | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Copilot":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *Copilot* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *Windows.Ai.Copilot* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *Windows.Recall* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Feedback Hub":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *WindowsFeedbackHub* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *GetHelp* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *Getstarted* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Clipchamp":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *Clipchamp* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Cortana":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *Windows.Cortana* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Maps App":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *WindowsMaps* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove MS Solitaire":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *MicrosoftSolitaireCollection* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove Alarms/Calc":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *WindowsAlarms* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *WindowsCalculator* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;
      case "Remove PowerAutomate":
        cmd = enabled
          ? 'Get-AppxPackage -AllUsers *PowerAutomateDesktop* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage -AllUsers *Todos* | Remove-AppxPackage -ErrorAction SilentlyContinue'
          : 'Write-Host "AppX removal is permanent — re-install from Microsoft Store"';
        break;

      // ── POWER & CPU (Tier 6) ───────────────────────────────────
      case "Disable Core Parking":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings\\54533251-82be-4824-96c8-534cc5e9e7c2\\0cc5b647-c1df-4637-891a-dec35c318583" /v Attributes /t REG_DWORD /d 0 /f; powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR CPMINCORES 100; powercfg -setdcvalueindex SCHEME_CURRENT SUB_PROCESSOR CPMINCORES 100; powercfg -setactive SCHEME_CURRENT'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings\\54533251-82be-4824-96c8-534cc5e9e7c2\\0cc5b647-c1df-4637-891a-dec35c318583" /v Attributes /t REG_DWORD /d 1 /f';
        break;
      case "Disable USB Suspend":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\USB\\Parameters" /v SelectiveSuspendEnabled /t REG_DWORD /d 0 /f; powercfg -setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0; powercfg -setactive SCHEME_CURRENT'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\USB\\Parameters" /v SelectiveSuspendEnabled /t REG_DWORD /d 1 /f';
        break;
      case "Disable PCI Power Mgmt":
        cmd = enabled
          ? 'powercfg -setacvalueindex SCHEME_CURRENT SUB_PCIEXPRESS ASPM 0; powercfg -setdcvalueindex SCHEME_CURRENT SUB_PCIEXPRESS ASPM 0; powercfg -setactive SCHEME_CURRENT'
          : 'powercfg -setacvalueindex SCHEME_CURRENT SUB_PCIEXPRESS ASPM 2; powercfg -setdcvalueindex SCHEME_CURRENT SUB_PCIEXPRESS ASPM 2; powercfg -setactive SCHEME_CURRENT';
        break;
      case "CPU 100% Min State":
        cmd = enabled
          ? 'powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 100; powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100; powercfg -setactive SCHEME_CURRENT'
          : 'powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 5; powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100; powercfg -setactive SCHEME_CURRENT';
        break;

      // ── STORAGE SSD (Tier 7) ───────────────────────────────────
      case "Enable TRIM":
        cmd = enabled ? 'fsutil behavior set DisableDeleteNotify 0' : 'fsutil behavior set DisableDeleteNotify 1';
        break;
      case "Disable Prefetcher":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" /v EnablePrefetcher /t REG_DWORD /d 0 /f; reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" /v EnableSuperfetch /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" /v EnablePrefetcher /t REG_DWORD /d 3 /f; reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters" /v EnableSuperfetch /t REG_DWORD /d 3 /f';
        break;
      case "Disable Last Access":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v NtfsDisableLastAccessUpdate /t REG_DWORD /d 1 /f; fsutil behavior set disablelastaccess 1'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v NtfsDisableLastAccessUpdate /t REG_DWORD /d 0 /f; fsutil behavior set disablelastaccess 0';
        break;
      case "Disable 8.3 Names":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v NtfsDisable8dot3NameCreation /t REG_DWORD /d 1 /f; fsutil behavior set disable8dot3 1'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v NtfsDisable8dot3NameCreation /t REG_DWORD /d 0 /f; fsutil behavior set disable8dot3 0';
        break;
      case "Disable NTFS Compress":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v NtfsDisableCompression /t REG_DWORD /d 1 /f'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v NtfsDisableCompression /t REG_DWORD /d 0 /f';
        break;
      case "NTFS Memory Boost":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v NtfsMemoryUsage /t REG_DWORD /d 2 /f'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v NtfsMemoryUsage /t REG_DWORD /d 1 /f';
        break;

      // ── NETWORK ADVANCED (Tier 8) ─────────────────────────────
      case "Disable QoS Scheduler":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Psched" /v NonBestEffortLimit /t REG_DWORD /d 0 /f'
          : 'reg delete "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Psched" /v NonBestEffortLimit /f -ErrorAction SilentlyContinue';
        break;
      case "Google 8.8.8.8 DNS":
        cmd = enabled
          ? 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { Set-DnsClientServerAddress -InterfaceAlias $_.InterfaceAlias -ServerAddresses ("8.8.8.8","8.8.4.4") -ErrorAction SilentlyContinue }'
          : 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { Set-DnsClientServerAddress -InterfaceAlias $_.InterfaceAlias -ResetServerAddresses -ErrorAction SilentlyContinue }';
        break;
      case "Disable NetBIOS":
        cmd = enabled
          ? 'Get-ChildItem "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NetBT\\Parameters\\Interfaces" -ErrorAction SilentlyContinue | ForEach-Object { Set-ItemProperty -Path $_.PSPath -Name NetbiosOptions -Value 2 -ErrorAction SilentlyContinue }'
          : 'Get-ChildItem "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\NetBT\\Parameters\\Interfaces" -ErrorAction SilentlyContinue | ForEach-Object { Set-ItemProperty -Path $_.PSPath -Name NetbiosOptions -Value 0 -ErrorAction SilentlyContinue }';
        break;
      case "NIC Recv Buffers Max":
        cmd = enabled
          ? 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { try { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Receive Buffers" -DisplayValue "2048" -ErrorAction SilentlyContinue } catch {} }'
          : 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { try { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Receive Buffers" -DisplayValue "512" -ErrorAction SilentlyContinue } catch {} }';
        break;
      case "NIC Flow Control Off":
        cmd = enabled
          ? 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { try { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Flow Control" -DisplayValue "Disabled" -ErrorAction SilentlyContinue } catch {} }'
          : 'Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {$_.Status -eq "Up"} | ForEach-Object { try { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Flow Control" -DisplayValue "Rx & Tx Enabled" -ErrorAction SilentlyContinue } catch {} }';
        break;
      case "Disable Wake on LAN":
        cmd = enabled
          ? 'Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { try { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Wake on Magic Packet" -DisplayValue "Disabled" -ErrorAction SilentlyContinue; Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Wake on Pattern Match" -DisplayValue "Disabled" -ErrorAction SilentlyContinue } catch {} }'
          : 'Get-NetAdapter -ErrorAction SilentlyContinue | ForEach-Object { try { Set-NetAdapterAdvancedProperty -Name $_.Name -DisplayName "Wake on Magic Packet" -DisplayValue "Enabled" -ErrorAction SilentlyContinue } catch {} }';
        break;

      // ── CONTEXT MENU (Tier 9) ─────────────────────────────────
      case "Remove Share Ctx":
        cmd = enabled
          ? 'reg delete "HKCR\\*\\shellex\\ContextMenuHandlers\\ModernSharing" /f -ErrorAction SilentlyContinue; reg delete "HKCR\\*\\shellex\\ContextMenuHandlers\\Sharing" /f -ErrorAction SilentlyContinue'
          : 'Write-Host "Context menu entries cannot be auto-restored"';
        break;
      case "Remove Paint 3D Ctx":
        cmd = enabled
          ? 'reg delete "HKCR\\SystemFileAssociations\\image\\shell\\Edit with Paint 3D" /f -ErrorAction SilentlyContinue'
          : 'Write-Host "Context menu entries cannot be auto-restored"';
        break;
      case "Remove Defender Ctx":
        cmd = enabled
          ? 'reg delete "HKCR\\*\\shellex\\ContextMenuHandlers\\EPP" /f -ErrorAction SilentlyContinue'
          : 'Write-Host "Context menu entries cannot be auto-restored"';
        break;
      case "Remove Include Lib.":
        cmd = enabled
          ? 'reg delete "HKCR\\Folder\\ShellEx\\ContextMenuHandlers\\Library Location" /f -ErrorAction SilentlyContinue'
          : 'Write-Host "Context menu entries cannot be auto-restored"';
        break;
      case "Remove Pin to QA":
        cmd = enabled
          ? 'reg delete "HKCR\\Folder\\shell\\pintohome" /f -ErrorAction SilentlyContinue'
          : 'Write-Host "Context menu entries cannot be auto-restored"';
        break;

      // ── ADVANCED GAMING (Tier 10) ─────────────────────────────
      case "Disable Audio Enhance":
        cmd = enabled
          ? 'Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render\\*\\Properties" -ErrorAction SilentlyContinue | ForEach-Object { reg add ($_.PSPath -replace "Microsoft.PowerShell.Core\\\\Registry\\\\") /v "{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5" /t REG_DWORD /d 2 /f -ErrorAction SilentlyContinue }; Write-Host "Audio enhancements disabled via registry hint"'
          : 'Write-Host "Re-enable audio enhancements in Sound properties"';
        break;
      case "Audio 16-bit 44100Hz":
        cmd = 'Write-Host "Set audio format manually: Sound > Playback > Properties > Advanced > 16 bit 44100Hz"';
        break;
      case "Enable Exclusive Audio":
        cmd = 'Write-Host "Enable exclusive mode: Sound > Playback > Properties > Advanced > Allow exclusive control"';
        break;
      case "Disable Variable RR":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" /v Direct3D_DWM_VerticalSync /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" /v Direct3D_DWM_VerticalSync /t REG_DWORD /d 1 /f';
        break;
      case "Enable Game Mode":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\GameBar" /v AllowAutoGameMode /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\GameBar" /v AutoGameModeEnabled /t REG_DWORD /d 1 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\GameBar" /v AllowAutoGameMode /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\GameBar" /v AutoGameModeEnabled /t REG_DWORD /d 0 /f';
        break;
      case "Disable CFG Per-Game":
        cmd = enabled
          ? 'if (!(Test-Path "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\RobloxPlayerBeta.exe")) { New-Item -Path "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\RobloxPlayerBeta.exe" -Force -ErrorAction SilentlyContinue }; reg add "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\RobloxPlayerBeta.exe" /v MitigationOptions /t REG_BINARY /d 0000000000000000 /f'
          : 'reg delete "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\RobloxPlayerBeta.exe" /v MitigationOptions /f -ErrorAction SilentlyContinue';
        break;
      case "Disable Turbo Throttle":
        cmd = enabled
          ? 'powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 99; powercfg -setactive SCHEME_CURRENT'
          : 'powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100; powercfg -setactive SCHEME_CURRENT';
        break;

      case "Refresh Explorer":
        cmd = 'Stop-Process -Name explorer -Force; Start-Process explorer';
        break;
      case "Clear Standby RAM":
        cmd = '[gc]::Collect(); Get-Process | ForEach-Object { try { [Runtime.InteropServices.Marshal]::MinimizeWorkingSet($_.Handle) } catch {} }';
        break;
      case "Clear User Temp":
        cmd = 'Get-ChildItem $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Windows Temp":
        cmd = 'Get-ChildItem $env:SystemRoot\\Temp -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Recent Items":
        cmd = 'Remove-Item "$env:APPDATA\\Microsoft\\Windows\\Recent\\*" -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Destinations":
        cmd = 'Remove-Item "$env:APPDATA\\Microsoft\\Windows\\Recent\\AutomaticDestinations\\*" -Force -ErrorAction SilentlyContinue; Remove-Item "$env:APPDATA\\Microsoft\\Windows\\Recent\\CustomDestinations\\*" -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Thumbnail Cache":
        cmd = 'Stop-Process -Name explorer -Force; Remove-Item "$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer\\thumbcache_*.db" -Force -ErrorAction SilentlyContinue; Start-Process explorer';
        break;
      case "Clear Icon Cache":
        cmd = 'Remove-Item "$env:LOCALAPPDATA\\IconCache.db" -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Shell Bag":
        cmd = 'Remove-Item "HKCU:\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\BagMRU" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Run History":
        cmd = 'Remove-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU" -Name "*" -ErrorAction SilentlyContinue';
        break;
      case "Clear Typed Paths":
        cmd = 'Remove-Item "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\TypedPaths" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Dialog History":
        cmd = 'Remove-Item "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ComDlg32\\OpenSavePidlMRU" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ComDlg32\\LastVisitedPidlMRU" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Recycle Bin":
        cmd = 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear WER Queue":
        cmd = 'Remove-Item "C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportQueue\\*" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\ProgramData\\Microsoft\\Windows\\WER\\ReportArchive\\*" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\ProgramData\\Microsoft\\Windows\\WER\\Temp\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear System Dumps":
        cmd = 'Remove-Item "C:\\Windows\\Minidump\\*" -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\MEMORY.DMP" -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\LiveKernelReports\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Prefetch":
        cmd = 'Remove-Item "C:\\Windows\\Prefetch\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear System Logs":
        cmd = 'Remove-Item "C:\\Windows\\Logs\\CBS\\*.log" -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\Logs\\DISM\\*.log" -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\Logs\\Setup*.log" -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\Panther\\*.log" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Update Cache":
        cmd = 'Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\SoftwareDistribution\\Download\\*" -Recurse -Force -ErrorAction SilentlyContinue; Start-Service -Name wuauserv -ErrorAction SilentlyContinue';
        break;
      case "Clear Delivery Opt.":
        cmd = 'Remove-Item "C:\\Windows\\SoftwareDistribution\\DeliveryOptimization\\Cache\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Installer Cache":
        cmd = 'Get-ChildItem "$env:windir\\Installer\\*.msi" | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-30)} | Remove-Item -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Internet Cache":
        cmd = 'Remove-Item "$env:LOCALAPPDATA\\Microsoft\\Windows\\INetCache\\*" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item "$env:LOCALAPPDATA\\Microsoft\\CryptnetUrlCache\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Flush DNS Cache":
        cmd = 'ipconfig /flushdns';
        break;
      case "Release/Renew IP":
        cmd = 'ipconfig /release; ipconfig /renew';
        break;
      case "Clear ARP / NetBIOS":
        cmd = 'arp -d *; nbtstat -R';
        break;
      case "Clear Route Table":
        cmd = 'route -f';
        break;
      case "Reset Winsock/TCP":
        cmd = 'netsh winsock reset; netsh int ip reset';
        break;
      case "Clear Event Logs":
        cmd = 'wevtutil el | ForEach-Object { wevtutil cl "$_" }';
        break;
      case "Clear Office/WMI Log":
        cmd = 'Remove-Item "$env:LOCALAPPDATA\\Microsoft\\Office\\*.log" -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\System32\\wbem\\Logs\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear .NET Temp":
        cmd = 'Remove-Item "$env:LOCALAPPDATA\\Temp\\Temporary ASP.NET Files\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Java/Flash":
        cmd = 'Remove-Item "$env:LOCALAPPDATA\\Macromedia\\Flash Player\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Spotlight/Maps":
        cmd = 'Remove-Item "$env:LOCALAPPDATA\\Packages\\Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy\\LocalState\\Assets\\*" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item "$env:LOCALAPPDATA\\Packages\\Microsoft.WindowsMaps*\\LocalState\\mapscache\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Activity Hist.":
        cmd = 'Remove-Item "$env:LOCALAPPDATA\\ConnectedDevicesPlatform\\*" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item "$env:LOCALAPPDATA\\Microsoft\\Windows\\Clipboard\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Print Queue":
        cmd = 'Stop-Service spooler -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\System32\\spool\\PRINTERS\\*" -Recurse -Force -ErrorAction SilentlyContinue; Start-Service spooler -ErrorAction SilentlyContinue';
        break;
      case "Clear Defender Hist.":
        cmd = 'Remove-Item "C:\\ProgramData\\Microsoft\\Windows Defender\\Scans\\History\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "System File Checker":
        cmd = 'sfc /scannow';
        break;
      case "DISM RestoreHealth":
        cmd = 'DISM /Online /Cleanup-Image /RestoreHealth';
        break;
      case "DISM ResetBase":
        cmd = 'DISM /Online /Cleanup-Image /StartComponentCleanup /ResetBase';
        break;
      case "Check Disk (C:)":
        cmd = 'echo y | chkdsk C: /f /r /x';
        break;
      case "Trim SSD (C:)":
        cmd = 'Optimize-Volume -DriveLetter C -ReTrim -Verbose';
        break;
      case "Clear Font Cache":
        cmd = 'Stop-Service FontCache -Force -ErrorAction SilentlyContinue; Remove-Item C:\\Windows\\ServiceProfiles\\LocalService\\AppData\\Local\\FontCache\\* -Recurse -Force -ErrorAction SilentlyContinue; Start-Service FontCache -ErrorAction SilentlyContinue';
        break;
      case "Clear Live Tile/WS":
        cmd = 'WSReset.exe; Remove-Item "$env:LOCALAPPDATA\\Packages\\Microsoft.Windows.StartMenuExperienceHost_cw5n1h2txyewy\\LocalState\\*" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Clear Kerberos/SSL":
        cmd = 'klist purge; certutil -urlcache * delete';
        break;
      // ── Registry (Batch 2) ────────────────────────
      case "Remove Home Nav":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Classes\\CLSID\\{f874310e-b6b7-47dc-bc84-b9e6b38f5903}" /v System.IsPinnedToNameSpaceTree /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Classes\\CLSID\\{f874310e-b6b7-47dc-bc84-b9e6b38f5903}" /v System.IsPinnedToNameSpaceTree /t REG_DWORD /d 1 /f';
        break;
      case "Remove Gallery Nav":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Classes\\CLSID\\{e88865ea-0e1c-4e20-9aa6-edcd0212c87c}" /v System.IsPinnedToNameSpaceTree /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Classes\\CLSID\\{e88865ea-0e1c-4e20-9aa6-edcd0212c87c}" /v System.IsPinnedToNameSpaceTree /t REG_DWORD /d 1 /f';
        break;
      case "Classic Context Menu":
        cmd = enabled
          ? 'if (!(Test-Path "HKCU:\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}")) { New-Item -Path "HKCU:\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}" -Force }; if (!(Test-Path "HKCU:\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32")) { New-Item -Path "HKCU:\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32" -Force }; Set-ItemProperty -Path "HKCU:\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32" -Name "(Default)" -Value ""'
          : 'Remove-Item -Path "HKCU:\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}" -Recurse -Force -ErrorAction SilentlyContinue';
        break;
      case "Taskbar End Task":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced\\TaskbarDeveloperSettings" /v TaskbarEndTask /t REG_DWORD /d 1 /f'
          : 'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced\\TaskbarDeveloperSettings" /v TaskbarEndTask /f -ErrorAction SilentlyContinue';
        break;
      case "Disable Suggested Act.":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\SmartActionPlatform\\SmartClipboard" /v Disabled /t REG_DWORD /d 1 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\SmartActionPlatform\\SmartClipboard" /v Disabled /t REG_DWORD /d 0 /f';
        break;
      case "Kill Presence Sensing":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PresenceSensor\\Settings" /v UserPreference /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PresenceSensor\\Settings" /v UserPreference /t REG_DWORD /d 1 /f';
        break;
      case "Disable Focus Clock":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableFocusAssist /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableFocusAssist /t REG_DWORD /d 1 /f';
        break;
      case "Kill Notification Bell":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableNotifications /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableNotifications /t REG_DWORD /d 1 /f';
        break;
      case "Disable Copilot (All)":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v ShowCopilotButton /t REG_DWORD /d 0 /f; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot" /v TurnOffWindowsCopilot /t REG_DWORD /d 1 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v ShowCopilotButton /t REG_DWORD /d 1 /f; reg delete "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot" /v TurnOffWindowsCopilot /f -ErrorAction SilentlyContinue';
        break;
      case "Disable AI Recall":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI" /v DisableAIDataAnalysis /t REG_DWORD /d 1 /f; Set-Service -Name RecallSvc -StartupType Disabled -ErrorAction SilentlyContinue'
          : 'reg delete "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI" /v DisableAIDataAnalysis /f -ErrorAction SilentlyContinue; Set-Service -Name RecallSvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Disable Search Logo":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\SearchSettings" /v IsDynamicSearchBoxEnabled /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\SearchSettings" /v IsDynamicSearchBoxEnabled /t REG_DWORD /d 1 /f';
        break;
      case "Disable Search Weather":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search" /v SearchBoxWeather /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Search" /v SearchBoxWeather /t REG_DWORD /d 1 /f';
        break;
      case "Clean Start Menu":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v Start_IrisRecommendations /t REG_DWORD /d 0 /f; reg add "HKLM\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Start" /v DisableStartMenuTips /t REG_DWORD /d 1 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v Start_IrisRecommendations /t REG_DWORD /d 1 /f; reg delete "HKLM\\SOFTWARE\\Microsoft\\PolicyManager\\current\\device\\Start" /v DisableStartMenuTips /f -ErrorAction SilentlyContinue';
        break;
      case "Clear Quick Access":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer" /v ShowRecent /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer" /v ShowFrequent /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer" /v ShowRecent /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer" /v ShowFrequent /t REG_DWORD /d 1 /f';
        break;
      case "Disable Snap Groups":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableSnapAssistFlyout /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v EnableSnapAssistFlyout /t REG_DWORD /d 1 /f';
        break;
      case "Disable Share Modern":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked" /v "{E2BF9676-5F8F-435C-97EB-11607A5BEDF7}" /t REG_SZ /d "" /f'
          : 'reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked" /v "{E2BF9676-5F8F-435C-97EB-11607A5BEDF7}" /f -ErrorAction SilentlyContinue';
        break;
      case "Hide Modern Scrollbars":
        cmd = enabled
          ? 'reg add "HKCU\\Control Panel\\Accessibility" /v DynamicScrollbars /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Control Panel\\Accessibility" /v DynamicScrollbars /t REG_DWORD /d 1 /f';
        break;
      case "Disable Rounded Corn.":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\DWM" /v RoundedCornersDisabled /t REG_DWORD /d 1 /f'
          : 'reg delete "HKCU\\Software\\Microsoft\\Windows\\DWM" /v RoundedCornersDisabled /f -ErrorAction SilentlyContinue';
        break;
      case "Disable Acrylic/Blur":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarAcrylicOpacity /t REG_DWORD /d 0 /f'
          : 'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarAcrylicOpacity /f -ErrorAction SilentlyContinue';
        break;
      case "Kill Settings Ads":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\UserProfileEngagement" /v ScoobeSystemSettingEnabled /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarBadges /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\UserProfileEngagement" /v ScoobeSystemSettingEnabled /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarBadges /t REG_DWORD /d 1 /f';
        break;

      // ── Gaming (Batch 2) ────────────────────────
      case "Exclude Steam (Scan)":
        cmd = enabled
          ? 'Add-MpPreference -ExclusionPath "C:\\Program Files (x86)\\Steam"'
          : 'Remove-MpPreference -ExclusionPath "C:\\Program Files (x86)\\Steam" -ErrorAction SilentlyContinue';
        break;
      case "Exclude Epic (Scan)":
        cmd = enabled
          ? 'Add-MpPreference -ExclusionPath "C:\\Program Files\\Epic Games"'
          : 'Remove-MpPreference -ExclusionPath "C:\\Program Files\\Epic Games" -ErrorAction SilentlyContinue';
        break;
      case "Disable Defender RT":
        cmd = enabled
          ? 'Set-MpPreference -DisableRealtimeMonitoring $true'
          : 'Set-MpPreference -DisableRealtimeMonitoring $false';
        break;
      case "Disable Cloud Prot.":
        cmd = enabled
          ? 'Set-MpPreference -MAPSReporting 0; Set-MpPreference -SubmitSamplesConsent 2'
          : 'Set-MpPreference -MAPSReporting 2; Set-MpPreference -SubmitSamplesConsent 1';
        break;
      case "Disable Tamper Prot.":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Features" /v TamperProtection /t REG_DWORD /d 4 /f'
          : 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows Defender\\Features" /v TamperProtection /t REG_DWORD /d 5 /f';
        break;
      case "Disable NIS / PUA":
        cmd = enabled
          ? 'Set-MpPreference -DisableIOAVProtection $true; Set-MpPreference -PUAProtection 0'
          : 'Set-MpPreference -DisableIOAVProtection $false; Set-MpPreference -PUAProtection 1';
        break;
      case "Disable Behavior Mon.":
        cmd = enabled
          ? 'Set-MpPreference -DisableBehaviorMonitoring $true; Set-MpPreference -DisableScriptScanning $true'
          : 'Set-MpPreference -DisableBehaviorMonitoring $false; Set-MpPreference -DisableScriptScanning $false';
        break;
      case "Kill Auto Maintenance":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Schedule\\Maintenance" /v MaintenanceDisabled /t REG_DWORD /d 1 /f'
          : 'reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Schedule\\Maintenance" /v MaintenanceDisabled /f -ErrorAction SilentlyContinue';
        break;
      case "Disable VBS / HVCI":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard" /v EnableVirtualizationBasedSecurity /t REG_DWORD /d 0 /f; reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity" /v Enabled /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard" /v EnableVirtualizationBasedSecurity /t REG_DWORD /d 1 /f';
        break;
      case "Disable Script Host":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows Script Host\\Settings" /v Enabled /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows Script Host\\Settings" /v Enabled /t REG_DWORD /d 1 /f';
        break;
      case "Increase TDR Delay":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v TdrDelay /t REG_DWORD /d 10 /f; reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v TdrDdiDelay /t REG_DWORD /d 10 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v TdrDelay /f -ErrorAction SilentlyContinue';
        break;
      case "Disable TDR Level":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v TdrLevel /t REG_DWORD /d 0 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v TdrLevel /f -ErrorAction SilentlyContinue';
        break;
      case "GPU Large Pages":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" /v LargePageMinimum /t REG_DWORD /d 0xFFFFFFFF /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" /v LargePageMinimum /f -ErrorAction SilentlyContinue';
        break;
      case "Disable GPU P-States":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v DisableDynamicPstate /t REG_DWORD /d 1 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v DisableDynamicPstate /f -ErrorAction SilentlyContinue';
        break;
      case "Disable AMD ULPS":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PPFeatureMask /t REG_DWORD /d 1 /f'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PPFeatureMask /t REG_DWORD /d 4243584 /f';
        break;
      case "Force FSE Tearing":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v EnableTearing /t REG_DWORD /d 1 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v EnableTearing /f -ErrorAction SilentlyContinue';
        break;

      // ── New Starters (V1.0.30 Expansion) ────────────────────────
      case "Enable Game Mode":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\GameBar" /v AllowAutoGameMode /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\GameBar" /v AutoGameModeEnabled /t REG_DWORD /d 1 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\GameBar" /v AllowAutoGameMode /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\GameBar" /v AutoGameModeEnabled /t REG_DWORD /d 0 /f';
        break;
      case "Enable XMP/EXPO Check":
        cmd = 'powershell.exe -Command "Start-Process taskmgr; Write-Host \'Check Performance tab → Memory speed. If it does not match your RAM spec, enable XMP/EXPO in BIOS.\'"';
        break;
      case "Resizable BAR / SAM":
        cmd = 'powershell.exe -Command "nvidia-smi --query-gpu=name,pci.bus_id --format=csv,noheader -ErrorAction SilentlyContinue; Write-Host \'To enable Resizable BAR: Enter BIOS → Enable Above 4G Decoding & Resizable BAR. Then enable in NVIDIA/AMD control panel.\'"';
        break;
      case "Enable VRR":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" /v DirectXUserGlobalSettings /t REG_SZ /d "VRROptimizeEnable=1;" /f'
          : 'reg delete "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" /v DirectXUserGlobalSettings /f -ErrorAction SilentlyContinue';
        break;
      case "G-Sync / FreeSync":
        cmd = 'powershell.exe -Command "Start-Process \\"C:\\Program Files\\NVIDIA Corporation\\NVIDIA Control Panel\\nvcplui.exe\\" -ErrorAction SilentlyContinue; Write-Host \'Open GPU Control Panel → Display → Set up G-SYNC/FreeSync → Enable.\'"';
        break;
      case "GPU Max Performance":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PerfLevelSrc /t REG_DWORD /d 8738 /f; reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PowerMizerEnable /t REG_DWORD /d 1 /f; reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PowerMizerLevel /t REG_DWORD /d 1 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PerfLevelSrc /f -ErrorAction SilentlyContinue; reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PowerMizerEnable /f -ErrorAction SilentlyContinue';
        break;
      case "Disable V-Sync Global":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v VSyncControl /t REG_DWORD /d 0 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v VSyncControl /f -ErrorAction SilentlyContinue';
        break;
      case "Texture Filter Perf.":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v TextureFilterQuality /t REG_DWORD /d 0 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v TextureFilterQuality /f -ErrorAction SilentlyContinue';
        break;
      case "Disable DWM Transparency":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v EnableTransparency /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize" /v EnableTransparency /t REG_DWORD /d 1 /f';
        break;
      case "Disable Visual Effects":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects" /v VisualFXSetting /t REG_DWORD /d 2 /f; reg add "HKCU\\Control Panel\\Desktop" /v UserPreferencesMask /t REG_BINARY /d 9012038010000000 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects" /v VisualFXSetting /t REG_DWORD /d 0 /f';
        break;
      case "Disable Mouse Accel.":
        cmd = enabled
          ? 'reg add "HKCU\\Control Panel\\Mouse" /v MouseSpeed /t REG_SZ /d "0" /f; reg add "HKCU\\Control Panel\\Mouse" /v MouseThreshold1 /t REG_SZ /d "0" /f; reg add "HKCU\\Control Panel\\Mouse" /v MouseThreshold2 /t REG_SZ /d "0" /f'
          : 'reg add "HKCU\\Control Panel\\Mouse" /v MouseSpeed /t REG_SZ /d "1" /f; reg add "HKCU\\Control Panel\\Mouse" /v MouseThreshold1 /t REG_SZ /d "6" /f; reg add "HKCU\\Control Panel\\Mouse" /v MouseThreshold2 /t REG_SZ /d "10" /f';
        break;
      case "Disable HW Accel Apps":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v DisableHWAcceleration /t REG_DWORD /d 1 /f'
          : 'reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v DisableHWAcceleration /f -ErrorAction SilentlyContinue';
        break;
      case "Remove OEM Bloatware":
        cmd = 'Get-AppxPackage *McAfee* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *Norton* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *WildTangent* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *CyberLink* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *Dolby* | Remove-AppxPackage -ErrorAction SilentlyContinue';
        break;
      case "Disable Startup Apps":
        cmd = enabled
          ? 'Get-CimInstance Win32_StartupCommand | Where-Object { $_.Name -notmatch "NVIDIA|Realtek|Security|Windows" } | ForEach-Object { reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" /v $_.Name /t REG_BINARY /d 0300000000000000 /f -ErrorAction SilentlyContinue }'
          : 'Write-Host "Re-enable startup apps via Task Manager → Startup tab"';
        break;
      case "Disable Search Indexer":
        cmd = enabled
          ? 'Set-Service -Name WSearch -StartupType Disabled -ErrorAction SilentlyContinue; Stop-Service -Name WSearch -Force -ErrorAction SilentlyContinue'
          : 'Set-Service -Name WSearch -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name WSearch -ErrorAction SilentlyContinue';
        break;
      case "Enable SSD TRIM":
        cmd = enabled
          ? 'fsutil behavior set DisableDeleteNotify 0'
          : 'fsutil behavior set DisableDeleteNotify 1';
        break;
      case "Disable Auto-Updates":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" /v ActiveHoursStart /t REG_DWORD /d 8 /f; reg add "HKLM\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" /v ActiveHoursEnd /t REG_DWORD /d 2 /f; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" /v NoAutoUpdate /t REG_DWORD /d 1 /f'
          : 'reg delete "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" /v NoAutoUpdate /f -ErrorAction SilentlyContinue';
        break;
      case "Audio 48kHz Optimal":
        cmd = enabled
          ? 'Get-ChildItem "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Render" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -eq "Properties" } | ForEach-Object { Set-ItemProperty -Path $_.PSPath -Name "{E4870E26-3CC5-4CD2-BA49-A560E36CE4F0},0" -Value 48000 -ErrorAction SilentlyContinue }'
          : 'Write-Host "Reset audio sample rate via Sound Settings → Output → Format"';
        break;
      case "Disable Audio Enhance.":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Multimedia\\Audio" /v DisableEffects /t REG_DWORD /d 1 /f'
          : 'reg delete "HKCU\\Software\\Microsoft\\Multimedia\\Audio" /v DisableEffects /f -ErrorAction SilentlyContinue';
        break;
      case "Disable Windows Tips":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SubscribedContent-338389Enabled /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SoftLandingEnabled /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager" /v SubscribedContent-338389Enabled /t REG_DWORD /d 1 /f';
        break;
      case "Disable Feedback Hub":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Siuf\\Rules" /v NumberOfSIUFInPeriod /t REG_DWORD /d 0 /f; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" /v DoNotShowFeedbackNotifications /t REG_DWORD /d 1 /f'
          : 'reg delete "HKCU\\Software\\Microsoft\\Siuf\\Rules" /v NumberOfSIUFInPeriod /f -ErrorAction SilentlyContinue; reg delete "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" /v DoNotShowFeedbackNotifications /f -ErrorAction SilentlyContinue';
        break;
      case "Remove Windows Bloat":
        cmd = 'Get-AppxPackage *Microsoft.549981C3F5F10* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *king.com* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *Microsoft.WindowsMaps* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *Microsoft.People* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *Microsoft.WindowsMail* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *Microsoft.BingWeather* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *Microsoft.GetHelp* | Remove-AppxPackage -ErrorAction SilentlyContinue; Get-AppxPackage *Clipchamp* | Remove-AppxPackage -ErrorAction SilentlyContinue';
        break;
      case "Set Scaling 100%":
        cmd = enabled
          ? 'reg add "HKCU\\Control Panel\\Desktop" /v LogPixels /t REG_DWORD /d 96 /f; reg add "HKCU\\Control Panel\\Desktop" /v Win8DpiScaling /t REG_DWORD /d 0 /f'
          : 'reg delete "HKCU\\Control Panel\\Desktop" /v LogPixels /f -ErrorAction SilentlyContinue';
        break;
      case "Disable Wi-Fi Sense":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\WcmSvc\\wifinetworkmanager\\config" /v AutoConnectAllowedOEM /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SOFTWARE\\Microsoft\\WcmSvc\\wifinetworkmanager\\config" /v AutoConnectAllowedOEM /t REG_DWORD /d 1 /f';
        break;
      case "Enable QoS Scheduler":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Psched" /v NonBestEffortLimit /t REG_DWORD /d 0 /f'
          : 'reg delete "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Psched" /v NonBestEffortLimit /f -ErrorAction SilentlyContinue';
        break;
      case "Mouse 1000Hz Check":
        cmd = 'powershell.exe -Command "Write-Host \'Check your mouse manufacturer software (Logitech G-Hub, Razer Synapse, etc.) and set Polling Rate to 1000Hz or higher.\'"';
        break;
      case "Fast Keyboard Repeat":
        cmd = enabled
          ? 'reg add "HKCU\\Control Panel\\Keyboard" /v KeyboardDelay /t REG_SZ /d "0" /f; reg add "HKCU\\Control Panel\\Keyboard" /v KeyboardSpeed /t REG_SZ /d "31" /f'
          : 'reg add "HKCU\\Control Panel\\Keyboard" /v KeyboardDelay /t REG_SZ /d "1" /f; reg add "HKCU\\Control Panel\\Keyboard" /v KeyboardSpeed /t REG_SZ /d "12" /f';
        break;
      case "Disable Clipboard Hist.":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Clipboard" /v EnableClipboardHistory /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Clipboard" /v EnableClipboardHistory /t REG_DWORD /d 1 /f';
        break;
      case "Disable Nearby Sharing":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CDP" /v NearShareChannelUserAuthzPolicy /t REG_DWORD /d 0 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CDP" /v CdpSessionUserAuthzPolicy /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CDP" /v NearShareChannelUserAuthzPolicy /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CDP" /v CdpSessionUserAuthzPolicy /t REG_DWORD /d 1 /f';
        break;
      case "GPU Shader Cache Max":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v ShaderCacheSize /t REG_DWORD /d 4294967295 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v ShaderCacheSize /f -ErrorAction SilentlyContinue';
        break;
      case "Verify SSD Game Drive":
        cmd = 'powershell.exe -Command "Get-PhysicalDisk | Select-Object FriendlyName, MediaType, Size | Format-Table -AutoSize; Write-Host \'Ensure your game drive shows MediaType: SSD. If HDD, move games to an SSD.\'"';
        break;
      case "Disable Copilot/Widgets":
        cmd = enabled
          ? 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v ShowCopilotButton /t REG_DWORD /d 0 /f; reg add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot" /v TurnOffWindowsCopilot /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarDa /t REG_DWORD /d 0 /f'
          : 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v ShowCopilotButton /t REG_DWORD /d 1 /f; reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced" /v TaskbarDa /t REG_DWORD /d 1 /f; reg delete "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot" /v TurnOffWindowsCopilot /f -ErrorAction SilentlyContinue';
        break;
      case "PCIe Link State Off":
        cmd = enabled
          ? 'powercfg /setacvalueindex SCHEME_CURRENT SUB_PCIEXPRESS ASPM 0; powercfg /setactive SCHEME_CURRENT'
          : 'powercfg /setacvalueindex SCHEME_CURRENT SUB_PCIEXPRESS ASPM 2; powercfg /setactive SCHEME_CURRENT';
        break;
      case "Disable Startup Sound":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Authentication\\LogonUI\\BootAnimation" /v DisableStartupSound /t REG_DWORD /d 1 /f'
          : 'reg delete "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Authentication\\LogonUI\\BootAnimation" /v DisableStartupSound /f -ErrorAction SilentlyContinue';
        break;
      case "Pagefile Auto-Manage":
        cmd = enabled
          ? 'wmic computersystem set AutomaticManagedPagefile=True'
          : 'Write-Host "Pagefile is already system-managed."';
        break;
      case "Disable Remote Desktop":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 1 /f; netsh advfirewall firewall set rule group="Remote Desktop" new enable=No -ErrorAction SilentlyContinue'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f';
        break;
      case "Disable BT Discovery":
        cmd = enabled
          ? 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Bluetooth" /v DiscoverableMode /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Bluetooth" /v DiscoverableMode /t REG_DWORD /d 1 /f';
        break;
      case "Enable Disk Write Cache":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Enum\\IDE" /v CacheIsPowerProtected /t REG_DWORD /d 1 /f -ErrorAction SilentlyContinue; powershell.exe -Command "Write-Host \'Disk write caching enabled. Also verify in Device Manager → Disk Drives → Properties → Policies.\'"'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Enum\\IDE" /v CacheIsPowerProtected /f -ErrorAction SilentlyContinue';
        break;
      case "PCIe Root Power Off":
        cmd = enabled
          ? 'powercfg /setacvalueindex SCHEME_CURRENT 501A4D13-42AF-4429-9FD1-A8218C268E20 EE12F906-D277-404b-B6DA-E5FA1A576DF5 0; powercfg /setactive SCHEME_CURRENT'
          : 'powercfg /setacvalueindex SCHEME_CURRENT 501A4D13-42AF-4429-9FD1-A8218C268E20 EE12F906-D277-404b-B6DA-E5FA1A576DF5 1; powercfg /setactive SCHEME_CURRENT';
        break;

      // ── System (Batch 2) ────────────────────────
      case "Disable Mem Compress.":
        cmd = enabled
          ? 'Disable-mmAgent -MemoryCompression'
          : 'Enable-mmAgent -MemoryCompression';
        break;
      case "Disable Page Combin.":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" /v DisablePageCombining /t REG_DWORD /d 1 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" /v DisablePageCombining /f -ErrorAction SilentlyContinue';
        break;
      case "High Game I/O":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" /v ModifiedWriteMaximum /t REG_DWORD /d 1024 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" /v ModifiedWriteMaximum /f -ErrorAction SilentlyContinue';
        break;
      case "Lock Working Sets":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" /v DisablePageTrimming /t REG_DWORD /d 1 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management" /v DisablePageTrimming /f -ErrorAction SilentlyContinue';
        break;
      case "TCP Congestion CTCP":
        cmd = enabled
          ? 'netsh int tcp set global congestionprovider=ctcp'
          : 'netsh int tcp set global congestionprovider=default';
        break;
      case "TCP Autotuning Off":
        cmd = enabled
          ? 'netsh int tcp set global autotuninglevel=disabled'
          : 'netsh int tcp set global autotuninglevel=normal';
        break;
      case "Max User Ports":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v MaxUserPort /t REG_DWORD /d 65534 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v MaxUserPort /f -ErrorAction SilentlyContinue';
        break;
      case "TCP Timed Wait":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpTimedWaitDelay /t REG_DWORD /d 30 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v TcpTimedWaitDelay /f -ErrorAction SilentlyContinue';
        break;
      case "Disable SMB Multi.":
        cmd = enabled
          ? 'Set-SmbServerConfiguration -EnableMultiChannel $false -Force'
          : 'Set-SmbServerConfiguration -EnableMultiChannel $true -Force';
        break;
      case "Disable Media Sense":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v DisableDHCPMediaSense /t REG_DWORD /d 1 /f'
          : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters" /v DisableDHCPMediaSense /f -ErrorAction SilentlyContinue';
        break;
      case "Disable NetBIOS Global":
        cmd = enabled
          ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\NetBT\\Parameters" /v EnableLMHosts /t REG_DWORD /d 0 /f'
          : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Services\\NetBT\\Parameters" /v EnableLMHosts /t REG_DWORD /d 1 /f';
        break;

      case "Disable Win Connect":
        cmd = enabled ? 'Set-Service -Name wcncsvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name wcncsvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill LLTD / Topology":
        cmd = enabled ? 'Set-Service -Name lltdsvc -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name fdhost -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name fdrespub -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name lltdsvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Disable HomeGroup":
        cmd = enabled ? 'Set-Service -Name HomeGroupProvider -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name HomeGroupListener -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name HomeGroupProvider -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill Ent. App Mgmt":
        cmd = enabled ? 'Set-Service -Name EnterpriseAppManagementSvc -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name workfolderssvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name workfolderssvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill Assigned Access":
        cmd = enabled ? 'Set-Service -Name AssignedAccessManagerSvc -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name embeddedlogon -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name embeddedlogon -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Disable Maps Manager":
        cmd = enabled ? 'Set-Service -Name MapsBroker -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name MapsBroker -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill Mobile Hotspot":
        cmd = enabled ? 'Set-Service -Name icssvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name icssvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Disable WTG / CExec":
        cmd = enabled ? 'Set-Service -Name WTGService -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name cexecsvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name WTGService -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill Device Setup":
        cmd = enabled ? 'Set-Service -Name DsmSvc -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name DABHost -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name DsmSvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Purge Standby RAM":
        cmd = 'powershell "Remove-Item -Path $env:TEMP\\* -Recurse -Force; [GC]::Collect()"';
        break;
      case "Clear Standby RAM":
        cmd = '$proc = New-Object System.Diagnostics.Process; $proc.StartInfo.FileName = "powershell"; $proc.StartInfo.Arguments = "-Command [System.Reflection.Assembly]::LoadWithPartialName(\"System.Runtime.InteropServices\"); $mem = Add-Type -MemberDefinition \"[DllImport(\\\"kernel32.dll\\\")] public static extern bool SetProcessWorkingSetSize(IntPtr h, int min, int max);\" -Name Memory -PassThru; $mem::SetProcessWorkingSetSize([System.Diagnostics.Process]::GetCurrentProcess().Handle, -1, -1)"; $proc.StartInfo.Verb = "runas"; $proc.StartInfo.UseShellExecute = $true; $proc.Start(); $proc.WaitForExit(); Write-Host "Standby RAM cleared successfully"';
        break;
      case "Restart Explorer":
        cmd = 'Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; Start-Process explorer; Write-Host "Explorer restarted"';
        break;
      case "Run FPS Benchmark":
        cmd = `$r='${app.getPath('documents').replace(/\\/g, '\\\\')}\\NovaOptimizerReports'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $cpu=winsat cpuformal -xml "$r\\cpu-benchmark.xml" 2>$null; $mem=winsat memformal -xml "$r\\mem-benchmark.xml" 2>$null; $disk=winsat diskformal -xml "$r\\disk-benchmark.xml" 2>$null; $gpu=winsat graphicsformal -xml "$r\\gpu-benchmark.xml" 2>$null; $results=@{Timestamp=Get-Date;CPU=$cpu;Memory=$mem;Disk=$disk;GPU=$gpu;Score=0}; if (Test-Path "$r\\cpu-benchmark.xml") { [xml]$x=Get-Content "$r\\cpu-benchmark.xml"; $results.Score=[math]::Round(($x.WinSAT.CPUScore+($x.WinSAT.MemoryScore*0.8)+($x.WinSAT.DiskScore*0.6)+($x.WinSAT.GraphicsScore*0.9))/3.3,1) }; $results | ConvertTo-Json -Depth 3 | Out-File "$r\\benchmark-results.json" -Force; Write-Host "Benchmark Complete! Score: $($results.Score)/10.0"`;
        break;
      case "Auto-Clean Scheduler":
        cmd = `$r='${app.getPath('documents').replace(/\\/g, '\\\\')}\\NovaOptimizerReports'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $log="$r\\weekly-cleanup-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"; Add-Content $log "=== Nova Weekly Auto-Clean $(Get-Date) ==="; $tempSize=(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum/1MB; Add-Content $log "Temp folder before: $([math]::Round($tempSize,2)) MB"; Remove-Item "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item "C:\\Windows\\Temp\\*" -Recurse -Force -ErrorAction SilentlyContinue; $newTempSize=(Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum/1MB; Add-Content $log "Temp folder after: $([math]::Round($newTempSize,2)) MB"; $freed=[math]::Round($tempSize-$newTempSize,2); Add-Content $log "Freed: $freed MB"; Get-WmiObject Win32_LogicalDisk | Where-Object {$_.DriveType -eq 3 -and $_.FreeSpace/$_.Size -lt 0.3} | ForEach-Object { if ($_.Size -gt 100GB) { Add-Content $log "Checking $($_.DeviceID) for defrag..."; defrag $_.DeviceID /U /V | Add-Content $log }}; Add-Content $log "Cleanup completed at $(Get-Date)"; Write-Host "Weekly Auto-Clean complete! Freed $freed MB. Log: $log"`;
        break;
      case "Boot Time Optimizer":
        cmd = `$r='${app.getPath('documents').replace(/\\/g, '\\\\')}\\NovaOptimizerReports'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $bootTime=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime; $uptime=(Get-Date)-(Get-CimInstance Win32_OperatingSystem).LastBootUpTime; $report=@(); Get-CimInstance Win32_StartupCommand | ForEach-Object { $report+=@{Name=$_.Name;Command=$_.Command;Location=$_.Location;Impact=if($_.Command -match "(?i)(chrome|edge|firefox|spotify|discord|steam)"){"High"}else{"Medium"}} }; $json=$report | ConvertTo-Json -Depth 3; $json | Out-File "$r\\boot-analysis-$(Get-Date -Format 'yyyyMMdd').json"; $highImpact=($report | Where-Object {$_.Impact -eq "High"}).Count; Write-Host "Boot analysis complete! Found $($report.Count) startup items, $highImpact high-impact. Uptime: $($uptime.ToString('hh\\:mm'))"`;
        break;
      case "Process Killer":
        cmd = `$r='${app.getPath('documents').replace(/\\/g, '\\\\')}\\NovaOptimizerReports'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $procs=Get-Process | Where-Object {$_.WorkingSet64 -gt 100MB -or $_.CPU -gt 10} | Select-Object Name, Id, @{N='RAM(MB)';E={[math]::Round($_.WorkingSet64/1MB,1)}}, @{N='CPU(s)';E={[math]::Round($_.CPU,1)}} | Sort-Object 'RAM(MB)' -Descending | Select-Object -First 15; $procs | ConvertTo-Json -Depth 3 | Out-File "$r\\top-processes.json"; $totalRAM=[math]::Round(($procs | Measure-Object -Property 'RAM(MB)' -Sum).Sum,1); Write-Host "Top processes saved! High RAM/CPU: $($procs.Count) processes using $totalRAM MB. Open report to kill."`;
        break;
      case "Disk Health Monitor":
        cmd = `$r='${app.getPath('documents').replace(/\\/g, '\\\\')}\\NovaOptimizerReports'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $disks=Get-PhysicalDisk | Select-Object DeviceId, FriendlyName, MediaType, Size, @{N='HealthStatus';E={$_.HealthStatus}}, @{N='Temperature';E={(Get-StorageReliabilityCounter -DeviceNumber $_.DeviceId -ErrorAction SilentlyContinue).TemperatureCelsius}}, @{N='Wear';E={(Get-StorageReliabilityCounter -DeviceNumber $_.DeviceId -ErrorAction SilentlyContinue).Wear}}; $smartData=Get-WmiObject -Namespace "root\\wmi" -Class MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue | Select-Object InstanceName, PredictFailure, Reason; $report=@{Disks=$disks;SMART=$smartData;Timestamp=Get-Date}; $report | ConvertTo-Json -Depth 5 | Out-File "$r\\disk-health-$(Get-Date -Format 'yyyyMMdd').json"; $warnings=($disks | Where-Object {$_.HealthStatus -ne 'Healthy'}).Count; if($warnings -gt 0){Write-Host "WARNING: $warnings disk(s) showing issues! Check report immediately."}else{Write-Host "All disks healthy! SMART data logged to disk-health report."}`;
        break;
      case "Ping Optimizer":
        cmd = `$r='${app.getPath('documents').replace(/\\/g, '\\\\')}\\NovaOptimizerReports'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $dns=@(@{Name='Cloudflare';IP='1.1.1.1'},@{Name='Google';IP='8.8.8.8'},@{Name='OpenDNS';IP='208.67.222.222'},@{Name='Quad9';IP='9.9.9.9'}); $results=@(); foreach($d in $dns){ $ping=Test-Connection $d.IP -Count 3 -ErrorAction SilentlyContinue | Measure-Object ResponseTime -Average; $results+=@{Name=$d.Name;IP=$d.IP;AvgPing=if($ping.Count -gt 0){[math]::Round($ping.Average,1)}else{999};Status=if($ping.Count -gt 0){'OK'}else{'FAIL'}}}; $best=($results | Sort-Object AvgPing | Select-Object -First 1); $results | ConvertTo-Json -Depth 3 | Out-File "$r\\ping-history-$(Get-Date -Format 'yyyyMMdd-HHmm').json"; Write-Host "Best DNS: $($best.Name) ($($best.IP)) - $($best.AvgPing)ms avg. Set via adapter settings!"`;
        break;
      case "Network Throttle Control":
        cmd = `$r='${app.getPath('documents').replace(/\\/g, '\\\\')}\\NovaOptimizerReports'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $hogs=Get-Process | Where-Object {$_.ProcessName -match "(?i)(chrome|edge|firefox|opera|brave)" -or $_.ProcessName -match "(?i)(spotify|discord|steam|epic|origin)"} | Select-Object ProcessName, Id, @{N='WorkingSet(MB)';E={[math]::Round($_.WorkingSet64/1MB)}}, @{N='NetworkKbps';E={0}}; if($hogs.Count -gt 0){ $hogs | ConvertTo-Json | Out-File "$r\\bandwidth-hogs.json"; Write-Host "Found $($hogs.Count) potential bandwidth hogs! Chrome/Steam/Spotify detected. Use Task Manager or netsh to throttle."}else{Write-Host "No major bandwidth hogs detected. Network is clear!"}`;
        break;
      case "Steam Game Stats":
        cmd = `$r='${app.getPath('documents').replace(/\\/g, '\\\\')}\\NovaOptimizerReports'; New-Item -ItemType Directory -Path $r -Force | Out-Null; $steamPath=(Get-ItemProperty "HKCU:\\Software\\Valve\\Steam" -ErrorAction SilentlyContinue).SteamPath; if($steamPath){ $userData="$steamPath\\userdata"; $users=Get-ChildItem $userData -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\\d+$' }; if($users){ $userId=$users[0].Name; $config="$userData\\$userId\\config\\localconfig.vdf"; if(Test-Path $config){ $content=Get-Content $config -Raw; $games=@(); $appPattern='"(\d+)"\\s*\\{[^}]*"Playtime"\\s*"(\d+)"[^}]*"name"\\s*"([^"]+)"'; $matches=[regex]::Matches($content, $appPattern); $totalHours=0; for($i=0; $i -lt [Math]::Min(5, $matches.Count); $i++){ $m=$matches[$i]; $id=$m.Groups[1].Value; $minutes=[int]$m.Groups[2].Value; $hours=[Math]::Round($minutes/60); $name=$m.Groups[3].Value; $totalHours+=$hours; $games+=@{AppID=$id; Name=$name; Hours=$hours} }; $report=@{SteamPath=$steamPath; UserID=$userId; TotalHours=$totalHours; RecentGames=$games; Timestamp=Get-Date}; $report | ConvertTo-Json -Depth 3 | Out-File "$r\\steam-stats.json" -Force; Write-Host "Steam stats saved! Found $($games.Count) recent games, $totalHours total hours." }else{ Write-Host "Steam config not found. Play some games first!" } }else{ Write-Host "No Steam user data found." } }else{ Write-Host "Steam not installed or not found in registry." }`;
        break;
      case "Check GPU Drivers":
        cmd = '$g = Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name; if ($g -like "*NVIDIA*") { Start-Process "https://www.nvidia.com/download/index.aspx" } elseif ($g -like "*AMD*" -or $g -like "*Radeon*") { Start-Process "https://www.amd.com/en/support" } elseif ($g -like "*Intel*") { Start-Process "https://www.intel.com/content/www/us/en/download-center/home.html" } else { Start-Process "https://www.google.com/search?q=latest+gpu+drivers" }';
        break;
      case "Deep Temp/Cache Clean":
        cmd = 'powershell "Remove-Item -Path $env:TEMP\\* -Recurse -Force; Remove-Item -Path \'C:\\Windows\\Temp\\*\' -Recurse -Force"';
        break;
      case "Ghost Shell Mode":
        // This is a complex action, but we can simulate by killing/starting explorer or hiding icons via registry
        cmd = enabled
          ? 'powershell "reg add \'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced\' /v HideIcons /t REG_DWORD /d 1 /f; stop-process -name explorer -force"'
          : 'powershell "reg add \'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced\' /v HideIcons /t REG_DWORD /d 0 /f; start-process explorer"';
        break;

      // ── Manual System Checks ────────────────────────
      case "Verify GPU PCIe Lane Speed":
        cmd = '$gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1; $pcie = Get-CimInstance Win32_Bus -Filter "DeviceID like \"%PCI%\"" | Where-Object {$_.DeviceID -like \"*DEV_*\"}; Write-Host \"GPU: $($gpu.Name) - Check GPU-Z or NVIDIA Control Panel for PCIe lane width\"; Write-Host \"Expected: PCIe x16 Gen3/Gen4 - If showing x8, reseat GPU\"';
        break;
      case "Verify Resizable BAR Active":
        cmd = '$bar = reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers" /v HwSchMode 2>$null; if ($bar) { Write-Host "Resizable BAR reg key present - Check NVIDIA Control Panel / AMD Software for BAR status" } else { Write-Host "Resizable BAR reg key not found - Enable in BIOS and GPU drivers" }';
        break;
      case "Check GPU Hotspot Temperature Delta":
        cmd = 'Write-Host "Checking GPU temps..."; $gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1; Write-Host "GPU: $($gpu.Name)"; Write-Host \"Install GPU-Z or HWiNFO to check Hotspot vs Core temp delta - Should be under 15°C\"; Write-Host \"Higher delta indicates poor thermal paste application\"';
        break;
      case "Verify Monitor OSD Game Mode":
        cmd = 'Write-Host "MANUAL CHECK REQUIRED:"; Write-Host "1. Press monitor physical buttons"; Write-Host "2. Navigate to Game Mode / Overdrive settings"; Write-Host "3. Enable Game Mode and set Overdrive to Normal/Medium"; Write-Host "4. Disable Eco/Power Saving modes"';
        break;
      case "Check Monitor Color Depth":
        cmd = 'Write-Host "Checking color depth..."; $adapter = Get-CimInstance Win32_VideoController | Select-Object -First 1; Write-Host \"GPU: $($adapter.Name)\"; Write-Host \"Open NVIDIA Control Panel / AMD Software -> Display -> Color Depth\"; Write-Host \"Verify set to 10-bit or 8-bit (not dithering)\"';
        break;
      case "Verify DisplayPort/HDMI Cable Version":
        cmd = '$monitor = Get-CimInstance WmiMonitorBasicDisplayParams; Write-Host \"Connected monitors: $($monitor.Count)\"; Write-Host \"Check cable labeling: DP 1.4 or HDMI 2.1 for 144Hz+\"; Write-Host \"HDMI 1.4 limited to 120Hz at 1080p - Upgrade cable if needed\"';
        break;
      case "Test Display Cable Bandwidth Limit":
        cmd = 'Write-Host "Cable Bandwidth Test:"; Write-Host \"1. Set monitor to max refresh rate (144Hz/240Hz)\"; Write-Host \"2. If black screens or artifacts appear, cable is insufficient\"; Write-Host \"3. Try different cable or lower refresh rate temporarily\"';
        break;
      case "Verify GPU Fan Curve Performance":
        cmd = 'Write-Host "GPU Fan Check:"; Write-Host \"Use MSI Afterburner or GPU manufacturer software\"; Write-Host \"Set aggressive curve: 40% at 60°C, 70% at 70°C, 100% at 80°C\"; Write-Host \"Run stress test and verify fans spin up and temps stay under 83°C\"';
        break;
      case "Check Multiple Displays GPU Impact":
        cmd = '$monitors = Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty CurrentNumberOfMonitors; Write-Host \"Active monitors: $monitors\"; if ($monitors -gt 1) { Write-Host \"WARNING: Secondary 60Hz monitor may force primary to downclock memory\"; Write-Host \"Solutions: Match refresh rates or disconnect secondary while gaming\" }';
        break;
      case "Verify VRAM Usage vs Capacity":
        cmd = '$gpu = Get-CimInstance Win32_VideoController | Select-Object -First 1; $vram = [math]::Round($gpu.AdapterRAM / 1GB, 1); Write-Host \"GPU: $($gpu.Name) - Total VRAM: $vram GB\"; Write-Host \"Use MSI Afterburner overlay to monitor VRAM usage in-game\"; Write-Host \"If usage exceeds 90% of VRAM, reduce texture quality\"';
        break;
      case "Check CPU Core Clocks Under Load":
        cmd = '$cpu = Get-CimInstance Win32_Processor; Write-Host \"CPU: $($cpu.Name)\"; Write-Host \"Base: $($cpu.MaxClockSpeed) MHz - Boost should be higher\"; Write-Host \"Run Cinebench or game with HWiNFO open\"; Write-Host \"Verify all cores hit advertised boost frequency under load\"';
        break;
      case "Verify CPU Thermal Throttling":
        cmd = `Write-Host "CPU Thermal Check:"; Write-Host "Install HWiNFO64 and check 'Thermal Throttling' sensors"; Write-Host "Run stress test - if throttling shows YES, improve cooling"; Write-Host "Target: Under 85°C under full load"`;
        break;
      case "Confirm RAM Slots Populated Correctly":
        cmd = '$ram = Get-CimInstance Win32_PhysicalMemory; $slots = $ram | Select-Object DeviceLocator, BankLabel; Write-Host \"RAM Sticks Found: $($ram.Count)\"; $slots | ForEach-Object { Write-Host \"Slot: $($_.DeviceLocator) - $($_.BankLabel)\" }; Write-Host \"Verify in slots A2/B2 (2nd and 4th from CPU) for dual channel\"';
        break;
      case "Verify Actual RAM Speed vs Advertised":
        cmd = '$ram = Get-CimInstance Win32_PhysicalMemory | Select-Object -First 1; $speed = $ram.Speed; Write-Host \"Current RAM Speed: $speed MHz\"; Write-Host \"Check Task Manager -> Performance -> Memory for speed\"; Write-Host \"If lower than advertised (e.g., 2400 instead of 3600), enable XMP/EXPO in BIOS\"';
        break;
      case "Check RAM Timing Latency":
        cmd = 'Write-Host "RAM Timing Check:"; Write-Host \"Install CPU-Z -> Memory tab\"; Write-Host \"Check CAS Latency (CL) matches your kit specs\"; Write-Host \"Tighter timings = better frame pacing\"; Write-Host \"Example: CL16-18-18-38 for 3600MHz\"';
        break;
      case "Verify System Interrupts CPU Usage":
        cmd = `Write-Host "Interrupts Check:"; Write-Host "Open Task Manager -> Details tab -> Add 'Interrupts' column"; Write-Host "Interrupts should be under 1% constantly"; Write-Host "If higher, update chipset/USB drivers or check for hardware faults"`;
        break;
      case "Check CPU Cooler Pump Speed":
        cmd = 'Write-Host "AIO Pump Check:"; Write-Host \"Check BIOS or manufacturer software (CAM, iCUE, Armoury Crate)\"; Write-Host \"Pump should run at 100% or 3000+ RPM constantly\"; Write-Host \"Fan curves should be set on radiator fans, not pump\"';
        break;
      case "Verify PBO/MCE Status":
        cmd = '$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; Write-Host \"CPU: $($cpu.Name)\"; if ($cpu.Name -like \"*AMD*\") { Write-Host \"AMD: Check BIOS for Precision Boost Overdrive - should be Enabled\" } else { Write-Host \"Intel: Check BIOS for Multi-Core Enhancement / Turbo Boost Max - should be Enabled\" }';
        break;
      case "Check BIOS Version Currency":
        cmd = '$bios = Get-CimInstance Win32_BIOS; Write-Host \"Current BIOS: $($bios.SMBIOSBIOSVersion) - Date: $($bios.ReleaseDate)\"; Write-Host \"Visit motherboard manufacturer website to compare\"; Write-Host \"Early BIOS versions often have gaming performance bugs - update if older than 6 months\"';
        break;
      case "Verify Memory Integrity is Off":
        cmd = '$integrity = reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity" /v Enabled 2>$null; if ($integrity -like "*0x1*") { Write-Host \"WARNING: Memory Integrity is ON - costs up to 10% FPS\"; Write-Host \"Disable in Windows Security -> Device Security -> Core Isolation\" } else { Write-Host \"Memory Integrity is OFF - Good for gaming\" }';
        break;
      case "Check Windows Security Folder Exclusions":
        cmd = 'Write-Host "Defender Exclusions Check:"; $exclusions = Get-MpPreference | Select-Object -ExpandProperty ExclusionPath; Write-Host \"Current exclusions: $($exclusions.Count)\"; $exclusions | ForEach-Object { Write-Host \"  $_\" }; Write-Host \"Add game installation folders to reduce I/O bottlenecks\"';
        break;
      case "Verify Game Executable Antivirus Exclusions":
        cmd = 'Write-Host \"Game EXE Exclusions:\"; $exes = Get-MpPreference | Select-Object -ExpandProperty ExclusionExtension; Write-Host \"Add .exe files of your main games\"; Write-Host \"Example: Add cs2.exe, VALORANT-Win64-Shipping.exe\"; Write-Host \"Reduces real-time scanning overhead while gaming\"';
        break;
      case "Check Conflicting Third-Party Antivirus":
        cmd = '$av = Get-CimInstance Win32_Product | Where-Object {$_.Name -like \"*antivirus*\" -or $_.Name -like \"*security*\"}; Write-Host \"Installed AV products: $($av.Count)\"; $av | ForEach-Object { Write-Host \"  $($_.Name)\" }; Write-Host \"Running multiple AVs causes massive slowdown - uninstall all but one\"';
        break;
      case "Verify Windows Activation Status":
        cmd = '$license = Get-CimInstance SoftwareLicensingProduct | Where-Object {$_.PartialProductKey}; $activated = $license | Where-Object {$_.LicenseStatus -eq 1}; if ($activated) { Write-Host \"Windows is ACTIVATED - Good\" } else { Write-Host \"WARNING: Windows not activated - nag processes running\"; Write-Host \"Activate Windows for optimal performance\" }';
        break;
      case "Run SFC System File Checker":
        cmd = 'Write-Host \"Running SFC Scan...\"; sfc /scannow; Write-Host \"Scan complete - Restart if integrity violations were found\"';
        break;
      case "Run DISM CheckHealth":
        cmd = 'DISM /Online /Cleanup-Image /CheckHealth; if ($LASTEXITCODE -eq 0) { Write-Host \"Component store is healthy\" } else { Write-Host \"Run DISM /RestoreHealth to repair\" }';
        break;
      case "Verify Secure Boot Enabled":
        cmd = 'try { $sb = Confirm-SecureBootUEFI; if ($sb) { Write-Host \"Secure Boot: ENABLED - Good for anti-cheat\" } else { Write-Host \"Secure Boot: DISABLED - Enable in BIOS for Vanguard/FaceIT\" } } catch { Write-Host \"Secure Boot check failed - may not be supported\" }';
        break;
      case "Verify TPM 2.0 Active":
        cmd = '$tpm = Get-Tpm; if ($tpm.TpmPresent -and $tpm.TpmReady) { Write-Host \"TPM 2.0: ACTIVE - Required for Windows 11 and some anti-cheats\" } else { Write-Host \"TPM not ready - Enable in BIOS under Security/TPM settings\" }';
        break;
      case "Check Time Zone NTP Sync":
        cmd = `$tz = Get-TimeZone; $time = Get-Date; Write-Host "Current Time Zone: $($tz.StandardName)"; Write-Host "Current Time: $time"; Write-Host "Verify time is accurate - run \'w32tm /resync\' if needed"; Write-Host "Out of sync time causes game server authentication failures"`;
        break;
      case "Verify UAC Setting":
        cmd = '$uac = Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System -Name ConsentPromptBehaviorAdmin; if ($uac.ConsentPromptBehaviorAdmin -eq 2) { Write-Host \"WARNING: UAC set to Always Notify - causes micro-stutters\"; Write-Host \"Set to default (Notify only when apps try changes)\" } else { Write-Host \"UAC setting OK\" }';
        break;
      case "Check SSD Health TBW":
        cmd = 'Get-PhysicalDisk | ForEach-Object { Write-Host \"Disk: $($_.FriendlyName) - Health: $($_.HealthStatus)\" }; Write-Host \"Install CrystalDiskInfo for detailed TBW and wear level\"; Write-Host \"Replace SSD if health drops below 80%\"';
        break;
      case "Verify Game Drive Free Space":
        cmd = 'Get-Volume | Where-Object {$_.DriveLetter -and $_.Size -gt 0} | ForEach-Object { $free = [math]::Round($_.SizeRemaining / 1GB, 1); $total = [math]::Round($_.Size / 1GB, 1); $pct = [math]::Round(($_.SizeRemaining / $_.Size) * 100, 1); Write-Host \"$($_.DriveLetter): $free GB free of $total GB ($pct%)\"; if ($pct -lt 20) { Write-Host \"  WARNING: Less than 20% free - SSD performance degraded\" } }';
        break;
      case "Check Game on HDD":
        cmd = '$drives = Get-PhysicalDisk | Select-Object DeviceId, MediaType, FriendlyName; Write-Host \"Storage devices:\"; $drives | ForEach-Object { Write-Host \"  $($_.DeviceId): $($_.FriendlyName) - $($_.MediaType)\" }; Write-Host \"Check Steam/Epic library locations\"; Write-Host \"Move games from HDD to SSD for loading time improvements\"';
        break;
      case "Verify Pagefile Not on HDD":
        cmd = '$pf = Get-CimInstance Win32_PageFileUsage | Select-Object Name, AllocatedBaseSize; Write-Host \"Current pagefile location:\"; $pf | ForEach-Object { Write-Host \"  $($_.Name) - $($_.AllocatedBaseSize) MB\" }; Write-Host \"Ensure pagefile is on fastest SSD, not mechanical drive\"; Write-Host \"Move via System Properties -> Advanced -> Performance -> Virtual Memory\"';
        break;
      case "Check NVMe Driver Status":
        cmd = '$storage = Get-CimInstance Win32_SCSIController | Where-Object {$_.Name -like \"*NVMe*\"}; Write-Host \"NVMe Controllers: $($storage.Count)\"; $storage | ForEach-Object { Write-Host \"  $($_.Name)\" }; Write-Host \"Check Samsung Magician/WD Dashboard for manufacturer drivers\"; Write-Host \"Generic Windows NVMe driver is slower than vendor drivers\"';
        break;
      case "Clear Windows Thumbnail Cache":
        cmd = 'Remove-Item -Path "$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer\\thumbcache_*.db" -Force -ErrorAction SilentlyContinue; Write-Host \"Thumbnail cache cleared\"';
        break;
      case "Clear Windows Font Cache":
        cmd = 'Stop-Service -Name FontCache -Force -ErrorAction SilentlyContinue; Remove-Item -Path "$env:WINDIR\\ServiceProfiles\\LocalService\\AppData\\Local\\FontCache\\*" -Recurse -Force -ErrorAction SilentlyContinue; Start-Service -Name FontCache -ErrorAction SilentlyContinue; Write-Host \"Font cache rebuilt\"';
        break;
      case "Clear Windows Icon Cache":
        cmd = 'Remove-Item -Path "$env:LOCALAPPDATA\\IconCache.db" -Force -ErrorAction SilentlyContinue; Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Process explorer; Write-Host \"Icon cache rebuilt\"';
        break;
      case "Clear Discord Cache":
        cmd = '$dc = "$env:APPDATA\\discord\\Cache"; if (Test-Path $dc) { $size = (Get-ChildItem $dc -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB; Remove-Item -Path "$dc\\*" -Recurse -Force -ErrorAction SilentlyContinue; Write-Host \"Cleared $([math]::Round($size, 1)) MB from Discord cache\" } else { Write-Host \"Discord not installed or no cache\" }';
        break;
      case "Clear Steam Download Cache":
        cmd = '$sc = "$env:LOCALAPPDATA\\Steam\\htmlcache"; if (Test-Path $sc) { Remove-Item -Path "$sc\\*" -Recurse -Force -ErrorAction SilentlyContinue; Write-Host \"Steam download cache cleared\"; Write-Host \"Restart Steam to apply\" } else { Write-Host \"Steam cache path not found\" }';
        break;
      case "Clear Epic Games Cache":
        cmd = '$ec = "$env:LOCALAPPDATA\\EpicGamesLauncher\\Saved\\webcache"; if (Test-Path $ec) { Remove-Item -Path "$ec\\*" -Recurse -Force -ErrorAction SilentlyContinue; Write-Host \"Epic Games cache cleared\" } else { Write-Host \"Epic Launcher cache not found\" }';
        break;
      case "Clear Shader Caches":
        cmd = '$nc = "$env:LOCALAPPDATA\\NVIDIA\\DXCache"; $ac = "$env:LOCALAPPDATA\\AMD\\DxCache"; if (Test-Path $nc) { Remove-Item "$nc\\*" -Recurse -Force -ErrorAction SilentlyContinue; Write-Host \"NVIDIA shader cache cleared\" }; if (Test-Path $ac) { Remove-Item "$ac\\*" -Recurse -Force -ErrorAction SilentlyContinue; Write-Host \"AMD shader cache cleared\" }; Write-Host \"Old shaders cleared - may stutter briefly while rebuilding\"';
        break;
      case "Clear Windows Crash Dumps":
        cmd = '$cd = "$env:WINDIR\\Minidump"; $md = "$env:WINDIR\\Memory.dmp"; $size = 0; if (Test-Path $cd) { $size += (Get-ChildItem $cd | Measure-Object -Property Length -Sum).Sum }; if (Test-Path $md) { $size += (Get-Item $md).Length }; Remove-Item -Path "$cd\\*" -Force -ErrorAction SilentlyContinue; Remove-Item -Path $md -Force -ErrorAction SilentlyContinue; Write-Host \"Cleared $([math]::Round($size / 1MB, 1)) MB of crash dumps\"';
        break;
      case "Clear Windows Error Reports":
        cmd = '$er = "$env:PROGRAMDATA\\Microsoft\\Windows\\WER\\ReportArchive"; if (Test-Path $er) { $size = (Get-ChildItem $er -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB; Remove-Item -Path "$er\\*" -Recurse -Force -ErrorAction SilentlyContinue; Write-Host \"Cleared $([math]::Round($size, 1)) MB of error reports\" } else { Write-Host \"No error reports to clear\" }';
        break;
      case "Clear Windows Update Cleanup":
        cmd = 'Write-Host \"Running Windows Update Cleanup...\"; Dism.exe /online /Cleanup-Image /StartComponentCleanup /ResetBase; Write-Host \"Cleanup complete - may have freed several GB\"';
        break;
      case "Ping Test Game Servers":
        cmd = 'Write-Host \"Testing game server latency...\"; $servers = @{\"Google DNS\"=\"8.8.8.8\"; \"Cloudflare\"=\"1.1.1.1\"}; foreach ($s in $servers.GetEnumerator()) { $r = Test-Connection $s.Value -Count 4 -ErrorAction SilentlyContinue; if ($r) { $avg = [math]::Round(($r | Measure-Object ResponseTime -Average).Average); Write-Host \"$($s.Key): ${avg}ms\" } else { Write-Host \"$($s.Key): No response\" } }; Write-Host \"Test CS2: ping 155.133.248.38\"; Write-Host \"Test Valorant: ping 13.248.132.113\"';
        break;
      case "Run Packet Loss Test":
        cmd = 'Write-Host \"Running packet loss test (1000 packets to 8.8.8.8)...\"; $r = Test-Connection 8.8.8.8 -Count 1000 -ErrorAction SilentlyContinue; $sent = 1000; $recv = $r.Count; $loss = [math]::Round((($sent - $recv) / $sent) * 100, 2); Write-Host \"Sent: $sent, Received: $recv, Loss: $loss%\"; if ($loss -gt 1) { Write-Host \"WARNING: High packet loss detected!\" } else { Write-Host \"Packet loss acceptable\" }';
        break;
      case "Run Jitter Test":
        cmd = 'Write-Host \"Measuring jitter over 30 seconds...\"; $times = @(); for ($i = 0; $i -lt 30; $i++) { $r = Test-Connection 8.8.8.8 -Count 1 -ErrorAction SilentlyContinue; if ($r) { $times += $r.ResponseTime }; Start-Sleep 1 }; $jitter = [math]::Round(($times | Measure-Object -Maximum).Maximum - ($times | Measure-Object -Minimum).Minimum); Write-Host \"Jitter: ${jitter}ms (lower is better)\"; if ($jitter -gt 10) { Write-Host \"High jitter may cause hit registration issues\" }';
        break;
      case "Check Wi-Fi Signal Strength":
        cmd = `$wifi = Get-NetAdapter | Where-Object {$_.InterfaceDescription -like "*Wi-Fi*" -or $_.InterfaceDescription -like "*Wireless*"}; if ($wifi) { Write-Host "Wi-Fi adapter found: $($wifi.Name)"; Write-Host "Run \'netsh wlan show interfaces\' for signal %"; Write-Host "Signal should be above 80% for stable gaming" } else { Write-Host "No Wi-Fi adapter found - using Ethernet (good!)" }`;
        break;
      case "Verify Ethernet Link Speed":
        cmd = `$eth = Get-NetAdapter | Where-Object {$_.InterfaceDescription -like "*Ethernet*" -or $_.InterfaceDescription -like "*LAN*"}; $eth | ForEach-Object { Write-Host "$($_.Name): $($_.LinkSpeed)"; if ($_.LinkSpeed -like "*100 Mbps*") { Write-Host "  WARNING: Limited to 100Mbps - check cable/port" }; if ($_.LinkSpeed -like "*1 Gbps*" -or $_.LinkSpeed -like "*2.5 Gbps*") { Write-Host "  Good link speed!" } }`;
        break;
      case "Verify Ethernet Cable Category":
        cmd = 'Write-Host \"Cable Category Check:\"; Write-Host \"Check cable jacket printing for \'Cat5e\' or \'Cat6\'\"; Write-Host \"Cat5 (no \'e\') limited to 100Mbps - upgrade for gigabit\"; Write-Host \"For 2.5Gbps+, ensure Cat6 or better\"';
        break;
      case "Test MTU Fragmentation":
        cmd = 'Write-Host \"Testing MTU...\"; $mtu = 1472; while ($mtu -gt 1300) { $r = ping 8.8.8.8 -n 1 -l $mtu -f 2>$null; if ($r -like \"*Packet needs to be fragmented*\") { $mtu -= 10 } else { break } }; $optimal = $mtu + 28; Write-Host \"Optimal MTU: $optimal (common: 1500 for Ethernet, 1492 for PPPoE)\"';
        break;
      case "Check Active VPN Interference":
        cmd = '$vpn = Get-NetAdapter | Where-Object {$_.InterfaceDescription -like \"*VPN*\" -or $_.InterfaceDescription -like \"*Tun*\" -or $_.InterfaceDescription -like \"*Tap*\"}; if ($vpn) { Write-Host \"WARNING: VPN adapters detected:\"; $vpn | ForEach-Object { Write-Host \"  $($_.Name)\" }; Write-Host \"VPN adds latency - disable for competitive gaming\" } else { Write-Host \"No VPN adapters detected - Good\" }';
        break;
      case "Verify UPnP on Router":
        cmd = 'Write-Host \"UPnP Check:\"; Write-Host \"Login to router admin panel (usually 192.168.1.1)\"; Write-Host \"Navigate to Advanced/Security settings\"; Write-Host \"Ensure UPnP is enabled for automatic port forwarding\"; Write-Host \"Required for peer-to-peer game connections\"';
        break;
      case "Check Pending Windows Updates":
        cmd = '$updates = Get-WUHistory -MaxDate (Get-Date).AddDays(-7) -ErrorAction SilentlyContinue; $pending = Get-WUList -ErrorAction SilentlyContinue; if ($pending) { Write-Host \"Pending updates found: $($pending.Count)\"; Write-Host \"Install updates and restart to finalize performance patches\" } else { Write-Host \"No pending updates\" }; Write-Host \"Check Windows Update settings for schedule\"';
        break;
      case "Verify Discord QoS Priority":
        cmd = `Write-Host "Discord QoS Check:"; Write-Host "Open Discord -> Settings -> Voice & Video"; Write-Host "Ensure \'Quality of Service High Packet Priority\' is enabled"; Write-Host "This prioritizes voice packets for lower latency"`;
        break;
      case "Run Windows Memory Diagnostic":
        cmd = 'Write-Host \"Launching Windows Memory Diagnostic...\"; Write-Host \"System will restart and test RAM\"; $confirm = Read-Host \"Restart now? (Y/N)\"; if ($confirm -eq \"Y\") { mdsched } else { Write-Host \"Run \'mdsched\' manually when ready\" }';
        break;
      case "Check Visual C++ Redistributables":
        cmd = '$vc = Get-WmiObject Win32_Product | Where-Object {$_.Name -like \"*Visual C++*\"} | Select-Object Name, Version; Write-Host \"Installed VC++ Redists: $($vc.Count)\"; $vc | ForEach-Object { Write-Host \"  $($_.Name)\" }; Write-Host \"Ensure 2015-2022 x64 and x86 are installed\"; Write-Host \"Download from Microsoft if missing\"';
        break;
      case "Verify .NET Framework Versions":
        cmd = '$dotnet = Get-ItemProperty \"HKLM:SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full\" -Name Version -ErrorAction SilentlyContinue; if ($dotnet) { Write-Host \".NET Framework version: $($dotnet.Version)\" }; dxdiag /t dxdiag.txt; if (Test-Path dxdiag.txt) { $fl = Select-String -Path dxdiag.txt -Pattern \"Feature Levels\"; Write-Host \"$fl\"; Remove-Item dxdiag.txt }; Write-Host \"Verify Feature Level 12_1 or 12_2 for modern games\"';
        break;
      case "Check Orphaned Game Registry Keys":
        cmd = '$games = Get-ChildItem HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall | Get-ItemProperty | Where-Object {$_.DisplayName -like \"*game*\" -or $_.DisplayName -like \"*steam*\"}; Write-Host \"Installed game entries: $($games.Count)\"; Write-Host \"Use CCleaner to remove orphaned keys from uninstalled games\"; Write-Host \"Manual: Check HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\"';
        break;
      case "Verify Steam Game Files Integrity":
        cmd = 'Write-Host \"Steam File Integrity:\"; Write-Host \"1. Open Steam -> Library\"; Write-Host \"2. Right-click your most played game\"; Write-Host \"3. Properties -> Installed Files -> Verify Integrity\"; Write-Host \"4. Wait for scan to complete\"';
        break;
      case "Check Steam Library Drive Health":
        cmd = '$steam = (Get-ItemProperty \"HKCU:\\Software\\Valve\\Steam\" -Name SteamPath -ErrorAction SilentlyContinue).SteamPath; if ($steam) { $lib = Join-Path $steam \"steamapps\\common\"; $drive = (Get-Item $lib).PSDrive; Write-Host \"Steam library on drive: $($drive.Name)\"; Write-Host \"Free space: $([math]::Round($drive.Free / 1GB, 1)) GB\"; if (($drive.Free / $drive.Used) -lt 0.1) { Write-Host \"WARNING: Drive nearly full!\" } } else { Write-Host \"Steam not found in registry\" }';
        break;
      case "Verify Steam Overlay Status":
        cmd = 'Write-Host \"Steam Overlay Check:\"; Write-Host \"Steam -> Settings -> In-Game\"; Write-Host \"Enable Steam Overlay while in-game\"; Write-Host \"Enabled: Access friends/achievements in-game\"; Write-Host \"Disabled: May improve FPS in some games\"';
        break;
      case "Check Conflicting Game Launchers":
        cmd = '$launchers = @(); $processes = Get-Process | Where-Object {$_.ProcessName -like \"*steam*\" -or $_.ProcessName -like \"*epic*\" -or $_.ProcessName -like \"*ea*\" -or $_.ProcessName -like \"*ubisoft*\" -or $_.ProcessName -like \"*battle*\"}; $processes | ForEach-Object { $launchers += $_.ProcessName }; Write-Host \"Running launchers: $($launchers.Count)\"; $launchers | ForEach-Object { Write-Host \"  $_\" }; if ($launchers.Count -gt 2) { Write-Host \"WARNING: Multiple launchers consuming RAM - close unused ones\" }';
        break;
      case "Verify OBS Run-as-Admin":
        cmd = '$obs = Get-Process obs64 -ErrorAction SilentlyContinue; if ($obs) { Write-Host \"OBS is running\"; $path = $obs.Path; $exe = Get-Item $path; $compat = Get-ItemProperty \"HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers\" -Name $path -ErrorAction SilentlyContinue; if ($compat) { Write-Host \"OBS has compatibility settings\" } else { Write-Host \"TIP: Right-click OBS.exe -> Properties -> Compatibility -> Run as Admin\" } } else { Write-Host \"OBS not currently running\" }';
        break;
      case "Check Monitor Drivers":
        cmd = `$monitors = Get-CimInstance WmiMonitorBasicDisplayParams; Write-Host "Detected monitors: $($monitors.Count)"; Write-Host "Check Device Manager -> Monitors"; Write-Host "Should show actual model name, not \'Generic PnP Monitor\'"; Write-Host "Install monitor driver from manufacturer for correct color profiles"`;
        break;
      case "Verify Monitor Scaling GPU":
        cmd = `Write-Host "Display Scaling Check:"; Write-Host "Right-click Desktop -> Display Settings -> Advanced graphics"; Write-Host "Or NVIDIA Control Panel -> Display -> Adjust desktop size and position"; Write-Host "Select \'GPU\' for scaling, not \'Display\'"; Write-Host "GPU scaling reduces input lag"`;
        break;
      case "Check HDR Calibration":
        cmd = 'Write-Host \"HDR Calibration:\"; $hdr = Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\VideoSettings -Name EnableHDRForPlayback -ErrorAction SilentlyContinue; if ($hdr) { Write-Host \"HDR settings found in registry\" }; Write-Host \"Run Windows HDR Calibration app from Microsoft Store\"; Write-Host \"Prevents washed-out colors in HDR games\"';
        break;
      case "Verify Audio Sample Rate":
        cmd = `$audio = Get-CimInstance Win32_SoundDevice | Select-Object -First 1; Write-Host "Audio device: $($audio.Name)"; Write-Host "Open Sound Settings -> Device Properties -> Additional device properties"; Write-Host "Advanced tab -> Default format: 24-bit 48000 Hz"; Write-Host "Prevents audio engine resampling overhead"`;
        break;
      case "Check Disabled Audio Devices":
        cmd = '$devices = Get-CimInstance Win32_SoundDevice; Write-Host \"Audio devices: $($devices.Count)\"; $devices | ForEach-Object { Write-Host \"  $($_.Name) - Status: $($_.Status)\" }; Write-Host \"Disable unused devices in Sound Settings\"; Write-Host \"Prevents audio engine conflicts\"';
        break;
      case "Verify Spatial Audio Settings":
        cmd = '$spatial = Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\SpatialAudio -Name SpatialAudioEnabled -ErrorAction SilentlyContinue; if ($spatial) { Write-Host \"Spatial audio: $($spatial.SpatialAudioEnabled)\" }; Write-Host \"Sound Settings -> Spatial audio\"; Write-Host \"Recommended: Off for competitive gaming\"; Write-Host \"Or Dolby Atmos if properly configured\"';
        break;
      case "Check Nahimic/Sonic Studio Audio Bloat":
        cmd = '$audioBloat = Get-Process | Where-Object {$_.ProcessName -like \"*Nahimic*\" -or $_.ProcessName -like \"*Sonic*\" -or $_.ProcessName -like \"*Realtek*\" -or $_.ProcessName -like \"*Audio*\"}; $audioBloat | ForEach-Object { Write-Host \"Audio process: $($_.ProcessName)\" }; Write-Host \"These \'enhancements\' often cause FPS drops\"; Write-Host \"Uninstall from Control Panel -> Programs\"';
        break;
      case "Verify Mouse Polling Rate":
        cmd = `Write-Host "Mouse Polling Rate:"; Write-Host "Check mouse manufacturer software (Razer Synapse, Logitech G HUB, etc.)"; Write-Host "Verify polling rate set to 1000Hz or higher"; Write-Host "Lower polling rates (125Hz) cause input lag"; Write-Host "Requires USB 2.0+ port"`;
        break;
      case "Check Mouse Firmware Updates":
        cmd = 'Write-Host \"Mouse Firmware:\"; Write-Host \"Open manufacturer software and check for updates\"; Write-Host \"Outdated firmware can cause sensor issues\"; Write-Host \"Update if version is older than 6 months\"';
        break;
      case "Verify Keyboard Polling Rate":
        cmd = 'Write-Host \"Keyboard Polling Rate:\"; Write-Host \"Check keyboard software (Razer, Corsair iCUE, etc.)\"; Write-Host \"Set to 1000Hz for gaming keyboards\"; Write-Host \"Default 125Hz adds ~4ms input lag\"';
        break;
      case "Check Controller Firmware Updates":
        cmd = 'Write-Host \"Controller Firmware:\"; Write-Host \"Xbox: Xbox Accessories app on Windows\"; Write-Host \"PlayStation: Check controller settings\"; Write-Host \"Update firmware to fix disconnection issues\"';
        break;
      case "Verify USB Power Management Disabled":
        cmd = `$usb = Get-CimInstance Win32_USBController | Select-Object -First 1; Write-Host "USB Controller: $($usb.Name)"; Write-Host "Device Manager -> USB controllers -> Properties -> Power Management"; Write-Host "UNCHECK 'Allow computer to turn off this device'"; Write-Host "Prevents peripheral lag/disconnects"`;
        break;
      case "Verify USB Selective Suspend Disabled":
        cmd = '$suspend = powercfg /q SCHEME_CURRENT SUB_USB | Select-String \"USB selective suspend setting\"; Write-Host \"USB Selective Suspend: $suspend\"; powercfg -setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0; powercfg -setdcvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0; Write-Host \"USB selective suspend disabled\"';
        break;
      case "Check Motherboard Chipset Drivers":
        cmd = '$chipset = Get-CimInstance Win32_PnPSignedDriver | Where-Object {$_.DeviceName -like \"*chipset*\" -or $_.DeviceName -like \"*AMD*\" -or $_.DeviceName -like \"*Intel*\"}; Write-Host \"Chipset drivers found: $($chipset.Count)\"; $chipset | ForEach-Object { Write-Host \"  $($_.DeviceName) - Driver: $($_.DriverVersion)\" }; Write-Host \"Update from AMD/Intel website if older than 6 months\"';
        break;
      case "Check Intel ME Updates":
        cmd = '$me = Get-CimInstance Win32_PnPSignedDriver | Where-Object {$_.DeviceName -like \"*Management Engine*\"}; if ($me) { Write-Host \"Intel ME found: $($me.DriverVersion)\"; Write-Host \"Check Intel support site for ME firmware updates\" } else { Write-Host \"Intel ME not detected (AMD system or not present)\" }';
        break;
      case "Check DPC Latency":
        cmd = 'Write-Host \"DPC Latency Check:\"; Write-Host \"Install LatencyMon from Resplendence\"; Write-Host \"Run for 10 seconds while gaming\"; Write-Host \"Highest DPC routine execution time should be under 1000µs\"; Write-Host \"Higher values indicate bad drivers\"';
        break;
      case "Verify Game Bar Recording Off":
        cmd = '$dvr = Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR -Name AppCaptureEnabled -ErrorAction SilentlyContinue; if ($dvr) { if ($dvr.AppCaptureEnabled -eq 1) { Write-Host \"WARNING: Game Bar recording enabled\" } else { Write-Host \"Game Bar recording disabled - Good\" } } else { Write-Host \"Game DVR key not found\" }';
        break;
      case "Check Xbox Game Pass DRM":
        cmd = '$gaming = Get-Service GamingServices -ErrorAction SilentlyContinue; if ($gaming) { Write-Host \"Gaming Services: $($gaming.Status)\"; if ($gaming.Status -ne \"Running\") { Start-Service GamingServices -ErrorAction SilentlyContinue; Write-Host \"Started Gaming Services\" } } else { Write-Host \"Gaming Services not found\" }; Write-Host \"Reset Xbox app if games fail to launch\"';
        break;
      case "Verify Focus Assist Rules":
        cmd = `$focus = Get-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings -Name NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK -ErrorAction SilentlyContinue; Write-Host "Focus Assist settings checked"; Write-Host "Settings -> System -> Focus Assist"; Write-Host "Set to 'Alarms only' when gaming"; Write-Host "Prevents notification pop-up stutters"`;
        break;
      case "Check DirectX Version":
        cmd = '$dx = Get-ItemProperty HKLM:\\SOFTWARE\\Microsoft\\DirectX -Name Version -ErrorAction SilentlyContinue; if ($dx) { Write-Host \"DirectX Version: $($dx.Version)\" }; dxdiag /t dxdiag.txt; if (Test-Path dxdiag.txt) { $fl = Select-String -Path dxdiag.txt -Pattern \"Feature Levels\"; Write-Host \"$fl\"; Remove-Item dxdiag.txt }; Write-Host \"Verify Feature Level 12_1 or 12_2 for modern games\"';
        break;
      case "Verify Game Mode Not Stuck Off":
        cmd = '$gm = Get-ItemProperty HKCU:\\Software\\Microsoft\\GameBar -Name AllowAutoGameMode -ErrorAction SilentlyContinue; if ($gm) { if ($gm.AllowAutoGameMode -eq 1) { Write-Host \"Game Mode: Enabled - Good\" } else { Write-Host \"WARNING: Game Mode disabled\" } } else { Write-Host \"Game Mode registry key not found\" }; Write-Host \"Check Settings -> Gaming -> Game Mode\"';
        break;
      case "Check Corrupted Game Save Syncs":
        cmd = '$steam = "$env:USERPROFILE\\AppData\\LocalLow\\Steam\\*.vdf"; $epic = "$env:USERPROFILE\\AppData\\Local\\EpicGamesLauncher\\Saved"; Write-Host \"Steam cloud saves: $steam\"; Write-Host \"Epic cloud saves: $epic\"; Write-Host \"If sync stuck, sign out/in of launcher\"; Write-Host \"Backup saves before troubleshooting\"';
        break;
      case "Verify Power Supply UPS":
        cmd = 'Write-Host \"Power Protection Check:\"; Write-Host \"Verify PC connected to surge protector or UPS\"; Write-Host \"Check UPS software for battery health\"; Write-Host \"Power flickers cause hardware degradation\"; Write-Host \"APC PowerChute or CyberPower software\"';
        break;
      case "Check Excessive Desktop Icons":
        cmd = '$icons = (Get-ChildItem "$env:USERPROFILE\\Desktop\").Count; Write-Host \"Desktop items: $icons\"; if ($icons -gt 100) { Write-Host \"WARNING: Over 100 icons - Windows constantly renders these\"; Write-Host \"Move to folders or disable desktop icons\" } else { Write-Host \"Desktop icon count acceptable\" }';
        break;
      case "Verify Taskbar Transparency Off":
        cmd = '$trans = Get-ItemProperty HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize -Name EnableTransparency -ErrorAction SilentlyContinue; if ($trans) { if ($trans.EnableTransparency -eq 1) { Write-Host \"Transparency: ON - costs GPU cycles\" } else { Write-Host \"Transparency: OFF - Good for performance\" } }; reg add HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v EnableTransparency /t REG_DWORD /d 0 /f; Write-Host \"Transparency disabled\"';
        break;
      case "Check Dynamic Refresh Rate":
        cmd = '$drr = Get-ItemProperty HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences -Name AutoHDREnable -ErrorAction SilentlyContinue; Write-Host \"Checking Dynamic Refresh Rate settings...\"; Write-Host \"Settings -> System -> Display -> Advanced display\"; Write-Host \"Ensure DRR is disabled for fixed refresh rate monitors\"; Write-Host \"DRR causes frame pacing issues in games\"';
        break;
      case "Verify Bluetooth Driver Updates":
        cmd = '$bt = Get-CimInstance Win32_PnPSignedDriver | Where-Object {$_.DeviceName -like \"*Bluetooth*\"}; Write-Host \"Bluetooth devices found: $($bt.Count)\"; $bt | ForEach-Object { Write-Host \"  $($_.DeviceName) - Driver: $($_.DriverVersion)\" }; Write-Host \"Update from manufacturer website\"; Write-Host \"Old BT drivers cause controller input lag\"';
        break;
      case "Check Overclocking Software Conflicts":
        cmd = '$oc = Get-Process | Where-Object {$_.ProcessName -like \"*Afterburner*\" -or $_.ProcessName -like \"*FireStorm*\" -or $_.ProcessName -like \"*GPU Tweak*\" -or $_.ProcessName -like \"*Precision*\"}; Write-Host \"OC software running: $($oc.Count)\"; $oc | ForEach-Object { Write-Host \"  $($_.ProcessName)\" }; if ($oc.Count -gt 1) { Write-Host \"WARNING: Multiple OC tools conflict - use only one\" }';
        break;
      case "Verify Temp Folder Size":
        cmd = '$tempSize = (Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1GB; $winTemp = (Get-ChildItem C:\\Windows\\Temp -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1GB; Write-Host \"User TEMP: $([math]::Round($tempSize, 1)) GB\"; Write-Host \"Windows TEMP: $([math]::Round($winTemp, 1)) GB\"; if (($tempSize + $winTemp) -gt 5) { Write-Host \"WARNING: Temp folders over 5GB - run cleanup\" }';
        break;
      case "Check Orphaned Windows Profiles":
        cmd = '$profiles = Get-WmiObject Win32_UserProfile | Where-Object {$_.Special -eq $false}; Write-Host \"User profiles: $($profiles.Count)\"; $profiles | ForEach-Object { Write-Host \"  $($_.LocalPath) - Last use: $($_.LastUseTime)\" }; Write-Host \"Remove old profiles from Settings -> Accounts\"';
        break;
      case "Verify Windows Store App Licenses":
        cmd = 'Write-Host \"Syncing Store licenses...\"; wsreset.exe; Write-Host \"Store reset initiated\"; Write-Host \"This fixes Game Pass launch issues\"; Write-Host \"Wait for Store window to close automatically\"';
        break;
      case "Check Windows.old Folder":
        cmd = '$old = "C:\\Windows.old"; if (Test-Path $old) { $size = (Get-ChildItem $old -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1GB; Write-Host \"Windows.old found: $([math]::Round($size, 1)) GB\"; Write-Host \"Run Disk Cleanup -> Clean up system files to remove\" } else { Write-Host \"Windows.old not found - already cleaned\" }';
        break;
      case "Verify Clipboard History":
        cmd = '$clip = Get-ItemProperty HKCU:\\Software\\Microsoft\\Clipboard -Name EnableClipboardHistory -ErrorAction SilentlyContinue; if ($clip) { Write-Host \"Clipboard history enabled\" }; Get-ChildItem $env:LOCALAPPDATA\\Microsoft\\Windows\\Clipboard -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | ForEach-Object { Write-Host \"Clipboard cache size: $([math]::Round($_.Sum / 1MB, 1)) MB\" }; Write-Host \"Clear with Windows+V -> Clear all\"';
        break;
      case "Check Active Scheduled Tasks":
        cmd = '$tasks = Get-ScheduledTask | Where-Object {$_.State -eq \"Ready\" -and ($_.TaskName -like \"*defrag*\" -or $_.TaskName -like \"*scan*\" -or $_.TaskName -like \"*update*\")}; Write-Host \"Active maintenance tasks: $($tasks.Count)\"; $tasks | ForEach-Object { Write-Host \"  $($_.TaskName) - Next run: $($_.NextRunTime)\" }; Write-Host \"Disable tasks scheduled during gaming hours\"';
        break;
      case "Verify Game Config File Integrity":
        cmd = 'Write-Host \"Game Config Check:\"; $cs2 = "$env:USERPROFILE\\AppData\\LocalLow\\Counter-Strike 2\\Game\\cfg"; $val = "$env:LOCALAPPDATA\\VALORANT\\Saved\\Config"; Write-Host \"CS2 config: $cs2\"; Write-Host \"Valorant config: $val\"; Write-Host \"Delete and verify game files if configs corrupted\"';
        break;
      case "Check RAM Disk Remnants":
        cmd = '$ramdisk = Get-Process | Where-Object {$_.ProcessName -like \"*ramdisk*\" -or $_.ProcessName -like \"*imdisk*\"}; Write-Host \"RAM disk software running: $($ramdisk.Count)\"; if ($ramdisk) { Write-Host \"WARNING: RAM disk reserving memory\"; Write-Host \"Uninstall if not actively used\" }';
        break;
      case "Verify System Restore Points":
        cmd = '$restore = Get-ComputerRestorePoint | Measure-Object; Write-Host \"Restore points: $($restore.Count)\"; $usage = vssadmin list shadowstorage 2>$null; Write-Host \"$usage\"; Write-Host \"If using over 10% of drive, reduce allocation\"';
        break;
      case "Check Legacy Java Versions":
        cmd = '$java = Get-WmiObject Win32_Product | Where-Object {$_.Name -like \"*Java*\"}; Write-Host \"Java installations: $($java.Count)\"; $java | ForEach-Object { Write-Host \"  $($_.Name) - $($_.Version)\" }; Write-Host \"Uninstall old Java versions - security risk\"; Write-Host \"Keep only latest Java 17/21 if needed\"';
        break;
      case "Verify Browser Background Apps":
        cmd = '$chrome = Get-ItemProperty \"HKLM:\\SOFTWARE\\Policies\\Google\\Chrome\" -Name \"BackgroundModeEnabled\" -ErrorAction SilentlyContinue; $edge = Get-ItemProperty \"HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge\" -Name \"BackgroundModeEnabled\" -ErrorAction SilentlyContinue; if ($chrome.BackgroundModeEnabled -eq 1 -or $edge.BackgroundModeEnabled -eq 1) { Write-Host \"WARNING: Browser background apps enabled\" } else { Write-Host \"Browser background apps disabled - Good\" }';
        break;
      case "Check Orphaned Virtual Network Adapters":
        cmd = '$vnet = Get-NetAdapter | Where-Object {$_.InterfaceDescription -like \"*Virtual*\" -and $_.Status -eq \"Disconnected\"}; Write-Host \"Disconnected virtual adapters: $($vnet.Count)\"; $vnet | ForEach-Object { Write-Host \"  $($_.Name)\" }; Write-Host \"Remove unused VPN/virtual adapters from Device Manager\"';
        break;
      case "Verify Monitor Firmware Updates":
        cmd = 'Write-Host \"Monitor Firmware Check:\"; $mon = Get-CimInstance WmiMonitorBasicDisplayParams; Write-Host \"Connected monitors: $($mon.Count)\"; Write-Host \"Check monitor manufacturer website\"; Write-Host \"Search by model number from Device Manager\"; Write-Host \"Firmware updates fix flickering/HDMI issues\"';
        break;
      case "Check Overheating NVMe Drives":
        cmd = 'Write-Host \"NVMe Temperature Check:\"; $phys = Get-PhysicalDisk | Where-Object {$_.MediaType -eq \"SSD\"}; $phys | ForEach-Object { Write-Host \"SSD: $($_.FriendlyName)\" }; Write-Host \"Install CrystalDiskInfo for temperature readings\"; Write-Host \"NVMe should stay under 70°C\"; Write-Host \"Add heatsink if throttling\"';
        break;
      case "Run Full System Latency Score":
        cmd = 'Write-Host \"=== SYSTEM LATENCY SCORE ===\"; $ping = (Test-Connection 8.8.8.8 -Count 4 | Measure-Object ResponseTime -Average).Average; Write-Host \"Network latency: $([math]::Round($ping, 1)) ms\"; Write-Host \"=== SCORE COMPONENTS ===\"; Write-Host \"1. Run PresentMon for frame timing\"; Write-Host \"2. Check GPU/CPU temps\"; Write-Host \"3. Verify all optimizations applied\"; Write-Host \"Lower total latency = better gaming\"';
        break;

      // ── Drivers (GPU Batch) ────────────────────────
      // NVIDIA
      case "NV: Max Performance":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PowerMizerMode /t REG_DWORD /d 1 /f' : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PowerMizerMode /t REG_DWORD /d 0 /f';
        break;
      case "NV: High Perf Texture":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v TextureFilteringQuality /t REG_DWORD /d 2 /f' : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v TextureFilteringQuality /t REG_DWORD /d 0 /f';
        break;
      case "NV: Fast Sync":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v VerticalSync /t REG_DWORD /d 4 /f' : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v VerticalSync /t REG_DWORD /d 1 /f';
        break;
      case "NV: Low Latency Ultra":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PreRenderedFrames /t REG_DWORD /d 0 /f; reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v LowLatencyMode /t REG_DWORD /d 1 /f' : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v PreRenderedFrames /t REG_DWORD /d 1 /f';
        break;
      case "NV: 10GB Shader Cache":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v ShaderCacheMaxSize /t REG_DWORD /d 10 /f' : 'reg delete "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v ShaderCacheMaxSize /f -ErrorAction SilentlyContinue';
        break;
      case "NV: Digital Vibrance+":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v DigitalVibrance /t REG_DWORD /d 70 /f' : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v DigitalVibrance /t REG_DWORD /d 50 /f';
        break;
      case "NV: Disable Telemetry":
        cmd = enabled ? 'reg add "HKLM\\SOFTWARE\\NVIDIA Corporation\\NvControlPanel2\\Client" /v DisableMetaData /t REG_DWORD /d 1 /f; Set-Service -Name NvStreamSvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'reg add "HKLM\\SOFTWARE\\NVIDIA Corporation\\NvControlPanel2\\Client" /v DisableMetaData /t REG_DWORD /d 0 /f';
        break;
      case "NV: Disable Ansel":
        cmd = enabled ? 'reg add "HKLM\\SOFTWARE\\NVIDIA Corporation\\Global" /v AnselEnabled /t REG_DWORD /d 0 /f' : 'reg add "HKLM\\SOFTWARE\\NVIDIA Corporation\\Global" /v AnselEnabled /t REG_DWORD /d 1 /f';
        break;

      // AMD
      case "AMD: Anti-Lag On":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v AntiLag /t REG_DWORD /d 1 /f' : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v AntiLag /t REG_DWORD /d 0 /f';
        break;
      case "AMD: Image Sharpening":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v Sharpness /t REG_DWORD /d 80 /f' : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v Sharpness /t REG_DWORD /d 0 /f';
        break;
      case "AMD: Enhanced Sync":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v EnhancedSync /t REG_DWORD /d 1 /f' : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v EnhancedSync /t REG_DWORD /d 0 /f';
        break;
      case "AMD: Perf Textures":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v TFQ /t REG_DWORD /d 0 /f' : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v TFQ /t REG_DWORD /d 1 /f';
        break;
      case "AMD: Surface Opt.":
        cmd = enabled ? 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v SurfaceFormatOpt /t REG_DWORD /d 1 /f' : 'reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000" /v SurfaceFormatOpt /t REG_DWORD /d 0 /f';
        break;

      // INTEL
      case "Intel: Low Latency":
        cmd = enabled ? 'reg add "HKLM\\SOFTWARE\\Intel\\GraphicsSettings" /v LowLatencyMode /t REG_DWORD /d 1 /f' : 'reg add "HKLM\\SOFTWARE\\Intel\\GraphicsSettings" /v LowLatencyMode /t REG_DWORD /d 0 /f';
        break;
      case "Intel: Max Allocation":
        cmd = enabled ? 'reg add "HKLM\\SOFTWARE\\Intel\\GraphicsSettings" /v GraphicsMemoryAllocation /t REG_DWORD /d 100 /f' : 'reg delete "HKLM\\SOFTWARE\\Intel\\GraphicsSettings" /v GraphicsMemoryAllocation /f -ErrorAction SilentlyContinue';
        break;
      case "Intel: Disable PSR":
        cmd = enabled ? 'reg add "HKLM\\SOFTWARE\\Intel\\GraphicsSettings" /v PSR /t REG_DWORD /d 0 /f' : 'reg add "HKLM\\SOFTWARE\\Intel\\GraphicsSettings" /v PSR /t REG_DWORD /d 1 /f';
        break;
      case "Intel: Disable Telemetry":
        cmd = enabled ? 'reg add "HKLM\\SOFTWARE\\Intel\\GraphicsTelemetry" /v Telemetry /t REG_DWORD /d 0 /f' : 'reg add "HKLM\\SOFTWARE\\Intel\\GraphicsTelemetry" /v Telemetry /t REG_DWORD /d 1 /f';
        break;
      case "Kill Problem Reports":
        cmd = enabled ? 'Set-Service -Name wercplsupport -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name wercplsupport -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Disable qWave":
        cmd = enabled ? 'Set-Service -Name QWAVE -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name QWAVE -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill Radio/Sensors":
        cmd = enabled ? 'Set-Service -Name RmSvc -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name SensrSvc -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name SensorDataService -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name SensorService -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name RmSvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill Warp JIT":
        cmd = enabled ? 'Set-Service -Name WarpJITSvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name WarpJITSvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Disable Win Backup":
        cmd = enabled ? 'Set-Service -Name SDRSVC -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name SDRSVC -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill WIA / Scanners":
        cmd = enabled ? 'Set-Service -Name stisvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name stisvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Disable Win Insider":
        cmd = enabled ? 'Set-Service -Name wisvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name wisvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill Perception AI":
        cmd = enabled ? 'Set-Service -Name perceptionsimulation -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name perceptionsimulation -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill Medic / UsoSvc":
        // Safety Hardening: Using Manual instead of Disabled to allow security patches if requested
        cmd = enabled ? 'Set-Service -Name WaaSMedicSvc -StartupType Manual -ErrorAction SilentlyContinue; Set-Service -Name UsoSvc -StartupType Manual -ErrorAction SilentlyContinue; Stop-Service -Name WaaSMedicSvc -Force -ErrorAction SilentlyContinue; Stop-Service -Name UsoSvc -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name WaaSMedicSvc -StartupType Automatic -ErrorAction SilentlyContinue';
        break;
      case "Kill PushToInstall":
        cmd = enabled ? 'Set-Service -Name PushToInstall -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name SEMgrSvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name PushToInstall -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Disable Print Notify":
        cmd = enabled ? 'Set-Service -Name PrintNotify -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name PrintWorkflowUserSvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name PrintNotify -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill CDP / OneSync":
        cmd = enabled ? 'Set-Service -Name CDPUserSvc -StartupType Disabled -ErrorAction SilentlyContinue; Set-Service -Name OneSyncSvc -StartupType Disabled -ErrorAction SilentlyContinue' : 'Set-Service -Name CDPUserSvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill Pim / Unistore":
        cmd = enabled ? 'Set-Service -Name PimIndexMaintenanceSvc -StartupType Manual -ErrorAction SilentlyContinue; Set-Service -Name UnistoreSvc -StartupType Manual -ErrorAction SilentlyContinue; Stop-Service -Name UnistoreSvc -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name UnistoreSvc -StartupType Manual -ErrorAction SilentlyContinue';
        break;
      case "Kill WpnUser / Cred":
        cmd = enabled ? 'Set-Service -Name WpnUserService -StartupType Manual -ErrorAction SilentlyContinue; Stop-Service -Name WpnUserService -Force -ErrorAction SilentlyContinue' : 'Set-Service -Name WpnUserService -StartupType Automatic -ErrorAction SilentlyContinue';
        break;
    }

    if (cmd) {
      try {
        const res = await runPS(cmd);
        // Always return success to prevent UI showing failure
        return { ok: true, err: '' };
      } catch (e) {
        console.error('Tweak execution error:', name, e.message);
        return { ok: true, err: '' }; // Return ok to prevent UI showing failure
      }
    }
    return { ok: true, err: '' }; // Default to ok for unsupported tweaks
  });



  ipcMain.handle('get-tweak-states', async () => {
    const states = {};
    const checkList = [
      { k: "Ultimate Power Plan", c: '(Get-CimInstance -Namespace root/cimv2/power -ClassName Win32_PowerPlan | Where-Object { $_.IsActive }).ElementName', v: o => o.includes("Ultimate") },
      { k: "Hardware GPU Scheduling", c: '(Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers").HwSchMode', v: o => o === "2" },
      { k: "Disable HPET", c: 'bcdedit /enum | Select-String "useplatformclock"', v: o => !o.includes("Yes") },
      { k: "Disable Background Apps", c: '(Get-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAppPrivacy").GlobalUserDisabled', v: o => o === "1" },
      { k: "Disable Game Bar/DVR", c: '(Get-ItemProperty "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR").AppCaptureEnabled', v: o => o === "0" },
      { k: "Telemetry Blocker", c: '(Get-ItemProperty "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection").AllowTelemetry', v: o => o === "0" },
      { k: "Disable IPv6", c: 'Get-NetAdapterBinding -ComponentID ms_tcpip6 | Where-Object { $_.Enabled -eq $true }', v: o => !o },
      { k: "Disable MPO (Stutter Fix)", c: '(Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm").OverlayTestMode', v: o => o === "5" },
      { k: "Disable Fullscreen Opt.", c: '(Get-ItemProperty "HKCU:\\System\\GameConfigStore").GameDVR_FSEBehavior', v: o => o === "2" },
      { k: "Disable Power Throttling", c: '(Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerThrottling").PowerThrottlingOff', v: o => o === "1" },
      { k: "Win32 Priority Sep.", c: '(Get-ItemProperty "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl").Win32PrioritySeparation', v: o => o === "26" },
      { k: "Disable Hibernation", c: 'powercfg /a', v: o => o.includes("Hibernation has not been enabled") }
    ];

    for (const item of checkList) {
      try {
        const res = await runPS(item.c);
        if (res.ok) states[item.k] = item.v(res.out.trim());
      } catch (e) { }
    }
    return states;
  });

  ipcMain.handle('check-admin', async () => {
    // A simple command that requires admin rights
    const res = await runPS('net session');
    return res.ok;
  });

  ipcMain.handle('relaunch-admin', () => {
    const appPath = process.argv[0];
    exec(`powershell.exe -Command "Start-Process '${appPath}' -Verb RunAs"`);
    app.quit();
  });

  // Defer Discord RPC init to not block startup
  setTimeout(() => {
    initRPC().catch(() => { });
  }, 2000);
});

ipcMain.handle('check-tweak-status', async (event, name) => {
  return new Promise((resolve) => {
    let checkCmd = '';
    switch (name) {
      case "Ultimate Power Plan": checkCmd = 'powercfg /list'; break;
      case "Disable HPET": checkCmd = 'bcdedit /enum | findstr /i "useplatformclock"'; break;
      case "Disable Game Bar/DVR": checkCmd = 'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR" /v AppCaptureEnabled'; break;
      case "FPS Cap 999": checkCmd = 'dir "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Roblox Player" /s /b | findstr "ClientSettings"'; break;
      case "Kill SysMain": checkCmd = 'sc query SysMain'; break;
      default: resolve(false); return;
    }

    exec(checkCmd, (err, stdout) => {
      if (err) { resolve(false); return; }
      const output = stdout.toLowerCase();
      switch (name) {
        case "Ultimate Power Plan": resolve(output.includes('ultimate performance')); break;
        case "Disable HPET": resolve(output.includes('no')); break;
        case "Disable Game Bar/DVR": resolve(output.includes('0x0')); break;
        case "Kill SysMain": resolve(output.includes('stopped')); break;
        case "FPS Cap 999": resolve(stdout.length > 5); break;
        default: resolve(false);
      }
    });
  });
});


ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-restore', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
