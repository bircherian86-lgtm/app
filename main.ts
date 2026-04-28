export { };

console.log("main.ts: Script Loaded");
type Tweak = {
  name: string;
  desc: string;
  category: string;
  risk: "SAFE" | "MODERATE" | "RISKY";
  enabled: boolean;
  frequency?: 'daily' | 'weekly' | 'monthly';
};

declare global {
  interface Window {
    novaAPI: {
      getStats: () => Promise<any>;
      getSpecs: () => Promise<any>;
      runTweak: (name: string, enabled: boolean) => Promise<any>;
      checkAdmin: () => Promise<boolean>;
      getTweakStates: () => Promise<Record<string, boolean>>;
      restartPC: () => Promise<void>;
      revertTweaks: () => Promise<void>;
      relaunchAdmin: () => Promise<void>;
      checkTweakStatus: (name: string) => Promise<boolean>;
      minimizeWindow: () => void;
      restoreWindow: () => void;
      closeWindow: () => void;
      updateRPC: (state: string, details: string) => Promise<void>;
      getStartupPrograms: () => Promise<any>;
      toggleStartupProgram: (name: string, enabled: boolean) => Promise<void>;
      getBootTime: () => Promise<any>;
      getDiskHealth: () => Promise<any>;
      getPingStats: () => Promise<any>;
      getTopProcesses: () => Promise<any>;
      killProcess: (name: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      selectBackground: (type?: string) => Promise<{ ok: boolean; filePath?: string }>;
    };
  }
}



const tweaks: Tweak[] = [
  { name: "Ultimate Power Plan", desc: "Unlocks the hidden 'Ultimate Performance' power scheme.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Max Refresh Rate", desc: "Forces your primary monitor to its maximum Hz.", category: "Starters", risk: "SAFE", enabled: true },
  { name: "Hardware GPU Scheduling", desc: "Enables hardware-accelerated GPU scheduling.", category: "Starters", risk: "SAFE", enabled: true },
  { name: "Disable HPET", desc: "Disables High Precision Event Timer to eliminate stuttering.", category: "Starters", risk: "SAFE", enabled: true },
  { name: "Dynamic Tick Fix", desc: "Locks the CPU tick rate to prevent clock-cycle drift.", category: "Starters", risk: "SAFE", enabled: true },
  { name: "Disable Fullscreen Opt.", desc: "Bypasses the DWM overlay for consistent per-frame delivery.", category: "Starters", risk: "SAFE", enabled: true },
  { name: "High Priority Gaming", desc: "Forces game processes to the highest CPU priority.", category: "Starters", risk: "MODERATE", enabled: false },
  { name: "Enable Game Mode", desc: "Activate Windows Game Mode to prioritize gaming and block background interruptions.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Enable XMP/EXPO Check", desc: "Prompts you to verify RAM is running at its advertised speed. Guides to BIOS if needed.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Resizable BAR / SAM", desc: "Guides you to enable full GPU VRAM access via BIOS/GPU driver settings.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Enable VRR", desc: "Turn on Variable Refresh Rate in Windows Display Settings to eliminate tearing.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "G-Sync / FreeSync", desc: "Guides you to enable VRR in NVIDIA/AMD control panel.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "GPU Max Performance", desc: "Set GPU power management to Prefer Maximum Performance. Prevents mid-game downclocking.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable V-Sync Global", desc: "Turn off Vertical Sync globally in GPU control panel for minimal input lag.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Texture Filter Perf.", desc: "Set texture filtering quality to High Performance in GPU settings.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable DWM Transparency", desc: "Turn off Windows transparency effects to free GPU/CPU resources.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Visual Effects", desc: "Set Windows to 'Adjust for best performance' while keeping font smoothing.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Mouse Accel.", desc: "Turn off 'Enhance pointer precision' for raw 1:1 mouse aiming.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable HW Accel Apps", desc: "Stop Discord/Spotify/Browsers from stealing GPU VRAM via hardware acceleration.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Remove OEM Bloatware", desc: "Detect and remove pre-installed manufacturer trialware (McAfee, Norton, etc).", category: "Starters", risk: "MODERATE", enabled: false },
  { name: "Disable Search Indexer", desc: "Stop Windows from indexing game drive files, preventing disk I/O spikes.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Enable SSD TRIM", desc: "Ensure SSD TRIM is active for consistent read/write speeds and drive health.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Auto-Updates", desc: "Set Active Hours so Windows won't download updates during gaming sessions.", category: "Starters", risk: "MODERATE", enabled: false },
  { name: "Audio 48kHz Optimal", desc: "Set audio output to 48000Hz/24-bit to prevent engine resampling overhead.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Audio Enhance.", desc: "Turn off Windows spatial audio and enhancements to lower audio latency.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Windows Tips", desc: "Turn off tips and suggestions to stop background telemetry and pop-ups.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Feedback Hub", desc: "Stop Windows from requesting feedback, reducing background processes.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Remove Windows Bloat", desc: "Uninstall Candy Crush, Mail, Maps, People and other bloatware apps.", category: "Starters", risk: "MODERATE", enabled: false },
  { name: "Set Scaling 100%", desc: "Ensure display scaling is at 100% to prevent UI rendering overhead.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Wi-Fi Sense", desc: "Stop network adapter from scanning for networks, preventing ping spikes.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Enable QoS Scheduler", desc: "Enable Quality of Service on network adapter to prioritize gaming packets.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Mouse 1000Hz Check", desc: "Prompts you to verify your gaming mouse is running at 1000Hz+ polling rate.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Fast Keyboard Repeat", desc: "Set keyboard repeat rate to fastest for smoother menu nav and movement.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Clipboard Hist.", desc: "Turn off clipboard history to prevent background RAM usage.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Nearby Sharing", desc: "Turn off Bluetooth/Wi-Fi sharing that scans for devices in background.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "GPU Shader Cache Max", desc: "Set NVIDIA shader cache to unlimited to prevent stuttering in new areas.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Verify SSD Game Drive", desc: "Prompts you to confirm games are installed on SSD, not HDD.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Copilot/Widgets", desc: "Remove AI and news widgets from taskbar to stop background CPU usage.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "PCIe Link State Off", desc: "Prevent PCIe slot from powering down GPU, eliminating wake-up stutters.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Startup Sound", desc: "Remove Windows startup sound to speed up boot times.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Pagefile Auto-Manage", desc: "Ensure Windows manages pagefile automatically to prevent OOM crashes.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Remote Desktop", desc: "Turn off remote connection features to close unnecessary ports/services.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable BT Discovery", desc: "Stop PC from constantly searching for Bluetooth devices while gaming.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Enable Disk Write Cache", desc: "Enable disk write caching in device manager for faster save/load times.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "PCIe Root Power Off", desc: "Disable PCIe power management for consistent GPU bandwidth.", category: "Starters", risk: "SAFE", enabled: false },
  { name: "Disable Game Bar/DVR", desc: "Kills background recording services.", category: "System", risk: "SAFE", enabled: true },
  { name: "Disable Background Apps", desc: "Absolute registry block for background processes.", category: "System", risk: "SAFE", enabled: true },
  { name: "Disable Power Throttling", desc: "Prevents Windows from down-clocking processes.", category: "System", risk: "SAFE", enabled: false },
  { name: "Disable MPO (Stutter Fix)", desc: "Fixes NVIDIA/AMD flickering and stutter.", category: "System", risk: "SAFE", enabled: true },
  { name: "CIM Game Priority", desc: "Adjusts MMCSS task priority via CIM.", category: "System", risk: "SAFE", enabled: true },
  { name: "Win32 Priority Sep.", desc: "Optimizes processor intervals for responsiveness.", category: "System", risk: "SAFE", enabled: true },
  { name: "Timer Resolution Fix", desc: "Attempts to global-lock timer resolution at 0.5ms.", category: "System", risk: "SAFE", enabled: true },
  { name: "Create Pre-Apply Restore Point", desc: "Required first step: create restore point 'Optimizer-System-Starters-PreApply' and confirm System Restore is enabled before any system change.", category: "System", risk: "SAFE", enabled: false },
  { name: "Verify Windows Build Health", desc: "Check pending Windows updates and confirm OS build is current and stable; schedule updates outside gaming sessions.", category: "System", risk: "SAFE", enabled: false },
  { name: "Secure Boot + Firmware Integrity", desc: "Confirm Secure Boot is enabled where supported and BIOS/UEFI firmware is on latest stable release.", category: "System", risk: "SAFE", enabled: false },
  { name: "Run SFC System Scan", desc: "Run System File Checker to detect and repair corrupted OS files tied to stutter, instability, or driver conflicts.", category: "System", risk: "SAFE", enabled: false },
  { name: "Run DISM Health Repair", desc: "Run DISM health check and repair to fix Windows component store/image issues.", category: "System", risk: "SAFE", enabled: false },
  { name: "Set Best Performance Defaults", desc: "Use non-destructive Windows performance defaults for visual effects/responsiveness while preserving stability and accessibility.", category: "System", risk: "SAFE", enabled: false },
  { name: "Memory Management Safe Defaults", desc: "Verify pagefile is system-managed on a fast drive and avoid unstable extreme manual memory tuning.", category: "System", risk: "SAFE", enabled: false },
  { name: "Enable Memory Integrity (Compat)", desc: "Enable Memory Integrity/VBS if compatible with installed games and drivers.", category: "System", risk: "MODERATE", enabled: false },
  { name: "Prune Unneeded Windows Features", desc: "Disable only gaming-irrelevant optional features while retaining core networking and security components.", category: "System", risk: "MODERATE", enabled: false },
  { name: "Defender Gaming Exclusions Audit", desc: "Set minimal Defender exclusions for game paths where needed and confirm real-time protection is not causing I/O spikes.", category: "System", risk: "MODERATE", enabled: false },
  { name: "Telemetry Balance (Safe)", desc: "Reduce non-essential telemetry where supported without disabling required diagnostics/security channels.", category: "System", risk: "SAFE", enabled: false },
  { name: "Windows Update Notify/Schedule", desc: "Set update behavior to notify or scheduled installs to prevent forced reboots and gaming-time downloads.", category: "System", risk: "SAFE", enabled: false },
  { name: "Block Auto Driver Replacements", desc: "Disable automatic driver replacement from Windows Update where supported to preserve stable vendor drivers.", category: "System", risk: "MODERATE", enabled: false },
  { name: "Verify Chipset Driver Stack", desc: "Confirm Intel/AMD chipset, firmware components, and storage drivers are current and stable.", category: "System", risk: "SAFE", enabled: false },
  { name: "Verify Network Adapter Drivers", desc: "Update Ethernet/Wi-Fi drivers for lower packet loss, jitter, and better game compatibility.", category: "System", risk: "SAFE", enabled: false },
  { name: "NIC Low-Jitter Properties", desc: "Disable NIC power-saving features and verify link speed/duplex negotiation for stable low-latency networking.", category: "System", risk: "MODERATE", enabled: false },
  { name: "TCP/IP Stable Defaults", desc: "Keep Windows TCP/IP settings on proven defaults and avoid unstable experimental network stack tweaks.", category: "System", risk: "SAFE", enabled: false },
  { name: "DNS Reliability Validation", desc: "Test reputable DNS options (or ISP default) for latency and packet loss before permanent switch.", category: "System", risk: "SAFE", enabled: false },
  { name: "Pause Background Sync Clients", desc: "Disable cloud sync and background upload/update clients during gaming windows to reduce jitter.", category: "System", risk: "SAFE", enabled: false },
  { name: "QoS Priority Guidance", desc: "Apply conservative QoS prioritization (prefer router-side) so game traffic is prioritized without destabilizing throughput.", category: "System", risk: "SAFE", enabled: false },
  { name: "High Performance Power Profile", desc: "Set system-wide High Performance profile on desktop and ensure battery-saver behaviors are off.", category: "System", risk: "SAFE", enabled: false },
  { name: "Selective Idle State Tuning", desc: "Tune CPU idle/C-state behavior cautiously through supported OS/firmware options and test for micro-stutter regressions.", category: "System", risk: "MODERATE", enabled: false },
  { name: "CPU Scheduling Responsiveness", desc: "Use standard gaming-optimized scheduler defaults for interactive responsiveness without extreme priorities.", category: "System", risk: "SAFE", enabled: false },
  { name: "Core Parking Responsiveness", desc: "Ensure core parking behavior allows fast core availability under load without aggressive hacks.", category: "System", risk: "SAFE", enabled: false },
  { name: "Timer Resolution Safe Guidance", desc: "Avoid aggressive timer forcing and keep system timers on stable defaults to prevent jitter.", category: "System", risk: "SAFE", enabled: false },
  { name: "Storage I/O Contention Audit", desc: "Confirm games run on fast drives (NVMe preferred), storage drivers are current, and heavy background I/O is limited.", category: "System", risk: "SAFE", enabled: false },
  { name: "Verify TRIM + SSD Firmware", desc: "Ensure TRIM is active and SSD firmware is current to prevent degradation and I/O stalls.", category: "System", risk: "SAFE", enabled: false },
  { name: "Gaming Drive Indexing Trim", desc: "Disable non-essential indexing on gaming drives while preserving indexing where workflow needs it.", category: "System", risk: "SAFE", enabled: false },
  { name: "Reduce Background Disk Writers", desc: "Disable non-essential scheduled disk-maintenance tasks while keeping required stability maintenance.", category: "System", risk: "MODERATE", enabled: false },
  { name: "Disk SMART Health Check", desc: "Check SMART indicators (reallocated sectors, wear, faults) for stutter/crash risk detection.", category: "System", risk: "SAFE", enabled: false },
  { name: "Memory Compression Default-On", desc: "Keep memory compression enabled by default unless repeatable regression testing proves otherwise.", category: "System", risk: "SAFE", enabled: false },
  { name: "Trim Startup Services", desc: "Disable non-critical startup services and vendor updaters that consume CPU/RAM without breaking OS core functions.", category: "System", risk: "MODERATE", enabled: false },
  { name: "Boot Path Optimization", desc: "Reduce boot bloat and background startup load; verify updates do not re-enable heavy startup apps.", category: "System", risk: "SAFE", enabled: false },
  { name: "Reliability Monitoring (Lean)", desc: "Keep crash/hang diagnostics enabled while reducing non-essential background reliability overhead.", category: "System", risk: "SAFE", enabled: false },
  { name: "Error Reporting Minimal Actionable", desc: "Capture critical failures for troubleshooting while minimizing background reporting overhead.", category: "System", risk: "SAFE", enabled: false },
  { name: "Disable Non-Essential Scheduled Tasks", desc: "Disable unnecessary media/telemetry/vendor tasks that trigger during gaming sessions.", category: "System", risk: "MODERATE", enabled: false },
  { name: "Time Sync Stability (NTP)", desc: "Ensure stable, accurate NTP synchronization and avoid jittery time corrections important for online play.", category: "System", risk: "SAFE", enabled: false },
  { name: "USB Driver + Power Behavior Check", desc: "Update USB/chipset drivers and verify consistent USB controller behavior to reduce dropouts.", category: "System", risk: "SAFE", enabled: false },
  { name: "Disable USB Selective Power Save", desc: "Disable USB power-saving where safe so devices do not enter low-power/reset states mid-game.", category: "System", risk: "MODERATE", enabled: false },
  { name: "Audio Stack Low-Latency Baseline", desc: "Set appropriate default audio device, sample rate, and driver mode for low-latency playback.", category: "System", risk: "SAFE", enabled: false },
  { name: "Disable Heavy Audio Enhancements", desc: "Disable non-essential audio effects/processors that add latency, CPU load, or stutter.", category: "System", risk: "SAFE", enabled: false },
  { name: "Input Stack Stability Audit", desc: "Verify keyboard/mouse/controller drivers are current and no background input hooks interfere.", category: "System", risk: "SAFE", enabled: false },
  { name: "Device Manager Stability Cleanup", desc: "Disable truly unused adapters/ports (unused COM/LPT/NICs) to reduce driver conflicts and overhead.", category: "System", risk: "MODERATE", enabled: false },
  { name: "ACPI/Firmware Device Validation", desc: "Validate ACPI device behavior and firmware configuration to reduce latency/stutter variability.", category: "System", risk: "SAFE", enabled: false },
  { name: "Compositor Performance Defaults", desc: "Use performance-friendly desktop/compositor defaults while preserving required accessibility settings.", category: "System", risk: "SAFE", enabled: false },
  { name: "Disable Heavy UI Background Features", desc: "Disable unnecessary accessibility/background visual effects that consume CPU/GPU without gaming benefit.", category: "System", risk: "SAFE", enabled: false },
  { name: "Run Short Stability Baseline", desc: "Run a short CPU+RAM+storage stability pass plus quick GPU check to catch misconfiguration early.", category: "System", risk: "SAFE", enabled: false },
  { name: "Run Network Baseline Test", desc: "Measure packet loss, jitter, and latency consistency with a quick baseline test.", category: "System", risk: "SAFE", enabled: false },
  { name: "Create Applied Tweaks Profile", desc: "Save applied tweak groups (power, services, network, storage, security, drivers) with one-click revert mapping.", category: "System", risk: "SAFE", enabled: false },
  { name: "Generate Post-Tune Report", desc: "Deliver measured changes and targeted next steps such as cooling, RAM, NVMe, driver, or firmware follow-ups.", category: "System", risk: "SAFE", enabled: false },
  { name: "TCP Nagle Off", desc: "Disables packet buffering for instant data.", category: "Network", risk: "SAFE", enabled: true },
  { name: "Cloudflare 1.1.1.1 DNS", desc: "Configures network for lowest-latency resolvers.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Disable IPv6", desc: "Removes protocol overhead and fixes DNS vulnerabilities.", category: "Network", risk: "SAFE", enabled: true },
  { name: "Interrupt Moderation Off", desc: "Forces NIC to process packets immediately.", category: "Network", risk: "SAFE", enabled: true },
  { name: "Create Network Pre-Apply Restore Point", desc: "Mandatory first step: create restore point 'Optimizer-Network-Starters-PreApply' and verify rollback availability before network changes.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Confirm Physical Ethernet Quality", desc: "Audit cable/port integrity, reseat Ethernet connections, and prioritize wired connectivity for competitive play.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Verify Link Speed & Duplex", desc: "Confirm negotiated adapter speed and duplex are healthy (no forced half-duplex/negotiation errors).", category: "Network", risk: "SAFE", enabled: false },
  { name: "Validate Router/Switch Port Health", desc: "Check LAN port speed/error state and identify suspect cables or switch ports causing instability.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Update NIC Drivers Audit", desc: "Collect and verify latest Ethernet/Wi-Fi driver inventory for Intel/Realtek/Broadcom/Qualcomm-class adapters.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Router Firmware Currency Check", desc: "Capture current router firmware status and flag need for latest stable update.", category: "Network", risk: "SAFE", enabled: false },
  { name: "ISP Line Health Baseline", desc: "Run line-health baseline checks (latency/loss) to surface WAN/modem/ONT stability issues.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Ping/Jitter/Loss Baseline", desc: "Run controlled ping/jitter/packet-loss baseline to key endpoints before applying changes.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Throughput Consistency Baseline", desc: "Measure download/upload consistency to detect congestion, throttling, or wireless bottlenecks.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Disable Ethernet Power Saving", desc: "Disable Energy Efficient Ethernet and related NIC power-saving behavior to reduce latency variance.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Disable Wi-Fi Power Saving", desc: "Prevent Wi-Fi adapter low-power/sleep transitions that cause reconnect delays and jitter spikes.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Ethernet Maximum Performance Mode", desc: "Enable high-performance Ethernet adapter profile and disable green networking features where safe.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Prefer 5/6 GHz Wi-Fi Band", desc: "Bias wireless connectivity toward 5 GHz/6 GHz bands over congested 2.4 GHz.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Optimize Wi-Fi Channel Selection", desc: "Evaluate and select a less congested Wi-Fi channel to reduce overlap/interference.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Set Stable Wi-Fi Channel Width", desc: "Lock channel width to the most stable tested width instead of unstable wide defaults.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Tune MU-MIMO/Beamforming", desc: "Enable and validate MU-MIMO/beamforming where supported and stable.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Router QoS Gaming Profile", desc: "Apply non-destructive gaming-aware QoS prioritization without aggressive network starvation.", category: "Network", risk: "MODERATE", enabled: false },
  { name: "UPnP Security-Aware Mode", desc: "Enable UPnP only when required and keep behavior controlled for safer auto-port mapping.", category: "Network", risk: "MODERATE", enabled: false },
  { name: "Game Port Forwarding Plan", desc: "Prepare/manualize required game port forwarding entries for stable matchmaking/NAT behavior.", category: "Network", risk: "MODERATE", enabled: false },
  { name: "NAT Type Optimization Check", desc: "Validate NAT openness target using supported methods without unsafe router hacks.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Disable VPN/Proxy During Gaming", desc: "Disable active VPN/proxy layers for latency testing and competitive-session stability.", category: "Network", risk: "SAFE", enabled: false },
  { name: "DNS Reliability Tuning", desc: "Set/test reputable DNS with latency + packet-loss validation before permanent use.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Lock Stable Static DNS Pair", desc: "Apply a stable static DNS pair to avoid resolver churn mid-session.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Disable DNS Churn Assist", desc: "Disable adaptive DNS auto-rotation behavior that can introduce lookup jitter variability.", category: "Network", risk: "SAFE", enabled: false },
  { name: "MTU Safe Optimization", desc: "Use PMTU-aware testing to set stable MTU values and avoid fragmentation regressions.", category: "Network", risk: "MODERATE", enabled: false },
  { name: "LSO/TSO Stability Toggle", desc: "Toggle Large Send Offload behavior for adapters that exhibit instability under load.", category: "Network", risk: "MODERATE", enabled: false },
  { name: "RSS Conflict Tuning", desc: "Apply/test Receive Side Scaling tuning and revert if consistency degrades.", category: "Network", risk: "MODERATE", enabled: false },
  { name: "Disable Unused Network Protocols", desc: "Disable non-required legacy network bindings/protocol components to reduce overhead/conflicts.", category: "Network", risk: "MODERATE", enabled: false },
  { name: "Firewall Predictability Rules", desc: "Apply focused firewall allowances for game executables/ports while avoiding broad unsafe opens.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Third-Party Firewall Test Mode", desc: "Temporarily disable conflicting third-party security filtering during baseline testing.", category: "Network", risk: "MODERATE", enabled: false },
  { name: "Pause Network-Heavy Background Apps", desc: "Pause cloud sync, updaters, backup/torrent/streaming services during gaming windows.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Limit Concurrent Downloads/Streams", desc: "Reduce simultaneous heavy transfers that saturate uplink/downlink and trigger bufferbloat.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Router Bandwidth Management Audit", desc: "Tune router shaping/fair-queue behavior carefully to avoid packet-loss-inducing throttles.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Enable Smart Queue/AQM", desc: "Enable Smart Queue or AQM where available to reduce latency under load and bufferbloat.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Router Time/NTP Validation", desc: "Ensure router timezone/NTP settings are correct for stable scheduling and diagnostics.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Dedicated Gaming VLAN Plan", desc: "Prepare safe VLAN segregation plan for gaming devices with correct routing/firewall behavior.", category: "Network", risk: "MODERATE", enabled: false },
  { name: "Dedicated Gaming SSID Strategy", desc: "Isolate gaming devices onto dedicated 5/6 GHz SSID to reduce cross-device contention.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Guest Wi-Fi Noise Control", desc: "Disable guest Wi-Fi during performance sessions if it adds management/interference overhead.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Mesh Placement/Backhaul Audit", desc: "Validate mesh node placement and backhaul quality (wired preferred) for jitter control.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Dedicated Mesh Backhaul Band", desc: "Use dedicated mesh backhaul band where supported to separate client and inter-node traffic.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Wi-Fi Roaming Aggressiveness Test", desc: "Reduce roaming aggressiveness to avoid mid-session AP hopping and packet instability.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Adapter Priority: Ethernet First", desc: "Set adapter metric priority so Ethernet is preferred over Wi-Fi for consistent routing.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Disable Unused Network Adapters", desc: "Disable unused NICs/Bluetooth PAN interfaces to reduce routing confusion and driver overhead.", category: "Network", risk: "MODERATE", enabled: false },
  { name: "IPv4 vs IPv6 Path Selection Test", desc: "Compare IPv4-only and IPv6-enabled paths and keep mode with lower loss/jitter.", category: "Network", risk: "SAFE", enabled: false },
  { name: "ICMP/PMTUD Safety Check", desc: "Validate ICMP behavior required for PMTUD and avoid fragmentation-causing ICMP blocks.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Continuous Gameplay Net Monitoring", desc: "Run lightweight in-session monitoring for jitter/loss spikes correlated with stutter.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Post-Change Network Validation", desc: "Re-run baseline suite and verify latency/jitter/loss/throughput did not regress.", category: "Network", risk: "SAFE", enabled: false },
  { name: "In-Game Net Stats Validation", desc: "Validate game net graph metrics align with synthetic tests after optimization changes.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Create Network Tweaks Profile", desc: "Save applied network categories and one-click revert mapping for Ethernet/Wi-Fi/router/DNS/QoS/security.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Generate Network Optimization Report", desc: "Generate personalized report of latency/jitter/loss changes and prioritized follow-up actions.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Kill Medic / UsoSvc", desc: "Stops background update polling (Manual).", category: "Services", risk: "RISKY", enabled: false },
  { name: "Kill SysMain", desc: "Prevents aggressive disk indexing.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Kill DiagTrack", desc: "Stops Telemetry service for pure privacy.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Create Services Pre-Apply Restore Point", desc: "Mandatory: create restore point 'Optimizer-Services-Starters-PreApply' and confirm rollback is enabled.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Baseline Process Snapshot", desc: "Capture baseline CPU/RAM/Disk/Network usage before service tuning.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Baseline Service Snapshot", desc: "Capture running services, startup impact, and high-impact vendor services.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Run SFC Service Stability Scan", desc: "Run SFC to repair OS files that can destabilize background services.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Run DISM Service Health Repair", desc: "Repair component store to prevent service-related instability and slowdowns.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Verify Windows Stable for Services", desc: "Validate updates/status and keep installs scheduled outside gaming sessions.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Best Performance UI (Services Safe)", desc: "Reduce visual effects and background compositing load safely.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Non-Essential Startup Apps", desc: "Disable non-essential startup apps (chat/updaters/utilities/RGB suites).", category: "Services", risk: "SAFE", enabled: false },
  { name: "Prune Startup High Impact Entries", desc: "Disable high-impact startup items affecting boot and gameplay.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Safe Startup Folder/Registry Prune", desc: "Safely prune clearly non-essential startup entries and document changes.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Third-Party Overlays", desc: "Disable Discord/Steam/Epic/GFE overlays by default; re-enable per game.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Vendor Monitoring Utilities", desc: "Disable auto-start hardware polling suites unless strictly required.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Background Capture Services", desc: "Disable always-on recording/capture services that add overhead.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Xbox Game Bar Services", desc: "Disable Xbox Game Bar and related background processes.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Consumer Background Apps", desc: "Disable non-essential consumer background apps/inbox tasks.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Services Safe List Mode", desc: "Switch non-critical services toward Manual/Triggered safe defaults.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Telemetry Safe-Limited Mode", desc: "Reduce telemetry overhead while preserving required diagnostics/security.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Windows Update Scheduled Behavior", desc: "Set update behavior to notify/scheduled and avoid forced gaming-time installs.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Delivery Optimization During Play", desc: "Reduce Windows Delivery Optimization activity during gaming.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Defender Gaming Profile (Services)", desc: "Apply minimal Defender gaming exclusions and validate I/O impact.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Search Indexing on Game Drives", desc: "Reduce indexing I/O pressure on gaming drives.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Windows Search Manual Triggered Mode", desc: "Set WSearch to Manual/Triggered if full indexing is not needed.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "SysMain Safe Configuration", desc: "Tune SysMain behavior safely if disk thrash is observed.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Non-Essential Scheduled Tasks (Services)", desc: "Disable non-essential telemetry/vendor/media/diagnostic task churn.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Schedule Maintenance Off-Hours", desc: "Move maintenance-heavy tasks to non-gaming windows.", category: "Services", risk: "SAFE", enabled: false },
  { name: "SSD Defrag Safety Check", desc: "Avoid legacy SSD defrag and keep optimization TRIM-aware.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Reduce Maintenance Background Noise", desc: "Disable non-essential maintenance routines causing background load.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Windows Error Reporting Lean Mode", desc: "Keep critical crash reporting but reduce heavy background processing.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Diagnostic Data Safe Configuration", desc: "Reduce non-essential diagnostic data collection safely.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable WMP Network Sharing", desc: "Disable Windows Media Player network sharing services if unused.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable WIA If Unused", desc: "Disable Windows Image Acquisition service when scanners/cameras are unused.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Print Spooler If Unused", desc: "Disable Print Spooler when no printer is needed.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Fax Service If Unused", desc: "Disable Fax service when not required.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Bluetooth Support If Unused", desc: "Disable Bluetooth support service when Bluetooth is not used.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Remote Desktop Services If Unused", desc: "Disable Remote Desktop services to reduce overhead/attack surface.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Remote Registry If Unused", desc: "Disable Remote Registry service if not required.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Insider Preview Services", desc: "Disable Insider/preview update churn if not participating.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Network Discovery Noise", desc: "Reduce network discovery background chatter where not needed.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable SMBv1 Legacy Services", desc: "Disable SMBv1 and unnecessary legacy sharing service components.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Biometric Service If Unused", desc: "Disable Windows Biometric Service when not used.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Touch Keyboard Service If Unused", desc: "Disable Touch Keyboard/Handwriting service on non-touch setups.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Sensor Services If Unused", desc: "Disable unused sensor services to reduce background polling.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Location Service If Unused", desc: "Disable Windows location service when not needed.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Push Notifications Quiet Mode", desc: "Reduce notification background processing and UI compositing noise.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Non-Essential Audio Services", desc: "Disable non-essential audio enhancement/background processors.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Input Utility Background Tools", desc: "Disable non-essential macro/input monitoring utilities.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Chat/Voice Auto-Start", desc: "Disable chat/voice apps auto-start and launch on demand.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Cloud Sync Auto-Start", desc: "Disable OneDrive/Dropbox/Drive auto-start to reduce bursts.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Schedule Cloud Sync Windows", desc: "Schedule sync outside gaming sessions.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Backup Client Auto-Start", desc: "Disable backup client auto-start to reduce I/O contention.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Non-Essential Auto-Updaters", desc: "Disable non-essential app auto-updaters and schedule updates.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Browser Background Services", desc: "Disable browser background services and heavy acceleration where needed.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Heavy Browser Extensions", desc: "Disable unnecessary browser extensions that increase overhead.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Browser Low-Resource Mode", desc: "Reduce browser tabs/processes/background activity during sessions.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Store Background Downloads", desc: "Disable Microsoft Store background downloads during gameplay windows.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Windows Installer Spike Mitigation", desc: "Reduce installer-related background spikes during gaming.", category: "Services", risk: "SAFE", enabled: false },
  { name: "COM+ Safe Pruning Audit", desc: "Audit and disable only clearly non-essential COM+ services.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Font Cache Safe Mode", desc: "Keep font cache default unless measured disk-thrash regression.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Unused Device Drivers", desc: "Disable unused devices/ports to reduce driver overhead.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable USB Polling Utilities", desc: "Disable vendor USB polling utilities unless required.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "USB Controller Stability Mode", desc: "Tune USB controllers for stability and disable power-saving resets.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Storage Filter Driver Audit", desc: "Audit third-party storage filter drivers for I/O jitter impact.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Heavy Security Agents", desc: "Disable non-essential heavy endpoint agents during testing only.", category: "Services", risk: "RISKY", enabled: false },
  { name: "Security Exclusions Minimal Set", desc: "Use minimal security exclusions for verified game paths only.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Defender Full Scan Off-Hours", desc: "Schedule Defender full scans off-hours.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Defender Real-Time Spike Test", desc: "Test selective Defender real-time components if I/O jitter appears.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Service Dependency Safety Check", desc: "Validate service dependency chains before disabling services.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Set Non-Critical Services Manual", desc: "Set non-critical services to Manual/Triggered startup.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Duplicate Vendor Stacks", desc: "Disable duplicate monitoring/RGB/OC stacks running simultaneously.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Per-Game Priority Guidance", desc: "Apply cautious per-game process priority guidance only.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Per-Game CPU Affinity Guidance", desc: "Provide safe per-game affinity guidance for CPU-bound workloads.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Cap Background CPU Consumers", desc: "Limit CPU usage of non-essential background processes where supported.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Background COM Servers", desc: "Reduce unnecessary background COM server load.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Memory Management Defaults (Services)", desc: "Keep pagefile system-managed with safe defaults.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Reduce Background RAM Pressure", desc: "Close/trim non-essential apps to reduce paging pressure.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Visual Background Apps", desc: "Disable widgets/news/background visual apps not needed for gaming.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Widgets and News Feed", desc: "Disable Windows Widgets/News feed overhead.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Heavy Accessibility Services", desc: "Disable non-essential heavy accessibility background services.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Background Printing Features", desc: "Disable print queue monitoring/background printing features.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Disable Background Scanning Services", desc: "Reduce background AV/backup/indexing scans during play.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Vendor Telemetry Agents", desc: "Disable non-essential vendor telemetry agents where supported.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Disable Driver Helper Services", desc: "Disable non-essential driver helper polling services.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Chipset/ME Service Safe Config", desc: "Keep required chipset/ME services and disable duplicate utilities.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Post-Change Process+Service Audit", desc: "Audit CPU/RAM/Disk/service state after tuning for regressions.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Post-Change Stability Check", desc: "Run quick stability check and short gaming validation pass.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Post-Change Benchmark Validation", desc: "Compare FPS/frametime before-after and flag regressions.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Monitor Disk I/O Jitter", desc: "Monitor Resource Monitor disk activity for background thrash.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Monitor CPU Service Wake-Ups", desc: "Detect frequent service wake-ups and micro-stutter spikes.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Create Gaming Services Profile", desc: "Create gaming profile with high-impact safe service reductions.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Create Productivity Services Profile", desc: "Create productivity profile restoring work-related services.", category: "Services", risk: "SAFE", enabled: false },
  { name: "One-Click Revert Per Services Category", desc: "Provide one-click category revert for services/startup/tasks/security.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Document Disabled Items + Impact", desc: "Document each disabled item with expected performance impact.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Flag Dependencies + Alternatives", desc: "List dependencies and safe alternatives for each disabled service.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Vendor-Specific Service Guidance", desc: "Provide Intel/AMD/NVIDIA/Realtek/Qualcomm service guidance.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Gaming Session Mode Automation", desc: "Automate pause/stop of non-essential services and restore after session.", category: "Services", risk: "MODERATE", enabled: false },
  { name: "Security Posture Validation", desc: "Validate firewall/AV state and minimal exclusion footprint post-tuning.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Network Sanity Check After Services", desc: "Run quick ping/jitter sanity check after service changes.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Generate Services Optimization Report", desc: "Generate personalized services/process optimization results report.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Schedule Monthly Services Re-Audit", desc: "Schedule periodic re-audit to catch update-induced regressions.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Escalation Capture Guidance", desc: "Capture process/service/crash evidence for troubleshooting instability.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Lock Final Safe Services Baseline", desc: "Lock and preserve final safe baseline for competitive gaming stability.", category: "Services", risk: "SAFE", enabled: false },
  { name: "Deep Temp/Cache Clean", desc: "Nukes all User, Local, Prefetch, and Temp caches.", category: "Manual", risk: "SAFE", enabled: true },
  { name: "Check GPU Drivers", desc: "Opens official driver download portal.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Purge Standby RAM", desc: "Forces Windows to flush Standby memory list.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Ghost Shell Mode", desc: "Hides desktop icons. Use 'Revert' to restore.", category: "Manual", risk: "MODERATE", enabled: false },
  { name: "Verify GPU PCIe Lane Speed", desc: "Check if GPU is running at full x16 bandwidth vs reduced x8.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Resizable BAR Active", desc: "Confirm Resizable BAR/SAM is functioning in GPU driver software.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check GPU Hotspot Temperature Delta", desc: "Ensure GPU core-to-hotspot temp difference is under 15°C.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Monitor OSD Game Mode", desc: "Check physical monitor buttons for Game Mode/Overdrive settings.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Monitor Color Depth", desc: "Verify 10-bit or 8-bit color in GPU control panel.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify DisplayPort/HDMI Cable Version", desc: "Check cable matches monitor refresh rate requirements.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Test Display Cable Bandwidth Limit", desc: "Run pixel clock test to check cable performance at max refresh.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify GPU Fan Curve Performance", desc: "Check GPU fans spin up adequately under load.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Multiple Displays GPU Impact", desc: "Verify secondary monitors aren't forcing primary to downclock.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify VRAM Usage vs Capacity", desc: "Check if games exceed GPU VRAM limit causing stutters.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check CPU Core Clocks Under Load", desc: "Verify all CPU cores hit advertised Boost/Turbo frequencies.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify CPU Thermal Throttling", desc: "Check CPU isn't hitting 95°C+ and downclocking.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Confirm RAM Slots Populated Correctly", desc: "Verify A2/B2 slots for dual-channel bandwidth.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Actual RAM Speed vs Advertised", desc: "Compare Task Manager RAM speed against purchased kit.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check RAM Timing Latency", desc: "Verify CAS Latency matches kit specifications.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify System Interrupts CPU Usage", desc: "Check hardware interrupts consuming less than 1% CPU.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check CPU Cooler Pump Speed", desc: "Verify AIO pump running at 100% or optimal speed.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify PBO/MCE Status", desc: "Check AMD PBO or Intel MCE applied for max performance.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check BIOS Version Currency", desc: "Compare current BIOS against latest available.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Memory Integrity is Off", desc: "Check Windows Security for Core Isolation status.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Windows Security Folder Exclusions", desc: "Verify game directories excluded from real-time scanning.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Game Executable Antivirus Exclusions", desc: "Ensure game .exe files are whitelisted in AV.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Conflicting Third-Party Antivirus", desc: "Detect if two AV programs running simultaneously.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Windows Activation Status", desc: "Ensure Windows is fully activated.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Run SFC System File Checker", desc: "Scan and repair corrupted Windows system files.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Run DISM CheckHealth", desc: "Verify Windows component store health.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Secure Boot Enabled", desc: "Check Secure Boot is on for anti-cheat compatibility.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify TPM 2.0 Active", desc: "Ensure TPM enabled in BIOS for Windows 11.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Time Zone NTP Sync", desc: "Verify system clock sync for game server authentication.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify UAC Setting", desc: "Ensure UAC not set to Always Notify causing stutters.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check SSD Health TBW", desc: "Read SSD S.M.A.R.T. data for wear level and health.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Game Drive Free Space", desc: "Check game drive has over 20% free space.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Game on HDD", desc: "Detect if game installed on mechanical drive vs SSD.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Pagefile Not on HDD", desc: "Ensure virtual memory pagefile is on fastest SSD.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check NVMe Driver Status", desc: "Verify NVMe using manufacturer driver vs generic Windows.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Clear Windows Thumbnail Cache", desc: "Delete thumbnail data to free space and reduce Explorer hangs.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Clear Windows Font Cache", desc: "Reset font cache to prevent UI stutters.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Clear Windows Icon Cache", desc: "Rebuild icon cache to fix memory leaks.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Clear Discord Cache", desc: "Delete Discord image/video cache eating SSD/RAM.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Clear Steam Download Cache", desc: "Fix Disk Write Errors and free temp space.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Clear Epic Games Cache", desc: "Clear manifest cache to fix launch failures.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Clear Shader Caches", desc: "Wipe old shader caches to fix stuttering and flashing.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Clear Windows Crash Dumps", desc: "Delete Memory.dmp and minidump files.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Clear Windows Error Reports", desc: "Delete archived error reporting data.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Clear Windows Update Cleanup", desc: "Remove leftover update files freeing 5-10GB.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Ping Test Game Servers", desc: "Run live ping test to CS2/Valorant/LoL servers.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Run Packet Loss Test", desc: "Send 1000 packets to detect network drops.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Run Jitter Test", desc: "Measure ping variance over 30 seconds.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Wi-Fi Signal Strength", desc: "Verify connection above 80% signal quality.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Ethernet Link Speed", desc: "Check adapter negotiated 1Gbps/2.5Gbps with router.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Ethernet Cable Category", desc: "Ensure Cat5e/Cat6 cable used not older Cat5.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Test MTU Fragmentation", desc: "Find optimal MTU size for network.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Active VPN Interference", desc: "Detect VPN adding distance to game servers.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify UPnP on Router", desc: "Ensure game can automatically open ports.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Pending Windows Updates", desc: "Detect updates requiring restart to finalize.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Discord QoS Priority", desc: "Check Discord Quality of Service enabled.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Run Windows Memory Diagnostic", desc: "Quick RAM hardware error check.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Visual C++ Redistributables", desc: "Scan for missing VCRedist versions.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify .NET Framework Versions", desc: "Ensure latest .NET runtimes installed.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Orphaned Game Registry Keys", desc: "Clean leftover registry from uninstalled games.", category: "Manual", risk: "MODERATE", enabled: false },
  { name: "Verify Steam Game Files Integrity", desc: "Run file verification on most played game.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Steam Library Drive Health", desc: "Verify Steam drive not at 99% capacity.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Steam Overlay Status", desc: "Check if Steam Overlay enabled/disabled.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Conflicting Game Launchers", desc: "Detect multiple launchers running simultaneously.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify OBS Run-as-Admin", desc: "Check OBS set to run as Administrator.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Monitor Drivers", desc: "Verify monitor recognized by actual model name.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Monitor Scaling GPU", desc: "Ensure scaling handled by GPU not monitor.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check HDR Calibration", desc: "Verify Windows HDR Calibration tool run.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Audio Sample Rate", desc: "Check playback device locked to 48kHz/24-bit.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Disabled Audio Devices", desc: "Detect and disable disconnected audio devices.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Spatial Audio Settings", desc: "Check Windows Sonic/Dolby Atmos configuration.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Nahimic/Sonic Studio Bloat", desc: "Detect manufacturer audio enhancement software.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Mouse Polling Rate", desc: "Check mouse polling rate at 1000Hz+.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Mouse Firmware Updates", desc: "Verify gaming mouse firmware up to date.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Keyboard Polling Rate", desc: "Ensure keyboard set to 1000Hz not 125Hz.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Controller Firmware Updates", desc: "Verify Xbox/PlayStation controller firmware updated.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify USB Power Management Disabled", desc: "Check Windows can't turn off USB hubs.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify USB Selective Suspend Disabled", desc: "Ensure power plan not suspending USB devices.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Motherboard Chipset Drivers", desc: "Verify latest AMD/Intel chipset drivers installed.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Intel ME Updates", desc: "Verify ME firmware up to date for system stability.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check DPC Latency", desc: "Run 10-second DPC latency check for bad drivers.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Game Bar Recording Off", desc: "Double-check Windows hasn't re-enabled recording.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Xbox Game Pass DRM", desc: "Verify Windows gaming services healthy.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Focus Assist Rules", desc: "Ensure Focus Assist set to Alarms Only when gaming.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check DirectX Version", desc: "Verify DirectX Feature Level at 12.1/12_2.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Game Mode Not Stuck Off", desc: "Check registry key for Game Mode status.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Corrupted Game Save Syncs", desc: "Verify cloud save folders not stuck in sync loop.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Power Supply UPS", desc: "Check PC plugged into surge protector/UPS.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Excessive Desktop Icons", desc: "Warn if over 100 desktop icons eating VRAM.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Taskbar Transparency Off", desc: "Check taskbar effects re-enabled by updates.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Dynamic Refresh Rate", desc: "Ensure Windows DRR disabled for fixed refresh.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Bluetooth Driver Updates", desc: "Check for updated Bluetooth drivers.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Overclocking Software Conflicts", desc: "Detect multiple GPU OC tools installed.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Temp Folder Size", desc: "Check %TEMP% size and prompt cleanup if over 5GB.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Orphaned Windows Profiles", desc: "Detect old user accounts taking up space.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Windows Store App Licenses", desc: "Sync Microsoft Store licenses for Game Pass.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Windows.old Folder", desc: "Detect leftover Windows.old folder taking 20GB+.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Clipboard History", desc: "Check clipboard accumulated data and prompt clear.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Active Scheduled Tasks", desc: "Scan Task Scheduler for gaming-hour tasks.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Game Config File Integrity", desc: "Check CS2/Valorant configs for corruption.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check RAM Disk Remnants", desc: "Detect unused RAM disk software reserving memory.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify System Restore Points", desc: "Check if Restore taking over 10% of drive.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Legacy Java Versions", desc: "Detect outdated Java runtimes for removal.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Verify Browser Background Apps", desc: "Check Chrome/Edge running background apps.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Orphaned Virtual Network Adapters", desc: "Remove leftover VPN/Virtual Box adapters.", category: "Manual", risk: "MODERATE", enabled: false },
  { name: "Verify Monitor Firmware Updates", desc: "Check manufacturer site for monitor firmware.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Check Overheating NVMe Drives", desc: "Verify NVMe temps under 70°C to prevent throttling.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Run Full System Latency Score", desc: "Diagnostic benchmark for input-to-photon latency.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Disable Startup Apps", desc: "Disable all non-essential startup programs to speed up boot and free RAM.", category: "Manual", risk: "MODERATE", enabled: false },
  { name: "Clear Standby RAM", desc: "Flushes Windows standby memory cache (not running apps).", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Restart Explorer", desc: "Kills and restarts Windows Explorer to fix UI glitches.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Run FPS Benchmark", desc: "Measures system performance score (CPU/GPU/RAM/Disk) and saves results.", category: "Manual", risk: "SAFE", enabled: false },
  { name: "Auto-Clean Scheduler", desc: "Schedule temp cleanup: Daily, Weekly, or Monthly. Auto-defrags HDDs, logs results.", category: "Manual", risk: "SAFE", enabled: false, frequency: 'weekly' },
  { name: "Boot Time Optimizer", desc: "Analyzes startup impact, suggests apps to disable, tracks boot improvements.", category: "System", risk: "MODERATE", enabled: false },
  { name: "Process Killer", desc: "Lists top CPU/RAM consumers with one-click kill and blacklist support.", category: "Manual", risk: "MODERATE", enabled: false },
  { name: "Disk Health Monitor", desc: "Shows SSD wear level, SMART data, predicts failure warnings.", category: "System", risk: "SAFE", enabled: false },
  { name: "Ping Optimizer", desc: "Tests Cloudflare/Google/OpenDNS, auto-selects lowest latency, shows history.", category: "Network", risk: "SAFE", enabled: false },
  { name: "Network Throttle Control", desc: "Limits background bandwidth, prioritizes game traffic, kills bandwidth hogs.", category: "Network", risk: "MODERATE", enabled: false },

  // MODS CATEGORY
  { name: "TranslucentTB", desc: "A lightweight utility that makes your Windows taskbar translucent or transparent.", category: "Mods", risk: "SAFE", enabled: false },
  { name: "Vencord", desc: "The most feature-rich Discord client mod. Fast, open source and easy to use.", category: "Mods", risk: "SAFE", enabled: false },
  { name: "Lively Wallpaper", desc: "Free and open-source software that allows you to set animated and interactive wallpapers.", category: "Mods", risk: "SAFE", enabled: false },
  { name: "Spicetify", desc: "Powerful CLI tool to customize the Spotify client. Change themes and add extensions.", category: "Mods", risk: "SAFE", enabled: false },
  { name: "BetterDiscord", desc: "A popular Discord customization tool that supports themes and plugins; a strong alternative/companion to Vencord depending on your needs.", category: "Mods", risk: "SAFE", enabled: false },
  { name: "RoundedTB", desc: "Windows taskbar tweak that lets you round the taskbar corners and split/adjust it for a more polished desktop aesthetic.", category: "Mods", risk: "SAFE", enabled: false },
  { name: "ExplorerPatcher", desc: "Restores and enhances Windows Explorer/Start behavior (especially useful if you prefer older Start styles or want deeper UI control on newer Windows versions).", category: "Mods", risk: "SAFE", enabled: false },
  { name: "PowerToys", desc: "A Microsoft-made suite of utilities (FancyZones, PowerRename, Keyboard Manager, etc.) that effectively “mod” everyday Windows workflows for speed and ergonomics.", category: "Mods", risk: "SAFE", enabled: false },
  { name: "Dark Reader", desc: "Browser extension that applies dark mode to almost any website, reducing eye strain and making the web feel consistent with your desktop theme.", category: "Mods", risk: "SAFE", enabled: false },
  { name: "uBlock Origin", desc: "A high-performance ad/content blocker that improves browsing speed, privacy, and cleanliness—an essential “quality-of-life mod” for the modern web.", category: "Mods", risk: "SAFE", enabled: false },
];

let cpuHistory: number[] = new Array(50).fill(0);
let gpuHistory: number[] = new Array(50).fill(0);
let currentCategory = 'Starters';
let currentPage = 1;
const ITEMS_PER_PAGE = 10; // Shorter pages for easier scrolling

function saveTweaks() {
  const state = tweaks.map(t => ({ name: t.name, enabled: t.enabled, frequency: t.frequency }));
  localStorage.setItem('nova_tweaks_state', JSON.stringify(state));
  updateHealthScore();
}

function loadTweaks() {
  const saved = localStorage.getItem('nova_tweaks_state');
  if (saved) {
    try {
      const savedState = JSON.parse(saved);
      savedState.forEach((s: any) => {
        const tweak = tweaks.find(t => t.name === s.name);
        if (tweak) {
          tweak.enabled = s.enabled;
          if (s.frequency) tweak.frequency = s.frequency;
        }
      });
    } catch (e) { }
  }
}

function initGraphs() {
  const cpuCanvas = document.getElementById('cpu-graph-canvas') as HTMLCanvasElement;
  const gpuCanvas = document.getElementById('gpu-graph-canvas') as HTMLCanvasElement;
  if (cpuCanvas) cpuCanvas.width = 180;
  if (gpuCanvas) gpuCanvas.width = 180;
}

function drawSparkline(canvas: HTMLCanvasElement, data: number[], color: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || data.length < 2) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const step = canvas.width / (data.length - 1);
  data.forEach((val, i) => {
    const x = i * step;
    const y = canvas.height - (val / 100 * canvas.height);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

let clockInterval: any = null;
function startClock() {
  const clockEl = document.getElementById('clock');
  if (!clockEl) return;
  if (clockInterval) clearInterval(clockInterval);

  const update = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    clockEl.innerText = `${h}:${m}:${s}`;
  };

  update();
  clockInterval = setInterval(update, 1000);
}

// syncSystemState removed - it was causing slow startup and overriding user preferences
// LocalStorage is now the source of truth for toggle states

function updateMonitor() {
  const cpuEl = document.getElementById('cpu-usage');
  const gpuEl = document.getElementById('gpu-usage');
  const ramEl = document.getElementById('ram-usage');
  const pingEl = document.getElementById('ping');
  const cpuTempEl = document.getElementById('cpu-temp');
  const gpuTempEl = document.getElementById('gpu-temp');
  const fpsEl = document.getElementById('fps-val');
  const procEl = document.getElementById('proc-count');
  const uptimeEl = document.getElementById('uptime-val');
  const storageList = document.getElementById('storage-list');

  const update = async () => {
    const winAny = window as any;
    if (winAny.novaAPI) {
      const stats = await winAny.novaAPI.getStats();
      if (stats) {
        if (cpuEl) cpuEl.innerText = `${Math.round(stats.cpuUsage)}%`;
        if (gpuEl) gpuEl.innerText = `${Math.round(stats.gpuUsage)}%`;
        if (ramEl) ramEl.innerText = `${stats.ramUsage.toFixed(1)} GB (${Math.round((stats.ramUsage / (stats.ramTotal || 16)) * 100)}%)`;
        if (pingEl) pingEl.innerText = `${Math.round(stats.ping)} MS`;
        if (cpuTempEl) cpuTempEl.innerText = `${Math.round(stats.cpuTemp)}\u00b0C`;
        if (gpuTempEl) gpuTempEl.innerText = `${Math.round(stats.gpuTemp)}\u00b0C`;
        if (fpsEl) fpsEl.innerText = `${Math.max(0, Math.floor(700 - (stats.cpuUsage * 4)))} FPS`;
        if (procEl) procEl.innerText = stats.processes || '\u2014';

        if (uptimeEl) {
          const totalSec = stats.uptime;
          const hours = Math.floor(totalSec / 3600);
          const mins = Math.floor((totalSec % 3600) / 60);
          uptimeEl.innerText = `${hours}H ${mins}M`;
        }

        if (storageList && stats.drives) {
          // Only rebuild DOM if drive count changed or usage shifted >2%
          const driveKey = stats.drives.map((d: any) => `${d.label}:${d.use}`).join('|');
          if ((storageList as any)._lastKey !== driveKey) {
            (storageList as any)._lastKey = driveKey;
            const frag = document.createDocumentFragment();
            stats.drives.forEach((d: any) => {
              const row = document.createElement('div');
              row.style.cssText = 'display:flex; justify-content:space-between; font-size:0.7rem; margin-bottom:2px;';
              row.innerHTML = `<span style="color:var(--text-main)">Disk ${d.label}</span><span style="color:var(--text-dim)">${d.availableGB}GB</span>`;
              const bar = document.createElement('div');
              bar.style.cssText = 'height:4px; width:100%; background:rgba(255,255,255,0.05); border-radius:2px; overflow:hidden; margin-bottom:8px;';
              bar.innerHTML = `<div style="height:100%; width:${d.use}%; background:var(--accent-magenta); box-shadow:0 0 8px var(--glow-magenta);"></div>`;
              frag.appendChild(row);
              frag.appendChild(bar);
            });
            storageList.innerHTML = '';
            storageList.appendChild(frag);
          }
        }

        cpuHistory.shift(); cpuHistory.push(stats.cpuUsage);
        gpuHistory.shift(); gpuHistory.push(stats.gpuUsage);
        const cc = document.getElementById('cpu-graph-canvas') as HTMLCanvasElement;
        const gc = document.getElementById('gpu-graph-canvas') as HTMLCanvasElement;
        if (cc) drawSparkline(cc, cpuHistory, '#FF107A');
        if (gc) drawSparkline(gc, gpuHistory, '#00FFF5');

        // Update health score based on real performance metrics
        updateHealthScore(stats);
      }
    }
  };

  update();
  setInterval(update, 1000);
}

function updateHealthScore(stats?: any) {
  const healthEl = document.getElementById('health-score');
  const sphereEl = document.querySelector('.health-sphere') as HTMLElement;
  if (!healthEl) return;

  const score = stats ? calculatePerformanceScore(stats) : lastHealthScore;
  healthEl.textContent = score.toString();

  if (sphereEl) {
    const colors = getScoreColor(score);
    sphereEl.style.borderColor = colors.border;
    sphereEl.style.boxShadow = `0 0 60px ${colors.glow}, inset 0 0 40px ${colors.glow}`;
    sphereEl.style.background = `radial-gradient(circle, ${colors.bg} 0%, transparent 70%)`;
  }
}

function renderLibrary(category: string, filter: string = '', page: number = currentPage) {
  const container = document.getElementById('tweak-list');
  if (!container) return;

  // Update global currentCategory
  const isNewCategory = category !== currentCategory;
  currentCategory = category;

  // Reset to page 1 when changing category or filter
  if (isNewCategory && !filter) {
    currentPage = 1;
    page = 1;
  }

  let list = category.toUpperCase() === 'ALL' ? tweaks : tweaks.filter(t => t.category.toUpperCase() === category.toUpperCase());
  if (filter) {
    list = list.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()) || t.desc.toLowerCase().includes(filter.toLowerCase()));
    currentPage = 1;
    page = 1;
  }

  // Pagination calculations
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
  currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, totalItems);
  const paginatedList = list.slice(startIndex, endIndex);

  const frag = document.createDocumentFragment();
  paginatedList.forEach((tweak, index) => {
    const card = document.createElement('div');
    card.className = 'tweak-card glass library-card';
    card.style.animationDelay = `${(index % ITEMS_PER_PAGE) * 0.03}s`; // Stagger based on page position
    const isManual = tweak.category.toUpperCase() === 'MANUAL' || tweak.category.toUpperCase() === 'MODS';
    const isMods = tweak.category.toUpperCase() === 'MODS';
    const riskColor = tweak.risk === 'SAFE' ? '#00FF7F' : (tweak.risk === 'MODERATE' ? '#FFAA00' : '#FF107A');

    card.style.border = isMods ? '1px solid rgba(255, 0, 60, 0.35)' : '1px solid rgba(255, 0, 60, 0.12)';
    if (isMods) {
      card.style.boxShadow = '0 0 20px rgba(255, 0, 60, 0.15)';
    }

    const isAutoClean = tweak.name === 'Auto-Clean Scheduler';
    const freqSelector = isAutoClean ? `
      <select class="freq-select" style="background:rgba(0,0,0,0.3); border:1px solid var(--border-subtle); color:var(--text-main); padding:4px 8px; border-radius:6px; font-size:0.75rem; margin-top:8px; cursor:pointer;">
        <option value="daily" ${tweak.frequency === 'daily' ? 'selected' : ''}>Daily</option>
        <option value="weekly" ${tweak.frequency === 'weekly' || !tweak.frequency ? 'selected' : ''}>Weekly</option>
        <option value="monthly" ${tweak.frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
      </select>
    ` : '';

    card.innerHTML = `
      <div class="tweak-info">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
           <span class="tweak-name card-name ${isMods ? 'mod-name-rainbow' : ''}" style="margin:0">${tweak.name}</span>
           <span style="font-size:0.6rem; padding:2px 6px; border-radius:4px; font-weight:900; background:rgba(255,255,255,0.05); color:${riskColor}">${tweak.risk}</span>
        </div>
        <span class="tweak-tag">${tweak.category}</span>
        <span class="tweak-desc card-desc">${tweak.desc}</span>
        ${freqSelector}
      </div>
      ${isManual ? `<button class="btn-manual">RUN</button>` : `<label class="switch"><input type="checkbox" ${tweak.enabled ? 'checked' : ''}><span class="slider"></span></label>`}
    `;

    // Add frequency change handler for Auto-Clean
    if (isAutoClean) {
      card.querySelector('.freq-select')?.addEventListener('change', (e) => {
        tweak.frequency = (e.target as HTMLSelectElement).value as any;
        saveTweaks();
      });
    }

    if (isManual) {
      card.querySelector('.btn-manual')?.addEventListener('click', async (e) => {
        const b = e.target as HTMLButtonElement;
        b.innerText = '...';

        // Update Discord RPC for benchmark
        if (tweak.name === 'Run FPS Benchmark') {
          (window as any).novaAPI?.updateRPC?.('benchmarking', 'Testing system performance...');
          b.innerText = 'TESTING...';
        }

        const modLinks: Record<string, string> = {
          'TranslucentTB': 'https://github.com/TranslucentTB/TranslucentTB',
          'Vencord': 'https://vencord.dev/',
          'Lively Wallpaper': 'https://github.com/rocksdanister/lively',
          'Spicetify': 'https://spicetify.app/',
          'BetterDiscord': 'https://betterdiscord.app/',
          'RoundedTB': 'https://github.com/torchgm/RoundedTB',
          'ExplorerPatcher': 'https://github.com/valinet/ExplorerPatcher',
          'PowerToys': 'https://github.com/microsoft/PowerToys',
          'Dark Reader': 'https://darkreader.org/',
          'uBlock Origin': 'https://ublockorigin.com/'
        };

        if (modLinks[tweak.name]) {
          await (window as any).novaAPI?.openExternal?.(modLinks[tweak.name]);
          b.innerText = 'OPENED';
          setTimeout(() => b.innerText = 'RUN', 1500);
          return;
        }

        const res = await (window as any).novaAPI?.runTweak?.(tweak.name, true);

        if (res?.ok === false) {
          alert(`Failed tweak: ${tweak.name}\n${res.err || 'Unknown error'}`);
          b.innerText = 'FAIL';
        } else {
          b.innerText = tweak.name === 'Run FPS Benchmark' ? 'SCORE SAVED' : 'DONE';
        }

        // Reset RPC after benchmark
        if (tweak.name === 'Run FPS Benchmark') {
          setTimeout(() => (window as any).novaAPI?.updateRPC?.('idle'), 3000);
        }

        setTimeout(() => b.innerText = 'RUN', tweak.name === 'Run FPS Benchmark' ? 2000 : 1200);
      });
    } else {
      card.querySelector('input')?.addEventListener('change', async (e) => {
        const input = e.target as HTMLInputElement;
        tweak.enabled = input.checked;
        const res = await (window as any).novaAPI?.runTweak?.(tweak.name, tweak.enabled);
        if (res?.ok === false) {
          alert(`Failed tweak: ${tweak.name}\n${res.err || 'Unsupported or failed command'}`);
          tweak.enabled = !tweak.enabled;
          input.checked = tweak.enabled;
        }
        saveTweaks();
      });
    }
    frag.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(frag);

  renderPagination(totalItems, totalPages, currentPage, category, filter);
}

function renderPagination(_totalItems: number, totalPages: number, current: number, category: string, filter: string) {
  // Remove existing pagination and scroll indicator
  const existing = document.getElementById('library-pagination');
  if (existing) existing.remove();
  const existingScroll = document.querySelector('.scroll-indicator');
  if (existingScroll) existingScroll.remove();

  if (totalPages <= 1) return; // No pagination needed

  const container = document.getElementById('tweak-list');
  if (!container) return;

  const paginationDiv = document.createElement('div');
  paginationDiv.id = 'library-pagination';
  paginationDiv.className = 'pagination-container';

  // Helper to create page button
  const createPageBtn = (pageNum: number, isActive: boolean = false) => {
    const btn = document.createElement('button');
    btn.className = `pagination-btn ${isActive ? 'active' : ''}`;
    btn.innerText = pageNum.toString();
    if (!isActive) {
      btn.addEventListener('click', () => {
        currentPage = pageNum;
        renderLibrary(category, filter, pageNum);
      });
    }
    return btn;
  };

  // Helper to create ellipsis
  const createEllipsis = () => {
    const span = document.createElement('span');
    span.className = 'pagination-info';
    span.innerText = '...';
    span.style.padding = '0 0.5rem';
    return span;
  };

  // Previous button
  const prevBtn = document.createElement('button');
  prevBtn.className = 'pagination-btn';
  prevBtn.innerText = '←';
  prevBtn.title = 'Previous';
  prevBtn.disabled = current === 1;
  prevBtn.addEventListener('click', () => {
    currentPage = current - 1;
    renderLibrary(category, filter, currentPage);
  });
  paginationDiv.appendChild(prevBtn);

  // First page
  if (totalPages > 1) {
    paginationDiv.appendChild(createPageBtn(1, current === 1));
  }

  // Calculate visible page range
  let startPage = Math.max(2, current - 2);
  let endPage = Math.min(totalPages - 1, current + 2);

  // Adjust if near edges
  if (current <= 3) {
    endPage = Math.min(totalPages - 1, 5);
  } else if (current >= totalPages - 2) {
    startPage = Math.max(2, totalPages - 4);
  }

  // Left ellipsis
  if (startPage > 2) {
    paginationDiv.appendChild(createEllipsis());
  }

  // Middle pages
  for (let i = startPage; i <= endPage; i++) {
    paginationDiv.appendChild(createPageBtn(i, current === i));
  }

  // Right ellipsis
  if (endPage < totalPages - 1) {
    paginationDiv.appendChild(createEllipsis());
  }

  // Last page
  if (totalPages > 1) {
    paginationDiv.appendChild(createPageBtn(totalPages, current === totalPages));
  }

  // Next button
  const nextBtn = document.createElement('button');
  nextBtn.className = 'pagination-btn';
  nextBtn.innerText = '→';
  nextBtn.title = 'Next';
  nextBtn.disabled = current === totalPages;
  nextBtn.addEventListener('click', () => {
    currentPage = current + 1;
    renderLibrary(category, filter, currentPage);
  });
  paginationDiv.appendChild(nextBtn);

  // Page info removed as per user request

  // Insert after container
  container.parentNode?.insertBefore(paginationDiv, container.nextSibling);
}



// Futuristic Loading Sequence with Countdown - Return Promise to allow awaiting
function runLoadingSequence(): Promise<void> {
  return new Promise((resolve) => {
    const loadingScreen = document.getElementById('loading-screen');
    const loadingBar = document.getElementById('loading-bar');
    const loadingPercent = document.getElementById('loading-percent');
    const loadingModules = document.getElementById('loading-modules');
    const loadingStatus = document.getElementById('loading-status');
    const appContainer = document.getElementById('app-container');
    const navDock = document.getElementById('nav-dock');

    // Ensure body is locked during loading
    document.body.style.overflow = 'hidden';

    const modules = [
      'INITIALIZING KERNEL...',
      'LOADING SYSTEM MODULES...',
      'OPTIMIZING MEMORY...',
      'CALIBRATING SENSORS...',
      'ESTABLISHING SECURE CONNECTION...',
      'SYNCING WITH CLOUD...',
      'SYSTEM READY - AWAITING LAUNCH'
    ];

    let progress = 0;
    let currentModule = 0;
    const totalTime = 4; // Faster, more premium feel
    const startTime = Date.now();

    // Countdown digit elements
    const digits = {
      min0: document.getElementById('cd-min0'),
      min1: document.getElementById('cd-min1'),
      sec0: document.getElementById('cd-sec0'),
      sec1: document.getElementById('cd-sec1'),
      ms0: document.getElementById('cd-ms0'),
      ms1: document.getElementById('cd-ms1')
    };

    function updateDigit(el: HTMLElement | null, newVal: string, oldVal: string) {
      if (!el || newVal === oldVal) return;
      el.style.animation = 'none';
      el.offsetHeight; // Reflow
      el.style.animation = 'digitFlip 0.3s ease, digitPulse 1s ease-in-out infinite';
      el.textContent = newVal;
    }

    let lastTimeStr = 'XXXXXX'; // min0, min1, sec0, sec1, ms0, ms1

    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, totalTime - elapsed);

      const mm = Math.floor(remaining / 60).toString().padStart(2, '0');
      const ss = Math.floor(remaining % 60).toString().padStart(2, '0');
      const ms = Math.floor((remaining % 1) * 100).toString().padStart(2, '0');

      const currentTimeStr = mm + ss + ms;

      // Update all digits
      updateDigit(digits.min0, currentTimeStr[0], lastTimeStr[0]);
      updateDigit(digits.min1, currentTimeStr[1], lastTimeStr[1]);
      updateDigit(digits.sec0, currentTimeStr[2], lastTimeStr[2]);
      updateDigit(digits.sec1, currentTimeStr[3], lastTimeStr[3]);
      updateDigit(digits.ms0, currentTimeStr[4], lastTimeStr[4]);
      updateDigit(digits.ms1, currentTimeStr[5], lastTimeStr[5]);

      lastTimeStr = currentTimeStr;

      progress = Math.min(100, (elapsed / totalTime) * 100);

      if (loadingBar) loadingBar.style.width = `${progress}%`;
      if (loadingPercent) loadingPercent.textContent = `${Math.floor(progress)}%`;

      const modIdx = Math.min(Math.floor((progress / 100) * modules.length), modules.length - 1);
      if (modIdx !== currentModule) {
        currentModule = modIdx;
        if (loadingModules) loadingModules.textContent = `${currentModule + 1}/7`;
        if (loadingStatus) {
          loadingStatus.textContent = modules[currentModule];
        }
      }

      if (progress >= 100) {
        clearInterval(interval);

        if (loadingStatus) {
          loadingStatus.textContent = 'LAUNCHING NOVA...';
          loadingStatus.style.color = 'var(--accent-cyan)';
        }

        setTimeout(() => {
          if (loadingScreen) {
            loadingScreen.style.transition = 'opacity 0.8s ease-out';
            loadingScreen.style.opacity = '0';
          }

          setTimeout(() => {
            if (loadingScreen) loadingScreen.style.display = 'none';

            if (appContainer) {
              appContainer.style.transition = 'opacity 0.6s ease-out';
              appContainer.style.opacity = '1';
              appContainer.style.overflowY = 'auto';
            }
            if (navDock) {
              navDock.style.transition = 'opacity 0.6s ease-out 0.2s';
              navDock.style.opacity = '1';
            }

            // Fade out cinematic overlay
            const cinematicFade = document.getElementById('cinematic-fade');
            if (cinematicFade) {
              cinematicFade.style.transition = 'opacity 0.6s ease-out';
              cinematicFade.style.opacity = '0';
            }

            document.body.style.overflow = 'hidden';
            resolve();
          }, 800);
        }, 400);
      }
    }, 25);

    // Fail-safe
    setTimeout(() => {
      if (loadingScreen && loadingScreen.style.display !== 'none') {
        loadingScreen.style.display = 'none';
        if (appContainer) {
          appContainer.style.opacity = '1';
          appContainer.style.overflowY = 'auto';
        }
        if (navDock) {
          navDock.style.opacity = '1';
        }
        document.body.style.overflow = 'hidden';
        resolve();
      }
    }, 10000);
  });
}

function setupEventListeners() {
  const socialLinks: Record<string, string> = {
    'social-discord': 'https://discord.com/invite/tJCDbsweQC',
    'social-telegram': 'https://t.me/novaoptimizer',
    'social-roblox': 'https://www.roblox.com/users/10662797224/profile'
  };

  Object.entries(socialLinks).forEach(([id, url]) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', async () => {
        try {
          await (window as any).novaAPI.openExternal(url);
        } catch (e) {
          window.open(url, '_blank');
        }
      });
    }
  });



  document.getElementById('btn-optimize')?.addEventListener('click', async (e) => {
    const btn = e.target as HTMLButtonElement;
    btn.innerText = 'OPTIMIZING...';
    btn.disabled = true;

    const toOptimize = tweaks.filter(t => t.category.toUpperCase() !== 'MANUAL' && t.risk !== 'RISKY' && !t.enabled);
    const batchSize = 3;

    for (let i = 0; i < toOptimize.length; i += batchSize) {
      const batch = toOptimize.slice(i, i + batchSize);
      await Promise.all(batch.map(async (tweak) => {
        tweak.enabled = true;
        const res = await (window as any).novaAPI?.runTweak?.(tweak.name, true);
        if (res?.ok === false) {
          tweak.enabled = false;
        }
        return res;
      }));

      if (i + batchSize < toOptimize.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    saveTweaks();
    renderLibrary(currentCategory);
    btn.innerText = 'DONE';
    btn.disabled = false;
    setTimeout(() => btn.innerText = 'OPTIMIZE NOW', 2000);
  });

  // Window Controls
  document.getElementById('win-min')?.addEventListener('click', () => {
    (window as any).novaAPI?.minimizeWindow?.();
  });
  document.getElementById('win-restore')?.addEventListener('click', () => {
    (window as any).novaAPI?.restoreWindow?.();
  });
  document.getElementById('win-close')?.addEventListener('click', () => {
    (window as any).novaAPI?.closeWindow?.();
  });

  const revertHandler = async () => {
    await (window as any).novaAPI?.revertTweaks?.();
    tweaks.forEach(t => t.enabled = false);
    saveTweaks();
    renderLibrary(currentCategory);
    alert('System Default State Restored Successfully.');
  };
  document.getElementById('btn-revert')?.addEventListener('click', revertHandler);
  document.getElementById('revert-all-library')?.addEventListener('click', revertHandler);

  document.getElementById('optimize-all-library')?.addEventListener('click', async (e) => {
    const btn = e.target as HTMLButtonElement;
    btn.innerText = 'OPTIMIZING...';
    btn.disabled = true;

    const toOptimize = tweaks.filter(t => t.category.toUpperCase() !== 'MANUAL' && t.risk !== 'RISKY' && !t.enabled);
    const batchSize = 3; // Process 3 at a time to prevent freezing

    for (let i = 0; i < toOptimize.length; i += batchSize) {
      const batch = toOptimize.slice(i, i + batchSize);
      // Run batch in parallel
      await Promise.all(batch.map(async (tweak) => {
        tweak.enabled = true;
        const res = await (window as any).novaAPI?.runTweak?.(tweak.name, true);
        if (res?.ok === false) {
          tweak.enabled = false;
        }
        return res;
      }));

      // Small delay between batches to let UI breathe
      if (i + batchSize < toOptimize.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    saveTweaks();
    renderLibrary(currentCategory);
    btn.innerText = 'DONE';
    btn.disabled = false;
    setTimeout(() => btn.innerText = 'OPTIMIZE ALL', 2000);
  });

  const sInput = document.getElementById('library-search') as HTMLInputElement;
  sInput?.addEventListener('input', (e) => {
    const term = (e.target as HTMLInputElement).value;
    renderLibrary(currentCategory, term);
  });

  document.querySelectorAll('.pill').forEach(pill => {
    const p = pill as HTMLElement;
    const cat = p.getAttribute('data-cat') || 'starters';
    p.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      currentCategory = cat;
      if (sInput) sInput.value = ''; // Clear search when switching categories

      // Handle MODS category
      const tweakList = document.getElementById('tweak-list');
      const pagination = document.getElementById('library-pagination');
      const modsSection = document.getElementById('mods-section');

      if (cat === 'mods') {
        if (tweakList) tweakList.style.display = 'none';
        if (pagination) pagination.style.display = 'none';
        if (modsSection) {
          modsSection.style.display = 'block';
          modsSection.style.opacity = '0';
          void modsSection.offsetWidth;
          modsSection.style.opacity = '1';
        }
      } else {
        if (tweakList) tweakList.style.display = 'grid';
        if (pagination) pagination.style.display = 'flex';
        if (modsSection) modsSection.style.display = 'none';
        renderLibrary(currentCategory);
      }
    });
  });

  // Scrolling is handled by .app-container in CSS

  document.querySelectorAll('[data-view]').forEach(i => i.addEventListener('click', (e) => {
    const vId = (i as HTMLElement).getAttribute('data-view') || 'dashboard';

    // Prevent default jump if any
    if (e) e.preventDefault();

    const views = document.querySelectorAll('.content-view');
    const navItems = document.querySelectorAll('.nav-item');
    const targetView = document.getElementById(vId);
    const targetNav = document.querySelector(`.nav-item[data-view="${vId}"]`);

    if (!targetView || targetView.classList.contains('active')) return;

    // Switch active state with smooth fade
    views.forEach(v => {
      const he = v as HTMLElement;
      if (he.classList.contains('active')) {
        he.style.opacity = '0';
        setTimeout(() => he.classList.remove('active'), 250);
      }
    });
    navItems.forEach(n => n.classList.remove('active'));

    setTimeout(() => {
      targetView.classList.add('active');
      if (targetNav) targetNav.classList.add('active');

      // Force reflow and fade in
      targetView.style.opacity = '0';
      void targetView.offsetWidth;
      targetView.style.opacity = '1';

      const dock = document.querySelector('.nav-dock') as HTMLElement;
      if (dock) dock.style.display = 'flex';
    }, 250);
    // Reset scroll position smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));

  // Settings functionality
  document.getElementById('setting-timezone')?.addEventListener('change', (e) => {
    const tz = (e.target as HTMLSelectElement).value;
    localStorage.setItem('nova_timezone', tz);
    // Clock will pick up the new timezone on next tick
  });

  document.getElementById('setting-theme')?.addEventListener('change', (e) => {
    const theme = (e.target as HTMLSelectElement).value;
    localStorage.setItem('nova_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  });

  document.getElementById('setting-accent-color')?.addEventListener('input', (e) => {
    const color = (e.target as HTMLInputElement).value;
    localStorage.setItem('nova_accent_color', color);
    document.documentElement.style.setProperty('--accent-magenta', color);
    document.documentElement.style.setProperty('--glow-magenta', hexToRgbA(color, 0.5));
  });

  // Restart PC button
  document.getElementById('restart-pc-btn')?.addEventListener('click', () => {
    (window as any).novaAPI?.restartPC?.();
  });

  // ── Background Customization ─────────────────────
  const bgTypeSelect = document.getElementById('setting-bg-type') as HTMLSelectElement;
  const bgFileSection = document.getElementById('bg-file-section');
  const bgFileName = document.getElementById('bg-file-name');
  const btnSelectBg = document.getElementById('btn-select-bg');
  const btnApplyBg = document.getElementById('btn-apply-bg');
  const btnClearBg = document.getElementById('btn-clear-bg');
  const bgLayer = document.getElementById('bg-layer');
  const inputBgUrl = document.getElementById('input-bg-url') as HTMLInputElement;

  let currentBgPath = localStorage.getItem('nova_bg_path') || '';
  let currentBgType = localStorage.getItem('nova_bg_type') || 'solid';
  let selectedBgPath = ''; // Temp storage for selected file before applying

  // Initialize background on load
  function initBackground() {
    if (bgTypeSelect) bgTypeSelect.value = currentBgType;

    if (inputBgUrl) inputBgUrl.style.display = currentBgType === 'url' ? 'block' : 'none';
    if (btnSelectBg) btnSelectBg.style.display = currentBgType === 'url' ? 'none' : 'block';
    if (bgFileName) bgFileName.parentElement!.style.display = currentBgType === 'url' ? 'none' : 'flex';

    if (currentBgType !== 'solid' && currentBgPath) {
      if (currentBgType === 'url' && inputBgUrl) inputBgUrl.value = currentBgPath;
      applyBackground(currentBgType, currentBgPath);
      if (bgFileName && currentBgType !== 'url') bgFileName.textContent = currentBgPath.split(/[/\\]/).pop() || 'Unknown';
      if (bgFileSection) bgFileSection.style.display = 'block';
    }
  }

  function applyBackground(type: string, path: string) {
    if (!bgLayer) return;

    if (type === 'solid' || !path) {
      bgLayer.style.opacity = '0';
      setTimeout(() => {
        if (currentBgType === 'solid') bgLayer.innerHTML = '';
      }, 500);
    } else {
      bgLayer.style.display = 'block';
      const isImg = type === 'image' || type === 'gif' || (type === 'url' && path.match(/\.(jpeg|jpg|gif|png|webp)/i));
      const isVid = type === 'video' || (type === 'url' && path.match(/\.(mp4|webm)/i));

      const url = type === 'url' ? path : `nova-file://${path.replace(/\\/g, '/')}`;

      if (isImg) {
        bgLayer.innerHTML = `<img src="${url}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onload="this.parentElement.style.opacity='1'" onerror="console.error('Failed to load image:', this.src)">`;
      } else if (isVid) {
        bgLayer.innerHTML = `<video autoplay muted loop playsinline style="width: 100%; height: 100%; object-fit: cover;" oncanplay="this.parentElement.style.opacity='1'"><source src="${url}"></video>`;
      } else if (type === 'url') {
        // Fallback guess
        bgLayer.innerHTML = `<img src="${url}" alt="" style="width: 100%; height: 100%; object-fit: cover;" onload="this.parentElement.style.opacity='1'">`;
      }
    }
  }

  // Apply button handler
  btnApplyBg?.addEventListener('click', () => {
    if (currentBgType === 'url') {
      if (inputBgUrl && inputBgUrl.value) {
        currentBgPath = inputBgUrl.value;
        localStorage.setItem('nova_bg_path', currentBgPath);
        applyBackground(currentBgType, currentBgPath);
        if (btnApplyBg) btnApplyBg.style.display = 'none';
      }
    } else if (selectedBgPath && currentBgType !== 'solid') {
      currentBgPath = selectedBgPath;
      localStorage.setItem('nova_bg_path', currentBgPath);
      applyBackground(currentBgType, currentBgPath);
      if (bgFileName) bgFileName.textContent = currentBgPath.split(/[/\\]/).pop() || 'Unknown';
      if (btnApplyBg) btnApplyBg.style.display = 'none';
    }
  });

  bgTypeSelect?.addEventListener('change', (e) => {
    const type = (e.target as HTMLSelectElement).value;
    currentBgType = type;
    localStorage.setItem('nova_bg_type', type);

    if (inputBgUrl) inputBgUrl.style.display = type === 'url' ? 'block' : 'none';
    if (btnSelectBg) btnSelectBg.style.display = type === 'url' ? 'none' : 'block';
    if (bgFileName) bgFileName.parentElement!.style.display = type === 'url' ? 'none' : 'flex';

    if (type === 'solid') {
      if (bgFileSection) bgFileSection.style.display = 'none';
      if (btnApplyBg) btnApplyBg.style.display = 'none';
      applyBackground('solid', '');
    } else {
      if (bgFileSection) bgFileSection.style.display = 'block';
      if (type === 'url') {
        if (btnApplyBg) btnApplyBg.style.display = 'block';
      } else {
        if (currentBgPath) {
          applyBackground(type, currentBgPath);
          if (bgFileName) bgFileName.textContent = currentBgPath.split(/[/\\]/).pop() || 'Unknown';
        }
      }
    }
  });


  btnSelectBg?.addEventListener('click', async () => {
    try {
      // Use Electron's dialog via IPC
      const result = await (window as any).novaAPI?.selectBackground?.(currentBgType);
      if (result && result.filePath) {
        selectedBgPath = result.filePath;
        if (bgFileName) bgFileName.textContent = selectedBgPath.split(/[/\\]/).pop() || 'Unknown';
        // Show apply button instead of immediately applying
        if (btnApplyBg) btnApplyBg.style.display = 'block';
      }
    } catch (err) {
      console.error('Failed to select background:', err);
    }
  });

  btnClearBg?.addEventListener('click', () => {
    currentBgPath = '';
    selectedBgPath = '';
    if (inputBgUrl) inputBgUrl.value = '';
    localStorage.removeItem('nova_bg_path');
    localStorage.setItem('nova_bg_type', 'solid');
    if (bgFileName) bgFileName.textContent = 'None';
    if (bgFileSection) bgFileSection.style.display = 'none';
    if (bgTypeSelect) bgTypeSelect.value = 'solid';
    if (btnApplyBg) btnApplyBg.style.display = 'none';
    applyBackground('solid', '');
  });

  // Initialize on load
  initBackground();

  // Helper to toggle nav visibility
  function toggleNav(show: boolean) {
    const nav = document.querySelector('.nav-dock') as HTMLElement;
    if (nav) nav.style.display = show ? 'flex' : 'none';
  }

  // ── Startup Programs Manager ─────────────────────
  const startupCard = document.getElementById('startup-card');
  const startupModal = document.getElementById('startup-modal') as HTMLElement;
  const closeStartup = document.getElementById('close-startup');
  const refreshStartup = document.getElementById('refresh-startup');

  startupCard?.addEventListener('click', () => {
    startupModal.style.display = 'flex';
    toggleNav(false);
    loadStartupPrograms();
  });

  function closeStartupModal() {
    startupModal.style.display = 'none';
    toggleNav(true);
  }

  closeStartup?.addEventListener('click', closeStartupModal);

  refreshStartup?.addEventListener('click', () => {
    loadStartupPrograms();
  });

  startupModal?.querySelector('.modal-close')?.addEventListener('click', closeStartupModal);

  // ── Steam Stats ─────────────────────


  // ── Disk Health Modal ─────────────────────
  const diskCard = document.getElementById('disk-card');
  const diskModal = document.getElementById('disk-modal') as HTMLElement;
  const closeDisk = document.getElementById('close-disk');

  diskCard?.addEventListener('click', () => {
    diskModal.style.display = 'flex';
    toggleNav(false);
    loadDiskStats();
  });

  function closeDiskModal() {
    diskModal.style.display = 'none';
    toggleNav(true);
  }

  closeDisk?.addEventListener('click', closeDiskModal);
  diskModal?.querySelector('.modal-close')?.addEventListener('click', closeDiskModal);

  // ── Network/Ping Modal ─────────────────────
  const pingCard = document.getElementById('ping-card');
  const pingModal = document.getElementById('ping-modal') as HTMLElement;
  const closePing = document.getElementById('close-ping');

  pingCard?.addEventListener('click', () => {
    pingModal.style.display = 'flex';
    toggleNav(false);
    loadPingStats();
  });

  function closePingModal() {
    pingModal.style.display = 'none';
    toggleNav(true);
  }

  closePing?.addEventListener('click', closePingModal);
  pingModal?.querySelector('.modal-close')?.addEventListener('click', closePingModal);

  // ── Processes Modal ─────────────────────
  const processCard = document.getElementById('process-card');
  const processModal = document.getElementById('process-modal') as HTMLElement;
  const closeProcess = document.getElementById('close-process');
  const refreshProcess = document.getElementById('refresh-process');

  processCard?.addEventListener('click', () => {
    processModal.style.display = 'flex';
    toggleNav(false);
    loadProcessStats();
  });

  function closeProcessModal() {
    processModal.style.display = 'none';
    toggleNav(true);
  }

  closeProcess?.addEventListener('click', closeProcessModal);
  refreshProcess?.addEventListener('click', loadProcessStats);
  processModal?.querySelector('.modal-close')?.addEventListener('click', closeProcessModal);

  // Load initial counts
  loadStartupCount();
  loadProcessCount();

  // Update Discord RPC on optimize
  document.getElementById('optimize-btn')?.addEventListener('click', () => {
    (window as any).novaAPI?.updateRPC?.('optimizing', 'Applying system tweaks...');
  });

  // Load settings
  loadSettings();

  // Reload App Button
  document.getElementById('reload-app-btn')?.addEventListener('click', () => {
    location.reload();
  });
} // End of setupEventListeners

function loadSettings() {
  const tzSelect = document.getElementById('setting-timezone') as HTMLSelectElement;
  const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement;

  // Populate timezone options with real IANA zones
  if (tzSelect) {
    const timezones = [
      { value: 'local', label: 'Local System Time' },
      { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
      { value: 'America/New_York', label: 'EST — New York' },
      { value: 'America/Chicago', label: 'CST — Chicago' },
      { value: 'America/Denver', label: 'MST — Denver' },
      { value: 'America/Los_Angeles', label: 'PST — Los Angeles' },
      { value: 'America/Anchorage', label: 'AKST — Alaska' },
      { value: 'Pacific/Honolulu', label: 'HST — Hawaii' },
      { value: 'America/Sao_Paulo', label: 'BRT — São Paulo' },
      { value: 'Europe/London', label: 'GMT — London' },
      { value: 'Europe/Paris', label: 'CET — Paris' },
      { value: 'Europe/Berlin', label: 'CET — Berlin' },
      { value: 'Europe/Moscow', label: 'MSK — Moscow' },
      { value: 'Asia/Dubai', label: 'GST — Dubai' },
      { value: 'Asia/Kolkata', label: 'IST — Mumbai' },
      { value: 'Asia/Bangkok', label: 'ICT — Bangkok' },
      { value: 'Asia/Shanghai', label: 'CST — Shanghai' },
      { value: 'Asia/Tokyo', label: 'JST — Tokyo' },
      { value: 'Asia/Seoul', label: 'KST — Seoul' },
      { value: 'Australia/Sydney', label: 'AEST — Sydney' },
      { value: 'Pacific/Auckland', label: 'NZST — Auckland' },
    ];
    tzSelect.innerHTML = timezones.map(tz => `<option value="${tz.value}">${tz.label}</option>`).join('');

    const savedTz = localStorage.getItem('nova_timezone') || 'local';
    tzSelect.value = savedTz;
  }

  if (themeSelect) {
    const savedTheme = localStorage.getItem('nova_theme') || 'dark';
    themeSelect.value = savedTheme;
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  const accentColorInput = document.getElementById('setting-accent-color') as HTMLInputElement;
  const savedColor = localStorage.getItem('nova_accent_color');
  if (savedColor) {
    if (accentColorInput) accentColorInput.value = savedColor;
    document.documentElement.style.setProperty('--accent-magenta', savedColor);
    document.documentElement.style.setProperty('--glow-magenta', hexToRgbA(savedColor, 0.5));
  }
}

function hexToRgbA(hex: string, alpha: number) {
  let c: any;
  if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
    c = hex.substring(1).split('');
    if (c.length == 3) {
      c = [c[0], c[0], c[1], c[1], c[2], c[2]];
    }
    c = '0x' + c.join('');
    return 'rgba(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',') + ',' + alpha + ')';
  }
  return `rgba(255, 0, 0, ${alpha})`;
}

let lastHealthScore = 0;

function calculatePerformanceScore(stats: any): number {
  if (!stats) return lastHealthScore;

  // CPU Score (25 pts max) - lower usage is better
  const cpuScore = Math.max(0, 25 - (stats.cpuUsage / 4));

  // RAM Score (25 pts max) - need total RAM to calculate percentage
  // Assuming 16GB total if not specified, calculate usage %
  const totalRamGB = stats.totalRamGB || 16;
  const ramPercent = (stats.ramUsage / totalRamGB) * 100;
  const ramScore = Math.max(0, 25 - (ramPercent / 4));

  // CPU Temp Score (20 pts max) - under 50°C is perfect, over 85°C is 0
  const cpuTemp = stats.cpuTemp || 45;
  const tempScore = cpuTemp < 50 ? 20 : Math.max(0, 20 - ((cpuTemp - 50) / 1.75));

  // Disk Health Score (15 pts max) - based on average drive usage
  let diskScore = 15;
  if (stats.drives && stats.drives.length > 0) {
    const avgDiskUse = stats.drives.reduce((sum: number, d: any) => sum + (d.use || 0), 0) / stats.drives.length;
    diskScore = Math.max(0, 15 - (avgDiskUse / 6.67));
  }

  // Network/Ping Score (15 pts max) - under 20ms is perfect, over 100ms is 0
  const ping = stats.ping || 20;
  const pingScore = ping < 20 ? 15 : Math.max(0, 15 - ((ping - 20) / 5.33));

  const totalScore = Math.round(cpuScore + ramScore + tempScore + diskScore + pingScore);
  lastHealthScore = totalScore;
  return totalScore;
}

function getScoreColor(score: number): { border: string; glow: string; bg: string } {
  if (score >= 85) return { border: '#00FFF5', glow: 'rgba(0, 255, 245, 0.45)', bg: 'rgba(0, 255, 245, 0.1)' }; // Cyan - Excellent
  if (score >= 70) return { border: '#00FF7F', glow: 'rgba(0, 255, 127, 0.45)', bg: 'rgba(0, 255, 127, 0.1)' }; // Green - Good
  if (score >= 50) return { border: '#FFAA00', glow: 'rgba(255, 170, 0, 0.45)', bg: 'rgba(255, 170, 0, 0.1)' }; // Orange - Fair
  return { border: '#FF107A', glow: 'rgba(255, 16, 122, 0.45)', bg: 'rgba(255, 16, 122, 0.1)' }; // Red/Magenta - Poor
}

// ── Startup Programs Manager Functions ─────────────────────
async function loadStartupPrograms() {
  const list = document.getElementById('startup-list');
  if (!list) return;

  list.innerHTML = '<div class="loading-text" style="text-align: center; padding: 2rem; color: var(--text-dim);">Loading startup programs...</div>';

  const res = await (window as any).novaAPI?.getStartupPrograms?.();
  if (!res?.ok || !res.programs?.length) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);">No startup programs found or access denied.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  res.programs.forEach((prog: any, index: number) => {
    const item = document.createElement('div');
    item.className = 'startup-item';
    item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border-subtle); animation: contentSlideUp 0.3s ease forwards; animation-delay: ' + (index * 0.05) + 's; opacity: 0;';

    const stopBtn = document.createElement('button');
    stopBtn.className = 'nav-back glass';
    stopBtn.style.cssText = 'padding: 0.3rem 0.8rem; font-size: 0.7rem; height: auto;';
    stopBtn.innerText = 'STOP';
    stopBtn.addEventListener('click', async () => {
      stopBtn.innerText = 'STOPPING...';
      await (window as any).novaAPI?.toggleStartupProgram?.(prog.Name, false);
      stopBtn.innerText = 'STOPPED';
      setTimeout(() => loadStartupPrograms(), 1000);
    });

    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex: 1; overflow: hidden;';
    infoDiv.innerHTML = `
      <div style="font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${prog.Name || 'Unknown'}</div>
      <div style="font-size: 0.75rem; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${prog.Location || 'Startup'} • ${prog.User || 'All Users'}</div>
    `;

    item.appendChild(infoDiv);
    item.appendChild(stopBtn);
    frag.appendChild(item);
  });

  list.innerHTML = '';
  list.appendChild(frag);
}

async function loadStartupCount() {
  const res = await (window as any).novaAPI?.getStartupPrograms?.();
  const count = res?.ok ? res.programs?.length || 0 : '?';
  const el = document.getElementById('startup-count');
  if (el) el.innerText = count.toString();
}

// ── Steam Stats Functions ─────────────────────
// ── Boot Time Stats ─────────────────────
// @ts-ignore
async function loadBootStats() {

  const list = document.getElementById('boot-list');
  if (!list) return;

  list.innerHTML = '<div class="loading-text" style="text-align: center; padding: 2rem; color: var(--text-dim);">Analyzing boot performance...</div>';

  // Get boot time from system
  const bootTime = await (window as any).novaAPI?.getBootTime?.();
  if (!bootTime?.ok) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);">Unable to analyze boot time.</div>';
    return;
  }

  list.innerHTML = `
    <div style="padding: 1rem; text-align: center;">
      <div style="font-size: 3rem; font-weight: 800; color: #FF6B35;">${bootTime.seconds}s</div>
      <div style="color: var(--text-dim); margin-top: 0.5rem;">Boot Time</div>
      <div style="margin-top: 1rem; padding: 1rem; background: rgba(255,107,53,0.1); border-radius: 12px;">
        <div style="color: var(--text-dim); font-size: 0.9rem;">Status: <span style="color: #FF6B35;">${bootTime.status || 'Normal'}</span></div>
      </div>
    </div>
  `;

  const timeEl = document.getElementById('boot-time');
  if (timeEl) timeEl.innerText = bootTime.seconds + 's';
}

// ── Disk Health Stats ─────────────────────
async function loadDiskStats() {
  const list = document.getElementById('disk-list');
  if (!list) return;

  list.innerHTML = '<div class="loading-text" style="text-align: center; padding: 2rem; color: var(--text-dim);">Checking disk health...</div>';

  const diskHealth = await (window as any).novaAPI?.getDiskHealth?.();
  if (!diskHealth?.ok) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);">Unable to check disk health.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  diskHealth.disks?.forEach((disk: any, index: number) => {
    const item = document.createElement('div');
    item.className = 'startup-item';
    item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border-subtle); animation: contentSlideUp 0.3s ease forwards; animation-delay: ' + (index * 0.05) + 's; opacity: 0;';
    item.innerHTML = `
      <div style="flex: 1;">
        <div style="font-weight: 600; color: var(--text-main);">${disk.FriendlyName || 'Drive ' + index}</div>
        <div style="font-size: 0.75rem; color: var(--text-dim);">${disk.MediaType || 'Unknown'} • ${disk.HealthStatus || 'Unknown'}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-weight: 700; color: ${disk.HealthStatus === 'Healthy' ? '#9B59B6' : '#E74C3C'};">${disk.HealthStatus || 'Unknown'}</div>
      </div>
    `;
    frag.appendChild(item);
  });

  list.innerHTML = '';
  list.appendChild(frag);

  const statusEl = document.getElementById('disk-status');
  if (statusEl) statusEl.innerText = diskHealth.disks?.length || 0 + ' drives';
}

