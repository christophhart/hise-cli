/hise launch
/builder
reset
add Script FX
/exit

/dsp
use Script FX
init myfx embedded

add control.xfader as fader
add container.multi as channel_splitter
cd channel_splitter
add core.gain as L
add core.gain as R
cd ..
create_parameter myfx.Value
connect myfx.Value to fader.Value
connect fader.0 to L.Gain
connect fader.1 to R.Gain
/expect get source of L.Gain is fader.0
/dsp

/hise shutdown