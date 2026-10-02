# ============================================================
#  Hybrid Local AI Hub  --  BOSS TERMINAL  v2.0
#  Run: powershell -ExecutionPolicy Bypass -File boss.ps1
# ============================================================

$AgentExe     = "$PSScriptRoot\target\release\hybrid-hub.exe"
$DataRoot     = "$env:APPDATA\HybridAI"
$AgentsDir    = "$DataRoot\agents"
$GlobalConfig = "$DataRoot\config.json"
$HistoryFile  = "$DataRoot\history.json"
$OllamaUrl    = "http://localhost:11434"
$TaskFolder   = "\HybridAI"

# ── Color helpers ─────────────────────────────────────────────────────────────
function C($t, $c = "White") { Write-Host $t -ForegroundColor $c }
function CL($t, $c = "White") { Write-Host $t -ForegroundColor $c -NoNewline }

function Ensure-Dirs {
    foreach ($d in @($DataRoot, $AgentsDir)) {
        if (-not (Test-Path $d)) { New-Item -ItemType Directory $d -Force | Out-Null }
    }
}

# ── Global config (first-run settings) ───────────────────────────────────────
function Load-GlobalConfig {
    if (Test-Path $GlobalConfig) {
        try { return Get-Content $GlobalConfig -Raw | ConvertFrom-Json }
        catch {}
    }
    return [PSCustomObject]@{
        first_run      = $true
        default_model  = "llama3.2"
        ollama_url     = "http://localhost:11434"
        boss_autostart = $false
    }
}

function Save-GlobalConfig($cfg) {
    $cfg | ConvertTo-Json -Depth 5 | Set-Content $GlobalConfig -Encoding UTF8
}

# ── Agent settings schema ─────────────────────────────────────────────────────
function New-AgentSettings($name, $task) {
    return [PSCustomObject]@{
        name            = $name
        description     = ""
        task_prompt     = $task
        model           = "llama3.2"
        max_steps       = 15
        timeout_secs    = 600
        auto_approve    = $false
        autostart       = $false
        schedule        = "boot"        # boot | logon | daily | daily9 | daily18 | hourly | never
        schedule_time   = "09:00"       # used when schedule = daily
        working_dir     = $PSScriptRoot
        enabled         = $true
        ollama_url      = "http://localhost:11434"
        run_hidden      = $true
        notify_desktop  = $true
        created_at      = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        last_run        = ""
    }
}

function Agent-Path($name) { return "$AgentsDir\$($name -replace '[^a-zA-Z0-9_-]','_').json" }

function Load-Agent($name) {
    $p = Agent-Path $name
    if (Test-Path $p) {
        try { return Get-Content $p -Raw | ConvertFrom-Json } catch {}
    }
    return $null
}

function Save-Agent($ag) {
    $p = Agent-Path $ag.name
    $ag | ConvertTo-Json -Depth 5 | Set-Content $p -Encoding UTF8
}

function List-Agents {
    if (-not (Test-Path $AgentsDir)) { return @() }
    return Get-ChildItem "$AgentsDir\*.json" |
        ForEach-Object { try { Get-Content $_.FullName -Raw | ConvertFrom-Json } catch {} } |
        Where-Object { $_ -ne $null }
}