// ── Network/Ping Stats ─────────────────────
async function loadPingStats() {
  const list = document.getElementById('ping-list');
  if (!list) return;

  list.innerHTML = '<div class="loading-text" style="text-align: center; padding: 2rem; color: var(--text-dim);">Testing network latency...</div>';

  const pingStats = await (window as any).novaAPI?.getPingStats?.();
  if (!pingStats?.ok) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);">Unable to test network.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  pingStats.results?.forEach((dns: any, index: number) => {
    const item = document.createElement('div');
    item.className = 'startup-item';
    item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border-subtle); animation: contentSlideUp 0.3s ease forwards; animation-delay: ' + (index * 0.05) + 's; opacity: 0;';
    item.innerHTML = `
      <div style="flex: 1;">
        <div style="font-weight: 600; color: var(--text-main);">${dns.Name || 'DNS'}</div>
        <div style="font-size: 0.75rem; color: var(--text-dim);">${dns.IP || 'N/A'}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-weight: 700; color: ${dns.AvgPing < 50 ? '#2ECC71' : '#E74C3C'};">${dns.AvgPing || 0}ms</div>
      </div>
    `;
    frag.appendChild(item);
  });

  list.innerHTML = '';
  list.appendChild(frag);

  const statusEl = document.getElementById('ping-status');
  if (statusEl) statusEl.innerText = pingStats.best?.Name || 'Ready';
}

