# Tab completion — verify completion engine provides candidates
# This tape tests completion via the Session.complete() method
# without rendering the TUI (engine-level validation).

Set Width 80
Set Height 24
Set Connection "mock"

# Start in root mode
ExpectPrompt "> "

# Slash command completion at root
Type "/he"
# Session.complete("/he") should return /help as a match

# Enter builder mode
Type "/builder"
Enter
Sleep 300ms
ExpectMode "builder"

# Keyword completion in builder
Type "a"
# complete("a") should return "add" keyword

# Module type completion after "add "
Type "dd AH"
# complete("add AH") should return AHDSR

# Exit builder
Type "/exit"
Enter
Sleep 300ms

# Enter script mode
Type "/script"
Enter
Sleep 300ms
ExpectMode "script"

# Namespace completion
Type "Sy"
# complete("Sy") should return Synth

# Method completion after dot
Type "nth.add"
# complete("Synth.add") should return addNoteOn, addNoteOff

# Exit script
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
