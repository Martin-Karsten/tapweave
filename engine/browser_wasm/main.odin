package main

import engine_runtime "../runtime"

// Production transport only. No test trace exports are linked into the player.
main :: proc() {
    _ = engine_runtime.oe_abi_control()
}
