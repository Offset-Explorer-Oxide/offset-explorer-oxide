# Injected into CMake dependency builds via CMAKE_TOOLCHAIN_FILE in
# `.cargo/config.toml`. In this workspace that means exactly one build:
# librdkafka, which rdkafka-sys builds with CMake on Windows (the `cmake-build`
# feature) and with configure+make everywhere else.
#
# Why this exists
# ---------------
# librdkafka's CMake build has no `WITH_SNAPPY` option, and nothing ever sets
# that variable — not librdkafka's own CMakeLists.txt, not rdkafka-sys's build
# script. On Unix that is harmless, because Snappy is turned on further
# downstream regardless: `packaging/cmake/config.h.in` carries a literal
# `#define WITH_SNAPPY 1`, and the configure/mklove path does
# `mkl_allvar_set WITH_SNAPPY WITH_SNAPPY y`.
#
# On Windows it is not harmless. `WITHOUT_WIN32_CONFIG` defaults to ON there,
# which does two things: librdkafka's sources stop reading the generated
# `config.h` at all and read `src/win32_config.h` instead (where every `WITH_*`
# default is itself `#ifndef WITHOUT_WIN32_CONFIG`'d out), and
# `src/CMakeLists.txt` starts deriving each `WITH_*` from a CMake variable:
#
#     if(WITH_SNAPPY)
#       list(APPEND rdkafka_compile_definitions WITH_SNAPPY=1)
#     else()
#       list(APPEND rdkafka_compile_definitions WITH_SNAPPY=0)   # <- always this
#     endif()
#
# An unset variable is false, so every Windows build compiles `WITH_SNAPPY=0`.
# `#if WITH_SNAPPY` in `rdkafka_msgset_reader.c` then drops the Snappy branch of
# the decompression switch, and Snappy-compressed topics fall through to
# `default:` — which returns exactly the `Local: Not Implemented` users hit.
# Forcing the variable on is the entire fix.
#
# Deliberately NOT forced here: `WITH_ZSTD`. rdkafka-sys already derives that
# from the `zstd` Cargo feature (see backend/kafka/Cargo.toml), which is the one
# place it should be decided. Forcing it here would also break any build that
# leaves that feature off, since librdkafka then links `${ZSTD_LIBRARY}`
# unconditionally and fails at generate time when it is NOTFOUND.
#
# This file is not the guarantee that any of it worked. That is
# `backend/kafka/src/build_info.rs`, which asks the built librdkafka what it
# actually supports.

set(WITH_SNAPPY ON CACHE BOOL "librdkafka: compile in Snappy decompression" FORCE)
