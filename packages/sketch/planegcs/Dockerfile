# Toolchain for Extrudo's planegcs WASM (ADR-0002). Pinned so the build is
# reproducible: the tag is part of the input hash.
FROM emscripten/emsdk:6.0.10
RUN apt-get update && apt-get install -qqy libeigen3-dev libboost-dev && mkdir /inc && ln -sf /usr/include/boost /inc
