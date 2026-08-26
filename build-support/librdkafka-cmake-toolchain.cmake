# Injected into CMake dependency builds via CMAKE_TOOLCHAIN_FILE in
# `.cargo/config.toml`. In this workspace that means exactly one build:
# librdkafka, which rdkafka-sys builds with CMake on Windows (the `cmake-build`
# feature) and with configure+make everywhere else.
#
# Why this exists
# ---------------
# librdkafka's CMake build has no `WITH_SNAPPY` option, and nothing ever sets
# that variable — not librdkafka's own CMakeLists.txt, not rdkafka-sys's build
# script (which does define WITH_ZLIB, WITH_ZSTD, WITH_SSL, WITH_SASL and
# ENABLE_LZ4_EXT, and nothing for Snappy). On Unix that is harmless, because
# Snappy is turned on further downstream regardless:
# `packaging/cmake/config.h.in` carries a literal `#define WITH_SNAPPY 1`, and
# the configure/mklove path does `mkl_allvar_set WITH_SNAPPY WITH_SNAPPY y`.
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
#
# Why forcing the variable is only half of it
# -------------------------------------------
# v0.37.0 shipped with this file in place and still had `WITH_SNAPPY=0` baked
# into the released Windows binary — provably, since librdkafka only compiles
# the string "snappy not enabled at build time" (rdkafka_conf.c's
# `_UNSUPPORTED_SNAPPY`) into the library when the codec is *missing*, and that
# string is present in the shipped `kafkaoxide-app.exe`. A toolchain file that
# is never delivered fails silently and looks exactly like one that worked, so
# `.cargo/config.toml` now sets the variable with `force = true` (a
# `CMAKE_TOOLCHAIN_FILE` already present in the environment — vcpkg
# integrations set precisely that — otherwise wins over the workspace value and
# this file is simply never read), and the checks below turn the other silent
# cases into loud ones.
#
# Deliberately NOT forced here: `WITH_ZLIB` and `WITH_ZSTD`. rdkafka-sys derives
# both from Cargo features (see backend/kafka/Cargo.toml), which is the one
# place they should be decided; forcing them on would break any build that
# leaves a feature off, since librdkafka then links `${ZSTD_LIBRARY}` /
# requires `find_package(ZLIB)` unconditionally and fails at generate time when
# they are NOTFOUND. They are *asserted* instead — same guarantee for the user
# (no shipped build can quietly lose a codec), without overriding the decision.
#
# lz4 needs neither: librdkafka bundles its own copy and compiles it in
# unconditionally, whatever `ENABLE_LZ4_EXT` says.
#
# None of this is the guarantee that any of it worked. That is
# `backend/kafka/src/build_info.rs` (asks the built librdkafka what it actually
# supports), the app's own `--librdkafka-features` flag (asks the *shipped*
# executable), and `backend/kafka/tests/compression_codecs.rs` (reads real
# compressed topics off a real broker).

set(WITH_SNAPPY ON CACHE BOOL "librdkafka: compile in Snappy decompression" FORCE)

# CMake includes a toolchain file for every `try_compile` it runs during
# compiler detection too, and those throwaway projects carry none of the parent
# cache — so only assert when this is the real librdkafka configure, which is
# the only source tree here with `src/rdkafka.h` in it.
if(EXISTS "${CMAKE_SOURCE_DIR}/src/rdkafka.h")
  foreach(codec ZLIB ZSTD)
    if(NOT WITH_${codec})
      message(FATAL_ERROR
        "librdkafka is being built with WITH_${codec} off. A topic compressed "
        "with that codec cannot be read at all — every poll fails with "
        "\"Local: Not Implemented\" — so this is a broken build rather than a "
        "smaller one, and failing here beats shipping it. WITH_${codec} comes "
        "from a Cargo feature on rdkafka in backend/kafka/Cargo.toml.")
    endif()
  endforeach()
endif()

# One more trap, learned the hard way: editing this file does not rebuild
# anything. cmake-rs reads `CMAKE_TOOLCHAIN_FILE` through a helper that never
# emits `cargo:rerun-if-env-changed`, so cargo has no idea the codec
# configuration changed and relinks the librdkafka it built last time — and
# CMake would ignore a newly-passed toolchain file for an already-configured
# build tree anyway. After changing anything here, run:
#
#     cargo clean -p rdkafka-sys
#
# The release workflow does exactly that before every build.
