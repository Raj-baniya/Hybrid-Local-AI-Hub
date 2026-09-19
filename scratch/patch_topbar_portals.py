import os

file_path = "e:/Hybrid Local AI Hub/ui/components/TopBar.tsx"
with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Add ReactDOM import
if "import ReactDOM" not in content:
    content = content.replace("import React, { useEffect } from 'react';", "import React, { useEffect } from 'react';\nimport ReactDOM from 'react-dom';")

# Portal for PreRunDialog
old_prerun = """      {isPreRunDialogOpen && (
        <PreRunDialog 
          onConfirm={handleRunConfirm}
          onCancel={() => setPreRunDialogOpen(false)} 
        />
      )}"""
new_prerun = """      {isPreRunDialogOpen && ReactDOM.createPortal(
        <PreRunDialog 
          onConfirm={handleRunConfirm}
          onCancel={() => setPreRunDialogOpen(false)} 
        />,
        document.body
      )}"""
content = content.replace(old_prerun, new_prerun)

# Portal for preflightStatus
old_preflight = """      {preflightStatus && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,"""
new_preflight = """      {preflightStatus && ReactDOM.createPortal(
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,"""
content = content.replace(old_preflight, new_preflight)

# Close portal for preflightStatus
old_preflight_end = """              {preflightStatus}
            </div>
          </div>
        </div>
      )}"""
new_preflight_end = """              {preflightStatus}
            </div>
          </div>
        </div>,
        document.body
      )}"""
content = content.replace(old_preflight_end, new_preflight_end)

# Close portal for settings modal if it's there
old_settings = """      {isSettingsOpen && (
        <SettingsModal onClose={() => setIsSettingsOpen(false)} />
      )}"""
new_settings = """      {isSettingsOpen && ReactDOM.createPortal(
        <SettingsModal onClose={() => setIsSettingsOpen(false)} />,
        document.body
      )}"""
content = content.replace(old_settings, new_settings)


with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("TopBar.tsx portaling patched successfully.")
