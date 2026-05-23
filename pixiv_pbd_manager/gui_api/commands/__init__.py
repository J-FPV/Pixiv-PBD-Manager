# Command handler modules. Each module defines a small set of named functions
# with the signature (payload, emit) -> result; the package __init__ wires them
# into the COMMANDS dispatch dict that run_command consults.