// ── Process Stats ─────────────────────
async function loadProcessStats() {
  const list = document.getElementById('process-list');
  if (!list) return;

  list.innerHTML = '<div class="loading-text" style="text-align: center; padding: 2rem; color: var(--text-dim);">Loading processes...</div>';

  const processes = await (window as any).novaAPI?.getTopProcesses?.();
  if (!processes?.ok) {
    list.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-dim);">Unable to load processes.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  processes.processes?.forEach((proc: any, index: number) => {
    const item = document.createElement('div');
    item.className = 'startup-item';
    item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border-bottom: 1px solid var(--border-subtle); animation: contentSlideUp 0.3s ease forwards; animation-delay: ' + (index * 0.05) + 's; opacity: 0;';

    const killBtn = document.createElement('button');
    killBtn.className = 'nav-back glass';
    killBtn.style.cssText = 'padding: 0.3rem 0.8rem; font-size: 0.7rem; height: auto; background: rgba(231, 76, 60, 0.2); border-color: #E74C3C;';
    killBtn.innerText = 'KILL';
    killBtn.addEventListener('click', async () => {
      killBtn.innerText = '...';
      await (window as any).novaAPI?.killProcess?.(proc.Name);
      setTimeout(() => loadProcessStats(), 500);
    });

    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'flex: 1;';
    infoDiv.innerHTML = `
      <div style="font-weight: 600; color: var(--text-main);">${proc.Name || 'Unknown'}</div>
      <div style="font-size: 0.75rem; color: var(--text-dim);">CPU: ${proc.CPU || 0}% • RAM: ${proc.RAM || 0}MB</div>
    `;

    item.appendChild(infoDiv);
    item.appendChild(killBtn);
    frag.appendChild(item);
  });

  list.innerHTML = '';
  list.appendChild(frag);
}