# ── Task Scheduler ────────────────────────────────────────────────────────────
function Register-AgentSchedule($ag) {
    if (-not (Test-Path $AgentExe)) { C "  [!] Agent binary not found. Build first." Red; return }
    if ($ag.schedule -eq "never") { return }

    $windowStyle = if ($ag.run_hidden) { "Hidden" } else { "Normal" }
    $argStr = "agent --task `"$($ag.task_prompt -replace '"', '\"' -replace '\\$', '\\\')`" --model `"$($ag.model)`" --max-steps $($ag.max_steps) --ollama-url `"$($ag.ollama_url)`""
    if ($ag.auto_approve) { $argStr += " --yes" }

    $action = New-ScheduledTaskAction -Execute $AgentExe -Argument $argStr -WorkingDirectory $ag.working_dir

    $trigger = switch ($ag.schedule) {
        "boot"    { New-ScheduledTaskTrigger -AtStartup }
        "logon"   { New-ScheduledTaskTrigger -AtLogOn }
        "daily"   { New-ScheduledTaskTrigger -Daily -At $ag.schedule_time }
        "daily9"  { New-ScheduledTaskTrigger -Daily -At "09:00" }
        "daily18" { New-ScheduledTaskTrigger -Daily -At "18:00" }
        "hourly"  { New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -Once -At (Get-Date) }
        default   { New-ScheduledTaskTrigger -AtStartup }
    }

    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit (New-TimeSpan -Seconds $ag.timeout_secs) `
        -StopIfGoingOnBatteries $false `
        -DisallowStartIfOnBatteries $false `
        -StartWhenAvailable $true

    $principal = New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME -RunLevel Limited -LogonType Interactive

    try {
        Register-ScheduledTask `
            -TaskName "$TaskFolder\$($ag.name)" `
            -Action $action -Trigger $trigger `
            -Settings $settings -Principal $principal `
            -Description $ag.description `
            -Force | Out-Null
        C "  [OK] Registered scheduled task: $($ag.name) ($($ag.schedule))" Green
    } catch {
        C "  [!] Task Scheduler error: $_" Red
        C "  Tip: Run PowerShell as Administrator for Task Scheduler access." Yellow
    }
}

function Unregister-AgentSchedule($name) {
    try {
        Unregister-ScheduledTask -TaskName "$TaskFolder\$name" -Confirm:$false -ErrorAction SilentlyContinue
        C "  [OK] Removed scheduled task: $name" Green
    } catch {}
}

