# ============================================================
#  Auto-start setup for Hybrid Local AI Hub agents
#  Run as Administrator: powershell -ExecutionPolicy Bypass -File setup-autostart.ps1
# ============================================================

param(
    [switch]$Remove   # Pass -Remove to unregister all tasks
)

$AgentExe = "$PSScriptRoot\target\release\hybrid-hub.exe"
$BossScript = "$PSScriptRoot\boss.ps1"

function Register-AgentTask($name, $task, $triggerType, $description) {
    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-WindowStyle Normal -ExecutionPolicy Bypass -File `"$BossScript`""
    # Override: for background agents, run the binary directly with the task
    if ($task) {
        $action = New-ScheduledTaskAction `
            -Execute $AgentExe `
            -Argument "agent --task `"$task`" --yes"
        }

    $trigger = switch ($triggerType) {
        "boot"    { New-ScheduledTaskTrigger -AtStartup }
        "logon"   { New-ScheduledTaskTrigger -AtLogOn }
        "daily9"  { New-ScheduledTaskTrigger -Daily -At "09:00" }
        "daily18" { New-ScheduledTaskTrigger -Daily -At "18:00" }
    }

    $settingsArgs = @{
        AllowStartIfOnBatteries = $true
        DontStopIfGoingOnBatteries = $true
    }
    if ($task) {
        $settingsArgs.ExecutionTimeLimit = (New-TimeSpan -Minutes 30)
    }
    $settings = New-ScheduledTaskSettingsSet @settingsArgs

    $principal = New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME `
        -RunLevel Limited `
        -LogonType Interactive

    Register-ScheduledTask `
        -TaskName "HybridAI\$name" `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description $description `
        -Force | Out-Null

    Write-Host "  Registered: $name" -ForegroundColor Green
}

if ($Remove) {
    Write-Host "  Removing all Hybrid AI scheduled tasks..." -ForegroundColor Yellow
    Get-ScheduledTask -TaskPath "\HybridAI\" -ErrorAction SilentlyContinue | Unregister-ScheduledTask -Confirm:$false
    Write-Host "  Done." -ForegroundColor Green
    exit 0
}

if (-not (Test-Path $AgentExe)) {
    Write-Host "  ERROR: Agent binary not found." -ForegroundColor Red
    Write-Host "  Run: cargo build --release --bin hybrid-hub" -ForegroundColor Yellow
    exit 1
}

# Create task folder
$taskPath = "\HybridAI\"
try { [void](Get-ScheduledTask -TaskPath $taskPath 2>$null) } catch {}

Write-Host ""
Write-Host "  Registering Hybrid AI scheduled agents..." -ForegroundColor Cyan
Write-Host ""

# 1. Daily morning planner (runs at 9am every day)
Register-AgentTask `
    -Name "DailyMorningPlanner" `
    -Task "Summarize today's agenda: check what files were modified yesterday in C:\Hybrid Local AI Hub and give me a brief status report" `
    -TriggerType "daily9" `
    -Description "Runs the AI daily morning briefing at 9am"

# 2. Daily evening summary (runs at 6pm every day)
Register-AgentTask `
    -Name "DailyEveningSummary" `
    -Task "Give me an end-of-day summary: list the most recently modified files in C:\Hybrid Local AI Hub from today" `
    -TriggerType "daily18" `
    -Description "Runs the AI evening wrap-up at 6pm"

# 3. Boss terminal opens on logon
Register-AgentTask `
    -Name "BossTerminalOnLogon" `
    -Task $null `
    -TriggerType "logon" `
    -Description "Opens the Boss AI terminal when you log in"

Write-Host ""
Write-Host "  All agents registered successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  To see them: Open Task Scheduler > HybridAI folder" -ForegroundColor Gray
Write-Host "  To remove:   powershell -File setup-autostart.ps1 -Remove" -ForegroundColor Gray
Write-Host ""
