# Script REPL — evaluate expressions, see results (mock HISE)
# Tests script mode with mock responses.

Set Width 80
Set Height 24
Set Connection "mock"
Set MockResponse "/api/repl" {"success": true, "result": "REPL Evaluation OK", "value": 44100.0, "logs": [], "errors": []}

# Enter script mode
Type "/script"
Enter
Sleep 300ms
ExpectMode "script"

# Evaluate an expression
Type "Engine.getSampleRate()"
Enter
Sleep 500ms
Expect "44100"

# Exit
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
