# Wizard list — verify /wizard list and /wizard <name> commands
# Tests the wizard slash command interface and form rendering.

Set Width 140
Set Height 34
Set Connection "mock"

ExpectPrompt "> "

# ── List available wizards ──────────────────────────────────────────

Type "/wizard list"
Enter
Sleep 500ms
Expect "setup" output
Expect "new_project" output
Expect "plugin_export" output
Expect "recompile" output

# ── Open a wizard form ──────────────────────────────────────────────

Type "/wizard recompile"
Enter
Sleep 500ms
Expect "Recompile"
Expect "Global Variables"
Expect "Fonts"
Expect "Audio Files"
Expect "Images"

# Cancel the wizard with double-Escape
Escape
Sleep 100ms
Escape
Sleep 300ms
ExpectPrompt "> "
