# Builder validation — type errors caught locally, suggestions
# Tests smart client local validation against moduleList.json.

Set Width 80
Set Height 24
Set Connection "mock"

# Enter builder mode
Type "/builder"
Enter
Sleep 300ms
ExpectMode "builder"

# Valid module type
Type "add AHDSR"
Enter
Sleep 300ms
Expect "add AHDSR"

# Invalid module type with suggestion
Type "add AHDRS"
Enter
Sleep 300ms
Expect "Unknown module type"
Expect "Did you mean"

# Completely unknown module
Type "add FakeModule"
Enter
Sleep 300ms
Expect "Unknown module type"

# Exit
Type "/exit"
Enter
Sleep 300ms
ExpectMode "root"