async function loadProcessCount() {
  const processes = await (window as any).novaAPI?.getTopProcesses?.();
  const count = processes?.ok ? processes.processes?.length || 0 : '?';
  const el = document.getElementById('proc-count');
  if (el) el.innerText = count.toString();
}

// Safer, more aggressive initialization for Electron/Vite
const bootApp = async () => {
  console.log("Nova Optimizer: Initializing App...");
  // Start countdown IMMEDIATELY for UI feedback
  await runLoadingSequence();

  // Emergency Bypass for loading sequence
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const loading = document.getElementById('loading-screen');
      if (loading && loading.style.display !== 'none') {
        loading.style.display = 'none';
        const app = document.getElementById('app-container');
        if (app) app.style.opacity = '1';
        const nav = document.getElementById('nav-dock');
        if (nav) nav.style.opacity = '1';
        const fade = document.getElementById('cinematic-fade');
        if (fade) fade.style.opacity = '0';
      }
    }
  });

  try {
    // Force reset old pixelated backgrounds to show the new 8k render
    if (localStorage.getItem('nova_bg_path')?.includes('sukuna') || localStorage.getItem('nova_bg_path')?.includes('.gif')) {
      localStorage.removeItem('nova_bg_path');
      localStorage.setItem('nova_bg_type', 'solid');
    }

    loadTweaks();
    renderLibrary('Starters');
    updateHealthScore();
    initGraphs();
    updateMonitor();
    startClock();
    loadStartupCount();

    // Setup Event Listeners
    setupEventListeners();
  } catch (e) {
    console.error("Boot Error:", e);
  }

  // EMERGENCY BYPASS: Press ESC to skip loading
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      console.log("Emergency bypass triggered.");
      const app = document.getElementById('app-container');
      const loading = document.getElementById('loading-screen');
      if (app) { app.style.opacity = '1'; app.style.display = 'flex'; }
      if (loading) loading.style.display = 'none';
      document.body.style.overflow = 'auto';
    }
  });
};

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  bootApp();
} else {
  document.addEventListener('DOMContentLoaded', bootApp);
}
