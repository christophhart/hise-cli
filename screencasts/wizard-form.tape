# Wizard form — navigate fields, toggle, choose, and cancel
# Tests the wizard TUI form interaction without executing.

Set Width 140
Set Height 34
Set Connection "mock"

ExpectPrompt "> "

# ── Open the new_project wizard ─────────────────────────────────────

Type "/wizard new_project"
Enter
Sleep 500ms
Expect "Create New Project"
Expect "Project Name"

# ── Navigate between fields with arrow keys ─────────────────────────

# Type a project name
Enter
Sleep 100ms
Type "TestProject"
Escape
Sleep 300ms
Expect "TestProject"

# Move to next field (Location)
Down
Sleep 200ms
Expect "Location"

# Move to the toggle field
Down
Sleep 200ms
Expect "Use as default"

# Toggle it
Enter
Sleep 200ms

# Move to the choice field (Template)
Down
Sleep 200ms
Expect "Project Template"

# Cycle through choice items
Enter
Sleep 100ms
Down
Sleep 100ms
Expect "Import HXI"

# Cancel the wizard
Escape
Sleep 100ms
Escape
Sleep 300ms
ExpectPrompt "> "