function Register-BossOnLogon {
    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-WindowStyle Normal -ExecutionPolicy Bypass -File `"$PSScriptRoot\boss.ps1`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -StopIfGoingOnBatteries $false -DisallowStartIfOnBatteries $false
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Limited -LogonType Interactive
    try {
        Register-ScheduledTask -TaskName "$TaskFolder\BossTerminal" `
            -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
            -Description "Opens the Hybrid AI Boss Terminal on login" -Force | Out-Null
        C "  [OK] Boss Terminal will open automatically on next login." Green
    } catch {
        C "  [!] Could not register autostart (try running as Admin): $_" Red
    }
}

function Unregister-BossOnLogon {
    Unregister-ScheduledTask -TaskName "$TaskFolder\BossTerminal" -Confirm:$false -ErrorAction SilentlyContinue
}

# ── History ───────────────────────────────────────────────────────────────────
function Load-History {
    if (Test-Path $HistoryFile) { try { return Get-Content $HistoryFile -Raw | ConvertFrom-Json } catch {} }
    return @()
}
function Add-History($task, $result, $steps, $model) {
    $h = Load-History
    if ($h -isnot [System.Array]) { $h = @($h) }
    $entry = [PSCustomObject]@{ timestamp=(Get-Date -Format "yyyy-MM-dd HH:mm:ss"); task=$task; result=$result; steps=$steps; model=$model }
    $h = @($entry) + $h
    if ($h.Count -gt 200) { $h = $h[0..199] }
    $h | ConvertTo-Json -Depth 5 | Set-Content $HistoryFile -Encoding UTF8
}

# ── Ollama ────────────────────────────────────────────────────────────────────
function Test-Ollama($url = $OllamaUrl) {
    try { return (Invoke-WebRequest "$url/api/tags" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop).StatusCode -eq 200 }
    catch { return $false }
}
function Ensure-Ollama {
    if (-not (Test-Ollama)) {
        C "  [!] Ollama not running. Starting..." Yellow
        Start-Process "ollama" "serve" -WindowStyle Hidden
        Start-Sleep 4
        if (Test-Ollama) { C "  [OK] Ollama started." Green }
        else { C "  [FAIL] Ollama could not start. Run: ollama serve" Red }
    } else { C "  [OK] Ollama is running." Green }
}

# ── Run agent ─────────────────────────────────────────────────────────────────
function Invoke-Agent($task, $model, $maxSteps, $yes, $ollamaUrl) {
    if (-not (Test-Path $AgentExe)) {
        C "  [!] Binary not found: $AgentExe" Red
        C "  Build with: cargo build --release --bin hybrid-hub" Yellow
        return "binary_not_found"
    }
    Write-Host ""
    C "  >> $task" Cyan
    CL "     Model: " DarkGray; C $model Gray
    Write-Host ""

    $argList = @("agent","--task",$task,"--model",$model,"--max-steps",$maxSteps,"--ollama-url",$ollamaUrl)
    if ($yes) { $argList += "--yes" }

    $output = & $AgentExe @argList 2>&1
    $exit = $LASTEXITCODE

    foreach ($line in $output) {
        $l = "$line"
        if ($l -match "RemoteException|NativeCommandError") { continue }
        if ($l -match "Success|completed") { Write-Host "  $l" -ForegroundColor Green }
        elseif ($l -match "Error|error|FAIL|Not Resolved") { Write-Host "  $l" -ForegroundColor Red }
        elseif ($l -match "Stalled|Warning|Max steps|Timed") { Write-Host "  $l" -ForegroundColor Yellow }
        elseif ($l -match "AGENT REPORT|>>") { Write-Host "  $l" -ForegroundColor Cyan }
        elseif ($l -match "\[Agent") { Write-Host "  $l" -ForegroundColor DarkYellow }
        elseif ($l -match "debug") { Write-Host "  $l" -ForegroundColor DarkGray }
        else { Write-Host "  $l" -ForegroundColor White }
    }

    $resultLine = ($output | Where-Object { "$_" -match "Stop Reason:" }) -replace ".*Stop Reason:\s*",""
    $stepsLine  = ($output | Where-Object { "$_" -match "Steps Used:" })  -replace ".*Steps Used:\s*",""
    Add-History $task $(if ($resultLine) { $resultLine } else { "unknown" }) $(if ($stepsLine)  { $stepsLine  } else { "0" }) $model

    Write-Host ""
    if ($exit -eq 0) { C "  Task completed!" Green }
    elseif ($exit -eq 130) { C "  Interrupted." Yellow }
    else { C "  Task ended (exit: $exit). Type 'history' to review." DarkYellow }
    Write-Host ""
    return $resultLine
}

# ── First-run setup ───────────────────────────────────────────────────────────
function First-Run-Setup($cfg) {
    Clear-Host
    Write-Host ""
    C "  +==========================================================+" DarkCyan
    C "  |   HYBRID LOCAL AI HUB  --  FIRST TIME SETUP              |" Cyan
    C "  +==========================================================+" DarkCyan
    Write-Host ""
    C "  Welcome! Let me set things up for you." White
    Write-Host ""

    # Ask: autostart boss terminal on login?
    C "  [1/3] Auto-start Boss Terminal when you log in?" White
    C "        This opens this terminal automatically every time Windows starts." DarkGray
    $ans = Read-Host "        Enable? (Y/n)"
    $cfg.boss_autostart = ($ans -ne "n" -and $ans -ne "N")
    if ($cfg.boss_autostart) { Register-BossOnLogon }

    Write-Host ""

    # Ask: default model
    C "  [2/3] Which Ollama model do you want to use by default?" White
    C "        Examples: llama3.2  mistral  phi3  gemma2  codellama" DarkGray
    $modelInput = Read-Host "        Model name (Enter for llama3.2)"
    if (-not [string]::IsNullOrWhiteSpace($modelInput)) { $cfg.default_model = $modelInput.Trim() }

    Write-Host ""

    # Ask: create default agents?
    C "  [3/3] Create default auto-agents? (Daily Planner, Evening Summary)" White
    C "        These run automatically on a schedule using Task Scheduler." DarkGray
    $createAgents = Read-Host "        Create them? (Y/n)"
    if ($createAgents -ne "n" -and $createAgents -ne "N") {
        $ag1 = New-AgentSettings "DailyMorningPlanner" "Summarize today's agenda: list files modified in the last 24 hours in $PSScriptRoot and give a brief status report"
        $ag1.schedule = "daily9"; $ag1.auto_approve = $true; $ag1.description = "Daily morning AI briefing at 9am"
        $ag1.autostart = $true
        Save-Agent $ag1; Register-AgentSchedule $ag1

        $ag2 = New-AgentSettings "DailyEveningSummary" "Give an end-of-day summary: list the most recently modified files in $PSScriptRoot from today"
        $ag2.schedule = "daily18"; $ag2.auto_approve = $true; $ag2.description = "Daily evening AI wrap-up at 6pm"
        $ag2.autostart = $true
        Save-Agent $ag2; Register-AgentSchedule $ag2

        C "  [OK] Created DailyMorningPlanner and DailyEveningSummary agents." Green
    }

    $cfg.first_run = $false
    Save-GlobalConfig $cfg
    Write-Host ""
    C "  Setup complete! Starting Boss Terminal..." Cyan
    Start-Sleep 1
}

# ── Banner ────────────────────────────────────────────────────────────────────
function Show-Banner($cfg) {
    Clear-Host
    Write-Host ""
    C "  +==========================================================+" DarkCyan
    C "  |   HYBRID LOCAL AI HUB  --  BOSS TERMINAL                 |" Cyan
    C "  |   100% Offline * Powered by Ollama                        |" DarkGray
    C "  +==========================================================+" DarkCyan
    Write-Host ""
    $hour = (Get-Date).Hour
    $g = if ($hour -lt 12) { "Good morning" } elseif ($hour -lt 17) { "Good afternoon" } else { "Good evening" }
    C "  Hello Boss! $g. Model: $($cfg.default_model)" Cyan
    C "  Type a task, or 'help' to see commands." DarkGray
    Write-Host ""
}

# ── Agent settings editor ─────────────────────────────────────────────────────
function Edit-AgentSettings($ag, $cfg) {
    while ($true) {
        Clear-Host
        Write-Host ""
        C "  +===========================================+" DarkCyan
        C "  |  AGENT SETTINGS: $($ag.name.PadRight(25))|" Cyan
        C "  +===========================================+" DarkCyan
        Write-Host ""
        $fields = @(
            @{n="1"; k="name";           l="Name"},
            @{n="2"; k="description";    l="Description"},
            @{n="3"; k="task_prompt";    l="Task Prompt"},
            @{n="4"; k="model";          l="Model"},
            @{n="5"; k="max_steps";      l="Max Steps"},
            @{n="6"; k="timeout_secs";   l="Timeout (secs)"},
            @{n="7"; k="auto_approve";   l="Auto-Approve (dangerous cmds)"},
            @{n="8"; k="autostart";      l="Autostart (Task Scheduler)"},
            @{n="9"; k="schedule";       l="Schedule [boot|logon|daily|daily9|daily18|hourly|never]"},
            @{n="10";k="schedule_time";  l="Schedule Time (HH:mm, for daily)"},
            @{n="11";k="working_dir";    l="Working Directory"},
            @{n="12";k="run_hidden";     l="Run Hidden (background)"},
            @{n="13";k="notify_desktop"; l="Desktop Notification on complete"},
            @{n="14";k="enabled";        l="Enabled"}
        )
        foreach ($f in $fields) {
            $val = $ag."$($f.k)"
            $valColor = if ($val -eq $true) { "Green" } elseif ($val -eq $false) { "Red" } else { "White" }
            CL "  [$($f.n.PadLeft(2))] $($f.l.PadRight(40))" DarkGray
            C $val $valColor
        }
        Write-Host ""
        C "  [r] Run agent now     [s] Save and return     [x] Cancel" DarkGray
        Write-Host ""
        $choice = Read-Host "  Edit field number (or r/s/x)"

        switch ($choice.Trim().ToLower()) {
            "s" {
                Save-Agent $ag
                # Handle autostart change
                if ($ag.autostart -and $ag.schedule -ne "never") {
                    Register-AgentSchedule $ag
                } else {
                    Unregister-AgentSchedule $ag.name
                }
                C "  [OK] Agent '$($ag.name)' saved." Green
                Start-Sleep 1
                return $ag
            }
            "x" { return $ag }
            "r" {
                C "  Running agent now..." Cyan
                Invoke-Agent $ag.task_prompt $ag.model $ag.max_steps $ag.auto_approve $ag.ollama_url
                $ag.last_run = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
                Save-Agent $ag
                Read-Host "  Press Enter to return to settings"
            }
            default {
                $fMatch = $fields | Where-Object { $_.n -eq $choice.Trim() }
                if (-not $fMatch) { C "  Invalid choice." Red; Start-Sleep 1; continue }
                $key = $fMatch.k
                $cur = $ag."$key"
                if ($cur -is [bool]) {
                    $ag."$key" = -not $cur
                    C "  Toggled '$key' to $($ag.$key)" Green
                } else {
                    $newVal = Read-Host "  New value for '$key' (current: $cur)"
                    if (-not [string]::IsNullOrWhiteSpace($newVal)) {
                        # type coerce
                        if ($cur -is [int] -or $cur -is [long]) {
                            $ag."$key" = [int]$newVal
                        } else {
                            $ag."$key" = $newVal.Trim()
                        }
                    }
                }
            }
        }
    }
}

# ── Agents management screen ──────────────────────────────────────────────────
function Manage-Agents($cfg) {
    while ($true) {
        Clear-Host
        Write-Host ""
        C "  +===================================+" DarkCyan
        C "  |  MY AGENTS                        |" Cyan
        C "  +===================================+" DarkCyan
        Write-Host ""
        $agents = List-Agents
        if ($agents.Count -eq 0) {
            C "  No agents yet. Create one with 'n'." DarkGray
        } else {
            $i = 1
            foreach ($ag in $agents) {
                $status = if ($ag.enabled) { if ($ag.autostart) { "[AUTO]" } else { "[ON]" } } else { "[OFF]" }
                $statusColor = if ($ag.enabled) { if ($ag.autostart) { "Green" } else { "Cyan" } } else { "DarkGray" }
                $schInfo = if ($ag.autostart) { " | $($ag.schedule)" } else { "" }
                CL "  [$i] " DarkGray
                CL "$status " $statusColor
                CL "$($ag.name.PadRight(30))" White
                C "$schInfo" DarkGray
                $i++
            }
        }
        Write-Host ""
        C "  [n] New agent   [1-N] Edit agent   [d N] Delete agent   [b] Back" DarkGray
        Write-Host ""
        $choice = Read-Host "  Choice"
        $c = $choice.Trim().ToLower()

        if ($c -eq "b") { return }
        elseif ($c -eq "n") {
            $name = Read-Host "  Agent name (no spaces)"
            if ([string]::IsNullOrWhiteSpace($name)) { continue }
            $task = Read-Host "  What should this agent do? (task prompt)"
            if ([string]::IsNullOrWhiteSpace($task)) { continue }
            $ag = New-AgentSettings $name.Trim() $task.Trim()
            $ag.model = $cfg.default_model
            $ag.ollama_url = $cfg.ollama_url
            Save-Agent $ag
            C "  [OK] Agent '$name' created. Opening settings..." Green
            Start-Sleep 1
            Edit-AgentSettings $ag $cfg | Out-Null
        }
        elseif ($c -match "^d\s+(\d+)$") {
            $idx = [int]$Matches[1] - 1
            if ($idx -ge 0 -and $idx -lt $agents.Count) {
                $ag = $agents[$idx]
                $confirm = Read-Host "  Delete '$($ag.name)'? (y/N)"
                if ($confirm -eq "y" -or $confirm -eq "Y") {
                    Unregister-AgentSchedule $ag.name
                    Remove-Item (Agent-Path $ag.name) -ErrorAction SilentlyContinue
                    C "  [OK] Deleted." Green; Start-Sleep 1
                }
            }
        }
        elseif ($c -match '^\d+$') {
            $idx = [int]$c - 1
            if ($idx -ge 0 -and $idx -lt $agents.Count) {
                Edit-AgentSettings $agents[$idx] $cfg | Out-Null
            }
        }
    }
}

# ── Global settings screen ────────────────────────────────────────────────────
function Manage-GlobalSettings($cfg) {
    while ($true) {
        Clear-Host
        Write-Host ""
        C "  +===================================+" DarkCyan
        C "  |  GLOBAL SETTINGS                  |" Cyan
        C "  +===================================+" DarkCyan
        Write-Host ""
        C "  [1] Default model         : $($cfg.default_model)" White
        C "  [2] Ollama URL            : $($cfg.ollama_url)" White
        $bossAS = if ($cfg.boss_autostart) { "ON  (opens on login)" } else { "OFF" }
        $bossColor = if ($cfg.boss_autostart) { "Green" } else { "Red" }
        CL "  [3] Boss Terminal Autostart: " White; C $bossAS $bossColor
        Write-Host ""
        C "  [s] Save   [b] Back" DarkGray
        Write-Host ""
        $ch = Read-Host "  Choice"
        switch ($ch.Trim()) {
            "1" { $v = Read-Host "  New default model"; if ($v) { $cfg.default_model = $v.Trim() } }
            "2" { $v = Read-Host "  New Ollama URL"; if ($v) { $cfg.ollama_url = $v.Trim(); $script:OllamaUrl = $v.Trim() } }
            "3" {
                $cfg.boss_autostart = -not $cfg.boss_autostart
                if ($cfg.boss_autostart) { Register-BossOnLogon } else { Unregister-BossOnLogon }
                C "  Boss autostart: $($cfg.boss_autostart)" $(if($cfg.boss_autostart){"Green"}else{"Red"})
            }
            "s" { Save-GlobalConfig $cfg; C "  [OK] Saved." Green; Start-Sleep 1; return $cfg }
            "b" { return $cfg }
        }
    }
}

# ── History view ──────────────────────────────────────────────────────────────
function Show-History-Menu {
    $h = Load-History
    if (-not $h -or ($h -is [System.Array] -and $h.Count -eq 0)) { C "  No history." Yellow; Read-Host "  Press Enter"; return $null }
    if ($h -isnot [System.Array]) { $h = @($h) }
    Clear-Host
    Write-Host ""
    C "  +===========================+" DarkCyan
    C "  |  HISTORY (last 20)        |" Cyan
    C "  +===========================+" DarkCyan
    Write-Host ""
    $shown = [Math]::Min(20, $h.Count)
    for ($i = 0; $i -lt $shown; $i++) {
        $entry = $h[$i]
        $task = $entry.task; if ($task.Length -gt 55) { $task = $task.Substring(0,52)+"..." }
        CL "  [$($i+1)] " DarkGray; CL "$($entry.timestamp) " Gray; C $task White
    }
    Write-Host ""
    $choice = Read-Host "  Re-run a task (1-$shown) or Enter to cancel"
    if ($choice -match '^\d+$') {
        $idx = [int]$choice - 1
        if ($idx -ge 0 -and $idx -lt $shown) { return $h[$idx].task }
    }
    return $null
}

# ── Help ──────────────────────────────────────────────────────────────────────
function Show-Help {
    Write-Host ""
    C "  COMMANDS:" Cyan
    $cmds = @(
        @("agents",      "Manage, create, edit, delete agents + autostart"),
        @("settings",    "Global settings (model, URL, Boss autostart)"),
        @("history",     "View and re-run past tasks"),
        @("model <name>","Change model for this session"),
        @("models",      "List and pick an installed model"),
        @("steps <N>",   "Change max steps for this session"),
        @("yes",         "Toggle auto-approve commands"),
        @("status",      "Check Ollama and scheduled tasks"),
        @("help",        "Show this menu"),
        @("exit",        "Quit")
    )
    foreach ($cmd in $cmds) {
        CL "  $($cmd[0].PadRight(16))" Yellow; C $cmd[1] White
    }
    Write-Host ""
    C "  Or just type anything to run it as an agent task." DarkGray
    Write-Host ""
}

function Show-Status($cfg) {
    Write-Host ""
    C "  --- System Status ---" Cyan
    if (Test-Ollama $cfg.ollama_url) { C "  Ollama: Running at $($cfg.ollama_url)" Green }
    else { C "  Ollama: NOT RUNNING ($($cfg.ollama_url))" Red }
    if (Test-Path $AgentExe) { C "  Agent:  Binary found" Green }
    else { C "  Agent:  NOT BUILT (run: cargo build --release --bin hybrid-hub)" Red }
    $tasks = Get-ScheduledTask -TaskPath "$TaskFolder\" -ErrorAction SilentlyContinue
    C "  Scheduled tasks: $(@($tasks).Count) registered" White
    if ($tasks) { $tasks | ForEach-Object { C "    - $($_.TaskName) [$($_.State)]" DarkGray } }
    $agents = List-Agents
    C "  Agents: $($agents.Count) total, $(($agents | Where-Object { $_.autostart }).Count) with autostart" White
    Write-Host ""
}

# ══════════════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════════════
Ensure-Dirs
$cfg = Load-GlobalConfig

# First-run wizard
if ($cfg.first_run) { First-Run-Setup $cfg; $cfg = Load-GlobalConfig }

Show-Banner $cfg
Ensure-Ollama
Write-Host ""

# Session overrides
$script:SessionModel = $cfg.default_model
$script:MaxSteps     = 15
$script:AutoYes      = $false

while ($true) {
    Write-Host ""
    CL "  " White; CL "Boss" Magenta; CL " > " DarkGray
    $userInput = Read-Host

    if ([string]::IsNullOrWhiteSpace($userInput)) { continue }
    $t = $input.Trim()

    switch -Regex ($t.ToLower()) {
        "^(exit|quit|bye)$" {
            C "`n  Goodbye Boss! All agents continue running in the background." Cyan
            exit 0
        }
        "^help$"     { Show-Help }
        "^agents$"   { Manage-Agents $cfg }
        "^settings$" { $cfg = Manage-GlobalSettings $cfg; Show-Banner $cfg }
        "^history$"  { $pt = Show-History-Menu; if ($pt) { Invoke-Agent $pt $script:SessionModel $script:MaxSteps $script:AutoYes $cfg.ollama_url } }
        "^status$"   { Show-Status $cfg }
        "^models$" {
            Write-Host "`n  Querying Ollama for installed models..." -ForegroundColor DarkGray
            $out = ollama list
            if (-not $out) {
                C "  Failed to retrieve models from Ollama." Red
                continue
            }
            $lines = $out -split "`n" | Where-Object { $_.Trim() -ne "" }
            if ($lines.Count -le 1) {
                C "  No models installed. Try 'ollama pull llama3.2:1b'" Yellow
                continue
            }
            Write-Host ""
            C "  +===========================+" DarkCyan
            C "  |  INSTALLED MODELS         |" Cyan
            C "  +===========================+" DarkCyan
            Write-Host ""
            
            $modelList = @()
            for ($i = 1; $i -lt $lines.Count; $i++) {
                $line = $lines[$i]
                if ($line -match '^(\S+)') {
                    $mName = $Matches[1]
                    $modelList += $mName
                    CL "  [$i] " DarkGray; C $mName White
                }
            }
            Write-Host ""
            $choice = Read-Host "  Select a model (1-$($modelList.Count)) or Enter to cancel"
            if ($choice -match '^\d+$') {
                $idx = [int]$choice - 1
                if ($idx -ge 0 -and $idx -lt $modelList.Count) {
                    $script:SessionModel = $modelList[$idx]
                    C "  Model set to: $($script:SessionModel)" Green
                }
            }
        }
        "^model\s+(\S+)$" {
            $script:SessionModel = $Matches[1]
            C "  Model set to: $($script:SessionModel)" Green
        }
        "^steps\s+(\d+)$" {
            $script:MaxSteps = [int]$Matches[1]
            C "  Max steps: $($script:MaxSteps)" Green
        }
        "^yes$" {
            $script:AutoYes = -not $script:AutoYes
            C "  Auto-approve: $($script:AutoYes)" $(if($script:AutoYes){"Yellow"}else{"Green"})
        }
        default {
            Invoke-Agent $t $script:SessionModel $script:MaxSteps $script:AutoYes $cfg.ollama_url
        }
    }
}
