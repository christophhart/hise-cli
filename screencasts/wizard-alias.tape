# Wizard alias — verify /setup alias opens the setup wizard
# Tests that wizard aliases are registered as top-level slash commands.

Set Width 140
Set Height 34
Set Connection "mock"

ExpectPrompt "> "

# ── /setup alias should open the setup wizard ──────────────────────

Type "/setup"
Enter
Sleep 500ms
Expect "HISE Setup"
Expect "Install Path"

# Cancel
Escape
Sleep 100ms
Escape
Sleep 300ms
ExpectPrompt "> "

# ── Tab completion should include the alias ────────────────────────

Type "/set"
Sleep 200ms
Tab
Sleep 300ms
Expect "/setup"

# Clear
Backspace 6
Sleep 100ms
